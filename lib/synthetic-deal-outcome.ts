import type {DeliveryIntent} from "./outbound-preflight.ts";
import {projectSimulatedDeliveryEvents} from "./delivery-event-projection.ts";

/** Fictional CRM deal outcome, not a verified sale, contract or contact authority. */
export type SyntheticDealOutcomeEvent = {
  eventId: string;
  organizationId: string;
  proposalId: string;
  revision: number;
  kind: "won" | "lost";
  observedAt: string;
};

export type SyntheticDealOutcomeProjection = {
  state: "deal-outcome-simulation-only";
  outcome: "unverified" | "won" | "lost";
  closedAt: string | null;
  eventCount: number;
  contactAuthorized: false;
};

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIELDS=["eventId","organizationId","proposalId","revision","kind","observedAt"] as const;

function exact(value:unknown):value is Record<string,unknown>{
  if (!value||typeof value!=="object"||Array.isArray(value)
    ||Object.getPrototypeOf(value)!==Object.prototype
    ||Reflect.ownKeys(value).length!==FIELDS.length) return false;
  return FIELDS.every(field=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,field);
    return descriptor?.enumerable===true&&Object.hasOwn(descriptor,"value");
  });
}
function utc(value:unknown):value is string{
  if (typeof value!=="string"||!UTC.test(value)) return false;
  const millis=Date.parse(value);
  return Number.isFinite(millis)&&new Date(millis).toISOString()===value;
}
function dense(value:unknown):value is SyntheticDealOutcomeEvent[]{
  if (!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype
    ||value.length>100||Reflect.ownKeys(value).length!==value.length+1) return false;
  for(let index=0;index<value.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor?.enumerable||!Object.hasOwn(descriptor,"value"))return false;
  }
  return true;
}

/** Review immutable fictional won/lost decisions for one proposal revision.
 * An absent event means UNKNOWN, never an independently verified open deal.
 * Each proposal has at most one distinct terminal decision; exact ID/body
 * replays are idempotent, while a second terminal claim fails closed.
 * No storage, authenticated user, event source, live CRM, or sending occurs. */
export function projectSyntheticDealOutcome(
  intent:DeliveryIntent,
  events:readonly SyntheticDealOutcomeEvent[],
  nowUtc:string,
):SyntheticDealOutcomeProjection{
  // Existing dispatch identity checks apply even to an empty outcome stream.
  projectSimulatedDeliveryEvents(intent,[]);
  if(!dense(events)||!utc(nowUtc))throw new TypeError("Invalid synthetic deal outcome stream");
  const seen=new Map<string,string>();
  let outcome:SyntheticDealOutcomeProjection["outcome"]="unverified";
  let closedAt:string|null=null;
  for(const event of events){
    if(!exact(event)||typeof event.eventId!=="string"||!UUID.test(event.eventId)
      ||event.organizationId!==intent.organizationId
      ||event.proposalId!==intent.proposalId||event.revision!==intent.revision
      ||(event.kind!=="won"&&event.kind!=="lost")||!utc(event.observedAt)
      ||event.observedAt>nowUtc){
      throw new TypeError("Invalid or cross-tenant synthetic deal outcome");
    }
    const fingerprint=JSON.stringify(FIELDS.map(field=>event[field]));
    const previous=seen.get(event.eventId);
    if(previous!==undefined){
      if(previous!==fingerprint)throw new TypeError("Conflicting synthetic deal outcome replay");
      continue;
    }
    if(closedAt!==null){
      throw new TypeError("Conflicting synthetic terminal deal outcomes");
    }
    seen.set(event.eventId,fingerprint);
    outcome=event.kind;
    closedAt=event.observedAt;
  }
  return {state:"deal-outcome-simulation-only",outcome,closedAt,
    eventCount:seen.size,contactAuthorized:false};
}
