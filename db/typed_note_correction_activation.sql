-- STAGED ONLY: evidence acceptance -> nonquotable renewed-scope queue.
-- Absolutely no quote or customer send; existing scope writers reject rev5.
alter table public.bm_intake_sources add column correction_activation jsonb;
alter table public.bm_intake_sources drop constraint bm_source_revision_range;
alter table public.bm_intake_sources add constraint bm_source_revision_range
 check (revision between 1 and 5);
alter table public.bm_intake_sources drop constraint bm_source_lifecycle;
alter table public.bm_intake_sources add constraint bm_source_lifecycle check (
 ((revision=1 and review is null and extraction_audit='[]'::jsonb
   and scope_review is null and correction_hold is null)
 or (revision=2 and review is not null and jsonb_typeof(review)='object'
   and jsonb_typeof(extraction_audit)='array'
   and jsonb_array_length(extraction_audit)=1 and scope_review is null
   and correction_hold is null)
 or (revision=3 and review is not null and jsonb_typeof(review)='object'
   and jsonb_typeof(extraction_audit)='array'
   and jsonb_array_length(extraction_audit)=1 and scope_review is not null
   and jsonb_typeof(scope_review)='object' and correction_hold is null)
 or (revision=4 and review is not null and jsonb_typeof(review)='object'
   and jsonb_typeof(extraction_audit)='array'
   and jsonb_array_length(extraction_audit)=1 and scope_review is null
   and correction_hold is not null and jsonb_typeof(correction_hold)='object'
   and correction_hold->>'state'='quarantined-awaiting-correction'))
   and correction_activation is null
 or (revision=5 and review is not null and jsonb_typeof(review)='object'
   and jsonb_typeof(extraction_audit)='array'
   and jsonb_array_length(extraction_audit)=1 and scope_review is null
   and correction_hold is not null and jsonb_typeof(correction_hold)='object'
   and correction_hold->>'state'='quarantined-awaiting-correction'
   and correction_activation is not null
   and jsonb_typeof(correction_activation)='object'
   and correction_activation->>'state'='awaiting-renewed-human-scope-review')
);
create table bm_intake_private.correction_activations (
 organization_id uuid not null,
 source_id uuid not null,
 submitted_by uuid not null,
 activated_by uuid not null,
 draft_sha256 text not null check(draft_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_review_sha256 text not null check(evidence_review_sha256 ~ '^[a-f0-9]{64}$'),
 proposed_candidates_sha256 text not null check(proposed_candidates_sha256 ~ '^[a-f0-9]{64}$'),
 activation_sha256 text not null check(activation_sha256 ~ '^[a-f0-9]{64}$'),
 activation_marker jsonb not null check(jsonb_typeof(activation_marker)='object'),
 created_at timestamptz not null default now(),
 primary key(organization_id,source_id),
 foreign key(organization_id,source_id)
  references bm_intake_private.correction_evidence_reviews
   (organization_id,source_id) on update restrict on delete restrict,
 check(submitted_by<>activated_by)
);
revoke all on bm_intake_private.correction_activations
 from public,anon,authenticated,service_role;
create trigger bm_correction_activation_immutable
 before update or delete on bm_intake_private.correction_activations
 for each row execute function bm_intake_private.reject_correction_hold_mutation();
create or replace function bm_intake_private.enforce_source_transition()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,bm_intake_private as $guard$
begin
 if tg_op='DELETE' then
   raise exception 'Intake source deletion forbidden' using errcode='42501';
 end if;
 if row(new.organization_id,new.id,new.created_by,new.request_id,
        new.kind,new.original_text,new.text_sha256,new.created_at,
        new.review,new.extraction_audit)
    is distinct from
    row(old.organization_id,old.id,old.created_by,old.request_id,
        old.kind,old.original_text,old.text_sha256,old.created_at,
        old.review,old.extraction_audit)
    and old.revision <> 1 then
   raise exception 'Immutable extracted original or audit changed'
     using errcode='42501';
 end if;
 if row(new.organization_id,new.id,new.created_by,new.request_id,
        new.kind,new.original_text,new.text_sha256,new.created_at)
    is distinct from
    row(old.organization_id,old.id,old.created_by,old.request_id,
        old.kind,old.original_text,old.text_sha256,old.created_at) then
   raise exception 'Immutable intake source identity changed'
     using errcode='42501';
 end if;
 if old.revision=1 and new.revision=2
   and old.review is null and old.extraction_audit='[]'::jsonb
   and old.scope_review is null and old.correction_hold is null
   and new.review is not null and jsonb_typeof(new.review)='object'
   and jsonb_typeof(new.extraction_audit)='array'
   and jsonb_array_length(new.extraction_audit)=1
   and new.scope_review is null and new.correction_hold is null then
   return new;
 end if;
 if old.revision=2 and new.revision=3
   and new.review is not distinct from old.review
   and new.extraction_audit is not distinct from old.extraction_audit
   and old.scope_review is null and old.correction_hold is null
   and new.scope_review is not null
   and jsonb_typeof(new.scope_review)='object'
   and new.correction_hold is null then
   return new;
 end if;
 if old.revision in (2,3) and new.revision=4
   and old.correction_hold is null
   and new.review is not distinct from old.review
   and new.extraction_audit is not distinct from old.extraction_audit
   and new.scope_review is null
   and new.correction_hold is not null
   and exists (
    select 1 from bm_intake_private.correction_holds h
    where h.organization_id=old.organization_id and h.source_id=old.id
      and h.previous_revision=old.revision
      and h.actor_id=old.created_by
      and h.invalidated_scope is not distinct from old.scope_review
      and h.hold=new.correction_hold
   ) then
   return new;
 end if;
 -- Promote correction EVIDENCE only into a non-quotable scope-review queue.
 -- Private receipt must exist BEFORE this source revision can move 4 -> 5.
 if old.revision=4 and new.revision=5
   and old.scope_review is null and new.scope_review is null
   and new.review is not distinct from old.review
   and new.extraction_audit is not distinct from old.extraction_audit
   and new.correction_hold is not distinct from old.correction_hold
   and old.correction_activation is null
   and new.correction_activation is not null
   and new.correction_activation->>'state'=
      'awaiting-renewed-human-scope-review'
   and exists (
    select 1 from bm_intake_private.correction_activations x
    where x.organization_id=old.organization_id and x.source_id=old.id
      and x.submitted_by=old.created_by
      and x.activation_marker=new.correction_activation
   ) then
   return new;
 end if;
 raise exception 'Invalid intake revision transition' using errcode='42501';
end;
$guard$;

-- p_actor MUST come from server-side fresh Auth, not browser form fields.
-- Actor is the independent evidence reviewer and must remain owner/operator.
create function bm_intake_private.activate_reviewed_correction(
 p_org uuid,p_actor uuid,p_source uuid,p_expected_draft_sha text,
 p_expected_review_sha text
) returns table(source_revision integer,activation_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private as $activate$
declare
 v_source public.bm_intake_sources%rowtype;
 v_draft bm_intake_private.correction_candidate_drafts%rowtype;
 v_hold bm_intake_private.correction_holds%rowtype;
 v_review bm_intake_private.correction_evidence_reviews%rowtype;
 v_source_sha text;
 v_original_sha text;
 v_proposed_sha text;
 v_actions_sha text;
 v_draft_sha text;
 v_review_sha text;
 v_activation_sha text;
 v_marker jsonb;
begin
 if p_org is null or p_actor is null or p_source is null
   or coalesce(p_expected_draft_sha,'') !~ '^[a-f0-9]{64}$'
   or coalesce(p_expected_review_sha,'') !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid correction activation request'
     using errcode='22023';
 end if;
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=p_actor
   and member_role in ('owner','operator') for share;
 if not found then
   raise exception 'Current correction reviewer authorization required'
     using errcode='42501';
 end if;
 select * into v_source from public.bm_intake_sources
  where organization_id=p_org and id=p_source for update;
 if not found then
   raise exception 'Private correction activation source unavailable'
     using errcode='42501';
 end if;
 if v_source.created_by=p_actor then
   raise exception 'Correction creator cannot self-activate'
     using errcode='42501';
 end if;
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=v_source.created_by
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Correction submitter membership revoked'
     using errcode='42501';
 end if;
 if v_source.revision<>4 or v_source.scope_review is not null
  or v_source.correction_activation is not null
  or jsonb_typeof(v_source.correction_hold) is distinct from 'object'
  or v_source.correction_hold->>'state' is distinct from
    'quarantined-awaiting-correction'
  or jsonb_typeof(v_source.review->'candidates') is distinct from 'array'
  or jsonb_typeof(v_source.extraction_audit) is distinct from 'array'
  or jsonb_array_length(v_source.extraction_audit)<>1 then
   raise exception 'Correction activation source revision stale'
    using errcode='40001';
 end if;
 select * into v_hold from bm_intake_private.correction_holds
  where organization_id=p_org and source_id=p_source for share;
 if not found then
  raise exception 'Correction quarantine receipt unavailable' using errcode='42501';
 end if;
 select * into v_draft from bm_intake_private.correction_candidate_drafts
  where organization_id=p_org and source_id=p_source for share;
 if not found then
  raise exception 'Correction candidate draft unavailable' using errcode='42501';
 end if;
 select * into v_review from bm_intake_private.correction_evidence_reviews
  where organization_id=p_org and source_id=p_source for share;
 if not found or v_review.decision is distinct from 'accept-evidence'
   or v_review.reviewed_by is distinct from p_actor
   or v_review.submitted_by is distinct from v_source.created_by then
  raise exception 'Independent accepted evidence review required' using errcode='42501';
 end if;
 v_source_sha:=encode(sha256(convert_to('typed-note','UTF8')
   || decode('00','hex') ||convert_to(v_source.original_text,'UTF8')),'hex');
 v_original_sha:=bm_intake_private.canonical_candidate_sha256(
    v_source.review->'candidates');
 v_proposed_sha:=bm_intake_private.canonical_candidate_sha256(
    v_draft.proposed_candidates);
 v_actions_sha:=encode(sha256(convert_to(v_draft.correction_actions::text,'UTF8')),'hex');
 v_draft_sha:=encode(sha256(convert_to(jsonb_build_array(
  p_org::text,p_source::text,v_draft.actor_id::text,
  v_draft.request_sha256,v_draft.hold_sha256,v_original_sha,
  v_proposed_sha,v_actions_sha,v_draft.reason)::text,'UTF8')),'hex');
 v_review_sha:=encode(sha256(convert_to(jsonb_build_array(
  'bm-correction-evidence-review-v1',p_org::text,p_source::text,
  v_draft.actor_id::text,p_actor::text,v_draft_sha,
  v_proposed_sha,v_review.decision,v_review.reviewer_reason)::text,'UTF8')),'hex');
 if v_hold.actor_id is distinct from v_source.created_by
  or v_hold.hold is distinct from v_source.correction_hold
  or v_draft.actor_id is distinct from v_source.created_by
  or v_draft.hold_sha256 is distinct from encode(sha256(
     convert_to(v_source.correction_hold::text,'UTF8')),'hex')
  or v_draft.request_sha256 is distinct from v_hold.request_sha256
  or v_draft.request_sha256 is distinct from v_source.correction_hold->>'requestSha256'
  or v_source.review->>'sourceSha256' is distinct from v_source_sha
  or v_source.correction_hold->>'sourceSha256' is distinct from v_source_sha
  or v_source.review->>'candidatesSha256' is distinct from v_original_sha
  or v_source.correction_hold->>'candidatesSha256' is distinct from v_original_sha
  or v_source.extraction_audit->0->>'actorId' is distinct from
      v_source.created_by::text
  or v_source.extraction_audit->0->>'sourceRevision' is distinct from '2'
  or v_source.extraction_audit->0->>'sourceSha256' is distinct from v_source_sha
  or v_source.extraction_audit->0->>'candidatesSha256' is distinct from v_original_sha
  or v_draft.original_candidates_sha256 is distinct from v_original_sha
  or v_draft.proposed_candidates_sha256 is distinct from v_proposed_sha
  or v_draft.actions_sha256 is distinct from v_actions_sha
  or v_draft.draft_sha256 is distinct from v_draft_sha
  or v_review.request_sha256 is distinct from v_draft.request_sha256
  or v_review.draft_sha256 is distinct from v_draft_sha
  or v_review.proposed_candidates_sha256 is distinct from v_proposed_sha
  or v_review.evidence_review_sha256 is distinct from v_review_sha
  or v_review_sha is distinct from p_expected_review_sha
  or v_draft_sha is distinct from p_expected_draft_sha
  or not bm_intake_private.replay_correction_actions(
     v_source.review->'candidates',v_draft.correction_actions,v_draft.proposed_candidates)
  or bm_intake_private.correction_request_sha256(
     p_org,p_source,v_source_sha,v_original_sha,v_proposed_sha,
     v_draft.correction_actions) is distinct from v_draft.request_sha256 then
   raise exception 'Correction activation evidence integrity mismatch'
     using errcode='22023';
 end if;
 v_activation_sha:=encode(sha256(convert_to(jsonb_build_array(
   'bm-correction-activation-v1',p_org::text,p_source::text,
   v_source.created_by::text,p_actor::text,v_draft_sha,v_review_sha,
   v_proposed_sha)::text,'UTF8')),'hex');
 v_marker:=jsonb_build_object(
   'state','awaiting-renewed-human-scope-review',
   'sourceRevision',5,'activatedBy',p_actor::text,
   'draftSha256',v_draft_sha,'evidenceReviewSha256',v_review_sha,
   'proposedCandidatesSha256',v_proposed_sha,
   'activationSha256',v_activation_sha);
 insert into bm_intake_private.correction_activations(
  organization_id,source_id,submitted_by,activated_by,
  draft_sha256,evidence_review_sha256,proposed_candidates_sha256,
  activation_sha256,activation_marker
 ) values (p_org,p_source,v_source.created_by,p_actor,
   v_draft_sha,v_review_sha,v_proposed_sha,v_activation_sha,v_marker);
 update public.bm_intake_sources
   set revision=5,correction_activation=v_marker
   where organization_id=p_org and id=p_source and revision=4;
 if not found then
   raise exception 'Concurrent correction activation lost revision'
     using errcode='40001';
 end if;
 return query select 5,v_activation_sha;
end;
$activate$;
revoke all on function bm_intake_private.activate_reviewed_correction(
 uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function bm_intake_private.activate_reviewed_correction(
 uuid,uuid,uuid,text,text) to service_role;
