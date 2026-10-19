import { prepareExtractionCorrectionDraft, type ExtractionCorrectionChange }
  from "./extraction-correction-draft.ts";
import type { prepareCorrectionEditorRequest } from "./extraction-correction-editor.ts";
import { readExtractionCorrectionContext, commitAuthorizedExtractionCorrection,
  type TrustedExtractionCorrectionStore } from "./tenant-extraction-correction.ts";

type EditorRequest = ReturnType<typeof prepareCorrectionEditorRequest>;
type SourceSelector = {organizationId:string; sourceId:string};
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactFields(value:unknown,names:readonly string[]):boolean {
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
  // Two independently authorized reads establish the source CAS checkpoint.
  const context=await readExtractionCorrectionContext(store,session,target);
  // Fresh primary read binds the browser-provided evidence IDs to the
  // actual tenant-owned original and extraction; not to a supplied snapshot.
  const record=await store.readAuthorized({...target,session});
  if (!record || record.organizationId!==target.organizationId
    || record.sourceId!==target.sourceId
    || record.revision!==context.expectedRevision
    || record.review?.sourceSha256!==payload.sourceSha256
    || record.review?.candidatesSha256!==payload.candidatesSha256
    || record.pendingCorrection!=null || record.activatedCorrection!=null) {
    throw new Error("Correction editor evidence is stale or unauthorized");
  }
  const validated=prepareExtractionCorrectionDraft(
    record.original,record.review,payload.changes);
  if (validated.sourceSha256!==payload.sourceSha256
    || validated.originalCandidatesSha256!==payload.candidatesSha256) {
    throw new Error("Correction editor evidence is stale or unauthorized");
  }
  // Detached immutable decision input is revalidated AGAIN under trusted
  // source ownership and revision CAS inside commitAuthorized...().
  return commitAuthorizedExtractionCorrection(store,session,{
    organizationId:target.organizationId,sourceId:target.sourceId,
    expectedRevision:context.expectedRevision,
    expectedSnapshotSha256:context.expectedSnapshotSha256,
    expectedCorrectionSha256:validated.correctionSha256,
    changes:rehydrateActions(validated.changes),
  });
}
