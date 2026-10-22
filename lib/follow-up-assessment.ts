import {deliveryIdempotencyKey, type DeliveryIntent} from "./outbound-preflight.ts";
import {projectSimulatedDeliveryEvents, type DeliveryEvent} from "./delivery-event-projection.ts";
import {projectSyntheticDealOutcome, type SyntheticDealOutcomeEvent}
  from "./synthetic-deal-outcome.ts";

export type FollowUpPolicy = {
  consent: "confirmed" | "unknown" | "revoked";
  version: number;
  minimumDelayHours: number;
  maximumAttempts: number;
};
export type FollowUpRecord = {
  attemptId: string;
  organizationId: string;
  idempotencyKey: string;
  recipient: string;
  recordedAt: string;
};
export type FollowUpAssessment = {
  state: "blocked" | "candidate-internal-only";
  blockers: string[];
  nextEligibleAt: string | null;
  recordedAttempts: number;
};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const POLICY=["consent","version","minimumDelayHours","maximumAttempts"];
const ATTEMPT=["attemptId","organizationId","idempotencyKey","recipient","recordedAt"];

function exact(value:unknown,fields:readonly string[]):value is Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)
    ||Object.getPrototypeOf(value)!==Object.prototype
    ||Reflect.ownKeys(value).length!==fields.length)return false;
  return fields.every(field=>{
    const p=Object.getOwnPropertyDescriptor(value,field);
    return p?.enumerable===true&&Object.hasOwn(p,"value");
  });
}
function utc(value:unknown):value is string{
  if(typeof value!=="string"||!UTC.test(value))return false;
  const ms=Date.parse(value);
  return Number.isFinite(ms)&&new Date(ms).toISOString()===value;
}
function validPolicy(value:unknown):value is FollowUpPolicy{
  if(!exact(value,POLICY))return false;
  return ["confirmed","unknown","revoked"].includes(value.consent as string)
    &&Number.isSafeInteger(value.version)&&(value.version as number)>=1
    &&Number.isSafeInteger(value.minimumDelayHours)
    &&(value.minimumDelayHours as number)>=1&&(value.minimumDelayHours as number)<=720
    &&Number.isSafeInteger(value.maximumAttempts)
    &&(value.maximumAttempts as number)>=1&&(value.maximumAttempts as number)<=3;
}
function validAttempts(value:unknown):value is FollowUpRecord[]{
  return Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype
    &&value.length<=500&&Reflect.ownKeys(value).length===value.length+1
    &&Array.from({length:value.length},(_,i)=>{
      const p=Object.getOwnPropertyDescriptor(value,String(i));
      return p?.enumerable===true&&Object.hasOwn(p,"value");
    }).every(Boolean);
}

/** Pure dry run. Does not authenticate evidence, contact anyone or reserve work. */
export function assessSimulatedFollowUp(
  intent:DeliveryIntent,events:readonly DeliveryEvent[],
  policy:FollowUpPolicy,previousAttempts:readonly FollowUpRecord[],nowUtc:string,
  dealEvents:readonly SyntheticDealOutcomeEvent[]=[],
):FollowUpAssessment{
  const delivery=projectSimulatedDeliveryEvents(intent,events);
  if(!validPolicy(policy)||!validAttempts(previousAttempts)||!utc(nowUtc)){
    throw new TypeError("Invalid simulated follow-up inputs");
  }
  const deal=projectSyntheticDealOutcome(intent,dealEvents,nowUtc);
  // A new fictional dispatch reserved on or after a known closed-deal
  // timestamp is contradictory, even if later provider callbacks look valid.
  // Provider callbacks for a reservation made BEFORE closure are not new sends.
  if(deal.closedAt && delivery.timeline.some(event =>
    event.kind==="reserved" && event.observedAt>=deal.closedAt)){
    throw new TypeError("Simulated delivery reservation conflicts with closed-deal chronology");
  }
  const {idempotencyKey,...identity}=intent;
  if(deliveryIdempotencyKey(identity)!==idempotencyKey){
    throw new TypeError("Invalid simulated follow-up identity");
  }
  const deliveredAt=delivery.timeline.find(e=>e.kind==="provider_delivered")?.observedAt;
  // A recorded reminder after a recipient's stop-contact signal is conflicting
  // history, not a coherent attempt that can be silently counted as valid.
  const contactStoppedAt=delivery.timeline.find(event => [
    "recipient_replied", "recipient_opted_out", "provider_bounced", "provider_complained",
  ].includes(event.kind))?.observedAt;
  const seen=new Map<string,string>();
  let lastAttempt="";
  for(const attempt of previousAttempts){
    if(!exact(attempt,ATTEMPT)||typeof attempt.attemptId!=="string"
      ||!UUID.test(attempt.attemptId)
      ||attempt.organizationId!==intent.organizationId
      ||attempt.idempotencyKey!==idempotencyKey
      ||attempt.recipient!==intent.recipient||!utc(attempt.recordedAt)){
      throw new TypeError("Invalid or cross-tenant follow-up record");
    }
    const fingerprint=JSON.stringify(ATTEMPT.map(field=>attempt[
      field as keyof FollowUpRecord]));
    const previous=seen.get(attempt.attemptId);
    if(previous!==undefined){
      if(previous!==fingerprint)throw new TypeError("Conflicting follow-up record replay");
      continue;
    }
    if(!deliveredAt||attempt.recordedAt<deliveredAt
      ||attempt.recordedAt>nowUtc||attempt.recordedAt<lastAttempt){
      throw new TypeError("Follow-up history requires chronological reconciliation");
    }
    if(contactStoppedAt && attempt.recordedAt>=contactStoppedAt){
      throw new TypeError("Follow-up attempt conflicts with stop-contact chronology");
    }
    if(deal.closedAt && attempt.recordedAt>=deal.closedAt){
      throw new TypeError("Follow-up attempt conflicts with closed-deal chronology");
    }
    // A previous reminder is coherent only when the same minimum delay was
    // respected at the time, not merely when the next reminder would be due.
    if(Date.parse(attempt.recordedAt)<Date.parse(lastAttempt||deliveredAt)
      +policy.minimumDelayHours*3600000){
      throw new TypeError("Follow-up history violates minimum delay");
    }
    seen.set(attempt.attemptId,fingerprint);
    lastAttempt=attempt.recordedAt;
  }
  const blockers:string[]=[];
  if(policy.consent!=="confirmed")blockers.push("Contact consent is not confirmed");
  if(delivery.delivery!=="reported_delivered"||!deliveredAt)
    blockers.push("No uncontested simulated delivery event");
  if(delivery.replied)blockers.push("Recipient reply suppresses follow-up");
  if(delivery.suppression.length)blockers.push("Bounce, complaint or opt-out suppresses follow-up");
  if(deal.closedAt)blockers.push("Fictional won/lost deal stops follow-up");
  if(seen.size>=policy.maximumAttempts)blockers.push("Follow-up attempt limit reached");
  const baseline=lastAttempt||deliveredAt;
  let nextEligibleAt:string|null=null;
  if(baseline && !deal.closedAt){
    nextEligibleAt=new Date(Date.parse(baseline)+policy.minimumDelayHours*3600000).toISOString();
    if(nowUtc<nextEligibleAt)blockers.push("Minimum follow-up delay has not elapsed");
  }
  if(delivery.timeline.at(-1)?.observedAt && delivery.timeline.at(-1)!.observedAt>nowUtc)
    blockers.push("Delivery stream contains future observations");
  return {state:blockers.length?"blocked":"candidate-internal-only",
    blockers,nextEligibleAt,recordedAttempts:seen.size};
}
