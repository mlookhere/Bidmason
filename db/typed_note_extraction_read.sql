-- STAGING ONLY. Primary PostgreSQL creator-owned source projection for
-- authenticated server-side extraction verification and read-back.
-- No browser RPC or customer route is created by this file.
create function bm_intake_private.read_typed_note_for_extraction(
 p_organization_id uuid, p_actor_id uuid, p_source_id uuid
) returns table(record jsonb)
language plpgsql security invoker
set search_path=pg_catalog,public
as $read$
begin
 if p_organization_id is null or p_actor_id is null or p_source_id is null then
   raise exception 'Invalid extraction source lookup' using errcode='22023';
 end if;
 -- Check membership BEFORE finding or disclosing source existence. Row
 -- lock prevents concurrent membership revocation until this read commits.
 perform 1 from public.bm_memberships m
 where m.organization_id=p_organization_id and m.user_id=p_actor_id
   and m.member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 return query
 select jsonb_build_object(
   'organizationId',s.organization_id::text,
   'sourceId',s.id::text,
   'revision',s.revision,
   'original',jsonb_build_object('kind',s.kind,'text',s.original_text),
   'review',s.review,
   'extractionAudit',s.extraction_audit,
   'scopeReview',s.scope_review,
   'creationAudit',jsonb_build_object(
     'actorId',s.created_by::text,'requestId',s.request_id::text,
     'textSha256',s.text_sha256))
 from public.bm_intake_sources s
 where s.organization_id=p_organization_id and s.id=p_source_id
   and s.created_by=p_actor_id
 for share of s;
end;
$read$;
revoke all on function bm_intake_private.read_typed_note_for_extraction(
 uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function bm_intake_private.read_typed_note_for_extraction(
 uuid,uuid,uuid) to service_role;
