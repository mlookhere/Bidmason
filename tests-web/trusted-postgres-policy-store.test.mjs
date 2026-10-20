import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedPostgresPolicyStore} from "../lib/trusted-postgres-policy-store.ts";
import {submitPolicyDraft,reviewPolicyDraft} from "../lib/company-policy-revisions.ts";

const A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REVIEWER="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const policy={revision:1,pricing:{policyId:"test-one",currency:"USD",
  minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
  services:{office:{label:"Office",unit:"visit",rateCents:7000,billing:"charged"}}},
 tax:{method:"none",bps:0},excludedServiceCodes:[]};
function fixture({afterFirstAuth=()=>{},afterFirstHistory=()=>{},decorate=()=>{}}={}){
  let state=null,authCalls=0,readCalls=0,writes=0;
  const queries=[];
  const auth={async verifyActiveSession(session){
    authCalls++;
    if(session!=="admin" && session!=="review")throw Error("Revoked Auth session");
    if(authCalls===1)afterFirstAuth();
    return {userId:session==="admin"?ADMIN:REVIEWER};
  }};
  const db={async query(sql,params){
    queries.push({sql,params});
    if(params[0]!==A)throw Error("Foreign tenant SQL access blocked");
    const actor=params[1];
    if(sql.includes("read_policy_history")){
      readCalls++;
      const rows=[{history:state===null?null:structuredClone(state)}];
      if(readCalls===1)afterFirstHistory();
      decorate("read",rows);
      return {rows};
    }
    writes++;
    if(sql.includes("submit_policy_history_draft")){
      if(actor!==ADMIN)throw Error("Draft requires current admin");
      const last=state?.revisions.at(-1);
      const from=params[2],sha=params[3]||null;
      if(from!==(last?.revision??0).toString() || sha!==(last?.policySha256??null))
        throw Error("Stale policy SQL CAS");
      const submitted=JSON.parse(params[4]);
      state=submitPolicyDraft(state,{organizationId:A,submittedBy:actor,
        policy:submitted,expectedRevision:Number(from),expectedSha256:sha});
      const head=state.revisions.at(-1);
      const rows=[{submitted_revision:head.revision,submitted_sha256:head.policySha256}];
      decorate("write",rows);
      return {rows};
    }
    if(sql.includes("review_policy_history_draft")){
      if(actor!==REVIEWER)throw Error("Independent review required");
      state=reviewPolicyDraft(state,{organizationId:A,reviewedBy:actor,
        expectedRevision:Number(params[2]),expectedSha256:params[3],
        decision:params[4]});
      const head=state.revisions.at(-1);
      const rows=[{reviewed_revision:head.revision,reviewed_sha256:head.policySha256,
        reviewed_status:head.status}];
      decorate("write",rows);
      return {rows};
    }
    throw Error("Unexpected private database query");
  }};
  return {api:createTrustedPostgresPolicyStore(auth,db),
    get state(){return structuredClone(state)},
    get authCalls(){return authCalls},get readCalls(){return readCalls},
    get writes(){return writes},queries};
}

test("private draft CAS uses original operation and callback after first authorized read",async()=>{
 const input={organizationId:A,session:"admin",permission:"draft",
   transform:(prior,actor)=>submitPolicyDraft(prior,{organizationId:A,
     submittedBy:actor,policy,expectedRevision:0,expectedSha256:null})};
 const original=input.transform;
 const f=fixture({afterFirstHistory(){
   input.organizationId=B;input.session="revoked";
   input.permission="review";input.transform=()=>{throw Error("forged transform");};
 }});
 const result=await f.api.mutateAuthorized(input);
 assert.equal(result.organizationId,A);
 assert.equal(result.revisions[0].policy.pricing.services.office.rateCents,7000);
 assert.equal(result.revisions[0].submittedBy,ADMIN);
 assert.equal(input.transform===original,false);
 assert.equal(f.writes,1);assert.equal(f.readCalls,2);
 assert.deepEqual(f.queries.filter(x=>x.sql.includes("submit_policy_history_draft"))
   .map(x=>x.params.slice(0,2)),[[A,ADMIN]]);
});

test("private independent approval binds original review permission and callback",async()=>{
 const f0=fixture();
 const draft=await f0.api.mutateAuthorized({organizationId:A,session:"admin",
   permission:"draft",transform:(prior,actor)=>submitPolicyDraft(prior,{
     organizationId:A,submittedBy:actor,policy,expectedRevision:0,expectedSha256:null})});
 // Build a fresh fixture with state established through the same adapter.
 let pending=null;
 const shared=fixture({afterFirstHistory(){
  if(!pending)return;
  pending.organizationId=B;pending.session="admin";pending.permission="draft";
  pending.transform=()=>{throw Error("forged review decision");};
 }});
 await shared.api.mutateAuthorized({organizationId:A,session:"admin",permission:"draft",
   transform:(prior,actor)=>submitPolicyDraft(prior,{organizationId:A,
    submittedBy:actor,policy,expectedRevision:0,expectedSha256:null})});
 pending={organizationId:A,session:"review",permission:"review",
   transform:(prior,actor)=>reviewPolicyDraft(prior,{organizationId:A,
     reviewedBy:actor,decision:"approve",expectedRevision:1,
     expectedSha256:draft.revisions[0].policySha256})};
 // Mutate on this review's first read, not during fixture setup.
 // The first read is already consumed; use the adapter's transform hook.
 const original=pending.transform;
 pending.transform=(prior,actor)=>{
   pending.organizationId=B;pending.session="admin";pending.permission="draft";
   pending.transform=()=>{throw Error("forged approval");};
   return original(prior,actor);
 };
 const accepted=await shared.api.mutateAuthorized(pending);
 assert.equal(accepted.activeRevision,1);
 assert.equal(accepted.revisions[0].status,"approved");
 assert.equal(accepted.revisions[0].reviewedBy,REVIEWER);
 assert.equal(shared.writes,2);
});

test("read-only policy request binds original tenant and session before Auth",async()=>{
 const input={organizationId:A,session:"admin"};
 const f=fixture({afterFirstAuth(){
   input.organizationId=B;input.session="revoked";
 }});
 assert.equal(await f.api.readAuthorized(input),null);
 assert.deepEqual(f.queries[0].params,[A,ADMIN]);
});

test("privileged requests reject getters, symbols and inherited directives before Auth",async()=>{
 let getters=0;
 for(const builder of [
   ()=>{const obj={organizationId:A,session:"admin"};
     Object.defineProperty(obj,"approved",{value:true});return obj;},
   ()=>Object.assign(Object.create({send:true}),{organizationId:A,session:"admin"}),
   ()=>{const obj={organizationId:A,session:"admin"};
     obj[Symbol("approved")]=true;return obj;},
   ()=>{const obj={organizationId:A,session:"admin"};
     Object.defineProperty(obj,"organizationId",{enumerable:true,
       get(){getters++;throw Error("unsafe tenant getter");}});return obj;},
 ]){
   const f=fixture();
   await assert.rejects(f.api.readAuthorized(builder()),/Invalid authorized policy read/);
   assert.equal(f.authCalls,0);assert.equal(f.queries.length,0);
 }
 const f=fixture();
 const hostile={organizationId:A,session:"admin",permission:"draft",
   transform:()=>{throw Error("should not run");}};
 Object.defineProperty(hostile,"permission",{enumerable:true,
   get(){getters++;throw Error("unsafe permission getter");}});
 await assert.rejects(f.api.mutateAuthorized(hostile),
   /Invalid authorized policy mutation/);
 assert.equal(f.authCalls,0);assert.equal(f.writes,0);
 assert.equal(getters,0);
});

test("privileged SQL row index and receipt getters fail without execution",async()=>{
 let invoked=0;
 for(const stage of ["read","write"]){
   const f=fixture({decorate(which,rows){
     if(which===stage)Object.defineProperty(rows,"0",{enumerable:true,
       get(){invoked++;throw Error("unsafe SQL index getter");}});
   }});
   const args={organizationId:A,session:"admin",permission:"draft",
     transform:(prior,actor)=>submitPolicyDraft(prior,{organizationId:A,
       submittedBy:actor,policy,expectedRevision:0,expectedSha256:null})};
   await assert.rejects(f.api.mutateAuthorized(args),stage==="read"
     ?/Ambiguous privileged company policy history/
     :/Company policy CAS result indeterminate/);
   assert.equal(f.writes,stage==="read"?0:1);
 }
 assert.equal(invoked,0);
});

test("SQL policy-history revision-array getters are rejected before validation",async()=>{
 let getters=0;
 const f=fixture({decorate(stage,rows){
   if(stage==="read" && rows[0].history){
     Object.defineProperty(rows[0].history.revisions,"0",{enumerable:true,
       get(){getters++;throw Error("untrusted revision getter");}});
   }
 }});
 await f.api.mutateAuthorized({organizationId:A,session:"admin",permission:"draft",
   transform:(prior,actor)=>submitPolicyDraft(prior,{
     organizationId:A,submittedBy:actor,policy,expectedRevision:0,expectedSha256:null})})
   .catch(()=>{});
 // The write may persist even if readback is unreadable; do not retry.
 assert.equal(f.writes,1);
 await assert.rejects(f.api.readAuthorized({organizationId:A,session:"admin"}),
   /Invalid private immutable policy revision/);
 assert.equal(getters,0);
});
