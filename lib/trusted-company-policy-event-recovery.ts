import { assertValidCompanyPolicyHistory } from "./company-policy-revisions.ts";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const CAN_REVIEW=`select 1 as allowed from public.bm_memberships
  where organization_id=$1::uuid and user_id=$2::uuid
    and member_role in ('owner','operator') for share`;

type Selector={
  organizationId:string;
  session:unknown;
  revision:number;
  policySha256:string;
} & ({kind:"submission"}|{kind:"review";decision:"approve"|"reject"});

type State="not-recorded-at-read"|"matching-record-at-read";
type Observation={state:State;observedStatus:"draft"|"approved"|"rejected"|null};

export type TrustedPolicyEventReconciliation={
  organizationId:string;revision:number;policySha256:string;
} & ({state:"changed-during-read"}|{
  state:State;observedStatus:Observation["observedStatus"]
});

function exact(value:unknown,fields:readonly string[]):value is Record<string,unknown> {
  return value!==null && typeof value==="object" && !Array.isArray(value)
    && Object.keys(value).length===fields.length
    && fields.every(key=>Object.hasOwn(value,key));
}
function validate(input:Selector):void {
  if((!exact(input,["organizationId","session","revision","policySha256","kind"])
    && !exact(input,["organizationId","session","revision","policySha256","kind","decision"]))
    || typeof input.organizationId!=="string" || !UUID.test(input.organizationId)
    || input.session===null || input.session===undefined
    || !Number.isSafeInteger(input.revision) || input.revision<1
    || input.revision>1000
    || typeof input.policySha256!=="string" || !SHA.test(input.policySha256)
    || (input.kind!=="submission" && input.kind!=="review")
    || (input.kind==="review" && !["approve","reject"].includes(input.decision))
    || (input.kind==="submission" && Object.hasOwn(input,"decision"))) {
    throw new TypeError("Invalid private policy event recovery selector");
  }
}

/**
 * Read-only staging reconciliation for unknown submission/review CAS outcomes.
 * Returns observed ledger evidence, NEVER authorship of an attempted write
 * or a permit to retry one. All SQL occurs server side.
 */
export function createTrustedCompanyPolicyEventRecovery(
  auth:ActiveSessionVerifier, store:TrustedPolicyStore,
  database:PrivateIntakeDatabase,
) {
  async function actor(session:unknown):Promise<string> {
    const identity=await auth.verifyActiveSession(session);
    if(!exact(identity,["userId"])
      || typeof identity.userId!=="string" || !UUID.test(identity.userId)) {
      throw new Error("Fresh policy event recovery identity required");
    }
    return identity.userId;
  }
  async function observe(input:Selector,originalActor?:string):Promise<{
    actor:string;receipt:Observation
  }> {
    const subject=await actor(input.session);
    if(originalActor!==undefined && subject!==originalActor) {
      throw new Error("Policy event recovery identity changed");
    }
    // Unlike draft submitters, reviewers require a current independent
    // owner/operator membership check even when their decision was not
    // recorded. The service_role read cannot rely on PostgREST RLS.
    if(input.kind==="review") {
      const rights=await database.query(CAN_REVIEW,[input.organizationId,subject]);
      if(!rights || !Array.isArray(rights.rows) || rights.rows.length!==1
        || !exact(rights.rows[0],["allowed"])
        || rights.rows[0].allowed!==1) {
        throw new Error("Current independent policy reviewer permission required");
      }
    }
    const history=await store.readAuthorized({
      organizationId:input.organizationId,session:input.session});
    if(history)assertValidCompanyPolicyHistory(history,input.organizationId);
    const entries=history?.revisions??[];
    if(input.revision>entries.length+1) {
      throw new Error("Requested policy event revision is not next or recorded");
    }
    const row=entries[input.revision-1];
    let receipt:Observation;
    if(input.kind==="submission") {
      if(!row) {
        receipt={state:"not-recorded-at-read",observedStatus:null};
      } else {
        if(row.submittedBy!==subject || row.policySha256!==input.policySha256) {
          throw new Error("Policy submission evidence belongs to another actor or SHA");
        }
        receipt={state:"matching-record-at-read",observedStatus:row.status};
      }
    } else if(!row || row.status==="draft") {
      if(row && row.submittedBy===subject) {
        throw new Error("Policy submitter cannot independently review own draft");
      }
      if(row && row.policySha256!==input.policySha256) {
        throw new Error("Unreviewed policy submission SHA differs");
      }
      receipt={state:"not-recorded-at-read",observedStatus:row?"draft":null};
    } else {
      if(row.reviewedBy!==subject || row.policySha256!==input.policySha256
        || row.status!==(input.decision==="approve"?"approved":"rejected")) {
        throw new Error("Recorded policy review actor, decision or SHA conflicts");
      }
      receipt={state:"matching-record-at-read",observedStatus:row.status};
    }
    if(await actor(input.session)!==subject) {
      throw new Error("Policy event recovery identity changed during inspection");
    }
    return {actor:subject,receipt};
  }
  return {
    async reconcile(input:Selector):Promise<TrustedPolicyEventReconciliation> {
      validate(input);
      const a=await observe(input);
      const b=await observe(input,a.actor);
      const base={organizationId:input.organizationId,
        revision:input.revision,policySha256:input.policySha256};
      if(a.receipt.state!==b.receipt.state
        || a.receipt.observedStatus!==b.receipt.observedStatus) {
        return {...base,state:"changed-during-read"};
      }
      return {...base,state:b.receipt.state,
        observedStatus:b.receipt.observedStatus};
    },
  };
}
