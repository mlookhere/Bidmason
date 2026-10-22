import {deliveryIdempotencyKey, type DeliveryIntent} from "./outbound-preflight.ts";
import {assessSimulatedFollowUp, type FollowUpAssessment} from "./follow-up-assessment.ts";
import {classifySimulatedRecipientAwareTriage, type RecipientAwareDeliveryTriage} from "./recipient-aware-delivery-triage.ts";
import type {SyntheticRecipientHistory} from "./recipient-suppression-history.ts";
import {projectSyntheticDealOutcome, type SyntheticDealOutcomeEvent}
  from "./synthetic-deal-outcome.ts";
import {summarizeSyntheticDeliveryReview, type SyntheticReviewEntry, type SimulatedReviewSummary} from "./delivery-review-summary.ts";
import {summarizeSyntheticCrmPipeline, type SyntheticCrmPipeline} from "./synthetic-crm-pipeline.ts";
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
  recipient: string;
  consent: "confirmed" | "unknown";
  events: readonly DeliveryEventKind[];
  earlierOptOutProposalId?: string;
  earlierReplyProposalId?: string;
  terminal?: "won" | "lost";
};
const CASES: readonly CaseDefinition[] = [
  {id:"painting-reply",label:"A reply stops reminders",
   company:"Fictional painting contractor",
   organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
   proposalId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
   recipient:"buyer-reply@fictional.example",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_delivered","recipient_replied"]},
  {id:"cleaning-bounce",label:"A bounce suppresses follow-up",
   company:"Fictional cleaning contractor",
   organizationId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
   proposalId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
   recipient:"buyer-bounce@fictional.example",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_bounced"]},
  {id:"painting-consent-unknown",label:"Missing consent blocks follow-up",
   company:"Fictional painting contractor",
   organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
   proposalId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
   recipient:"buyer-unknown@fictional.example",
   consent:"unknown",
   events:["reserved","provider_accepted","provider_delivered"]},
  {id:"cleaning-internal-candidate",label:"A due date is not send approval",
   company:"Fictional cleaning contractor",
   organizationId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
   proposalId:"ffffffff-ffff-4fff-8fff-ffffffffffff",
   recipient:"buyer-candidate@fictional.example",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_delivered"]},
  {id:"cleaning-prior-optout",label:"Earlier opt-out overrides new proposal",
   company:"Fictional cleaning contractor",
   organizationId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
   proposalId:"11111111-1111-4111-8111-111111111111",
   recipient:"buyer-prior-optout@fictional.example",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_delivered"],
   earlierOptOutProposalId:"22222222-2222-4222-8222-222222222222"},
  {id:"painting-prior-reply",label:"Earlier reply holds a new follow-up",
   company:"Fictional painting contractor",
   organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
   proposalId:"33333333-3333-4333-8333-333333333333",
   recipient:"buyer-prior-reply@fictional.example",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_delivered"],
   earlierReplyProposalId:"44444444-4444-4444-8444-444444444444"},
  {id:"painting-deal-won",label:"A won deal ends follow-up reminders",
   company:"Fictional painting contractor",
   organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
   proposalId:"55555555-5555-4555-8555-555555555555",
   recipient:"buyer-deal-won@fictional.example",
   consent:"confirmed",
   events:["reserved","provider_accepted","provider_delivered"],
   terminal:"won"},
];

export type DeliveryLabCase = {
  id:string;label:string;company:string;
  projection:DeliveryProjection;followUp:FollowUpAssessment;triage:RecipientAwareDeliveryTriage;
  contactState:"fictional-confirmed"|"fictional-unconfirmed";
  dealOutcome:"unverified"|"won"|"lost";
  historicalSuppression: RecipientAwareDeliveryTriage["historicalSuppression"];
};

type FixtureRecord = {organizationId:string;company:string;
  publicCase:DeliveryLabCase;review:SyntheticReviewEntry;
  history: readonly SyntheticRecipientHistory[];
  dealOutcomes: readonly SyntheticDealOutcomeEvent[]};

function buildFixtureRecords(): FixtureRecord[] {
  return CASES.map((scenario, scenarioIndex) => {
    const identity={organizationId:scenario.organizationId,
      proposalId:scenario.proposalId,revision:1,...HASHES,
      // Different invented people, except an earlier proposal explicitly reuses
      // one exact recipient to demonstrate sticky cross-proposal suppression.
      recipient:scenario.recipient};
    const intent:DeliveryIntent={...identity,idempotencyKey:deliveryIdempotencyKey(identity)};
    const events:DeliveryEvent[]=scenario.events.map((kind,index)=>({
      eventId:String(scenarioIndex*10+index+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
      recipient:intent.recipient,kind,
      observedAt:"2026-10-20T08:"+String(index).padStart(2,"0")+":00.000Z",
    }));
    const policy={consent:scenario.consent,version:1,minimumDelayHours:24,maximumAttempts:2};
    const history: SyntheticRecipientHistory[] = scenario.earlierOptOutProposalId
      || scenario.earlierReplyProposalId
      ? (()=>{
        const previousIdentity={...identity,
          proposalId:scenario.earlierOptOutProposalId ?? scenario.earlierReplyProposalId!};
        const previousIntent:DeliveryIntent={...previousIdentity,
          idempotencyKey:deliveryIdempotencyKey(previousIdentity)};
        const previousKinds:DeliveryEventKind[]=["reserved","provider_accepted",
          "provider_delivered",scenario.earlierReplyProposalId?"recipient_replied":"recipient_opted_out"];
        const previousEvents:DeliveryEvent[]=previousKinds.map((kind,index)=>({
          eventId:String(scenarioIndex*10+index+101).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          organizationId:previousIntent.organizationId,
          idempotencyKey:previousIntent.idempotencyKey,
          recipient:previousIntent.recipient,kind,
          observedAt:"2026-10-19T08:"+String(index).padStart(2,"0")+":00.000Z",
        }));
        return [{intent:previousIntent,events:previousEvents}];
      })() : [];
    const dealOutcomes:SyntheticDealOutcomeEvent[]=scenario.terminal ? [{
      eventId:String(scenarioIndex*10+9).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId:intent.organizationId,proposalId:intent.proposalId,
      revision:intent.revision,kind:scenario.terminal,
      observedAt:"2026-10-21T08:00:00.000Z",
    }] : [];
    const outcome=projectSyntheticDealOutcome(intent,dealOutcomes,NOW);
    const triage=classifySimulatedRecipientAwareTriage(
      intent,events,policy,[],history,NOW,dealOutcomes);
    return {
      organizationId:scenario.organizationId,
      company:scenario.company,
      review:{intent,events,policy,previousAttempts:[]},
      history,dealOutcomes,
      publicCase:{id:scenario.id,label:scenario.label,company:scenario.company,
        projection:projectSimulatedDeliveryEvents(intent,events),
        followUp:assessSimulatedFollowUp(intent,events,policy,[],NOW,dealOutcomes),
        dealOutcome:outcome.outcome,
        triage,
        historicalSuppression:triage.historicalSuppression,
        contactState:scenario.consent==="confirmed"?"fictional-confirmed":"fictional-unconfirmed",
      },
    };
  });
}

/** The public preview never receives organization or recipient identifiers. */
export function buildSyntheticDeliveryLabCases(): DeliveryLabCase[] {
  return buildFixtureRecords().map(record=>record.publicCase);
}
export type DeliveryLabSummary = {
  company:string;
  report:SimulatedReviewSummary;
  pipeline:SyntheticCrmPipeline;
};
export function buildSyntheticDeliveryLabSummaries(): DeliveryLabSummary[] {
  const records=buildFixtureRecords();
  const tenants=[...new Set(records.map(record=>record.organizationId))];
  return tenants.map(organizationId=>{
    const scoped=records.filter(record=>record.organizationId===organizationId);
    if (!scoped.length || scoped.some(record=>record.company!==scoped[0].company))
      throw new TypeError("Inconsistent fictional company grouping");
    const entries=scoped.map(record=>record.review);
    const history=scoped.map(record=>record.history);
    const deals=scoped.map(record=>record.dealOutcomes);
    return {
      company:scoped[0].company,
      report:summarizeSyntheticDeliveryReview(organizationId,entries,NOW,history,deals),
      pipeline:summarizeSyntheticCrmPipeline(organizationId,entries,NOW,deals,history),
    };
  });
}
