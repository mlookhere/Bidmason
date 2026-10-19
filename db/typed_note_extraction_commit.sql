-- Staged private CAS for one typed-note extraction transition (rev 1 -> 2).
-- Not a migration or public RPC. A trusted server must derive the actor from
-- fresh Auth, validate every suggested UTF-16 span with parseUntrustedExtraction,
-- and use the original persisted source, never browser text.
create function bm_intake_private.commit_typed_note_extraction(
 p_organization_id uuid, p_actor_id uuid, p_source_id uuid,
 p_expected_text_sha256 text, p_review jsonb
) returns table(source_revision integer, original_sha256 text, candidates_sha256 text)
language plpgsql security invoker
set search_path=pg_catalog,public
as $commit$
declare
 v_note public.bm_intake_sources%rowtype;
 v_source_sha text;
begin
 if p_organization_id is null or p_actor_id is null or p_source_id is null
   or p_expected_text_sha256 is null
   or p_expected_text_sha256 !~ '^[0-9a-f]{64}$'
   or p_review is null or jsonb_typeof(p_review) is distinct from 'object'
   or pg_column_size(p_review) > 32768 then
   raise exception 'Invalid extraction CAS request' using errcode='22023';
 end if;
 -- Membership is checked FIRST, even if the source does not exist. This lock
 -- serializes revocation with the mutation for the duration of the transaction.
 perform 1 from public.bm_memberships
  where organization_id=p_organization_id and user_id=p_actor_id
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;

 select * into v_note from public.bm_intake_sources
  where organization_id=p_organization_id and id=p_source_id for update;
 if not found then
   raise exception 'Source unavailable for authorized extraction'
     using errcode='42501';
 end if;
 if v_note.revision<>1 or v_note.review is not null
   or v_note.extraction_audit<>'[]'::jsonb or v_note.scope_review is not null
   or v_note.text_sha256<>p_expected_text_sha256 then
   raise exception 'Stale or already extracted source' using errcode='40001';
 end if;

 v_source_sha:=encode(sha256(
   convert_to('typed-note','UTF8') || decode('00','hex')
   || convert_to(v_note.original_text,'UTF8')),'hex');

 if (select count(*) from jsonb_object_keys(p_review))<>5
   or exists(select 1 from jsonb_object_keys(p_review) k
     where k not in ('state','kind','sourceSha256','candidatesSha256','candidates'))
   or p_review->>'state' is distinct from 'needs-human-review'
   or p_review->>'kind' is distinct from 'typed-note'
   or p_review->>'sourceSha256' is distinct from v_source_sha
   or (p_review->>'candidatesSha256') is null
   or (p_review->>'candidatesSha256') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_review->'candidates') is distinct from 'array' then
   raise exception 'Extraction review source/provenance mismatch'
     using errcode='22023';
 end if;
 if jsonb_array_length(p_review->'candidates') not between 1 and 50
   or exists (
     select 1 from jsonb_array_elements(p_review->'candidates') e
     where jsonb_typeof(e) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(
         case when jsonb_typeof(e)='object' then e else '{}'::jsonb end))<>5
       or exists(select 1 from jsonb_object_keys(
         case when jsonb_typeof(e)='object' then e else '{}'::jsonb end) k
         where k not in ('serviceCode','units','start','end','excerpt'))
       or jsonb_typeof(e->'serviceCode') is distinct from 'string'
       or (e->>'serviceCode') !~ '^[a-z][a-z0-9_-]{0,63}$'
       or jsonb_typeof(e->'units') is distinct from 'number'
       or (e->>'units') !~ '^[1-9][0-9]{0,15}$'
       or jsonb_typeof(e->'start') is distinct from 'number'
       or (e->>'start') !~ '^(0|[1-9][0-9]{0,15})$'
       or jsonb_typeof(e->'end') is distinct from 'number'
       or (e->>'end') !~ '^[1-9][0-9]{0,15}$'
       or jsonb_typeof(e->'excerpt') is distinct from 'string'
       or length(btrim(e->>'excerpt'))=0
   ) then
   raise exception 'Malformed extraction candidate snapshot' using errcode='22023';
 end if;

 -- The trusted JS parser MUST verify exact UTF-16 offsets and recompute the
 -- candidates hash; SQL independently checks bounded shape and ORIGINAL hash.
 update public.bm_intake_sources
 set revision=2,review=p_review,
     extraction_audit=jsonb_build_array(jsonb_build_object(
       'sourceRevision',2,'actorId',p_actor_id::text,
       'sourceSha256',v_source_sha,
       'candidatesSha256',p_review->>'candidatesSha256'))
 where organization_id=p_organization_id and id=p_source_id and revision=1;
 if not found then
   raise exception 'Concurrent extraction transition failed' using errcode='40001';
 end if;
 return query select 2,v_note.text_sha256,p_review->>'candidatesSha256';
end;
$commit$;
revoke all on function bm_intake_private.commit_typed_note_extraction(
 uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function bm_intake_private.commit_typed_note_extraction(
 uuid,uuid,uuid,text,jsonb) to service_role;
