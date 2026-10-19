import { createHash } from "node:crypto";
import { readActivePolicy } from "./company-policy-revisions.ts";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import { buildReviewWorkbench } from "./intake-review-workbench.ts";
import { prepareReviewPreviewRequest } from "./intake-review-selection.ts";
import { previewReviewedEconomics } from "./intake-quote-preview.ts";
import { verifyActivatedCorrectionLineage,
  type TenantExtractionCorrectionRecord }
  from "./tenant-extraction-correction.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
type Selector={organizationId:string;sourceId:string};

export type CorrectedScopeDecision={
  state:"reviewed-corrected-scope-internal-only";
  sourceRevision:number;
  reviewedBy:string;
  activationSha256:string;
  reviewKey:string;
  sourceSha256:string;
  candidatesSha256:string;
  selectedIndices:number[];
  acceptedAddonCodes:string[];
  policyRevision:number;
  policySha256:string;
  reviewedSelectionSha256:string;
};

export type TenantCorrectedScopeRecord=TenantExtractionCorrectionRecord & {
  /** A distinct renewed review; never populate the old provider scopeReview. */
  correctedScopeReview?:CorrectedScopeDecision|null;
};

/** Production store must enforce current source ownership, session and this
 * distinct reviewer role INSIDE the same serializable/locked CAS transaction. */
export interface TrustedCorrectedScopeStore {
  readAuthorized(input:Selector & {session:unknown}):Promise<TenantCorrectedScopeRecord|null>;
  mutateAuthorized(input:Selector & {session:unknown;permission:"review-corrected-extraction";
    transform:(current:TenantCorrectedScopeRecord|null,
      authenticatedReviewerId:string)=>TenantCorrectedScopeRecord;
  }):Promise<TenantCorrectedScopeRecord>;
}

function checkSelector(value:Selector):void {
  if(!value||typeof value!=="object"||Array.isArray(value)
    ||typeof value.organizationId!=="string"||!UUID.test(value.organizationId)
    ||typeof value.sourceId!=="string"||!UUID.test(value.sourceId)){
    throw new TypeError("Invalid corrected scope selector");
  }
}

function checked(record:TenantCorrectedScopeRecord|null,target:Selector,
  allowReviewed=false):asserts record is TenantCorrectedScopeRecord {
  if(!record||record.organizationId!==target.organizationId
    ||record.sourceId!==target.sourceId||record.scopeReview!==null
    ||record.pendingCorrection!=null
    ||(!allowReviewed&&record.correctedScopeReview!=null)){
    throw new Error("Corrected scope is absent, stale or already reviewed");
  }
  verifyActivatedCorrectionLineage(record,target);
}

function stamp(record:TenantCorrectedScopeRecord):string {
  // Integrity snapshot only; neither signature nor authorization.
  return createHash("sha256").update(JSON.stringify([
    record.organizationId,record.sourceId,record.revision,
    record.original,record.review,record.extractionAudit,
    record.creationAudit??null,record.scopeReview,
    record.pendingCorrection??null,record.activatedCorrection,
    record.correctedScopeReview??null,
  ])).digest("hex");
}

async function policySnapshot(policyStore:Pick<TrustedPolicyStore,"readAuthorized">,
  session:unknown,organizationId:string){
  const history=await policyStore.readAuthorized({session,organizationId});
  if(!history)throw new Error("Approved tenant pricing is required");
  return readActivePolicy(history,organizationId);
}

/** TWO independent source and approved-policy reads before showing a
 * corrected candidate workbench. No old scope can be implicitly reused. */
export async function readCorrectedScopeContext(
  sourceStore:Pick<TrustedCorrectedScopeStore,"readAuthorized">,
  policyStore:Pick<TrustedPolicyStore,"readAuthorized">,
  session:unknown,target:Selector,
){
  checkSelector(target);
  const first=await sourceStore.readAuthorized({...target,session});
  checked(first,target);
  const evidence=verifyActivatedCorrectionLineage(first,target);
  const policy=await policySnapshot(policyStore,session,target.organizationId);
  const model=buildReviewWorkbench(first.original,evidence.correctedReview,policy);
  const recorded=stamp(first);
  const latest=await sourceStore.readAuthorized({...target,session});
  checked(latest,target);
  if(stamp(latest)!==recorded){
    throw new Error("Corrected extraction changed during human review; refresh");
  }
  const currentPolicy=await policySnapshot(policyStore,session,target.organizationId);
  const again=buildReviewWorkbench(latest.original,
    verifyActivatedCorrectionLineage(latest,target).correctedReview,currentPolicy);
  if(again.key!==model.key){
    throw new Error("Company policy changed during corrected review; refresh");
  }
  return {state:"requires-renewed-human-corrected-scope-review" as const,
    ...target,expectedRevision:first.revision,expectedSnapshotSha256:recorded,
    activationSha256:evidence.activationSha256,model};
}

export type CorrectedScopeCommitRequest=Selector & {
  expectedRevision:number;
  expectedSnapshotSha256:string;
  activationSha256:string;
  reviewKey:string;
  selectedIndices:number[];
  acceptedAddonCodes:string[];
};
function checkRequest(req:CorrectedScopeCommitRequest):void {
  const required=["organizationId","sourceId","expectedRevision",
    "expectedSnapshotSha256","activationSha256","reviewKey",
    "selectedIndices","acceptedAddonCodes"];
  if(!req||typeof req!=="object"||Array.isArray(req)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(req))
    ||Reflect.ownKeys(req).length!==required.length
    ||Reflect.ownKeys(req).some(key=>{
      if(typeof key!=="string"||!required.includes(key))return true;
      const d=Object.getOwnPropertyDescriptor(req,key);
      return !d||!d.enumerable||!Object.hasOwn(d,"value");
    })){
    throw new TypeError("Invalid corrected scope commit request");
  }
  checkSelector(req);
  if(!Number.isSafeInteger(req.expectedRevision)||req.expectedRevision<4
    ||![req.expectedSnapshotSha256,req.activationSha256,req.reviewKey]
      .every(s=>typeof s==="string"&&HASH.test(s))
    ||!Array.isArray(req.selectedIndices)||!Array.isArray(req.acceptedAddonCodes)){
    throw new TypeError("Invalid corrected scope commit request");
  }
}

/** Explicit human review of separately corrected evidence. The result stays
 * internal-only and cannot unlock existing proposal or send paths. */
export async function commitAuthorizedCorrectedScopeReview(
  sourceStore:TrustedCorrectedScopeStore,
  policyStore:Pick<TrustedPolicyStore,"readAuthorized">,
  session:unknown,request:CorrectedScopeCommitRequest,
):Promise<{state:"reviewed-corrected-scope-internal-only";sourceId:string;
  revision:number;reviewedBy:string;reviewedSelectionSha256:string}>{
  checkRequest(request);
  const policy=await policySnapshot(policyStore,session,request.organizationId);
  let expected:TenantCorrectedScopeRecord|null=null;
  const committed=await sourceStore.mutateAuthorized({
    session,organizationId:request.organizationId,sourceId:request.sourceId,
    permission:"review-corrected-extraction",
    transform(current,actorId){
      checked(current,request);
      if(typeof actorId!=="string"||!UUID.test(actorId)){
        throw new Error("Authenticated corrected scope reviewer required");
      }
      if(current.revision!==request.expectedRevision
        ||stamp(current)!==request.expectedSnapshotSha256){
        throw new Error("Stale corrected scope; reload review");
      }
      const evidence=verifyActivatedCorrectionLineage(current,request);
      if(evidence.activationSha256!==request.activationSha256){
        throw new Error("Activated extraction lineage has changed");
      }
      const model=buildReviewWorkbench(current.original,evidence.correctedReview,policy);
      if(model.key!==request.reviewKey){
        throw new Error("Approved tenant pricing or corrected review key changed");
      }
      const selection=prepareReviewPreviewRequest(model,{
        key:request.reviewKey,
        selectedIndices:request.selectedIndices,
        acceptedAddonCodes:request.acceptedAddonCodes,
      });
      const preview=previewReviewedEconomics(current.original,evidence.correctedReview,
        selection.selectedIndices,policy,selection.acceptedAddonCodes);
      if(current.revision>=Number.MAX_SAFE_INTEGER){
        throw new RangeError("Corrected scope revision overflow");
      }
      const revision=current.revision+1;
      const decision:CorrectedScopeDecision={
        state:"reviewed-corrected-scope-internal-only",
        sourceRevision:revision,reviewedBy:actorId,
        activationSha256:evidence.activationSha256,
        reviewKey:model.key,
        sourceSha256:preview.sourceSha256,
        candidatesSha256:preview.candidatesSha256,
        selectedIndices:selection.selectedIndices,
        acceptedAddonCodes:selection.acceptedAddonCodes,
        policyRevision:preview.economics.policyRevision,
        policySha256:preview.economics.policySha256,
        reviewedSelectionSha256:preview.reviewedSelectionSha256,
      };
      const next:TenantCorrectedScopeRecord={
        ...current,revision,scopeReview:null,correctedScopeReview:decision,
      };
      expected=structuredClone(next);
      return next;
    },
  });
  if(!expected||stamp(committed)!==stamp(expected)){
    throw new Error("Corrected scope mutation not confirmed");
  }
  const stored=await sourceStore.readAuthorized({
    session,organizationId:request.organizationId,sourceId:request.sourceId,
  });
  checked(stored,request,true);
  if(stamp(stored)!==stamp(expected)||!stored.correctedScopeReview
    ||stored.correctedScopeReview.state!=="reviewed-corrected-scope-internal-only"
    ||stored.correctedScopeReview.sourceRevision!==stored.revision){
    throw new Error("Corrected scope read-back not confirmed");
  }
  const finalPolicy=await policySnapshot(policyStore,session,request.organizationId);
  const finalModel=buildReviewWorkbench(stored.original,
    verifyActivatedCorrectionLineage(stored,request).correctedReview,finalPolicy);
  if(finalModel.key!==request.reviewKey){
    throw new Error("Company policy changed after corrected scope commit; reconcile");
  }
  return {state:"reviewed-corrected-scope-internal-only",
    sourceId:stored.sourceId,revision:stored.revision,
    reviewedBy:stored.correctedScopeReview.reviewedBy,
    reviewedSelectionSha256:stored.correctedScopeReview.reviewedSelectionSha256};
}
