-- STAGING ONLY: internal human scope-review draft CAS (source revision 2 -> 3).
-- NOT policy approval, quote authorization, customer send or a production migration.
-- The trusted server MUST validate the currently approved tenant-owned company
-- policy + reviewer selections and recompute reviewedSelectionSha256 before use.
-- This primitive enforces source integrity and the narrow ORIGINAL-CREATOR
-- restriction until an approved reviewer/delegation policy exists.
create function bm_intake_private.commit_typed_note_scope_review(
 p_organization_id uuid, p_actor_id uuid, p_source_id uuid,
 p_expected_source_sha256 text, p_expected_candidates_sha256 text,
 p_scope jsonb
) returns table(source_revision integer, reviewed_selection_sha256 text)
language plpgsql security invoker
set search_path=pg_catalog,public
as $scope$
declare
 v_note public.bm_intake_sources%rowtype;
 v_source_sha text;
 v_candidate_count integer;
 v_entry jsonb;
 v_index integer;
 v_previous integer:=-1;
 v_code text;
 v_codes text[]:=array[]::text[];
 v_accepted text[]:=array[]::text[];
begin
 if p_organization_id is null or p_actor_id is null or p_source_id is null
   or p_expected_source_sha256 is null
   or p_expected_candidates_sha256 is null
   or p_expected_source_sha256 !~ '^[0-9a-f]{64}$'
   or p_expected_candidates_sha256 !~ '^[0-9a-f]{64}$'
   or p_scope is null or jsonb_typeof(p_scope) is distinct from 'object'
   or pg_column_size(p_scope)>8192 then
    raise exception 'Invalid scope review CAS request' using errcode='22023';
 end if;
 -- Authorize before revealing the source or its state, and serialize member
 -- revocation with the entire mutation.
 perform 1 from public.bm_memberships
 where organization_id=p_organization_id and user_id=p_actor_id
   and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 select * into v_note from public.bm_intake_sources
 where organization_id=p_organization_id and id=p_source_id for update;
 if not found or v_note.created_by is distinct from p_actor_id then
   raise exception 'Private source unavailable for scope review'
     using errcode='42501';
 end if;
 if v_note.revision<>2 or v_note.scope_review is not null
   or v_note.review is null or jsonb_typeof(v_note.review) is distinct from 'object'
   or jsonb_typeof(v_note.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_note.extraction_audit)<>1 then
   raise exception 'Scope review source stale or not extracted'
     using errcode='40001';
 end if;
 v_source_sha:=encode(sha256(convert_to('typed-note','UTF8')
   ||decode('00','hex')||convert_to(v_note.original_text,'UTF8')),'hex');
 if v_note.review->>'sourceSha256' is distinct from v_source_sha
   or p_expected_source_sha256<>v_source_sha
   or v_note.review->>'candidatesSha256' is distinct from p_expected_candidates_sha256
   or jsonb_typeof(v_note.review->'candidates') is distinct from 'array'
   or v_note.extraction_audit->0->>'sourceSha256' is distinct from v_source_sha
   or v_note.extraction_audit->0->>'candidatesSha256' is distinct from
       p_expected_candidates_sha256
   or (v_note.extraction_audit->0->>'sourceRevision') is distinct from '2'
   or (v_note.extraction_audit->0->>'actorId') is distinct from v_note.created_by::text
   or bm_intake_private.canonical_candidate_sha256(
       v_note.review->'candidates') <> p_expected_candidates_sha256 then
   raise exception 'Extraction source or immutable candidate digest mismatch'
     using errcode='22023';
 end if;
 if (select count(*) from jsonb_object_keys(p_scope))<>11
   or exists (select 1 from jsonb_object_keys(p_scope) k
     where k not in ('sourceRevision','reviewedBy','reviewKey',
       'sourceSha256','candidatesSha256','selectedIndices',
       'acceptedAddonCodes','policyRevision','policySha256',
       'reviewedSelectionSha256','state'))
   or p_scope->>'state' is distinct from 'reviewed-for-proposal-draft'
   or jsonb_typeof(p_scope->'sourceRevision') is distinct from 'number'
   or p_scope->>'sourceRevision' is distinct from '3'
   or p_scope->>'reviewedBy' is distinct from p_actor_id::text
   or (p_scope->>'reviewKey') !~ '^[0-9a-f]{64}$'
   or p_scope->>'sourceSha256' is distinct from v_source_sha
   or p_scope->>'candidatesSha256' is distinct from p_expected_candidates_sha256
   or (p_scope->>'policySha256') !~ '^[0-9a-f]{64}$'
   or (p_scope->>'reviewedSelectionSha256') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_scope->'policyRevision') is distinct from 'number'
   or (p_scope->>'policyRevision') !~ '^[1-9][0-9]{0,5}$'
   or jsonb_typeof(p_scope->'selectedIndices') is distinct from 'array'
   or jsonb_typeof(p_scope->'acceptedAddonCodes') is distinct from 'array' then
   raise exception 'Scope review has invalid evidence or decision fields'
     using errcode='22023';
 end if;
 v_candidate_count:=jsonb_array_length(v_note.review->'candidates');
 if jsonb_array_length(p_scope->'selectedIndices')
      not between 1 and least(50,v_candidate_count)
   or jsonb_array_length(p_scope->'acceptedAddonCodes')>50 then
   raise exception 'Invalid human service selection count' using errcode='22023';
 end if;
 -- Sorted and unique indices, exactly mapped back to the stored candidate
 -- codes, without allowing the same service to be selected twice.
 for v_entry in select value from jsonb_array_elements(p_scope->'selectedIndices') loop
   if jsonb_typeof(v_entry) is distinct from 'number'
     or (v_entry#>>'{}') !~ '^(0|[1-9][0-9]{0,5})$' then
     raise exception 'Invalid selected service index' using errcode='22023';
   end if;
   v_index:=(v_entry#>>'{}')::integer;
   if v_index<=v_previous or v_index>=v_candidate_count then
     raise exception 'Duplicate, unsorted or out-of-bounds service selection'
       using errcode='22023';
   end if;
   v_previous:=v_index;
   v_code:=v_note.review->'candidates'->v_index->>'serviceCode';
   if v_code is null or v_code=any(v_codes) then
     raise exception 'Duplicate or invalid selected service'
       using errcode='22023';
   end if;
   v_codes:=array_append(v_codes,v_code);
 end loop;
 for v_entry in select value from jsonb_array_elements(p_scope->'acceptedAddonCodes') loop
   if jsonb_typeof(v_entry) is distinct from 'string'
     or (v_entry#>>'{}') !~ '^[a-z][a-z0-9_-]{0,63}$' then
     raise exception 'Invalid add-on acknowledgement' using errcode='22023';
   end if;
   v_code:=v_entry#>>'{}';
   if not (v_code=any(v_codes)) or v_code=any(v_accepted) then
     raise exception 'Duplicate or unselected add-on acknowledgement'
       using errcode='22023';
   end if;
   v_accepted:=array_append(v_accepted,v_code);
 end loop;
 -- This does NOT verify the policy is active or that a selected code is
 -- optional: the trusted policy authorization adapter is still REQUIRED.
 update public.bm_intake_sources set revision=3,scope_review=p_scope
 where organization_id=p_organization_id and id=p_source_id and revision=2;
 if not found then
   raise exception 'Concurrent scope transition failed' using errcode='40001';
 end if;
 return query select 3,p_scope->>'reviewedSelectionSha256';
end;
$scope$;
revoke all on function bm_intake_private.commit_typed_note_scope_review(
 uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function bm_intake_private.commit_typed_note_scope_review(
 uuid,uuid,uuid,text,text,jsonb) to service_role;
