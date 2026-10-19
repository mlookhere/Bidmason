import { companyPolicySha256, canonicalCompanyPolicyText }
  from "./company-policy-fingerprint.ts";
import { previewCompanyEconomics, type VersionedEconomicsPolicy,
  type EconomicsPreview } from "./company-economics.ts";
import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";
import type { SessionBoundActiveSessionVerifier }
  from "./supabase-session-bound-verifier.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const SERVICE=/^[a-z][a-z0-9_-]{0,63}$/;
const READ="select bm_intake_private.read_corrected_internal_preview_inputs("+
  "$1::uuid,$2::uuid,$3::uuid,$4::text) as projection";
const READ_SESSION_LOCKED=
  "select bm_intake_private.read_corrected_internal_preview_session_locked("+
  "$1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text) as projection";

type Evidence = {
  organizationId:string;sourceId:string;revision:number;
  sourceSha256:string;correctedCandidatesSha256:string;
  scopeReceiptSha256:string;internalDecisionSha256:string;
  policySha256:string;policyRevision:number;
};
export type PrivateCorrectedEconomicsPreview = {
  state:"preview-only";deliveryAuthorized:false;
  evidence:Evidence;economics:EconomicsPreview;
};

function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value)
    || ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const own=Reflect.ownKeys(value);
  return own.length===keys.length && own.every(key=>{
    if(typeof key!=="string" || !keys.includes(key))return false;
    const d=Object.getOwnPropertyDescriptor(value,key);
    return d?.enumerable===true && Object.hasOwn(d,"value");
  });
}
function uuid(value:unknown):value is string {
  return typeof value==="string" && UUID.test(value);
}
function sha(value:unknown):value is string {
  return typeof value==="string" && SHA.test(value);
}

/** Read-only internal preview. Never expose this adapter from a public route.
 * Auth must verify live non-revoked user, DB must be primary/server only. */
/**
 * Requires a fresh Auth-validated user + session UUID, then performs a
 * server-only SQL read that locks auth.sessions for the entire projection.
 * The public caller may never supply actorId or sessionId separately.
 */
export function createTrustedSessionLockedCorrectedEconomicsPreview(
  auth:SessionBoundActiveSessionVerifier,db:PrivateIntakeDatabase,
):{preview(input:unknown):Promise<PrivateCorrectedEconomicsPreview>} {
  if(typeof auth?.verifySessionBinding!=="function"){
    throw new TypeError("Session-bound Auth verifier required");
  }
  return createInternalCorrectedEconomicsPreview(auth,db,true);
}

/** Legacy staging adapter retained only for earlier read-only tests. */
export function createTrustedCorrectedEconomicsPreview(
  auth:ActiveSessionVerifier,db:PrivateIntakeDatabase,
):{preview(input:unknown):Promise<PrivateCorrectedEconomicsPreview>} {
  return createInternalCorrectedEconomicsPreview(auth,db,false);
}
function createInternalCorrectedEconomicsPreview(
  auth:ActiveSessionVerifier,db:PrivateIntakeDatabase,locked:boolean,
):{preview(input:unknown):Promise<PrivateCorrectedEconomicsPreview>} {
  async function verified(session:unknown):Promise<{userId:string;sessionId?:string}>{
    const current:{userId:string;sessionId?:string}=locked
      ? await (auth as SessionBoundActiveSessionVerifier).verifySessionBinding(session)
      : await auth.verifyActiveSession(session);
    if(!exact(current,locked?["userId","sessionId"]:["userId"])
      || !uuid(current.userId)
      || (locked&&!uuid(current.sessionId))){
      throw new Error("Current commercial reviewer Auth required");
    }
    return locked
      ? {userId:current.userId,sessionId:current.sessionId as string}
      : {userId:current.userId};
  }
  return {
    async preview(input:unknown):Promise<PrivateCorrectedEconomicsPreview>{
      if(!exact(input,["organizationId","sourceId","expectedDecisionSha256","session"])
        || !uuid(input.organizationId)||!uuid(input.sourceId)
        || !sha(input.expectedDecisionSha256)
        || input.session===null || input.session===undefined){
        throw new TypeError("Invalid private corrected economics selector");
      }
      // Capture selectors BEFORE auth await: do not trust mutable browser data.
      const org=input.organizationId,source=input.sourceId;
      const expected=input.expectedDecisionSha256,session=input.session;
      const current=await verified(session);
      const result=locked
        ? await db.query(READ_SESSION_LOCKED,[
          org,current.userId,current.sessionId as string,source,expected])
        : await db.query(READ,[org,current.userId,source,expected]);
      if(!result||!Array.isArray(result.rows)||result.rows.length!==1
        || !exact(result.rows[0],["projection"])){
        throw new Error("Approved internal corrected pricing evidence unavailable");
      }
      const projection=result.rows[0].projection;
      if(!exact(projection,["state","deliveryAuthorized","policy","requested","evidence"])
        || projection.state!=="preview-only"||projection.deliveryAuthorized!==false
        || !exact(projection.evidence,[
          "organizationId","sourceId","revision","sourceSha256",
          "correctedCandidatesSha256","scopeReceiptSha256",
          "internalDecisionSha256","policySha256","policyRevision"])
        || projection.evidence.organizationId!==org
        || projection.evidence.sourceId!==source
        || projection.evidence.revision!==5
        || projection.evidence.internalDecisionSha256!==expected
        || !sha(projection.evidence.sourceSha256)
        || !sha(projection.evidence.correctedCandidatesSha256)
        || !sha(projection.evidence.scopeReceiptSha256)
        || !sha(projection.evidence.policySha256)
        || !Number.isSafeInteger(projection.evidence.policyRevision)
        || (projection.evidence.policyRevision as number)<1
        || !Array.isArray(projection.requested)
        || projection.requested.length<1 || projection.requested.length>50){
        throw new Error("Unsafe corrected economics projection");
      }
      // Clone ONLY canonical data. Never run policy getters or toJSON, and
      // never calculate using a different policy than the one fingerprinted.
      const policyText=canonicalCompanyPolicyText(
        projection.policy as VersionedEconomicsPolicy);
      const policy=JSON.parse(policyText) as VersionedEconomicsPolicy;
      if(policy.revision!==projection.evidence.policyRevision
        || companyPolicySha256(policy)!==projection.evidence.policySha256){
        throw new Error("Approved company policy fingerprint mismatch");
      }
      const used=new Set<string>();
      const requested=projection.requested.map((entry:unknown)=>{
        if(!exact(entry,["serviceCode","units"])
          && !exact(entry,["serviceCode","units","addonAccepted"])){
          throw new Error("Noncanonical reviewed price line");
        }
        if(typeof entry.serviceCode!=="string"||!SERVICE.test(entry.serviceCode)
          || used.has(entry.serviceCode)
          || !Number.isSafeInteger(entry.units)||(entry.units as number)<1
          || (Object.hasOwn(entry,"addonAccepted")&&entry.addonAccepted!==true)){
          throw new Error("Invalid or duplicated reviewed price line");
        }
        used.add(entry.serviceCode);
        return {serviceCode:entry.serviceCode,units:entry.units as number,
          ...(entry.addonAccepted===true?{addonAccepted:true as const}:{})};
      });
      const evidence:Evidence={
        organizationId:org,sourceId:source,revision:5,
        sourceSha256:projection.evidence.sourceSha256 as string,
        correctedCandidatesSha256:projection.evidence.correctedCandidatesSha256 as string,
        scopeReceiptSha256:projection.evidence.scopeReceiptSha256 as string,
        internalDecisionSha256:expected,
        policySha256:projection.evidence.policySha256 as string,
        policyRevision:projection.evidence.policyRevision as number,
      };
      // Reverify after DB read and before calculating private economics.
      const renewed=await verified(session);
      if(renewed.userId!==current.userId
        || (locked&&renewed.sessionId!==current.sessionId)){
        throw new Error("Commercial reviewer session changed during preview");
      }
      const economics=previewCompanyEconomics(policy,requested);
      if(economics.policySha256!==evidence.policySha256
        || economics.policyRevision!==evidence.policyRevision
        || economics.state!=="preview-only"){
        throw new Error("Calculated economics policy parity mismatch");
      }
      return {state:"preview-only",deliveryAuthorized:false,evidence,economics};
    },
  };
}
