import {assessBuyerResponseDraft, type BuyerResponseDraftInput}
  from "./buyer-response-draft.ts";
import {verifyBuyerViewGrant, type BuyerViewIdentity}
  from "./buyer-view-grant.ts";

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
      || typeof record.observedAtSeconds!=="number"
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
  // A fictional decline ends review of this exact recipient/revision.
  // A later (or equal-second, order-ambiguous) response using a fresh
  // read-only grant must not silently reopen the already declined revision.
  // This check happens AFTER all signed grants and drafts were validated.
  const declineRecords=events.filter(item=>item.draft.kind==="decline");
  if(declineRecords.length>1 || (declineRecords.length===1
      && events.some(item=>item!==declineRecords[0]
        && item.observedAtSeconds>=declineRecords[0].observedAtSeconds))){
    throw new TypeError("Contradictory fictional buyer response after decline");
  }
  // The stream currently accepts same-second response events in input order.
  // Without a trustworthy event sequence number, their chronology is
  // ambiguous. Never treat arbitrary caller array order as causal proof.
  if(events.some((item,index)=>index>0
      && item.observedAtSeconds===events[index-1].observedAtSeconds)){
    throw new TypeError("Ambiguous fictional buyer response chronology");
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

/** One caller-supplied fictional stream for a specific proposal revision.
 * No database lookup or signed buyer authentication is performed here. */
export type SyntheticBuyerInboxStream = {
  identity: BuyerViewIdentity;
  events: readonly SyntheticBuyerInboxEvent[];
};

export type SyntheticBuyerInboxBatchSummary = SyntheticBuyerInboxSummary & {
  streamsReviewed: number;
  distinctProposals: number;
};

/** Detect duplicate inbound evidence even when it is replayed in DIFFERENT
 * proposal streams. Per-stream checks alone cannot detect batch replay.
 * Reject every record on any cross-stream collision; never count a prefix. */
export function summarizeSyntheticBuyerInboxBatch(
  organizationId: string,
  signingKey: Uint8Array,
  nowSeconds: number,
  revokedGrantIds: readonly string[],
  streams: readonly SyntheticBuyerInboxStream[],
): SyntheticBuyerInboxBatchSummary {
  if (typeof organizationId!=="string" || !UUID.test(organizationId)
    || !Array.isArray(streams)
    || Object.getPrototypeOf(streams)!==Array.prototype
    || streams.length<1 || streams.length>20
    || Reflect.ownKeys(streams).length!==streams.length+1
    || !Array.from({length:streams.length},(_,i)=>{
      const d=Object.getOwnPropertyDescriptor(streams,String(i));
      return d?.enumerable===true && Object.hasOwn(d,"value");
    }).every(Boolean)) {
    throw new TypeError("Invalid fictional buyer inbox batch");
  }

  const usedEvents=new Set<string>();
  const usedGrants=new Set<string>();
  const proposals=new Set<string>();
  // A proposal revision represents one immutable fictional document even
  // when several recipients hold separately signed view claims. An inbox
  // aggregate must not reconcile contradictory content digests as one deal.
  const revisionContent=new Map<string,string>();
  // A different grant/stream for the same buyer and proposal revision must
  // not restart a declined conversation. Evaluate after ALL streams, so the
  // caller's batch order cannot hide an otherwise terminal decline.
  const recipientResponses=new Map<string,Array<{time:number;kind:string}>>();
  const totals={eventsReviewed:0,questions:0,changeRequests:0,declines:0};
  for (let i=0;i<streams.length;i++){
    const entry=Object.getOwnPropertyDescriptor(streams,String(i))?.value;
    if(!plainExact(entry,["identity","events"])
      || !plainExact(entry.identity,[
        "organizationId","proposalId","revision",
        "recipientSha256","contentSha256",
      ]) || entry.identity.organizationId!==organizationId
      || !denseList(entry.events) || totals.eventsReviewed+entry.events.length>500){
      throw new TypeError("Invalid fictional buyer inbox batch");
    }
    const scoped=summarizeSyntheticBuyerInbox(
      entry.identity as BuyerViewIdentity,signingKey,nowSeconds,
      revokedGrantIds,entry.events as SyntheticBuyerInboxEvent[],
    );
    const revision=JSON.stringify([entry.identity.proposalId,entry.identity.revision]);
    const priorContent=revisionContent.get(revision);
    if (priorContent!==undefined && priorContent!==entry.identity.contentSha256) {
      throw new TypeError("Conflicting fictional buyer inbox proposal revision content");
    }
    revisionContent.set(revision,entry.identity.contentSha256 as string);
    for (let j=0;j<entry.events.length;j++){
      const item=Object.getOwnPropertyDescriptor(entry.events,String(j))?.value;
      // The scoped verifier just validated the entire stream, but the
      // batch must independently detect duplicates across streams.
      const proof=verifyBuyerViewGrant(
        item.viewToken, entry.identity as BuyerViewIdentity,signingKey,
        item.observedAtSeconds,revokedGrantIds,
      );
      if (proof.state!=="signed-claims-only"
        || usedEvents.has(item.eventId) || usedGrants.has(proof.grantId)){
        throw new TypeError("Replayed fictional buyer inbox batch evidence");
      }
      usedEvents.add(item.eventId);
      usedGrants.add(proof.grantId);
      const recipientKey=JSON.stringify([
        entry.identity.proposalId,entry.identity.revision,
        entry.identity.recipientSha256,
      ]);
      const observations=recipientResponses.get(recipientKey)??[];
      observations.push({
        time:item.observedAtSeconds,
        kind:item.draft.kind,
      });
      recipientResponses.set(recipientKey,observations);
    }
    proposals.add(entry.identity.proposalId as string);
    totals.eventsReviewed+=scoped.eventsReviewed;
    totals.questions+=scoped.questions;
    totals.changeRequests+=scoped.changeRequests;
    totals.declines+=scoped.declines;
  }
  // Preserve a terminal fictional decline for each recipient, even when
  // a different signed grant was used and batch entries are rearranged.
  // Independent recipients, proposals and revisions remain distinct.
  for(const observations of recipientResponses.values()){
    const declines=observations.filter(x=>x.kind==="decline");
    if(declines.length>1 || (declines.length===1 && observations.some(x=>
        x!==declines[0] && x.time>=declines[0].time))){
      throw new TypeError("Contradictory fictional buyer response after decline");
    }
    // Two independently verified grants with identical event timestamps
    // cannot establish which fictional response came first. Inspect the
    // whole batch regardless of stream order; no partial aggregate escapes.
    const seenTimes=new Set<number>();
    for(const response of observations){
      if(seenTimes.has(response.time))
        throw new TypeError("Ambiguous fictional buyer response chronology");
      seenTimes.add(response.time);
    }
  }
  return {
    state:"inbox-simulation-only",
    streamsReviewed:streams.length,
    distinctProposals:proposals.size,
    ...totals,
    operatorReviewRequired:totals.eventsReviewed,
    responseSubmitted:false,
    contactAuthorized:false,
    dataComplete:false,
  };
}
