-- STAGED / disposable PostgreSQL only. Revision 5 stays nonquotable.
-- A NEW original-creator human scope decision is bound to the independently
-- activated correction AND the currently approved company-owned policy.
-- No pricing approval, source transition, public route, or customer delivery.
create table bm_intake_private.corrected_scope_review_drafts (
 organization_id uuid not null,
 source_id uuid not null,
 reviewed_by uuid not null,
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 corrected_candidates_sha256 text not null check(
   corrected_candidates_sha256 ~ '^[a-f0-9]{64}$'),
 activation_sha256 text not null check(activation_sha256 ~ '^[a-f0-9]{64}$'),
 policy_revision integer not null check(policy_revision between 1 and 1000000),
 policy_sha256 text not null check(policy_sha256 ~ '^[a-f0-9]{64}$'),
 selected_indices jsonb not null check(jsonb_typeof(selected_indices)='array'),
 accepted_addon_codes jsonb not null check(jsonb_typeof(accepted_addon_codes)='array'),
 review_key text not null check(review_key ~ '^[a-f0-9]{64}$'),
 reviewed_selection_sha256 text not null check(
   reviewed_selection_sha256 ~ '^[a-f0-9]{64}$'),
 review_receipt_sha256 text not null check(
   review_receipt_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 primary key(organization_id,source_id),
 foreign key(organization_id,source_id) references
  bm_intake_private.correction_activations(organization_id,source_id)
  on delete restrict on update restrict
);
revoke all on bm_intake_private.corrected_scope_review_drafts
 from public,anon,authenticated,service_role;
create trigger bm_corrected_scope_review_immutable
 before update or delete on bm_intake_private.corrected_scope_review_drafts
 for each row execute function bm_intake_private.reject_correction_hold_mutation();

-- Actor must originate from current independently verified server session.
create function bm_intake_private.review_corrected_scope_pending(
 p_org uuid,p_actor uuid,p_source uuid,p_expected_activation_sha text,
 p_expected_candidates_sha text,p_expected_policy_revision integer,
 p_expected_policy_sha text,p_selected jsonb,p_accepted jsonb
) returns table(recorded_selection_sha256 text,recorded_receipt_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private
as $scope$
declare
 v_source public.bm_intake_sources%rowtype;
 v_activation bm_intake_private.correction_activations%rowtype;
 v_draft bm_intake_private.correction_candidate_drafts%rowtype;
 v_evidence bm_intake_private.correction_evidence_reviews%rowtype;
 v_source_sha text;
 v_orig_sha text;
 v_cand_sha text;
 v_action_sha text;
 v_draft_sha text;
 v_review_sha text;
 v_active_revision integer;
 v_active_sha text;
 v_active_policy jsonb;
 v_corr_review jsonb;
 v_key text;
 v_selection_sha text;
 v_receipt_sha text;
begin
 if p_org is null or p_actor is null or p_source is null
   or coalesce(p_expected_activation_sha,'') !~ '^[a-f0-9]{64}$'
   or coalesce(p_expected_candidates_sha,'') !~ '^[a-f0-9]{64}$'
   or p_expected_policy_revision is null
   or p_expected_policy_revision not between 1 and 1000000
   or coalesce(p_expected_policy_sha,'') !~ '^[a-f0-9]{64}$'
   or p_selected is null or jsonb_typeof(p_selected) is distinct from 'array'
   or p_accepted is null or jsonb_typeof(p_accepted) is distinct from 'array'
   or pg_column_size(p_selected)>4096 or pg_column_size(p_accepted)>4096 then
   raise exception 'Invalid corrected-scope review request' using errcode='22023';
 end if;
 -- Current original creator only, just as the rev2 original workbench.
 -- Membership lock precedes any source/evidence lookup.
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=p_actor
   and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current scope reviewer membership required'
     using errcode='42501';
 end if;
 select * into v_source from public.bm_intake_sources
 where organization_id=p_org and id=p_source and created_by=p_actor for share;
 if not found then
   raise exception 'Private corrected source unavailable'
     using errcode='42501';
 end if;
 if v_source.revision<>5 or v_source.scope_review is not null
   or v_source.correction_activation->>'state' is distinct from
     'awaiting-renewed-human-scope-review'
   or v_source.correction_hold->>'state' is distinct from
     'quarantined-awaiting-correction'
   or jsonb_typeof(v_source.review->'candidates') is distinct from 'array'
   or jsonb_typeof(v_source.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_source.extraction_audit)<>1 then
   raise exception 'Corrected source is not awaiting fresh human scope'
     using errcode='40001';
 end if;
 select * into v_activation from bm_intake_private.correction_activations
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Activation receipt unavailable' using errcode='42501'; end if;
 select * into v_draft from bm_intake_private.correction_candidate_drafts
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Corrected candidate draft unavailable'
   using errcode='42501'; end if;
 select * into v_evidence from bm_intake_private.correction_evidence_reviews
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Reviewed corrected evidence unavailable'
   using errcode='42501'; end if;
 v_source_sha:=encode(sha256(convert_to('typed-note','UTF8')||
   decode('00','hex')||convert_to(v_source.original_text,'UTF8')),'hex');
 v_orig_sha:=bm_intake_private.canonical_candidate_sha256(
   v_source.review->'candidates');
 v_cand_sha:=bm_intake_private.canonical_candidate_sha256(
   v_draft.proposed_candidates);
 v_action_sha:=encode(sha256(convert_to(
   v_draft.correction_actions::text,'UTF8')),'hex');
 v_draft_sha:=encode(sha256(convert_to(jsonb_build_array(
   p_org::text,p_source::text,v_draft.actor_id::text,
   v_draft.request_sha256,v_draft.hold_sha256,
   v_orig_sha,v_cand_sha,v_action_sha,v_draft.reason)::text,'UTF8')),'hex');
 v_review_sha:=encode(sha256(convert_to(jsonb_build_array(
   'bm-correction-evidence-review-v1',p_org::text,p_source::text,
   v_draft.actor_id::text,v_evidence.reviewed_by::text,v_draft_sha,
   v_cand_sha,v_evidence.decision,v_evidence.reviewer_reason)::text,'UTF8')),'hex');
 if v_draft.actor_id is distinct from p_actor
   or v_activation.submitted_by is distinct from p_actor
   or v_activation.activated_by is distinct from v_evidence.reviewed_by
   or v_evidence.submitted_by is distinct from p_actor
   or v_evidence.decision is distinct from 'accept-evidence'
   or v_evidence.draft_sha256 is distinct from v_draft_sha
   or v_evidence.evidence_review_sha256 is distinct from v_review_sha
   or v_activation.evidence_review_sha256 is distinct from v_review_sha
   or v_activation.draft_sha256 is distinct from v_draft_sha
   or v_activation.proposed_candidates_sha256 is distinct from v_cand_sha
   or v_activation.activation_sha256 is distinct from p_expected_activation_sha
   or v_activation.activation_marker is distinct from v_source.correction_activation
   or v_source.correction_activation->>'activationSha256' is distinct from
      p_expected_activation_sha
   or v_source.review->>'sourceSha256' is distinct from v_source_sha
   or v_source.review->>'candidatesSha256' is distinct from v_orig_sha
   or v_source.correction_hold->>'sourceSha256' is distinct from v_source_sha
   or v_source.correction_hold->>'candidatesSha256' is distinct from v_orig_sha
   or v_draft.original_candidates_sha256 is distinct from v_orig_sha
   or v_draft.proposed_candidates_sha256 is distinct from v_cand_sha
   or v_draft.actions_sha256 is distinct from v_action_sha
   or v_draft.draft_sha256 is distinct from v_draft_sha
   or v_cand_sha is distinct from p_expected_candidates_sha
   or v_source.extraction_audit->0->>'sourceSha256' is distinct from v_source_sha
   or v_source.extraction_audit->0->>'candidatesSha256' is distinct from v_orig_sha
   or v_source.extraction_audit->0->>'actorId' is distinct from p_actor::text
   or v_source.extraction_audit->0->>'sourceRevision' is distinct from '2'
   or not bm_intake_private.replay_correction_actions(
     v_source.review->'candidates',v_draft.correction_actions,
     v_draft.proposed_candidates)
   or bm_intake_private.correction_request_sha256(
     p_org,p_source,v_source_sha,v_orig_sha,v_cand_sha,
     v_draft.correction_actions) is distinct from v_draft.request_sha256 then
   raise exception 'Corrected-scope activation/source evidence invalid'
    using errcode='22023';
 end if;
 -- Approved policy is locked against changes for the remainder of this
 -- transaction. Never trust a browser-supplied policy object or rate.
 select h.revision,h.policy_sha256,v.policy
 into v_active_revision,v_active_sha,v_active_policy
 from bm_intake_private.active_policy_heads h
 join bm_intake_private.approved_policy_versions v
 on v.organization_id=h.organization_id
   and v.revision=h.revision and v.policy_sha256=h.policy_sha256
 where h.organization_id=p_org for share of h,v;
 if not found then
   raise exception 'Currently approved company policy required'
     using errcode='42501';
 end if;
 if v_active_revision is distinct from p_expected_policy_revision
   or v_active_sha is distinct from p_expected_policy_sha then
   raise exception 'Active company pricing policy changed'
     using errcode='40001';
 end if;
 -- Recompute existing proven workbench fingerprints against the *corrected*
 -- candidate list, NOT the original stale model extraction.
 v_corr_review:=jsonb_build_object(
   'sourceSha256',v_source_sha,'candidatesSha256',v_cand_sha,
   'candidates',v_draft.proposed_candidates);
 if not bm_intake_private.matches_approved_scope_services(
   v_active_policy,v_draft.proposed_candidates,p_selected,p_accepted) then
   raise exception 'Corrected selection violates company policy'
     using errcode='22023';
 end if;
 v_key:=bm_intake_private.review_workbench_sha256(
   v_source_sha,v_cand_sha,v_active_sha);
 v_selection_sha:=bm_intake_private.reviewed_selection_sha256(
   v_corr_review,p_selected,p_accepted,v_active_sha);
 v_receipt_sha:=encode(sha256(convert_to(jsonb_build_array(
   'bm-corrected-scope-review-v1',p_org::text,p_source::text,
   p_actor::text,p_expected_activation_sha,v_cand_sha,
   v_active_revision,v_active_sha,p_selected,p_accepted,
   v_key,v_selection_sha)::text,'UTF8')),'hex');
 insert into bm_intake_private.corrected_scope_review_drafts(
   organization_id,source_id,reviewed_by,source_sha256,
   corrected_candidates_sha256,activation_sha256,policy_revision,
   policy_sha256,selected_indices,accepted_addon_codes,
   review_key,reviewed_selection_sha256,review_receipt_sha256
 ) values(p_org,p_source,p_actor,v_source_sha,v_cand_sha,
   p_expected_activation_sha,v_active_revision,v_active_sha,
   p_selected,p_accepted,v_key,v_selection_sha,v_receipt_sha);
 return query select v_selection_sha,v_receipt_sha;
end;
$scope$;
revoke all on function bm_intake_private.review_corrected_scope_pending(
 uuid,uuid,uuid,text,text,integer,text,jsonb,jsonb)
 from public,anon,authenticated;
grant execute on function bm_intake_private.review_corrected_scope_pending(
 uuid,uuid,uuid,text,text,integer,text,jsonb,jsonb) to service_role;
