import {deliveryIdempotencyKey, type DeliveryIntent} from "./outbound-preflight.ts";
import {assessSimulatedFollowUp, type FollowUpAssessment} from "./follow-up-assessment.ts";
import {
  projectSimulatedDeliveryEvents, type DeliveryEvent, type DeliveryEventKind, type DeliveryProjection,
} from "./delivery-event-projection.ts";

/** Fictional deterministic records; not company terms, approvals, or customer activity. */
const HASHES = {
  sourceSha256: "a".repeat(64), policySha256: "b".repeat(64),
  contentSha256: "c".repeat(64), qaSha256: "d".repeat(64),
} as const;
const NOW = "2026-10-22T10:00:00.000Z";
type CaseDefinition = {
  id: string;
  label: string;
  company: string;
  organizationId: string;
  proposalId: string;
  consent: "confirmed" | "unknown";
  events: readonly DeliveryEventKind[];
};
const CASES: readonly CaseDefinition[] = [
  {id:"painting-reply",label:"A reply stops reminders",
   company:"Fictional painting contractor",
   organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
   proposalId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_delivered","recipient_replied"]},
  {id:"cleaning-bounce",label:"A bounce suppresses follow-up",
   company:"Fictional cleaning contractor",
   organizationId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
   proposalId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_bounced"]},
  {id:"painting-consent-unknown",label:"Missing consent blocks follow-up",
   company:"Fictional painting contractor",
   organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
   proposalId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
   consent:"unknown",
   events:["reserved","provider_accepted","provider_delivered"]},
  {id:"cleaning-internal-candidate",label:"A due date is not send approval",
   company:"Fictional cleaning contractor",
   organizationId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
   proposalId:"ffffffff-ffff-4fff-8fff-ffffffffffff",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_delivered"]},
];

export type DeliveryLabCase = {
  id:string;label:string;company:string;
  projection:DeliveryProjection;followUp:FollowUpAssessment;
  contactState:"fictional-confirmed"|"fictional-unconfirmed";
};

export function buildSyntheticDeliveryLabCases(): DeliveryLabCase[] {
  return CASES.map(scenario => {
    const identity={organizationId:scenario.organizationId,
      proposalId:scenario.proposalId,revision:1,...HASHES,
      recipient:"buyer@fictional.example"};
    const intent:DeliveryIntent={...identity,idempotencyKey:deliveryIdempotencyKey(identity)};
    const events:DeliveryEvent[]=scenario.events.map((kind,index)=>({
      eventId:String(index+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
      recipient:intent.recipient,kind,
      observedAt:"2026-10-20T08:"+String(index).padStart(2,"0")+":00.000Z",
    }));
    return {id:scenario.id,label:scenario.label,company:scenario.company,
      projection:projectSimulatedDeliveryEvents(intent,events),
      followUp:assessSimulatedFollowUp(intent,events,{
        consent:scenario.consent,version:1,minimumDelayHours:24,maximumAttempts:2,
      },[],NOW),
      contactState:scenario.consent==="confirmed"?"fictional-confirmed":"fictional-unconfirmed",
    };
  });
}
