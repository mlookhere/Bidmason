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

function exact(value:unknown,fields:readonly string[]):value is Record<string,unknown> {
  return value!==null && typeof value==="object" && !Array.isArray(value)
    && Object.keys(value).length===fields.length
    && fields.every(field=>Object.hasOwn(value,field));
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
    if(!result || !Array.isArray(result.rows) || result.rows.length!==1
      || !exact(result.rows[0],["history"])) {
      throw new Error("Ambiguous privileged company policy history");
    }
    const value=result.rows[0].history;
    if(value===null)return {actor,history:null};
    if(!exact(value,["organizationId","activeRevision","revisions"])) {
      throw new Error("Invalid private policy history structure");
    }
    const history=value as PolicyHistory;
    if(!Array.isArray(history.revisions)
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
      return (await read(input.organizationId,input.session)).history;
    },
    async mutateAuthorized(input) {
      if(!exact(input,["organizationId","session","permission","transform"])
        || !["draft","review"].includes(input.permission)
        || typeof input.transform!=="function") {
        throw new TypeError("Invalid authorized policy mutation");
      }
      validateSelector(input.organizationId,input.session);
      const {actor,history:current}=await read(input.organizationId,input.session);
      // A callback is not an authority: constrain its output to the exact
      // legal domain transition created by this same authenticated actor.
      // Isolate callback mutations from our pre-commit history snapshot.
      const next=await input.transform(
        current===null?null:structuredClone(current),actor);
      if(!next || !Array.isArray(next.revisions)) {
        throw new Error("Policy transform did not produce a history");
      }
      assertValidCompanyPolicyHistory(next,input.organizationId);
      const latest=next.revisions.at(-1)!;
      const previous=current?.revisions.at(-1);
      const expectedRevision=previous?.revision??0;
      const expectedSha256=previous?.policySha256??null;
      let legal:PolicyHistory;
      let statement:string, params:string[];
      if(input.permission==="draft") {
        if(latest.status!=="draft") {
          throw new Error("Only a new policy draft can be submitted");
        }
        legal=submitPolicyDraft(current,{
          organizationId:input.organizationId,submittedBy:actor,
          policy:latest.policy,expectedRevision,expectedSha256,
        });
        statement=SUBMIT;
        params=[input.organizationId,actor,String(expectedRevision),
          expectedSha256??"",canonicalCompanyPolicyText(latest.policy)];
      } else {
        if(!current || !previous)throw new Error("No policy draft to review");
        const decision=latest.status==="approved"?"approve":
          latest.status==="rejected"?"reject":null;
        if(decision===null)throw new Error("Explicit policy review required");
        legal=reviewPolicyDraft(current,{
          organizationId:input.organizationId,reviewedBy:actor,decision,
          expectedRevision,expectedSha256:expectedSha256!,
        });
        statement=REVIEW;
        params=[input.organizationId,actor,String(expectedRevision),
          expectedSha256!,decision];
      }
      if(!isDeepStrictEqual(next,legal)) {
        throw new Error("Policy transform attempted an unauthorized history mutation");
      }
      if(await verifiedActor(input.session)!==actor) {
        throw new Error("Company policy actor changed before commit");
      }
      // SQL independently locks current membership and the authoritative
      // submission head; an exception is not proof of rollback.
      const result=await database.query(statement,params);
      if(!result || !Array.isArray(result.rows) || result.rows.length!==1) {
        throw new Error("Company policy CAS result indeterminate; never retry");
      }
      const row=result.rows[0];
      if(input.permission==="draft") {
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
      const after=await read(input.organizationId,input.session,actor);
      if(!after.history || !isDeepStrictEqual(after.history,legal)) {
        throw new Error("Policy event read-back indeterminate; never retry");
      }
      return after.history;
    },
  };
}
