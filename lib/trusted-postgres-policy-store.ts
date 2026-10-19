import { isDeepStrictEqual } from "node:util";
import { assertValidCompanyPolicyHistory, reviewPolicyDraft, submitPolicyDraft,
  type PolicyHistory } from "./company-policy-revisions.ts";
import { canonicalCompanyPolicyText } from "./company-policy-fingerprint.ts";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const READ=`select bm_intake_private.read_policy_history(
  $1::uuid,$2::uuid) as history`;
const SUBMIT=`select submitted_revision,submitted_sha256
  from bm_intake_private.submit_policy_history_draft(
    $1::uuid,$2::uuid,$3::integer,nullif($4::text,''),$5::text)`;
const REVIEW=`select reviewed_revision,reviewed_sha256,reviewed_status
  from bm_intake_private.review_policy_history_draft(
    $1::uuid,$2::uuid,$3::integer,$4::text,$5::text)`;

/** Only canonical own data descriptors can authorize privileged SQL. */
function exact(value:unknown,fields:readonly string[]):value is Record<string,unknown> {
  if(value===null || typeof value!=="object" || Array.isArray(value)
    || ![Object.prototype,null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length!==fields.length)return false;
  return fields.every(field=>{
    const d=Object.getOwnPropertyDescriptor(value,field);
    return d?.enumerable===true && Object.hasOwn(d,"value");
  });
}
function canonicalArray(value:unknown,min:number,max:number):value is unknown[] {
  if(!Array.isArray(value)||value.length<min||value.length>max
    || Object.getPrototypeOf(value)!==Array.prototype
    || Reflect.ownKeys(value).length!==value.length+1)return false;
  for(let i=0;i<value.length;i++){
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(d?.enumerable!==true||!Object.hasOwn(d,"value"))return false;
  }
  return true;
}
function validateSelector(organizationId:string,session:unknown):void {
  if(typeof organizationId!=="string"||!UUID.test(organizationId)
    || session===null || session===undefined) {
    throw new TypeError("Invalid private company policy request");
  }
}
/** Staged, privileged-primary adapter. The verifier and database ports MUST be
 * implemented on a trusted server. No client may supply the actor or execute SQL.
 * A result after a single write can be indeterminate; never retry automatically. */
export function createTrustedPostgresPolicyStore(
  auth:ActiveSessionVerifier,database:PrivateIntakeDatabase,
):TrustedPolicyStore {
  async function verifiedActor(session:unknown):Promise<string> {
    const identity=await auth.verifyActiveSession(session);
    if(!exact(identity,["userId"]) || typeof identity.userId!=="string"
      || !UUID.test(identity.userId)) {
      throw new Error("Fresh authenticated policy actor required");
    }
    return identity.userId;
  }
  async function read(organizationId:string,session:unknown,
    priorActor?:string):Promise<{actor:string;history:PolicyHistory|null}> {
    const actor=await verifiedActor(session);
    if(priorActor!==undefined && actor!==priorActor) {
      throw new Error("Company policy actor changed during operation");
    }
    const result=await database.query(READ,[organizationId,actor]);
    if(!result || !canonicalArray(result.rows,1,1)
      || !exact(result.rows[0],["history"])) {
      throw new Error("Ambiguous privileged company policy history");
    }
    const value=result.rows[0].history;
    if(value===null)return {actor,history:null};
    if(!exact(value,["organizationId","activeRevision","revisions"])) {
      throw new Error("Invalid private policy history structure");
    }
    const history=value as PolicyHistory;
    if(!canonicalArray(history.revisions,1,100000)
      || history.revisions.some(revision=>!exact(revision,[
        "organizationId","revision","status","submittedBy","reviewedBy",
        "policySha256","policy"]))) {
      throw new Error("Invalid private immutable policy revision");
    }
    assertValidCompanyPolicyHistory(history,organizationId);
    return {actor,history};
  }
  return {
    async readAuthorized(input) {
      if(!exact(input,["organizationId","session"])) {
        throw new TypeError("Invalid authorized policy read");
      }
      validateSelector(input.organizationId,input.session);
      const target={organizationId:input.organizationId,session:input.session};
      return (await read(target.organizationId,target.session)).history;
    },
    async mutateAuthorized(input) {
      if(!exact(input,["organizationId","session","permission","transform"])
        || !["draft","review"].includes(input.permission)
        || typeof input.transform!=="function") {
        throw new TypeError("Invalid authorized policy mutation");
      }
      validateSelector(input.organizationId,input.session);
      // The exact validated operation and callback identity are bound before
      // any external Auth/history or user transformation can suspend.
      const target={organizationId:input.organizationId,session:input.session,
        permission:input.permission,transform:input.transform};
      const {actor,history:current}=await read(target.organizationId,target.session);
      // A callback is not an authority: constrain its output to the exact
      // legal domain transition created by this same authenticated actor.
      // Isolate callback mutations from our pre-commit history snapshot.
      const next=await target.transform(
        current===null?null:structuredClone(current),actor);
      if(!next || !Array.isArray(next.revisions)) {
        throw new Error("Policy transform did not produce a history");
      }
      assertValidCompanyPolicyHistory(next,target.organizationId);
      const latest=next.revisions.at(-1)!;
      const previous=current?.revisions.at(-1);
      const expectedRevision=previous?.revision??0;
      const expectedSha256=previous?.policySha256??null;
      let legal:PolicyHistory;
      let statement:string, params:string[];
      if(target.permission==="draft") {
        if(latest.status!=="draft") {
          throw new Error("Only a new policy draft can be submitted");
        }
        legal=submitPolicyDraft(current,{
          organizationId:target.organizationId,submittedBy:actor,
          policy:latest.policy,expectedRevision,expectedSha256,
        });
        statement=SUBMIT;
        params=[target.organizationId,actor,String(expectedRevision),
          expectedSha256??"",canonicalCompanyPolicyText(latest.policy)];
      } else {
        if(!current || !previous)throw new Error("No policy draft to review");
        const decision=latest.status==="approved"?"approve":
          latest.status==="rejected"?"reject":null;
        if(decision===null)throw new Error("Explicit policy review required");
        legal=reviewPolicyDraft(current,{
          organizationId:target.organizationId,reviewedBy:actor,decision,
          expectedRevision,expectedSha256:expectedSha256!,
        });
        statement=REVIEW;
        params=[target.organizationId,actor,String(expectedRevision),
          expectedSha256!,decision];
      }
      if(!isDeepStrictEqual(next,legal)) {
        throw new Error("Policy transform attempted an unauthorized history mutation");
      }
      if(await verifiedActor(target.session)!==actor) {
        throw new Error("Company policy actor changed before commit");
      }
      // SQL independently locks current membership and the authoritative
      // submission head; an exception is not proof of rollback.
      const result=await database.query(statement,params);
      if(!result || !canonicalArray(result.rows,1,1)) {
        throw new Error("Company policy CAS result indeterminate; never retry");
      }
      const row=result.rows[0];
      if(target.permission==="draft") {
        if(!exact(row,["submitted_revision","submitted_sha256"])
          || row.submitted_revision!==latest.revision
          || row.submitted_sha256!==latest.policySha256) {
          throw new Error("Policy submission result indeterminate; never retry");
        }
      } else if(!exact(row,["reviewed_revision","reviewed_sha256","reviewed_status"])
        || row.reviewed_revision!==latest.revision
        || row.reviewed_sha256!==latest.policySha256
        || row.reviewed_status!==latest.status) {
        throw new Error("Policy review result indeterminate; never retry");
      }
      const after=await read(target.organizationId,target.session,actor);
      if(!after.history || !isDeepStrictEqual(after.history,legal)) {
        throw new Error("Policy event read-back indeterminate; never retry");
      }
      return after.history;
    },
  };
}
