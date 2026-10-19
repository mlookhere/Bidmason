import test from "node:test";
import assert from "node:assert/strict";
import { submitCompanyPolicyDraft, reviewCompanyPolicyDraft,
  previewAuthorizedReviewedEconomics } from "../lib/company-policy-service.ts";
import { prepareExtractionReview } from "../lib/intake-review.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const admin = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const reviewer = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const outsider = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const policy = revision => ({
  revision,
  pricing: { policyId: "office-v" + revision, currency: "USD",
    minimum: { rule:"quote", cents:12000 },
    calculationOrder:"discount-then-surcharge",
    services:{ office:{label:"Office clean",unit:"visit",rateCents:7000,
      billing:"charged"}, pending:{label:"Undecided",unit:"visit",
        rateCents:47500,billing:"pending"} } },
  tax:{method:"none",bps:0}, excludedServiceCodes:["pending"],
});
const text = {kind:"typed-note",text:"Office clean"};
const review = prepareExtractionReview(text,[{serviceCode:"office",units:1,
  start:0,end:12,excerpt:"Office clean"}]);

// A test-only fixture: an actual production adapter MUST use a DB transaction
// with atomic membership validation and compare-and-swap, not this process Map.
function fixture() {
  const data=new Map();
  const members=new Map([
    ["adminA",{actor:admin,org:A,permissions:["draft","read"]}],
    ["reviewA",{actor:reviewer,org:A,permissions:["review","read"]}],
    ["adminB",{actor:outsider,org:B,permissions:["draft","review","read"]}],
    ["readonlyA",{actor:outsider,org:A,permissions:["read"]}],
  ]);
  const clone=x=>x==null?x:structuredClone(x);
  const ensure=(session,org,permission)=>{
    const member=members.get(session);
    if (!member||member.org!==org||!member.permissions.includes(permission)) {
      throw new Error("Unauthorized tenant policy access");
    }
    return member.actor;
  };
  const queue=new Map();
  let readCount=0;
  const port={
    async mutateAuthorized({organizationId,session,permission,transform}) {
      // Serialized per-tenant transaction. Verify authorization when the
      // transaction executes, not when it was queued.
      const prior=queue.get(organizationId)||Promise.resolve();
      const work=prior.catch(()=>{}).then(()=>{
        const id=ensure(session,organizationId,permission);
        const result=transform(clone(data.get(organizationId)||null),id);
        data.set(organizationId,clone(result));return clone(result);
      });
      queue.set(organizationId,work.then(()=>{},()=>{}));
      return work;
    },
    async readAuthorized({organizationId,session}) {
      ++readCount;
      ensure(session,organizationId,"read");
      return clone(data.get(organizationId)||null);
    },
  };
  return {port,members,data,clone,readCount:()=>readCount};
}
const initial=(org=A)=>({organizationId:org,policy:policy(1),
  expectedRevision:0,expectedSha256:null});
const head=(history)=>({expectedRevision:history.revisions.at(-1).revision,
  expectedSha256:history.revisions.at(-1).policySha256});
const request=(org=A)=>({organizationId:org,original:text,review,selection:[0]});

async function approved(f) {
  const draft=await submitCompanyPolicyDraft(f.port,"adminA",initial());
  return reviewCompanyPolicyDraft(f.port,"reviewA",{
    organizationId:A,decision:"approve",...head(draft),
  });
}

test("trusted adapter derives actor and retains independent review in tenant A",async()=>{
  const f=fixture(),draft=await submitCompanyPolicyDraft(f.port,"adminA",initial());
  assert.equal(draft.revisions[0].submittedBy,admin);
  assert.equal(draft.activeRevision,null);
  await assert.rejects(reviewCompanyPolicyDraft(f.port,"adminA",{
    organizationId:A,decision:"approve",...head(draft),
  }),/Unauthorized/);
  const p=await reviewCompanyPolicyDraft(f.port,"reviewA",{
    organizationId:A,decision:"approve",...head(draft),
  });
  assert.equal(p.activeRevision,1);
  assert.equal(p.revisions[0].reviewedBy,reviewer);
  const preview=await previewAuthorizedReviewedEconomics(f.port,"readonlyA",request());
  assert.equal(preview.state,"preview-only");
  assert.equal(preview.economics.quote.totalCents,12000);
  assert.equal(f.readCount(),2);
});

test("two competing drafts cannot both commit on the same head",async()=>{
  const f=fixture();
  const attempts=await Promise.allSettled([
    submitCompanyPolicyDraft(f.port,"adminA",initial()),
    submitCompanyPolicyDraft(f.port,"adminA",initial()),
  ]);
  assert.equal(attempts.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(attempts.filter(x=>x.status==="rejected").length,1);
  assert.equal(f.data.get(A).revisions.length,1);
});

test("cross-tenant access and write permissions fail before any mutation",async()=>{
  const f=fixture();
  await assert.rejects(submitCompanyPolicyDraft(f.port,"adminB",initial()),/Unauthorized/);
  await assert.rejects(submitCompanyPolicyDraft(f.port,"readonlyA",initial()),/Unauthorized/);
  await assert.rejects(previewAuthorizedReviewedEconomics(f.port,"adminB",request()),/Unauthorized/);
  assert.equal(f.data.size,0);
  const created=await submitCompanyPolicyDraft(f.port,"adminB",initial(B));
  assert.equal(created.organizationId,B);
  assert.equal(f.data.has(A),false);
});

test("permission revoked before queued transaction executes is denied",async()=>{
  const f=fixture();
  const first=await submitCompanyPolicyDraft(f.port,"adminA",initial());
  const approvedFirst=await reviewCompanyPolicyDraft(f.port,"reviewA",{
    organizationId:A,decision:"approve",...head(first),
  });
  const queued=submitCompanyPolicyDraft(f.port,"adminA",{
    organizationId:A,policy:policy(2),...head(approvedFirst),
  });
  f.members.delete("adminA");
  await assert.rejects(queued,/Unauthorized/);
  assert.equal(f.data.get(A).revisions.length,1);
});

test("draft, rejection and revoked access never produce customer-ready preview",async()=>{
  const f=fixture();
  const draft=await submitCompanyPolicyDraft(f.port,"adminA",initial());
  await assert.rejects(previewAuthorizedReviewedEconomics(f.port,"readonlyA",request()),
    /No approved/);
  const rejected=await reviewCompanyPolicyDraft(f.port,"reviewA",{
    organizationId:A,decision:"reject",...head(draft),
  });
  assert.equal(rejected.activeRevision,null);
  await assert.rejects(previewAuthorizedReviewedEconomics(f.port,"readonlyA",request()),
    /No approved/);
  f.members.delete("readonlyA");
  await assert.rejects(previewAuthorizedReviewedEconomics(f.port,"readonlyA",request()),
    /Unauthorized/);
});

test("membership revoked during preview invalidates the second authorized read",async()=>{
  const f=fixture(); await approved(f);
  const original=f.port.readAuthorized;
  let count=0;
  f.port.readAuthorized=async args=>{
    const result=await original(args);
    if(++count===1)f.members.delete("readonlyA");
    return result;
  };
  await assert.rejects(previewAuthorizedReviewedEconomics(f.port,"readonlyA",request()),
    /Unauthorized/);
});

test("an active policy revision changed during preview fails closed",async()=>{
  const f=fixture(); await approved(f);
  const original=f.port.readAuthorized;
  let count=0;
  f.port.readAuthorized=async args=>{
    if(++count===2){
      const current=f.data.get(A);
      const second=await submitCompanyPolicyDraft(f.port,"adminA",{
        organizationId:A,policy:policy(2),...head(current),
      });
      await reviewCompanyPolicyDraft(f.port,"reviewA",{
        organizationId:A,decision:"approve",...head(second),
      });
    }
    return original(args);
  };
  await assert.rejects(previewAuthorizedReviewedEconomics(f.port,"readonlyA",request()),
    /policy changed during preview/);
});

test("untrusted policy overrides cannot be substituted for the approved catalog",async()=>{
  const f=fixture(); await approved(f);
  const forged={...request(),policy:policy(999),actorId:admin};
  const preview=await previewAuthorizedReviewedEconomics(f.port,"readonlyA",forged);
  assert.equal(preview.economics.policyRevision,1);
  assert.equal(preview.economics.quote.totalCents,12000);
  const last=f.data.get(A); last.revisions[0].policy.pricing.services.office.rateCents=1;
  await assert.rejects(previewAuthorizedReviewedEconomics(f.port,"readonlyA",request()),
    /integrity/);
});


test("policy draft CAS persists the submitted ratecard despite delayed caller mutation",async()=>{
  const f=fixture(),input=initial();
  const deferred={...f.port,mutateAuthorized:args=>f.port.mutateAuthorized({
    ...args,transform:(current,actor)=>{
      input.organizationId=B;
      input.expectedRevision=999;
      input.expectedSha256="f".repeat(64);
      input.policy.pricing.services.office.rateCents=1;
      input.policy.excludedServiceCodes.push("office");
      return args.transform(current,actor);
    },
  })};
  const created=await submitCompanyPolicyDraft(deferred,"adminA",input);
  assert.equal(created.organizationId,A);
  assert.equal(created.revisions[0].policy.pricing.services.office.rateCents,7000);
  assert.deepEqual(created.revisions[0].policy.excludedServiceCodes,["pending"]);
  assert.equal(f.data.has(B),false);
});

test("review CAS preserves the original human decision and expected head",async()=>{
  const f=fixture(),submitted=await submitCompanyPolicyDraft(f.port,"adminA",initial());
  const input={organizationId:A,decision:"approve",...head(submitted)};
  const deferred={...f.port,mutateAuthorized:args=>f.port.mutateAuthorized({
    ...args,transform:(current,actor)=>{
      input.organizationId=B;
      input.decision="reject";
      input.expectedRevision=999;
      input.expectedSha256="0".repeat(64);
      return args.transform(current,actor);
    },
  })};
  const reviewed=await reviewCompanyPolicyDraft(deferred,"reviewA",input);
  assert.equal(reviewed.organizationId,A);
  assert.equal(reviewed.activeRevision,1);
  assert.equal(reviewed.revisions[0].reviewedBy,reviewer);
  assert.equal(f.data.has(B),false);
});

test("economics preview binds original tenant, evidence and selection before authorized reads",async()=>{
  const f=fixture();await approved(f);
  const baseline=await previewAuthorizedReviewedEconomics(f.port,"readonlyA",request());
  const input={...request(),selection:[0],acceptedAddonCodes:[]};
  let reads=0;
  const store={...f.port,readAuthorized:async args=>{
    const data=await f.port.readAuthorized(args);
    if(++reads===1){
      input.organizationId=B;
      input.original.text="forged source";
      input.review.candidates[0].units=999;
      input.selection[0]=2;
      input.acceptedAddonCodes.push("floor");
    }
    return data;
  }};
  const reviewed=await previewAuthorizedReviewedEconomics(store,"readonlyA",input);
  assert.equal(reads,2);
  assert.deepEqual(reviewed,baseline);
});

test("policy endpoints refuse getter-backed, hidden and decorated price data before adapters",async()=>{
  const f=fixture();
  let malicious=0,calls=0;
  const store={...f.port,mutateAuthorized:args=>{calls++;return f.port.mutateAuthorized(args)},
    readAuthorized:args=>{calls++;return f.port.readAuthorized(args)}};
  const hidden=initial();Object.defineProperty(hidden,"send",{value:true});
  const nestedGetter=initial();
  Object.defineProperty(nestedGetter.policy.pricing.services.office,"rateCents",{
    enumerable:true,get(){malicious++;throw Error("untrusted policy getter");
    },
  });
  const nestedSymbol=initial();
  nestedSymbol.policy.pricing.services.office[Symbol("approved")]=true;
  const decoratedArray=initial();
  Object.defineProperty(decoratedArray.policy.excludedServiceCodes,"send",{value:true});
  for(const bad of [hidden,nestedGetter,nestedSymbol,decoratedArray]){
    assert.throws(()=>submitCompanyPolicyDraft(store,"adminA",bad),
      /Invalid company policy request|Invalid policy request data/);
  }
  const reviewerRequest={organizationId:A,decision:"approve",
    expectedRevision:1,expectedSha256:"a".repeat(64)};
  Object.defineProperty(reviewerRequest,"send",{value:true});
  assert.throws(()=>reviewCompanyPolicyDraft(store,"reviewA",reviewerRequest),
    /Invalid company policy request/);
  const previewGetter={...request()};
  Object.defineProperty(previewGetter,"organizationId",{enumerable:true,
    get(){malicious++;throw Error("unsafe organization getter");}});
  await assert.rejects(previewAuthorizedReviewedEconomics(store,"readonlyA",previewGetter),
    /Invalid company pricing preview request/);
  assert.equal(malicious,0);
  assert.equal(calls,0);
});
