-- STAGED INTERNAL PREVIEW ONLY. No amounts, offer, send or source update.
-- Authenticated server-only function returns source-derived selections and
-- current approved company policy for the existing TS economics calculator.
create function bm_intake_private.read_corrected_internal_preview_inputs(
 p_org uuid,p_actor uuid,p_source uuid,p_expected_decision_sha text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private as $read$
declare
 s public.bm_intake_sources%rowtype;
 c bm_intake_private.corrected_commercial_decisions%rowtype;
 r bm_intake_private.corrected_scope_review_drafts%rowtype;
 d bm_intake_private.correction_candidate_drafts%rowtype;
 e bm_intake_private.correction_evidence_reviews%rowtype;
 a bm_intake_private.correction_activations%rowtype;
 policy jsonb;
 policy_sha text;
 policy_rev integer;
 candidate_sha text;
 source_sha text;
 selected_sha text;
 decision_sha text;
 lines jsonb:='[]'::jsonb;
 part jsonb;
 idx jsonb;
 line jsonb;
begin
 if p_org is null or p_actor is null or p_source is null
 or coalesce(p_expected_decision_sha,'') !~ '^[0-9a-f]{64}$' then
  raise exception 'Invalid internal economics preview request' using errcode='22023';
 end if;
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=p_actor
 and member_role in ('owner','operator') for share;
 if not found then raise exception 'Current owner/operator required' using errcode='42501'; end if;
 select * into s from public.bm_intake_sources
 where organization_id=p_org and id=p_source for share;
 if not found then raise exception 'Private correction unavailable' using errcode='42501'; end if;
 if s.revision<>5 or s.scope_review is not null
 or s.correction_activation->>'state' is distinct from
   'awaiting-renewed-human-scope-review'
 or s.correction_hold->>'state' is distinct from
   'quarantined-awaiting-correction' then
  raise exception 'Nonquotable corrected source revision required' using errcode='40001';
 end if;
 select * into c from bm_intake_private.corrected_commercial_decisions
 where organization_id=p_org and source_id=p_source for share;
 if not found or c.commercial_reviewer is distinct from p_actor
 or c.decision is distinct from 'approve-internal-draft'
 or c.original_creator is distinct from s.created_by
 or c.original_creator=c.evidence_reviewer
 or p_actor=c.original_creator or p_actor=c.evidence_reviewer then
  raise exception 'Distinct internal approval required' using errcode='42501';
 end if;
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=c.original_creator
 and member_role in ('owner','operator','contractor') for share;
 if not found then raise exception 'Original creator membership revoked' using errcode='42501'; end if;
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=c.evidence_reviewer
 and member_role in ('owner','operator') for share;
 if not found then raise exception 'Independent reviewer membership revoked' using errcode='42501'; end if;
 select * into r from bm_intake_private.corrected_scope_review_drafts
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Fresh corrected scope absent' using errcode='42501'; end if;
 select * into d from bm_intake_private.correction_candidate_drafts
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Source-bound corrected candidates absent' using errcode='42501'; end if;
 select * into e from bm_intake_private.correction_evidence_reviews
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Independent review absent' using errcode='42501'; end if;
 select * into a from bm_intake_private.correction_activations
 where organization_id=p_org and source_id=p_source for share;
 if not found then raise exception 'Correction activation absent' using errcode='42501'; end if;
 select ph.revision,ph.policy_sha256,v.policy into policy_rev,policy_sha,policy
 from bm_intake_private.active_policy_heads ph
 join bm_intake_private.approved_policy_versions v
  on v.organization_id=ph.organization_id
  and v.revision=ph.revision and v.policy_sha256=ph.policy_sha256
 where ph.organization_id=p_org for share of ph,v;
 if not found then raise exception 'Approved policy missing' using errcode='42501'; end if;
 if policy_rev is distinct from r.policy_revision
 or policy_sha is distinct from r.policy_sha256
 or policy_rev is distinct from c.policy_revision
 or policy_sha is distinct from c.policy_sha256 then
  raise exception 'Policy changed since independent review' using errcode='40001';
 end if;
 source_sha:=encode(sha256(convert_to('typed-note','UTF8')||
   decode('00','hex')||convert_to(s.original_text,'UTF8')),'hex');
 candidate_sha:=bm_intake_private.canonical_candidate_sha256(d.proposed_candidates);
 if s.review->>'sourceSha256' is distinct from source_sha
 or r.reviewed_by is distinct from s.created_by
 or r.source_sha256 is distinct from source_sha
 or r.corrected_candidates_sha256 is distinct from candidate_sha
 or a.activation_marker is distinct from s.correction_activation
 or a.activation_sha256 is distinct from r.activation_sha256
 or c.activation_sha256 is distinct from a.activation_sha256
 or c.corrected_candidates_sha256 is distinct from candidate_sha
 or e.decision is distinct from 'accept-evidence'
 or e.reviewed_by is distinct from c.evidence_reviewer
 or e.submitted_by is distinct from s.created_by
 or d.actor_id is distinct from s.created_by
 or d.proposed_candidates_sha256 is distinct from candidate_sha
 or not bm_intake_private.replay_correction_actions(
   s.review->'candidates',d.correction_actions,d.proposed_candidates)
 or not bm_intake_private.matches_approved_scope_services(
   policy,d.proposed_candidates,r.selected_indices,r.accepted_addon_codes) then
   raise exception 'Corrected provenance or eligible scope mismatched' using errcode='22023';
 end if;
 selected_sha:=bm_intake_private.reviewed_selection_sha256(
  jsonb_build_object('sourceSha256',source_sha,
   'candidatesSha256',candidate_sha,'candidates',d.proposed_candidates),
  r.selected_indices,r.accepted_addon_codes,policy_sha);
 if r.reviewed_selection_sha256 is distinct from selected_sha
 or r.review_key is distinct from bm_intake_private.review_workbench_sha256(
  source_sha,candidate_sha,policy_sha) then
   raise exception 'Fresh reviewed scope fingerprint mismatch' using errcode='22023';
 end if;
 decision_sha:=encode(sha256(convert_to(jsonb_build_array(
  'bm-corrected-commercial-decision-v1',p_org::text,p_source::text,
  c.original_creator::text,c.evidence_reviewer::text,p_actor::text,
  c.activation_sha256,c.selection_receipt_sha256,policy_rev,policy_sha,
  c.decision,c.reviewer_reason)::text,'UTF8')),'hex');
 if c.selection_receipt_sha256 is distinct from r.review_receipt_sha256
 or c.decision_sha256 is distinct from decision_sha
 or decision_sha is distinct from p_expected_decision_sha then
   raise exception 'Internal decision receipt mismatched' using errcode='22023';
 end if;
 for idx in select value from jsonb_array_elements(r.selected_indices) loop
  part:=d.proposed_candidates->((idx#>>'{}')::integer);
  line:=jsonb_build_object('serviceCode',part->>'serviceCode',
   'units',part->'units');
  if r.accepted_addon_codes ? (part->>'serviceCode') then
   line:=line||jsonb_build_object('addonAccepted',true);
  end if;
  lines:=lines||jsonb_build_array(line);
 end loop;
 return jsonb_build_object('state','preview-only',
  'deliveryAuthorized',false,'policy',policy,'requested',lines,
  'evidence',jsonb_build_object('organizationId',p_org::text,
   'sourceId',p_source::text,'revision',5,'sourceSha256',source_sha,
   'correctedCandidatesSha256',candidate_sha,
   'scopeReceiptSha256',r.review_receipt_sha256,
   'internalDecisionSha256',decision_sha,
   'policySha256',policy_sha,'policyRevision',policy_rev));
end;
$read$;
revoke all on function bm_intake_private.read_corrected_internal_preview_inputs(
 uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function bm_intake_private.read_corrected_internal_preview_inputs(
 uuid,uuid,uuid,text) to service_role;
