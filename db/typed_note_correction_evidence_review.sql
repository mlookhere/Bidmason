-- Staging / disposable PostgreSQL only. This is evidence review, NOT
-- activated correction, approved commercial scope, a pricing decision or send.
-- Requires quarantined revision 4 and immutable pending correction draft.
create table bm_intake_private.correction_evidence_reviews (
 organization_id uuid not null,
 source_id uuid not null,
 submitted_by uuid not null,
 reviewed_by uuid not null,
 request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
 draft_sha256 text not null check(draft_sha256 ~ '^[0-9a-f]{64}$'),
 proposed_candidates_sha256 text not null check(proposed_candidates_sha256 ~ '^[0-9a-f]{64}$'),
 decision text not null check(decision in ('accept-evidence','reject-evidence')),
 reviewer_reason text not null check (
  length(reviewer_reason) between 1 and 500 and
  octet_length(reviewer_reason)<=1000),
 evidence_review_sha256 text not null check(evidence_review_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 primary key(organization_id,source_id),
 foreign key(organization_id,source_id)
  references bm_intake_private.correction_candidate_drafts(
   organization_id,source_id) on update restrict on delete restrict,
 check(submitted_by<>reviewed_by)
);
revoke all on bm_intake_private.correction_evidence_reviews
 from public,anon,authenticated,service_role;
create trigger bm_correction_evidence_review_immutable
 before update or delete on bm_intake_private.correction_evidence_reviews
 for each row execute function bm_intake_private.reject_correction_hold_mutation();

-- Caller must derive BOTH actor IDs independently from verified Auth sessions.
-- SQL enforces current membership, distinct actors and locked evidence. There
-- is no activation or revised commercial scope in this transaction.
create function bm_intake_private.review_correction_evidence(
 p_org uuid,p_reviewer uuid,p_source uuid,p_expected_draft_sha text,
 p_decision text,p_reason text
) returns table(recorded_decision text,recorded_review_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private
as $review$
declare
 v_source public.bm_intake_sources%rowtype;
 v_draft bm_intake_private.correction_candidate_drafts%rowtype;
 v_hold bm_intake_private.correction_holds%rowtype;
 v_original_sha text;
 v_candidates_sha text;
 v_actions_sha text;
 v_draft_sha text;
 v_review_sha text;
begin
 if p_org is null or p_reviewer is null or p_source is null
   or coalesce(p_expected_draft_sha,'') !~ '^[0-9a-f]{64}$'
   or p_decision is null
   or p_decision not in ('accept-evidence','reject-evidence')
   or p_reason is null or p_reason<>btrim(p_reason)
   or length(p_reason) not between 1 and 500
   or octet_length(p_reason)>1000 or p_reason ~ '[[:cntrl:]]' then
   raise exception 'Invalid independent correction evidence review'
     using errcode='22023';
 end if;
 -- Membership before private source lookup; only owner/operator can review.
 -- The row lock remains held through the immutable INSERT.
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=p_reviewer
    and member_role in ('owner','operator') for share;
 if not found then
   raise exception 'Current independent reviewer membership required'
     using errcode='42501';
 end if;
 select * into v_source from public.bm_intake_sources
  where organization_id=p_org and id=p_source for share;
 if not found then
   raise exception 'Private correction review source unavailable'
     using errcode='42501';
 end if;
 if v_source.created_by=p_reviewer then
   raise exception 'Correction creator cannot review own evidence'
     using errcode='22023';
 end if;
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=v_source.created_by
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Correction submitter membership is no longer active'
     using errcode='42501';
 end if;
 if v_source.revision<>4 or v_source.scope_review is not null
   or jsonb_typeof(v_source.correction_hold) is distinct from 'object'
   or v_source.correction_hold->>'state' is distinct from
      'quarantined-awaiting-correction'
   or v_source.review is null
   or jsonb_typeof(v_source.review->'candidates') is distinct from 'array'
   or jsonb_typeof(v_source.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_source.extraction_audit)<>1 then
   raise exception 'Quarantined correction evidence is stale'
     using errcode='40001';
 end if;
 select * into v_draft from bm_intake_private.correction_candidate_drafts
  where organization_id=p_org and source_id=p_source for share;
 if not found then
   raise exception 'Pending correction draft unavailable'
     using errcode='42501';
 end if;
 select * into v_hold from bm_intake_private.correction_holds
  where organization_id=p_org and source_id=p_source for share;
 if not found then
   raise exception 'Correction hold receipt unavailable'
     using errcode='42501';
 end if;
 v_original_sha:=bm_intake_private.canonical_candidate_sha256(
   v_source.review->'candidates');
 v_candidates_sha:=bm_intake_private.canonical_candidate_sha256(
   v_draft.proposed_candidates);
 v_actions_sha:=encode(sha256(convert_to(
   v_draft.correction_actions::text,'UTF8')),'hex');
 v_draft_sha:=encode(sha256(convert_to(jsonb_build_array(
   p_org::text,p_source::text,v_draft.actor_id::text,
   v_draft.request_sha256,v_draft.hold_sha256,
   v_original_sha,v_candidates_sha,v_actions_sha,v_draft.reason
 )::text,'UTF8')),'hex');
 if v_draft.actor_id is distinct from v_source.created_by
   or v_hold.actor_id is distinct from v_source.created_by
   or v_hold.hold is distinct from v_source.correction_hold
   or v_draft.hold_sha256 is distinct from encode(sha256(
      convert_to(v_source.correction_hold::text,'UTF8')),'hex')
   or v_draft.request_sha256 is distinct from v_hold.request_sha256
   or v_draft.request_sha256 is distinct from
      v_source.correction_hold->>'requestSha256'
   or v_source.review->>'candidatesSha256' is distinct from v_original_sha
   or v_source.correction_hold->>'candidatesSha256' is distinct from v_original_sha
   or v_source.review->>'sourceSha256' is distinct from
      encode(sha256(convert_to('typed-note','UTF8')||decode('00','hex')
       ||convert_to(v_source.original_text,'UTF8')),'hex')
   or v_source.extraction_audit->0->>'actorId' is distinct from
       v_source.created_by::text
   or v_source.extraction_audit->0->>'sourceRevision' is distinct from '2'
   or v_source.extraction_audit->0->>'sourceSha256' is distinct from
       v_source.review->>'sourceSha256'
   or v_source.extraction_audit->0->>'candidatesSha256' is distinct from
       v_original_sha
   or v_draft.original_candidates_sha256 is distinct from v_original_sha
   or v_draft.proposed_candidates_sha256 is distinct from v_candidates_sha
   or v_draft.actions_sha256 is distinct from v_actions_sha
   or v_draft.draft_sha256 is distinct from v_draft_sha
   or v_draft.draft_sha256 is distinct from p_expected_draft_sha
   or not bm_intake_private.replay_correction_actions(
     v_source.review->'candidates',v_draft.correction_actions,
     v_draft.proposed_candidates)
   or bm_intake_private.correction_request_sha256(
     p_org,p_source,v_source.review->>'sourceSha256',v_original_sha,
     v_candidates_sha,v_draft.correction_actions) is distinct from
       v_draft.request_sha256 then
   raise exception 'Independent correction evidence fingerprint mismatch'
     using errcode='22023';
 end if;
 -- This hash records the evidence REVIEW only. It never mutates sources,
 -- candidate drafts, original reviews, human scope, pricing or approvals.
 v_review_sha:=encode(sha256(convert_to(jsonb_build_array(
   'bm-correction-evidence-review-v1',p_org::text,p_source::text,
   v_draft.actor_id::text,p_reviewer::text,v_draft_sha,
   v_candidates_sha,p_decision,p_reason)::text,'UTF8')),'hex');
 insert into bm_intake_private.correction_evidence_reviews(
  organization_id,source_id,submitted_by,reviewed_by,
  request_sha256,draft_sha256,proposed_candidates_sha256,
  decision,reviewer_reason,evidence_review_sha256
 ) values(p_org,p_source,v_draft.actor_id,p_reviewer,
  v_draft.request_sha256,v_draft_sha,v_candidates_sha,
  p_decision,p_reason,v_review_sha);
 return query select p_decision,v_review_sha;
end;
$review$;
revoke all on function bm_intake_private.review_correction_evidence(
 uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function bm_intake_private.review_correction_evidence(
 uuid,uuid,uuid,text,text,text) to service_role;
