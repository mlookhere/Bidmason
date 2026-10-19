import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {buildReviewWorkbench} from "../lib/intake-review-workbench.ts";
import {companyPolicySha256} from "../lib/company-policy-fingerprint.ts";
import {createTrustedTypedNoteScopeCommit}
  from "../lib/trusted-typed-note-scope-commit.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE="11111111-1111-4111-8111-111111111111";
const REQUEST="22222222-2222-4222-8222-222222222222";
const original={kind:"typed-note",text:"Paint 🧱 two rooms"};
const textHash=createHash("sha256").update(original.text).digest("hex");
const review=prepareExtractionReview(original,[{serviceCode:"painting",units:2,
  start:0,end:original.text.length,excerpt:original.text}]);
const policy={revision:1,pricing:{
  policyId:"synthetic-v1",currency:"USD",minimum:{rule:"none",cents:0},
  calculationOrder:"discount-then-surcharge",services:{
    painting:{label:"Painting",unit:"room",rateCents:15000,
      billing:"charged",optionalAddon:true},
  }},tax:{method:"none",bps:0}};
const key=buildReviewWorkbench(original,review,policy).key;
const request={session:"signed-in",organizationId:ORG,sourceId:SOURCE,
  reviewKey:key,selectedIndices:[0],acceptedAddonCodes:["painting"]};
const starting={organizationId:ORG,sourceId:SOURCE,revision:2,
  original,review,scopeReview:null,extractionAudit:[{
    sourceRevision:2,actorId:ACTOR,sourceSha256:review.sourceSha256,
    candidatesSha256:review.candidatesSha256,
  }],creationAudit:{actorId:ACTOR,requestId:REQUEST,textSha256:textHash}};

function fixture(options={}) {
  let current=structuredClone(starting);
  let activePolicy=structuredClone(policy),active=true,who=ACTOR;
  let currentMember=true,sourceReads=0;
  let authCalls=0, writes=0;
  const calls=[];
  const auth={async verifyActiveSession(token) {
    authCalls++;
    if(!active || token!=="signed-in")throw Error("Session revoked");
    if(authCalls===1)options.afterFirstAuth?.();
    options.afterAuth?.(authCalls);
    return {userId:who};
  }};
  const db={async query(sql,params) {
    calls.push({sql,params});
    if(sql.includes("read_typed_note_for_extraction")) {
      if(params[1]!==ACTOR || !currentMember)throw Error("Creator denied");
      const sourceRow={record:structuredClone(current)};
      sourceReads++;
      if (options.changeEvidenceAfterFirstSourceRead && sourceReads===1) {
        current.review.candidates[0].excerpt="forged";
      }
      if (options.revokeAfterFirstSourceRead && sourceReads===1) {
        currentMember=false;
      }
      // Simulate membership revoked just AFTER a successful private source
      // read-back, before the final privileged policy query.
      if (options.revokeAfterReadback && sourceReads===2) currentMember=false;
      const rows=[sourceRow];
      options.decorateRows?.(sql,rows);
      return {rows};
    }
    if(sql.includes("active_policy_heads")) {
      assert.ok(sql.includes("join public.bm_memberships m"));
      assert.match(sql,/for share of h,v,m/);
      assert.deepEqual(params,[ORG,ACTOR]);
      if(!currentMember) return {rows:[]};
      const snapshot=structuredClone(activePolicy);
      if (options.changePolicyAfterFirstRead) {
        activePolicy={...activePolicy,revision:2};
      }
      const rows=[{revision:snapshot.revision,
        policy_sha256:companyPolicySha256(activePolicy),
        policy:snapshot,submitted_by:ACTOR,reviewed_by:OTHER}];
      options.decorateRows?.(sql,rows);
      return {rows};
    }
    if(!sql.includes("commit_typed_note_scope_review"))throw Error("Unexpected SQL");
    writes++;
    if(params[1]!==ACTOR || current.revision!==2)throw Error("CAS stale");
    const scope=JSON.parse(params[5]);
    if(scope.reviewKey!==key || scope.sourceSha256!==review.sourceSha256)
      throw Error("Forged CAS input");
    current={...current,revision:3,scopeReview:structuredClone(scope)};
    options.afterWrite?.({revoke:()=>{active=false;},
      switchActor:()=>{who=OTHER;},
      changePolicy:()=>{activePolicy={...policy,revision:2};},
      tamper:()=>{current.scopeReview.reviewedSelectionSha256="0".repeat(64);},
      tamperCreation:()=>{current.creationAudit.requestId=
        "33333333-3333-4333-8333-333333333333";}});
    if(options.lostAck)throw Error("Provider acknowledgement lost");
    const rows=[{source_revision:3,
      reviewed_selection_sha256:scope.reviewedSelectionSha256}];
    options.decorateRows?.(sql,rows);
    return {rows};
  }};
  return {api:createTrustedTypedNoteScopeCommit(auth,db),calls,
    get writes(){return writes;},get authCalls(){return authCalls;},
    get record(){return structuredClone(current);},
    switchActor(){who=OTHER;},revoke(){active=false;},
    changePolicy(){activePolicy={...policy,revision:2};},
    tamperPolicy(){activePolicy={...policy,
      pricing:{...policy.pricing,services:{}}};},
  };
}

test("fresh Auth + approved policy + private CAS + primary readback produce review-only draft",async()=>{
  const f=fixture();
  const result=await f.api.commit(request);
  assert.equal(result.state,"reviewed-for-proposal-draft");
  assert.equal(result.revision,3);
  assert.equal(result.reviewedBy,ACTOR);
  assert.equal(f.writes,1);
  assert.equal(f.authCalls,6);
  assert.deepEqual(f.calls.map(x=>x.sql.includes("commit_typed_note_scope_review")),
    [false,false,true,false,false]);
  assert.deepEqual(f.calls[2].params.slice(0,5),[
    ORG,ACTOR,SOURCE,review.sourceSha256,review.candidatesSha256]);
  assert.equal(f.record.scopeReview.reviewKey,key);
  assert.equal(f.record.original.text,original.text);
  assert.equal(f.record.extractionAudit.length,1);
  assert.equal(Object.hasOwn(result,"send"),false);
  assert.equal(Object.hasOwn(result,"approved"),false);
});

test("invalid, forged, unsorted and malformed selection cannot reach Auth or SQL",async()=>{
 const changes=[
  {organizationId:"other"}, {sourceId:"nope"}, {reviewKey:"bad"},
  {selectedIndices:[]}, {selectedIndices:[0,0]},
  {selectedIndices:[2,1]}, {selectedIndices:[-1]},
  {acceptedAddonCodes:["painting","painting"]},
  {acceptedAddonCodes:["bad code"]}, {approved:true}, {actorId:OTHER},
 ];
 for(const change of changes) {
   const f=fixture();
   await assert.rejects(f.api.commit({...request,...change}),TypeError);
   assert.equal(f.authCalls,0);
   assert.equal(f.calls.length,0);
 }
});

test("stale key, invalid service and unacknowledged optional service do not write",async()=>{
 for(const change of [
  {reviewKey:"f".repeat(64)},
  {selectedIndices:[1]},
  {acceptedAddonCodes:[]},
  {acceptedAddonCodes:["unselected"]},
 ]) {
  const f=fixture();
  await assert.rejects(f.api.commit({...request,...change}));
  assert.equal(f.writes,0);
 }
});

test("changed identity, bad active policy and revoked session prevent commit",async()=>{
 const f=fixture();
 f.switchActor();
 await assert.rejects(f.api.commit(request),/Creator denied/);
 assert.equal(f.writes,0);
 const x=fixture();
 x.tamperPolicy();
 await assert.rejects(x.api.commit(request));
 assert.equal(x.writes,0);
 const y=fixture();
 y.revoke();
 await assert.rejects(y.api.commit(request),/Session revoked/);
 assert.equal(y.writes,0);
});

test("lost CAS acknowledgement remains indeterminate and never triggers retry",async()=>{
 const f=fixture({lostAck:true});
 await assert.rejects(f.api.commit(request),/Provider acknowledgement lost/);
 assert.equal(f.writes,1);
 assert.equal(f.record.revision,3);
});
test("revocation or policy change after the only write never claims success",async()=>{
 for(const [afterWrite,pattern] of [
  [({revoke})=>revoke(),/Session revoked/],
  [({changePolicy})=>changePolicy(),/Approved policy changed/],
  [({tamper})=>tamper(),/read-back indeterminate/],
  [({tamperCreation})=>tamperCreation(),/read-back indeterminate/],
 ]) {
  const f=fixture({afterWrite});
  await assert.rejects(f.api.commit(request),pattern);
  assert.equal(f.writes,1);
 }
});


test("revocation after valid source readback cannot pass the final policy lookup",async()=>{
  const f=fixture({revokeAfterReadback:true});
  await assert.rejects(f.api.commit(request),/No unambiguous approved current policy/);
  assert.equal(f.writes,1);
  assert.equal(f.record.revision,3);
  assert.equal(f.calls.filter(x=>x.sql.includes("active_policy_heads")).length,2);
  assert.equal(Object.hasOwn(f.record,"send"),false);
});


test("trusted readWorkbench and preview use private source plus active policy, never write",async()=>{
 const f=fixture(),selector={session:"signed-in",organizationId:ORG,sourceId:SOURCE};
 const workbench=await f.api.readWorkbench(selector);
 assert.equal(workbench.state,"requires-human-service-review");
 assert.equal(workbench.sourceRevision,2);
 assert.equal(workbench.model.key,key);
 assert.equal(workbench.model.rows[0].status,"optional");
 assert.equal(workbench.model.rows[0].excerpt,original.text);
 assert.equal(f.writes,0);
 assert.equal(f.authCalls,5);
 assert.equal(f.calls.length,4);
 const preview=await f.api.preview(request);
 assert.equal(preview.state,"preview-only");
 assert.equal(preview.reviewKey,key);
 assert.equal(preview.sourceId,SOURCE);
 assert.equal(preview.selectedServices[0].addonAccepted,true);
 assert.equal(preview.economics.policySha256,companyPolicySha256(policy));
 assert.equal(f.writes,0);
 assert.equal(f.authCalls,10);
 assert.equal(f.calls.filter(c=>c.sql.includes("commit_typed_note_scope_review")).length,0);
 assert.equal(Object.hasOwn(preview,"approved"),false);
 assert.equal(Object.hasOwn(preview,"send"),false);
});
test("read-only workbench/preview rejects user prices, forged actors and malformed selectors",async()=>{
 const selector={session:"signed-in",organizationId:ORG,sourceId:SOURCE};
 for(const malicious of [
  {...selector,rawSource:original},{...selector,rateCents:1},
  {...selector,actorId:OTHER},{...selector,session:null},
  {...selector,sourceId:"bad"},
 ]) {
  const f=fixture();
  await assert.rejects(f.api.readWorkbench(malicious),TypeError);
  assert.equal(f.calls.length,0);
 }
 for(const malicious of [
  {...request,policy},{...request,approved:true},{...request,actorId:OTHER},
  {...request,selectedIndices:[]},{...request,acceptedAddonCodes:[]},
  {...request,reviewKey:"0".repeat(64)},
 ]) {
  const f=fixture();
  await assert.rejects(f.api.preview(malicious));
  assert.equal(f.writes,0);
 }
});
test("two privileged preview reads detect changed source, policy and revoked access",async()=>{
 const selector={session:"signed-in",organizationId:ORG,sourceId:SOURCE};
 for(const options of [
  {changeEvidenceAfterFirstSourceRead:true},
  {changePolicyAfterFirstRead:true},
  {revokeAfterFirstSourceRead:true},
 ]) {
  for(const operation of ["readWorkbench","preview"]) {
   const f=fixture(options);
   await assert.rejects(f.api[operation](operation==="preview"?request:selector));
   assert.equal(f.writes,0);
  }
 }
 const f=fixture();f.switchActor();
 await assert.rejects(f.api.readWorkbench(selector),/Creator denied/);
 assert.equal(f.writes,0);
 const revoked=fixture();revoked.revoke();
 await assert.rejects(revoked.api.preview(request),/Session revoked/);
 assert.equal(revoked.writes,0);
});

test("read-only scope reconciliation distinguishes absent from exact reviewed evidence",async()=>{
 const f=fixture();
 const prior=await f.api.reconcile(request);
 assert.deepEqual(prior,{state:"unreviewed-at-read",organizationId:ORG,sourceId:SOURCE});
 assert.equal(f.writes,0);
 await f.api.commit(request);
 const matched=await f.api.reconcile(request);
 assert.equal(matched.state,"matching-scope-at-read");
 assert.equal(matched.revision,3);
 assert.equal(matched.reviewedSelectionSha256,f.record.scopeReview.reviewedSelectionSha256);
 assert.equal(f.writes,1);
 assert.equal(f.calls.filter(c=>c.sql.includes("commit_typed_note_scope_review")).length,1);
 assert.equal(Object.hasOwn(matched,"approved"),false);
 assert.equal(Object.hasOwn(matched,"send"),false);
});

test("lost scope acknowledgement can be inspected without a second SQL write",async()=>{
 const f=fixture({lostAck:true});
 await assert.rejects(f.api.commit(request),/Provider acknowledgement lost/);
 const observation=await f.api.reconcile(request);
 assert.equal(observation.state,"matching-scope-at-read");
 assert.equal(f.writes,1);
});

test("scope recovery never treats another selection or new policy as matching",async()=>{
 const changed=fixture();
 await changed.api.commit(request);
 const other=await changed.api.reconcile({...request,reviewKey:"f".repeat(64)});
 assert.equal(other.state,"different-scope-at-read");
 changed.changePolicy();
 const newer=await changed.api.reconcile(request);
 assert.equal(newer.state,"policy-changed-at-read");
 assert.equal(changed.writes,1);
 const damaged=fixture({afterWrite:({tamper})=>tamper()});
 await assert.rejects(damaged.api.commit(request),/read-back indeterminate/);
 const divergent=await damaged.api.reconcile(request);
 assert.equal(divergent.state,"different-scope-at-read");
 assert.equal(damaged.writes,1);
});

test("scope reconciliation fails closed on revocation, source drift and forged request",async()=>{
 const forged=fixture();
 await assert.rejects(forged.api.reconcile({...request,actorId:OTHER}),TypeError);
 assert.equal(forged.calls.length,0);
 const actor=fixture();actor.switchActor();
 await assert.rejects(actor.api.reconcile(request),/Creator denied/);
 assert.equal(actor.writes,0);
 const revoked=fixture();revoked.revoke();
 await assert.rejects(revoked.api.reconcile(request),/Session revoked/);
 assert.equal(revoked.writes,0);
 const changed=fixture({changeEvidenceAfterFirstSourceRead:true});
 await assert.rejects(changed.api.reconcile(request));
 assert.equal(changed.writes,0);
 const permission=fixture({revokeAfterFirstSourceRead:true});
 await assert.rejects(permission.api.reconcile(request));
 assert.equal(permission.writes,0);
});

test("unreviewed scope recovery requires eligible chosen services and optional consent",async()=>{
 // A matching review key authenticates evidence/policy, not a selected service.
 // Ineligible selection must never appear to be a valid pending review.
 for(const invalid of [
   {selectedIndices:[1]},
   {acceptedAddonCodes:[]},
   {acceptedAddonCodes:["unselected"]},
 ]) {
   const f=fixture();
   const result=await f.api.reconcile({...request,...invalid});
   assert.deepEqual(result,{
     state:"different-scope-at-read",organizationId:ORG,sourceId:SOURCE,
   });
   assert.equal(f.writes,0);
   assert.equal(f.calls.length,4);
   assert.equal(f.authCalls,5);
 }
 const valid=fixture();
 assert.equal((await valid.api.reconcile(request)).state,"unreviewed-at-read");
 assert.equal(valid.writes,0);
});


test("readReviewedDraft requires stored scope and returns only source-backed internal preview",async()=>{
 const f=fixture();
 const selector={session:"signed-in",organizationId:ORG,sourceId:SOURCE};
 await assert.rejects(f.api.readReviewedDraft(selector),/persisted reviewed scope/);
 assert.equal(f.writes,0);
 const committed=await f.api.commit(request);
 const callsBefore=f.calls.length;
 const authBefore=f.authCalls;
 const draft=await f.api.readReviewedDraft(selector);
 assert.equal(draft.state,"internal-reviewed-scope-only");
 assert.equal(draft.organizationId,ORG);
 assert.equal(draft.sourceId,SOURCE);
 assert.equal(draft.sourceRevision,3);
 assert.equal(draft.reviewedBy,ACTOR);
 assert.equal(draft.reviewedSelectionSha256,committed.reviewedSelectionSha256);
 assert.equal(draft.preview.state,"preview-only");
 assert.equal(draft.preview.economics.policySha256,companyPolicySha256(policy));
 assert.equal(draft.preview.economics.policyRevision,1);
 assert.equal(draft.preview.selectedServices[0].addonAccepted,true);
 assert.equal(f.writes,1);
 assert.equal(f.calls.length-callsBefore,4);
 assert.equal(f.authCalls-authBefore,5);
 assert.equal(Object.hasOwn(draft,"approved"),false);
 assert.equal(Object.hasOwn(draft,"quote"),false);
 assert.equal(Object.hasOwn(draft,"send"),false);
});
test("readReviewedDraft handles lost acknowledgement without redoing CAS",async()=>{
 const f=fixture({lostAck:true});
 await assert.rejects(f.api.commit(request),/Provider acknowledgement lost/);
 const draft=await f.api.readReviewedDraft({
   session:"signed-in",organizationId:ORG,sourceId:SOURCE,
 });
 assert.equal(draft.state,"internal-reviewed-scope-only");
 assert.equal(draft.reviewedSelectionSha256,f.record.scopeReview.reviewedSelectionSha256);
 assert.equal(f.writes,1);
});
test("readReviewedDraft denies forged selectors, stale policies and corrupted evidence",async()=>{
 const selector={session:"signed-in",organizationId:ORG,sourceId:SOURCE};
 const forged=fixture();
 for(const extra of [{actorId:ACTOR},{rateCents:1},{approved:true},{selectedIndices:[0]}]){
   await assert.rejects(forged.api.readReviewedDraft({...selector,...extra}),TypeError);
 }
 assert.equal(forged.calls.length,0);
 const changed=fixture();
 await changed.api.commit(request);
 changed.changePolicy();
 await assert.rejects(changed.api.readReviewedDraft(selector),
   /Reviewed scope policy superseded/);
 assert.equal(changed.writes,1);
 const tampered=fixture({afterWrite:({tamper})=>tamper()});
 await assert.rejects(tampered.api.commit(request),/read-back indeterminate/);
 await assert.rejects(tampered.api.readReviewedDraft(selector),
   /does not match approved economics/);
 assert.equal(tampered.writes,1);
 const foreign=fixture();await foreign.api.commit(request);
 foreign.switchActor();
 await assert.rejects(foreign.api.readReviewedDraft(selector),/Creator denied/);
 const revoked=fixture();await revoked.api.commit(request);
 revoked.revoke();
 await assert.rejects(revoked.api.readReviewedDraft(selector),/Session revoked/);
 assert.equal(foreign.writes,1);
 assert.equal(revoked.writes,1);
});

test("scope validation parity: preview, commit, recovery and persisted draft",async()=>{
 const f=fixture();
 const selector={session:"signed-in",organizationId:ORG,sourceId:SOURCE};
 const preview=await f.api.preview(request);
 assert.equal(preview.state,"preview-only");
 assert.equal(f.writes,0);
 const committed=await f.api.commit(request);
 assert.equal(committed.reviewedSelectionSha256,preview.reviewedSelectionSha256);
 const recovered=await f.api.reconcile(request);
 assert.equal(recovered.state,"matching-scope-at-read");
 assert.equal(recovered.reviewedSelectionSha256,preview.reviewedSelectionSha256);
 const persisted=await f.api.readReviewedDraft(selector);
 const {reviewKey:_reviewKey,sourceId:_sourceId,...canonicalPreview}=preview;
 assert.deepEqual(persisted.preview,canonicalPreview);
 assert.equal(persisted.reviewedSelectionSha256,preview.reviewedSelectionSha256);
 assert.equal(f.writes,1);
 assert.equal(f.calls.filter(x=>x.sql.includes("commit_typed_note_scope_review")).length,1);
});
test("scope entrypoints all reject noncanonical or unacknowledged selection",async()=>{
 for(const change of [
   {selectedIndices:[0,0]},
   {selectedIndices:[1]},
   {acceptedAddonCodes:[]},
   {acceptedAddonCodes:["not-selected"]},
 ]) {
   const f=fixture();
   await assert.rejects(f.api.preview({...request,...change}));
   await assert.rejects(f.api.commit({...request,...change}));
   if (change.selectedIndices?.length===2) {
     await assert.rejects(f.api.reconcile({...request,...change}),TypeError);
   } else {
     const recovered=await f.api.reconcile({...request,...change});
     assert.equal(recovered.state,"different-scope-at-read");
   }
   assert.equal(f.writes,0);
 }
});


test("all privileged scope methods keep original tenant and selections after first Auth await",async()=>{
  for(const name of ["readWorkbench","preview","reconcile","commit"]){
    const mutable={...request,selectedIndices:[...request.selectedIndices],
      acceptedAddonCodes:[...request.acceptedAddonCodes]};
    const target=name==="readWorkbench"
      ?{session:mutable.session,organizationId:mutable.organizationId,
        sourceId:mutable.sourceId}:mutable;
    const f=fixture({afterFirstAuth(){
      target.session="revoked-changed-caller-reference";
      target.organizationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      target.sourceId="33333333-3333-4333-8333-333333333333";
      if(name!=="readWorkbench"){
        target.reviewKey="0".repeat(64);
        target.selectedIndices[0]=1;
        target.acceptedAddonCodes[0]="unknown";
      }
    }});
    const outcome=await f.api[name](target);
    if(name==="readWorkbench")assert.equal(outcome.state,"requires-human-service-review");
    if(name==="preview")assert.equal(outcome.state,"preview-only");
    if(name==="reconcile")assert.equal(outcome.state,"unreviewed-at-read");
    if(name==="commit"){
      assert.equal(outcome.state,"reviewed-for-proposal-draft");
      assert.deepEqual(f.record.scopeReview.selectedIndices,[0]);
      assert.deepEqual(f.record.scopeReview.acceptedAddonCodes,["painting"]);
      assert.equal(f.writes,1);
    } else assert.equal(f.writes,0);
    for(const call of f.calls){
      assert.equal(call.params[0],ORG);
      if(call.sql.includes("read_typed_note_for_extraction")
        ||call.sql.includes("commit_typed_note_scope_review")){
        assert.equal(call.params[2],SOURCE);
      }
    }
  }
});

test("persisted internal scope handoff retains original tenant across Auth await",async()=>{
  const target={session:"signed-in",organizationId:ORG,sourceId:SOURCE};
  const f=fixture({afterAuth(count){
    // The initial commit has six independent Auth checks; mutate only
    // during the first Auth observation of the subsequent draft handoff.
    if(count===7){
      target.session="revoked-changed-caller-reference";
      target.organizationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      target.sourceId="33333333-3333-4333-8333-333333333333";
    }
  }});
  await f.api.commit(request);
  const actual=await f.api.readReviewedDraft(target);
  assert.equal(actual.state,"internal-reviewed-scope-only");
  assert.equal(actual.organizationId,ORG);
  assert.equal(actual.sourceId,SOURCE);
  assert.equal(f.writes,1);
});

test("scope rejects hidden, inherited and getter-backed directives before Auth/SQL",async()=>{
  const selector={session:"signed-in",organizationId:ORG,sourceId:SOURCE};
  let getterCalls=0;
  const variants=[
    ()=>{const x={...selector};Object.defineProperty(x,"send",{value:true});return x;},
    ()=>{const x={...selector};x[Symbol("approved")]=true;return x;},
    ()=>Object.assign(Object.create({send:true}),selector),
    ()=>{const x={...selector};Object.defineProperty(x,"organizationId",{
      enumerable:true,get(){getterCalls++;throw Error("unsafe tenant getter");}});return x;},
  ];
  for(const build of variants){
    const f=fixture();
    for(const name of ["readWorkbench","readReviewedDraft"]){
      await assert.rejects(f.api[name](build()),/Invalid trusted typed-note workbench selector/);
    }
    assert.equal(f.authCalls,0);
    assert.equal(f.calls.length,0);
  }
  const invalids=[
    ()=>{const x={...request,selectedIndices:[0]};Object.defineProperty(x.selectedIndices,"0",{
      enumerable:true,get(){getterCalls++;throw Error("unsafe index getter");}});return x;},
    ()=>{const x={...request,acceptedAddonCodes:["painting"]};
      Object.defineProperty(x.acceptedAddonCodes,"0",{enumerable:true,
      get(){getterCalls++;throw Error("unsafe addon getter");}});return x;},
    ()=>{const x={...request,selectedIndices:[0]};Object.defineProperty(x.selectedIndices,
      "send",{value:true});return x;},
    ()=>{const x={...request,selectedIndices:new Array(1)};return x;},
  ];
  for(const build of invalids){
    const f=fixture();
    for(const name of ["preview","reconcile","commit"]){
      await assert.rejects(f.api[name](build()),/Invalid internal typed-note scope selection/);
    }
    assert.equal(f.authCalls,0);
    assert.equal(f.calls.length,0);
  }
  assert.equal(getterCalls,0);
});

test("private scope source, policy and commit result arrays deny malicious index getters",async()=>{
  let getters=0;
  for(const which of ["read_typed_note_for_extraction",
    "active_policy_heads","commit_typed_note_scope_review"]){
    const f=fixture({decorateRows(sql,rows){
      if(sql.includes(which)){
        Object.defineProperty(rows,"0",{enumerable:true,
          get(){getters++;throw Error("unsafe SQL row getter");}});
      }
    }});
    if(which==="commit_typed_note_scope_review"){
      await assert.rejects(f.api.commit(request),
        /Human scope CAS result indeterminate/);
      assert.equal(f.writes,1);
    } else {
      await assert.rejects(f.api.commit(request),
        /Creator-owned scope source unavailable|No unambiguous approved current policy/);
      assert.equal(f.writes,0);
    }
  }
  assert.equal(getters,0);
});
