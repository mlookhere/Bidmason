import { prepareExtractionCorrectionDraft, type ExtractionCorrectionChange }
  from "./extraction-correction-draft.ts";
import type { prepareCorrectionEditorRequest } from "./extraction-correction-editor.ts";
import { readExtractionCorrectionContext, commitAuthorizedExtractionCorrection,
  type TrustedExtractionCorrectionStore } from "./tenant-extraction-correction.ts";

type EditorRequest = ReturnType<typeof prepareCorrectionEditorRequest>;
type SourceSelector = {organizationId:string; sourceId:string};
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactFields(value:unknown,names:readonly string[]):value is Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value)
    || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return false;
  const keys=Reflect.ownKeys(value);
  return keys.length===names.length && keys.every(key=>{
    if (typeof key!=="string" || !names.includes(key)) return false;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor?.enumerable===true && Object.hasOwn(descriptor,"value");
  });
}

function validateInput(target:SourceSelector,payload:EditorRequest):void {
  if (!exactFields(target,["organizationId","sourceId"])
    || typeof target.organizationId!=="string" || !UUID.test(target.organizationId)
    || typeof target.sourceId!=="string" || !UUID.test(target.sourceId)
    || !exactFields(payload,["sourceSha256","candidatesSha256","changes"])
    || typeof payload.sourceSha256!=="string" || !SHA.test(payload.sourceSha256)
    || typeof payload.candidatesSha256!=="string" || !SHA.test(payload.candidatesSha256)
    || !Array.isArray(payload.changes)) {
    throw new TypeError("Invalid source-bound correction editor submission");
  }
}

/** Snapshot the complete untrusted browser decision BEFORE any Auth/DB
 * await. Checking data descriptors avoids invoking accessor-backed fields.
 * The stricter evidence-aware validator still runs against stored originals. */
function snapshotEditorChanges(value:unknown):ExtractionCorrectionChange[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype
    || value.length<1 || value.length>100
    || Reflect.ownKeys(value).length!==value.length+1) {
    throw new TypeError("Invalid source-bound correction editor changes");
  }
  const field=(obj:object,key:string):unknown=>
    Object.getOwnPropertyDescriptor(obj,key)!.value;
  const snapCandidate=(value:unknown)=>{
    if(!exactFields(value,["serviceCode","units","start","end","excerpt"])) {
      throw new TypeError("Invalid source-bound correction candidate");
    }
    return {
      serviceCode:field(value,"serviceCode") as string,
      units:field(value,"units") as number,
      start:field(value,"start") as number,
      end:field(value,"end") as number,
      excerpt:field(value,"excerpt") as string,
    };
  };
  const detached:ExtractionCorrectionChange[]=[];
  for(let i=0;i<value.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(i));
    if(!descriptor?.enumerable || !Object.hasOwn(descriptor,"value")) {
      throw new TypeError("Invalid source-bound correction action list");
    }
    const action=descriptor.value;
    const kind=action && typeof action==="object"
      ? Object.getOwnPropertyDescriptor(action,"action") : undefined;
    if(!kind?.enumerable || !Object.hasOwn(kind,"value")) {
      throw new TypeError("Invalid source-bound correction action");
    }
    const shape=kind.value==="replace"
      ? ["action","index","candidate","reason"]
      :kind.value==="remove" ? ["action","index","reason"]
      :kind.value==="add" ? ["action","candidate","reason"] : [];
    if(!shape.length || !exactFields(action,shape)) {
      throw new TypeError("Invalid source-bound correction action");
    }
    const reason=field(action,"reason") as string;
    if(kind.value==="remove"){
      detached.push({action:"remove",index:field(action,"index") as number,reason});
    }else if(kind.value==="replace"){
      detached.push({action:"replace",index:field(action,"index") as number,
        candidate:snapCandidate(field(action,"candidate")),reason});
    }else{
      detached.push({action:"add",candidate:snapCandidate(field(action,"candidate")),
        reason});
    }
  }
  return detached;
}

function rehydrateActions(
  changes:ReturnType<typeof prepareExtractionCorrectionDraft>["changes"],
):ExtractionCorrectionChange[] {
  // The only submitted actions are those that have already survived the
  // strict server evidence/candidate validator. Remove any caller aliases.
  return changes.map(change=>{
    if (change.action==="add" && change.after) {
      return {action:"add",candidate:{...change.after},reason:change.reason};
    }
    if (change.action==="remove" && change.originalIndex!==undefined) {
      return {action:"remove",index:change.originalIndex,reason:change.reason};
    }
    if (change.action==="replace" && change.originalIndex!==undefined
      && change.after) {
      return {action:"replace",index:change.originalIndex,
        candidate:{...change.after},reason:change.reason};
    }
    throw new Error("Invalid validated correction action");
  });
}

/**
 * Server-only bridge for a browser's UNTRUSTED correction draft request.
 * The store MUST perform tenant authorization on each primary read and
 * current correct-extraction authorization inside its atomic CAS mutation.
 *
 * No browser-provided actor, expected revision, snapshot, price or approval is
 * accepted. An uncertain mutation result is NOT an invitation to retry; use
 * read-only reconcileExtractionCorrection with the original commit details
 * from trusted server-side durable operations.
 */
export async function submitAuthorizedCorrectionEditorRequest(
  store:TrustedExtractionCorrectionStore,
  session:unknown,
  target:SourceSelector,
  payload:EditorRequest,
):ReturnType<typeof commitAuthorizedExtractionCorrection> {
  validateInput(target,payload);
  // No await until ALL caller-owned selector, checksums and nested changes
  // have been detached. An async caller cannot change the reviewed decision.
  const selector:{organizationId:string;sourceId:string}={
    organizationId:target.organizationId,sourceId:target.sourceId,
  };
  const submitted={
    sourceSha256:payload.sourceSha256,
    candidatesSha256:payload.candidatesSha256,
    changes:snapshotEditorChanges(payload.changes),
  };
  // Two independently authorized reads establish the source CAS checkpoint.
  const context=await readExtractionCorrectionContext(store,session,selector);
  // Fresh primary read binds the browser-provided evidence IDs to the
  // actual tenant-owned original and extraction; not to a supplied snapshot.
  const record=await store.readAuthorized({...selector,session});
  if (!record || record.organizationId!==selector.organizationId
    || record.sourceId!==selector.sourceId
    || record.revision!==context.expectedRevision
    || record.review?.sourceSha256!==submitted.sourceSha256
    || record.review?.candidatesSha256!==submitted.candidatesSha256
    || record.pendingCorrection!=null || record.activatedCorrection!=null) {
    throw new Error("Correction editor evidence is stale or unauthorized");
  }
  const validated=prepareExtractionCorrectionDraft(
    record.original,record.review,submitted.changes);
  if (validated.sourceSha256!==submitted.sourceSha256
    || validated.originalCandidatesSha256!==submitted.candidatesSha256) {
    throw new Error("Correction editor evidence is stale or unauthorized");
  }
  // Detached immutable decision input is revalidated AGAIN under trusted
  // source ownership and revision CAS inside commitAuthorized...().
  return commitAuthorizedExtractionCorrection(store,session,{
    organizationId:selector.organizationId,sourceId:selector.sourceId,
    expectedRevision:context.expectedRevision,
    expectedSnapshotSha256:context.expectedSnapshotSha256,
    expectedCorrectionSha256:validated.correctionSha256,
    changes:rehydrateActions(validated.changes),
  });
}
