-- DISPOSABLE POSTGRES STAGING ONLY. A distinct current owner/operator may
-- approve the INTERNAL corrected-scope draft evidence. Never quote or send.
-- Rev5 remains rev5, previous public scope_review remains NULL.
create table bm_intake_private.corrected_commercial_decisions (
 organization_id uuid not null,
 source_id uuid not null,
 original_creator uuid not null,
 evidence_reviewer uuid not null,
 commercial_reviewer uuid not null,
 activation_sha256 text not null check(activation_sha256 ~ '^[a-f0-9]{64}$'),
 corrected_candidates_sha256 text not null check(
  corrected_candidates_sha256 ~ '^[a-f0-9]{64}$'),
 selection_receipt_sha256 text not null check(selection_receipt_sha256 ~ '^[a-f0-9]{64}$'),
 policy_revision integer not null check(policy_revision between 1 and 1000000),
 policy_sha256 text not null check(policy_sha256 ~ '^[a-f0-9]{64}$'),
 decision text not null check(decision in ('approve-internal-draft','reject-internal-draft')),
 reviewer_reason text not null check(length(reviewer_reason) between 1 and 500
   and octet_length(reviewer_reason)<=1000),
 decision_sha256 text not null check(decision_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 primary key (organization_id,source_id),
 foreign key (organization_id,source_id) references
  bm_intake_private.corrected_scope_review_drafts(organization_id,source_id)
  on update restrict on delete restrict,
 check(commercial_reviewer<>original_creator
   and commercial_reviewer<>evidence_reviewer
   and original_creator<>evidence_reviewer)
);
revoke all on bm_intake_private.corrected_commercial_decisions
 from public,anon,authenticated,service_role;
create trigger bm_corrected_commercial_decision_immutable
 before update or delete on bm_intake_private.corrected_commercial_decisions
 for each row execute function bm_intake_private.reject_correction_hold_mutation();

-- p_reviewer is TRUSTED-SERVER session identity, not a browser-provided ID.
-- Strictly a private internal signoff, no source revision or scope mutation.
create function bm_intake_private.review_corrected_commercial_draft(
 p_org uuid,p_reviewer uuid,p_source uuid,p_expected_selection_receipt text,
 p_expected_policy_revision integer,p_expected_policy_sha text,
 p_decision text,p_reason text
) returns table(recorded_decision text,recorded_decision_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private as $decision$
declare
 s public.bm_intake_sources%rowtype;
 a bm_intake_private.correction_activations%rowtype;
 d bm_intake_private.correction_candidate_drafts%rowtype;
 e bm_intake_private.correction_evidence_reviews%rowtype;
 h bm_intake_private.correction_holds%rowtype;
 r bm_intake_private.corrected_scope_review_drafts%rowtype;
 source_sha text;
 original_sha text;
 candidate_sha text;
 actions_sha text;
 draft_sha text;
 evidence_sha text;
 activation_sha text;
 selection_sha text;
 review_key text;
 receipt_sha text;
 decision_sha text;
 reviewed jsonb;
 policy_revision integer;
 policy_sha text;
 active_policy jsonb;
begin
 if p_org is null or p_reviewer is null or p_source is null
 or coalesce(p_expected_selection_receipt,'') !~ '^[a-f0-9]{64}$'
 or p_expected_policy_revision is null
 or p_expected_policy_revision not between 1 and 1000000
 or coalesce(p_expected_policy_sha,'') !~ '^[a-f0-9]{64}$'
 or p_decision is null
 or p_decision not in ('approve-internal-draft','reject-internal-draft')
 or p_reason is null or p_reason<>btrim(p_reason)
 or length(p_reason) not between 1 and 500 or octet_length(p_reason)>1000
 or p_reason ~ '[[:cntrl:]]' then
  raise exception 'Invalid corrected commercial decision request' using errcode='22023';
 end if;
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=p_reviewer
  and member_role in ('owner','operator') for share;
 if not found then
  raise exception 'Current commercial reviewer membership required' using errcode='42501';
 end if;
 select * into s from public.bm_intake_sources
 where organization_id=p_org and id=p_source for share;
 if not found then
  raise exception 'Private corrected source unavailable' using errcode='42501';
 end if;
 select * into e from bm_intake_private.correction_evidence_reviews
 where organization_id=p_org and source_id=p_source for share;
 if not found then
  raise exception 'Independent correction evidence missing' using errcode='42501';
 end if;
 if s.created_by=p_reviewer or e.reviewed_by=p_reviewer
 or s.created_by=e.reviewed_by then
  raise exception 'Commercial review must use a third independent actor'
   using errcode='42501';
 end if;
 -- Recheck other TWO memberships to reject a revoked evidence signatory.
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=s.created_by
   and member_role in ('owner','operator','contractor') for share;
 if not found then
  raise exception 'Correction submitter no longer authorized' using errcode='42501';
 end if;
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=e.reviewed_by
   and member_role in ('owner','operator') for share;
 if not found then
  raise exception 'Independent evidence reviewer no longer authorized'
    using errcode='42501';
 end if;
 if s.revision<>5 or s.scope_review is not null
 or s.correction_activation->>'state' is distinct from
   'awaiting-renewed-human-scope-review'
 or s.correction_hold->>'state' is distinct from 'quarantined-awaiting-correction'
 or jsonb_typeof(s.review->'candidates') is distinct from 'array'
 or jsonb_typeof(s.extraction_audit) is distinct from 'array'
 or jsonb_array_length(s.extraction_audit)<>1 then
  raise exception 'Corrected source not eligible for internal review' using errcode='40001';
 end if;
 select * into a from bm_intake_private.correction_activations
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Activation receipt absent' using errcode='42501'; end if;
 select * into d from bm_intake_private.correction_candidate_drafts
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Corrected candidates absent' using errcode='42501'; end if;
 select * into h from bm_intake_private.correction_holds
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Original correction hold absent' using errcode='42501'; end if;
 select * into r from bm_intake_private.corrected_scope_review_drafts
 where organization_id=p_org and source_id=p_source for share;
 if not found then
  raise exception 'Fresh human corrected-scope selection required'
    using errcode='42501';
 end if;
 select ph.revision,ph.policy_sha256,v.policy
 into policy_revision,policy_sha,active_policy
 from bm_intake_private.active_policy_heads ph
 join bm_intake_private.approved_policy_versions v
  on v.organization_id=ph.organization_id
  and v.revision=ph.revision and v.policy_sha256=ph.policy_sha256
 where ph.organization_id=p_org for share of ph,v;
 if not found then
  raise exception 'Current independently approved company policy required'
   using errcode='42501';
 end if;
 if policy_revision is distinct from p_expected_policy_revision
 or policy_sha is distinct from p_expected_policy_sha
 or policy_revision is distinct from r.policy_revision
 or policy_sha is distinct from r.policy_sha256 then
  raise exception 'Commercial review policy changed since human selection'
   using errcode='40001';
 end if;
 source_sha:=encode(sha256(convert_to('typed-note','UTF8')
  ||decode('00','hex')||convert_to(s.original_text,'UTF8')),'hex');
 original_sha:=bm_intake_private.canonical_candidate_sha256(s.review->'candidates');
 candidate_sha:=bm_intake_private.canonical_candidate_sha256(d.proposed_candidates);
 actions_sha:=encode(sha256(convert_to(d.correction_actions::text,'UTF8')),'hex');
 draft_sha:=encode(sha256(convert_to(jsonb_build_array(
  p_org::text,p_source::text,d.actor_id::text,d.request_sha256,d.hold_sha256,
  original_sha,candidate_sha,actions_sha,d.reason)::text,'UTF8')),'hex');
 evidence_sha:=encode(sha256(convert_to(jsonb_build_array(
  'bm-correction-evidence-review-v1',p_org::text,p_source::text,
  d.actor_id::text,e.reviewed_by::text,draft_sha,candidate_sha,
  e.decision,e.reviewer_reason)::text,'UTF8')),'hex');
 activation_sha:=encode(sha256(convert_to(jsonb_build_array(
  'bm-correction-activation-v1',p_org::text,p_source::text,
  s.created_by::text,e.reviewed_by::text,draft_sha,evidence_sha,
  candidate_sha)::text,'UTF8')),'hex');
 reviewed:=jsonb_build_object('sourceSha256',source_sha,
  'candidatesSha256',candidate_sha,'candidates',d.proposed_candidates);
 review_key:=bm_intake_private.review_workbench_sha256(
  source_sha,candidate_sha,policy_sha);
 if not bm_intake_private.matches_approved_scope_services(
  active_policy,d.proposed_candidates,r.selected_indices,r.accepted_addon_codes) then
  raise exception 'Scope selection no longer eligible for company policy'
   using errcode='22023';
 end if;
 selection_sha:=bm_intake_private.reviewed_selection_sha256(
  reviewed,r.selected_indices,r.accepted_addon_codes,policy_sha);
 receipt_sha:=encode(sha256(convert_to(jsonb_build_array(
  'bm-corrected-scope-review-v1',p_org::text,p_source::text,
  s.created_by::text,activation_sha,candidate_sha,policy_revision,
  policy_sha,r.selected_indices,r.accepted_addon_codes,
  review_key,selection_sha)::text,'UTF8')),'hex');
 if h.actor_id is distinct from s.created_by
 or h.hold is distinct from s.correction_hold
 or d.actor_id is distinct from s.created_by
 or d.hold_sha256 is distinct from encode(sha256(
   convert_to(s.correction_hold::text,'UTF8')),'hex')
 or d.request_sha256 is distinct from h.request_sha256
 or d.request_sha256 is distinct from s.correction_hold->>'requestSha256'
 or s.review->>'sourceSha256' is distinct from source_sha
 or s.review->>'candidatesSha256' is distinct from original_sha
 or s.correction_hold->>'sourceSha256' is distinct from source_sha
 or s.correction_hold->>'candidatesSha256' is distinct from original_sha
 or s.extraction_audit->0->>'sourceSha256' is distinct from source_sha
 or s.extraction_audit->0->>'candidatesSha256' is distinct from original_sha
 or s.extraction_audit->0->>'actorId' is distinct from s.created_by::text
 or s.extraction_audit->0->>'sourceRevision' is distinct from '2'
 or d.original_candidates_sha256 is distinct from original_sha
 or d.proposed_candidates_sha256 is distinct from candidate_sha
 or d.actions_sha256 is distinct from actions_sha
 or d.draft_sha256 is distinct from draft_sha
 or e.submitted_by is distinct from s.created_by
 or e.reviewed_by is distinct from a.activated_by
 or e.decision is distinct from 'accept-evidence'
 or e.request_sha256 is distinct from d.request_sha256
 or e.draft_sha256 is distinct from draft_sha
 or e.proposed_candidates_sha256 is distinct from candidate_sha
 or e.evidence_review_sha256 is distinct from evidence_sha
 or a.submitted_by is distinct from s.created_by
 or a.draft_sha256 is distinct from draft_sha
 or a.evidence_review_sha256 is distinct from evidence_sha
 or a.proposed_candidates_sha256 is distinct from candidate_sha
 or a.activation_sha256 is distinct from activation_sha
 or a.activation_marker is distinct from s.correction_activation
 or s.correction_activation->>'activationSha256' is distinct from activation_sha
 or r.reviewed_by is distinct from s.created_by
 or r.source_sha256 is distinct from source_sha
 or r.corrected_candidates_sha256 is distinct from candidate_sha
 or r.activation_sha256 is distinct from activation_sha
 or r.review_key is distinct from review_key
 or r.reviewed_selection_sha256 is distinct from selection_sha
 or r.review_receipt_sha256 is distinct from receipt_sha
 or receipt_sha is distinct from p_expected_selection_receipt
 or not bm_intake_private.replay_correction_actions(
   s.review->'candidates',d.correction_actions,d.proposed_candidates)
 or bm_intake_private.correction_request_sha256(
   p_org,p_source,source_sha,original_sha,candidate_sha,
   d.correction_actions) is distinct from d.request_sha256 then
  raise exception 'Source, action, corrected review or policy evidence mismatch'
   using errcode='22023';
 end if;
 decision_sha:=encode(sha256(convert_to(jsonb_build_array(
  'bm-corrected-commercial-decision-v1',p_org::text,p_source::text,
  s.created_by::text,e.reviewed_by::text,p_reviewer::text,
  activation_sha,receipt_sha,policy_revision,policy_sha,
  p_decision,p_reason)::text,'UTF8')),'hex');
 insert into bm_intake_private.corrected_commercial_decisions(
  organization_id,source_id,original_creator,evidence_reviewer,
  commercial_reviewer,activation_sha256,corrected_candidates_sha256,
  selection_receipt_sha256,policy_revision,policy_sha256,decision,
  reviewer_reason,decision_sha256
 ) values(p_org,p_source,s.created_by,e.reviewed_by,p_reviewer,
   activation_sha,candidate_sha,receipt_sha,policy_revision,policy_sha,
   p_decision,p_reason,decision_sha);
 return query select p_decision,decision_sha;
end;
$decision$;
revoke all on function bm_intake_private.review_corrected_commercial_draft(
 uuid,uuid,uuid,text,integer,text,text,text)
 from public,anon,authenticated;
grant execute on function bm_intake_private.review_corrected_commercial_draft(
 uuid,uuid,uuid,text,integer,text,text,text) to service_role;
