-- Staged Item 4 read-only idempotency reconciliation primitive.
-- NOT a deployed Supabase migration or browser-exposed RPC.
-- The trusted backend must verify active Auth/session and derive actor UUID.
-- One function call is one atomic PostgreSQL statement/snapshot. Separate
-- calls independently reauthorize membership and preserve source visibility.
create function bm_intake_private.lookup_typed_note(
 p_organization_id uuid, p_actor_id uuid, p_request_id uuid
) returns table(authenticated_actor_id uuid, text_sha256 text, record jsonb)
language plpgsql security invoker
set search_path=pg_catalog,public
as $lookup$
begin
 if p_organization_id is null or p_actor_id is null or p_request_id is null then
   raise exception 'Invalid request ledger lookup' using errcode='22023';
 end if;
 -- Authorization MUST precede even the absent-row response. Holding the
 -- member-row share lock blocks concurrent membership deletion until commit.
 perform 1 from public.bm_memberships m
  where m.organization_id=p_organization_id and m.user_id=p_actor_id
    and m.member_role in ('owner','operator','contractor')
  for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 return query
 select l.actor_id, l.text_sha256,
   jsonb_build_object(
     'organizationId',s.organization_id::text,
     'sourceId',s.id::text,
     'revision',s.revision,
     'original',jsonb_build_object('kind',s.kind,'text',s.original_text),
     'review',s.review,
     'extractionAudit',s.extraction_audit,
     'scopeReview',s.scope_review,
     'creationAudit',jsonb_build_object(
       'actorId',s.created_by::text,
       'requestId',s.request_id::text,
       'textSha256',s.text_sha256))
 from public.bm_typed_note_requests l
 join public.bm_intake_sources s
   on s.organization_id=l.organization_id
   and s.id=l.source_id and s.created_by=l.actor_id
   and s.request_id=l.request_id and s.text_sha256=l.text_sha256
 where l.organization_id=p_organization_id and l.actor_id=p_actor_id
   and l.request_id=p_request_id
 for share of l,s;
end;
$lookup$;
revoke all on function bm_intake_private.lookup_typed_note(uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function bm_intake_private.lookup_typed_note(uuid,uuid,uuid)
 to service_role;
