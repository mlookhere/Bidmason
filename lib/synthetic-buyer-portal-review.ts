import {verifyBuyerViewGrant, type BuyerViewIdentity}
  from "./buyer-view-grant.ts";
import {assessBuyerResponseDraft, type BuyerResponseDraftInput}
  from "./buyer-response-draft.ts";

/** Fictional, nonbinding buyer-portal review adapter.
 *
 * Signed read-only claims never establish an authenticated buyer session,
 * active tenant membership, approved revision, durable grant revocation or
 * authority to submit. In a real portal all those checks must be enforced
 * transactionally on a separately reviewed server before any content access.
 *
 * This intentionally reports NO token, grant ID, fingerprint, document,
 * note, tenant identifier, recipient, URL or claims. */
export type SyntheticBuyerPortalReview = {
  state: "portal-simulation-only";
  view: "signed-claims-only" | "blocked";
  response: "not-requested" | "draft-internal-only" | "blocked";
  reason: "none" | "grant-not-verified" | "draft-not-verified";
  contentAccessible: false;
  responseSubmitted: false;
  contactAuthorized: false;
  dataComplete: false;
};

/** Evaluate only the cryptographic/in-memory evidence supplied by the caller.
 * A response draft NEVER extends the read-only grant into submit privilege. */
export function reviewSyntheticBuyerPortal(
  identity: BuyerViewIdentity,
  viewToken: string,
  signingKey: Uint8Array,
  nowSeconds: number,
  revokedGrantIds: readonly string[],
  respondedGrantIds: readonly string[],
  draft?: BuyerResponseDraftInput,
): SyntheticBuyerPortalReview {
  // Only the underlying validators are trusted to reject hostile array or
  // accessor-based inputs. Verify before considering any response request.
  const view = verifyBuyerViewGrant(
    viewToken, identity, signingKey, nowSeconds, revokedGrantIds,
  );
  // Always validate the supplied response history, including when the caller
  // chooses no draft, so missing/hostile persistence evidence cannot be
  // silently misrepresented as a clean session.
  if (!Array.isArray(respondedGrantIds)
    || Object.getPrototypeOf(respondedGrantIds)!==Array.prototype
    || respondedGrantIds.length>500
    || Reflect.ownKeys(respondedGrantIds).length!==respondedGrantIds.length+1
    || !Array.from({length:respondedGrantIds.length}, (_,i)=>{
      const d=Object.getOwnPropertyDescriptor(respondedGrantIds,String(i));
      return d?.enumerable===true && Object.hasOwn(d,"value")
        && typeof d.value==="string" && /^[0-9a-f]{32}$/.test(d.value);
    }).every(Boolean)) {
    throw new TypeError("Invalid fictional buyer response history");
  }

  if (view.state==="blocked") {
    return {
      state:"portal-simulation-only",
      view:"blocked",response:"blocked",reason:"grant-not-verified",
      contentAccessible:false,responseSubmitted:false,
      contactAuthorized:false,dataComplete:false,
    };
  }
  if (draft===undefined) {
    return {
      state:"portal-simulation-only",
      view:"signed-claims-only",response:"not-requested",reason:"none",
      contentAccessible:false,responseSubmitted:false,
      contactAuthorized:false,dataComplete:false,
    };
  }

  const assessment=assessBuyerResponseDraft(
    draft, identity, viewToken, signingKey, nowSeconds,
    revokedGrantIds, respondedGrantIds,
  );
  return {
    state:"portal-simulation-only",
    view:"signed-claims-only",
    response:assessment.state==="draft-internal-only"
      ?"draft-internal-only":"blocked",
    reason:assessment.state==="draft-internal-only"?"none":"draft-not-verified",
    contentAccessible:false,responseSubmitted:false,
    contactAuthorized:false,dataComplete:false,
  };
}
