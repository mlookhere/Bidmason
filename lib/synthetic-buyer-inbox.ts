import {assessBuyerResponseDraft, type BuyerResponseDraftInput}
  from "./buyer-response-draft.ts";
import type {BuyerViewIdentity} from "./buyer-view-grant.ts";

/** Caller-supplied, fictional inbound evidence only. None of these records
 * authenticates an actual buyer or proves provider/session delivery. */
export type SyntheticBuyerInboxEvent = {
  eventId: string;
  viewToken: string;
  draft: BuyerResponseDraftInput;
  observedAtSeconds: number;
};

/** Counts only. Never outputs a buyer identifier, note, token, grant ID,
 * response fingerprint or customer-facing link. No submission is possible. */
export type SyntheticBuyerInboxSummary = {
  state: "inbox-simulation-only";
  eventsReviewed: number;
  questions: number;
  changeRequests: number;
  declines: number;
  operatorReviewRequired: number;
  responseSubmitted: false;
  contactAuthorized: false;
  dataComplete: false;
};

const FIELDS = ["eventId", "viewToken", "draft", "observedAtSeconds"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function plainExact(value:unknown, keys:readonly string[]): value is Record<string,unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value)!==Object.prototype
    || Reflect.ownKeys(value).length!==keys.length) return false;
  return keys.every(key => {
    const prop=Object.getOwnPropertyDescriptor(value,key);
    return prop?.enumerable===true && Object.hasOwn(prop,"value");
  });
}

function denseList(value:unknown): value is SyntheticBuyerInboxEvent[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype
    || value.length<1 || value.length>100
    || Reflect.ownKeys(value).length!==value.length+1) return false;
  return Array.from({length:value.length},(_,i)=>{
    const prop=Object.getOwnPropertyDescriptor(value,String(i));
    return prop?.enumerable===true && Object.hasOwn(prop,"value");
  }).every(Boolean);
}

/** Validate a synthetic inbound response stream as one indivisible
 * transaction: no partial success counts on replay, tenant crossover,
 * expired grant, invalid chronology or unsafe note. A signed READ grant is
 * deliberately still NOT an authorization to submit any response. */
export function summarizeSyntheticBuyerInbox(
  identity: BuyerViewIdentity,
  signingKey: Uint8Array,
  nowSeconds: number,
  revokedGrantIds: readonly string[],
  events: readonly SyntheticBuyerInboxEvent[],
): SyntheticBuyerInboxSummary {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds<0
    || nowSeconds>8_640_000_000 || !denseList(events)) {
    throw new TypeError("Invalid fictional buyer inbox evidence");
  }
  const seenEvents=new Set<string>();
  const respondedGrants:string[]=[];
  let latest=-1;
  const totals={questions:0,changeRequests:0,declines:0};

  for(let i=0;i<events.length;i++){
    // Never invoke getters or coerce objects supplied by untrusted callers.
    const record=Object.getOwnPropertyDescriptor(events,String(i))?.value;
    if(!plainExact(record,FIELDS) || typeof record.eventId!=="string"
      || !UUID.test(record.eventId) || seenEvents.has(record.eventId)
      || typeof record.viewToken!=="string"
      || !Number.isSafeInteger(record.observedAtSeconds)
      || record.observedAtSeconds<0 || record.observedAtSeconds>nowSeconds
      || record.observedAtSeconds<latest){
      throw new TypeError("Invalid fictional buyer inbox evidence");
    }
    seenEvents.add(record.eventId);
    latest=record.observedAtSeconds;
    // This strict existing validator also verifies exact proposal/tenant,
    // expiry at reported event time, grants and the nonbinding response kind.
    const assessment=assessBuyerResponseDraft(
      record.draft as BuyerResponseDraftInput, identity, record.viewToken,
      signingKey, record.observedAtSeconds, revokedGrantIds, respondedGrants,
    );
    if(assessment.state!=="draft-internal-only"){
      throw new TypeError("Inconsistent fictional buyer inbox evidence");
    }
    respondedGrants.push(assessment.grantId);
    if(assessment.kind==="question") totals.questions++;
    else if(assessment.kind==="request_changes") totals.changeRequests++;
    else totals.declines++;
  }
  return {
    state:"inbox-simulation-only",
    eventsReviewed:events.length,
    ...totals,
    operatorReviewRequired:events.length,
    responseSubmitted:false,
    contactAuthorized:false,
    dataComplete:false,
  };
}
