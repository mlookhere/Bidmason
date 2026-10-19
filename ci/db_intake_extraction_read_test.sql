-- Isolated PostgreSQL only: run after staged original, ledger, and CAS suites.
-- Checks the exact private projection used by the trusted JS extractor.
insert into public.bm_memberships(organization_id,user_id,member_role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '44444444-4444-4444-8444-444444444444','contractor');

do $verify$
begin
 if has_function_privilege('authenticated',
  'bm_intake_private.read_typed_note_for_extraction(uuid,uuid,uuid)','EXECUTE')
 or has_function_privilege('anon',
  'bm_intake_private.read_typed_note_for_extraction(uuid,uuid,uuid)','EXECUTE')
 or has_schema_privilege('authenticated','bm_intake_private','USAGE')
 then raise exception 'Browser can inspect private original source'; end if;
end;
$verify$;

set role service_role;
do $verify$
declare
 org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 foreign_org uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 creator uuid:='44444444-4444-4444-8444-444444444444';
 same_org_other_actor uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 req uuid:='12345678-1234-4234-8234-123456789abc';
 source_id uuid;
 result jsonb;
 sha text;
begin
 select t.source_id,t.original_sha256 into source_id,sha
 from bm_intake_private.create_typed_note(org,creator,req,'Clean café 🧱');
 select record into result from bm_intake_private.read_typed_note_for_extraction(
    org,creator,source_id);
 if result is null
   or (select count(*) from jsonb_object_keys(result))<>8
   or result->>'organizationId'<>org::text
   or result->>'sourceId'<>source_id::text
   or (result->>'revision')::integer<>1
   or result->'original'->>'text'<>'Clean café 🧱'
   or result->'original'->>'kind'<>'typed-note'
   or result->'creationAudit'->>'actorId'<>creator::text
   or result->'creationAudit'->>'requestId'<>req::text
   or result->'creationAudit'->>'textSha256'<>sha
   or result->'review'<>'null'::jsonb
   or result->'scopeReview'<>'null'::jsonb
   or result->'extractionAudit'<>'[]'::jsonb then
   raise exception 'Read projection lost immutable evidence or audit';
 end if;
 if (select count(*) from bm_intake_private.read_typed_note_for_extraction(
     org,creator,gen_random_uuid()))<>0 then
   raise exception 'Absent source returned a row';
 end if;
 if (select count(*) from bm_intake_private.read_typed_note_for_extraction(
     org,same_org_other_actor,source_id))<>0 then
   raise exception 'Another tenant member saw a private original';
 end if;
 begin
  perform 1 from bm_intake_private.read_typed_note_for_extraction(
    foreign_org,creator,source_id);
  raise exception 'Foreign tenant exposed private source';
 exception when insufficient_privilege then null; end;
 if (select count(*) from public.bm_intake_sources
    where organization_id=org and id=source_id)<>1 then
   raise exception 'Private source lookup mutated records';
 end if;
end;
$verify$;
reset role;

-- Deny existence and contents identically after membership revocation.
delete from public.bm_memberships
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id='44444444-4444-4444-8444-444444444444';
set role service_role;
do $verify$
declare
 org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 creator uuid:='44444444-4444-4444-8444-444444444444';
 source_id uuid;
begin
 select id into source_id from public.bm_intake_sources
 where organization_id=org and created_by=creator;
 begin
  perform 1 from bm_intake_private.read_typed_note_for_extraction(
    org,creator,source_id);
  raise exception 'Revoked creator read existing source';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from bm_intake_private.read_typed_note_for_extraction(
    org,creator,gen_random_uuid());
  raise exception 'Revoked creator learned source nonexistence';
 exception when insufficient_privilege then null; end;
end;
$verify$;
reset role;
select 'PASS: private extraction source projection, owner and tenant isolation, revocation';
