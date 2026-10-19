-- STAGING ONLY. Privileged *primary* read for indeterminate human-scope
-- CAS outcomes. This does not retry CAS or authorize pricing/approval/sending.
-- Caller must derive actor from a fresh authenticated server session.
create function bm_intake_private.inspect_typed_note_scope_commit(
 p_org uuid,p_actor uuid,p_source uuid,p_expected_source_sha text,
 p_expected_candidates_sha text,p_expected_selection_sha text
) returns table(observation text,persisted_revision integer,
                observed_selection_sha256 text)
language plpgsql security invoker
set search_path=pg_catalog,public
as $inspect$
declare
 v_note public.bm_intake_sources%rowtype;
 v_scope jsonb;
 v_original_sha text;
 v_historical_sha text;
 v_active_revision integer;
 v_active_sha text;
begin
 if p_org is null or p_actor is null or p_source is null
  or coalesce(p_expected_source_sha,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_expected_candidates_sha,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_expected_selection_sha,'') !~ '^[0-9a-f]{64}$' then
   raise exception 'Invalid scope reconciliation selector' using errcode='22023';
 end if;
 -- Authorize before source lookup, and lock membership against revocation.
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=p_actor
   and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 select * into v_note from public.bm_intake_sources
 where organization_id=p_org and id=p_source and created_by=p_actor for share;
 if not found then
   raise exception 'Private review source unavailable' using errcode='42501';
 end if;
 if v_note.revision not in (2,3)
   or v_note.review is null
   or jsonb_typeof(v_note.review->'candidates') is distinct from 'array'
   or jsonb_typeof(v_note.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_note.extraction_audit)<>1 then
   raise exception 'Invalid or unsupported reviewed source' using errcode='22023';
 end if;
 v_original_sha:=encode(sha256(convert_to('typed-note','UTF8')
   ||decode('00','hex')||convert_to(v_note.original_text,'UTF8')),'hex');
 if v_note.review->>'sourceSha256' is distinct from v_original_sha
   or v_original_sha is distinct from p_expected_source_sha
   or v_note.review->>'candidatesSha256' is distinct from
     p_expected_candidates_sha
   or v_note.extraction_audit->0->>'sourceSha256'
      is distinct from v_original_sha
   or v_note.extraction_audit->0->>'candidatesSha256'
      is distinct from p_expected_candidates_sha
   or v_note.extraction_audit->0->>'sourceRevision' is distinct from '2'
   or v_note.extraction_audit->0->>'actorId' is distinct from
      v_note.created_by::text
   or bm_intake_private.canonical_candidate_sha256(
       v_note.review->'candidates') is distinct from p_expected_candidates_sha
 then
   raise exception 'Immutable extraction proof disagrees with source'
     using errcode='22023';
 end if;
 if v_note.revision=2 then
   if v_note.scope_review is not null then
     raise exception 'Unreviewed revision carries scope' using errcode='22023';
   end if;
   return query select 'unreviewed-at-read'::text,2,null::text;
   return;
 end if;
 v_scope:=v_note.scope_review;
 if v_scope is null or jsonb_typeof(v_scope) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(v_scope))<>11
  or v_scope->>'state' is distinct from 'reviewed-for-proposal-draft'
  or v_scope->>'sourceRevision' is distinct from '3'
  or v_scope->>'reviewedBy' is distinct from v_note.created_by::text
  or v_scope->>'sourceSha256' is distinct from v_original_sha
  or v_scope->>'candidatesSha256' is distinct from p_expected_candidates_sha
  or coalesce(v_scope->>'policySha256','') !~ '^[0-9a-f]{64}$'
  or coalesce(v_scope->>'reviewKey','') !~ '^[0-9a-f]{64}$'
  or coalesce(v_scope->>'reviewedSelectionSha256','') !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(v_scope->'policyRevision') is distinct from 'number'
  or coalesce(v_scope->>'policyRevision','') !~ '^[1-9][0-9]{0,5}$'
  or jsonb_typeof(v_scope->'selectedIndices') is distinct from 'array'
  or jsonb_typeof(v_scope->'acceptedAddonCodes') is distinct from 'array'
  or exists(select 1 from jsonb_object_keys(v_scope) k where k not in
    ('state','sourceRevision','reviewedBy','sourceSha256',
    'candidatesSha256','policySha256','policyRevision','reviewKey',
    'reviewedSelectionSha256','selectedIndices','acceptedAddonCodes')) then
   raise exception 'Corrupt persisted human review evidence' using errcode='22023';
 end if;
 -- A historical snapshot can remain valid evidence after active rates
 -- advance; validate the original approved revision rather than pretending
 -- the older review still authorizes a current quotation.
 select v.policy_sha256 into v_historical_sha
 from bm_intake_private.approved_policy_versions v
 where v.organization_id=p_org and v.revision=(v_scope->>'policyRevision')::integer
   and v.policy_sha256=v_scope->>'policySha256' for share;
 if not found or v_historical_sha is null then
   raise exception 'Persisted review lacks approved policy provenance'
    using errcode='22023';
 end if;
 if v_scope->>'reviewKey' is distinct from
    bm_intake_private.review_workbench_sha256(
      v_original_sha,p_expected_candidates_sha,v_historical_sha)
   or v_scope->>'reviewedSelectionSha256' is distinct from
    bm_intake_private.reviewed_selection_sha256(
      v_note.review,v_scope->'selectedIndices',
      v_scope->'acceptedAddonCodes',v_historical_sha) then
   raise exception 'Persisted scope fingerprints do not match evidence'
    using errcode='22023';
 end if;
 select h.revision,h.policy_sha256 into v_active_revision,v_active_sha
 from bm_intake_private.active_policy_heads h
 where h.organization_id=p_org for share;
 if not found then
   raise exception 'Active approved policy unavailable'
    using errcode='42501';
 end if;
 if v_scope->>'reviewedSelectionSha256' is distinct from
     p_expected_selection_sha then
   return query select 'different-scope-at-read'::text,3,
      v_scope->>'reviewedSelectionSha256';
 elsif v_active_revision is distinct from (v_scope->>'policyRevision')::integer
    or v_active_sha is distinct from v_historical_sha then
   return query select 'matching-stale-policy-at-read'::text,3,
      v_scope->>'reviewedSelectionSha256';
 else
   return query select 'matching-scope-at-read'::text,3,
      v_scope->>'reviewedSelectionSha256';
 end if;
end;
$inspect$;
revoke all on function bm_intake_private.inspect_typed_note_scope_commit(
 uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function bm_intake_private.inspect_typed_note_scope_commit(
 uuid,uuid,uuid,text,text,text) to service_role;
