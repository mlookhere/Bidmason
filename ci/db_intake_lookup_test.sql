-- Run ONLY after ci/db_intake_test.sql against disposable PostgreSQL CI.
-- That suite revokes its original operator's membership; this suite exercises
-- a fresh actor's own idempotency key and a second same-tenant actor.
insert into public.bm_memberships(organization_id,user_id,member_role)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','operator'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ffffffff-ffff-4fff-8fff-ffffffffffff','contractor');

do $test$
begin
 if has_function_privilege('anon',
    'bm_intake_private.lookup_typed_note(uuid,uuid,uuid)','EXECUTE')
 or has_function_privilege('authenticated',
    'bm_intake_private.lookup_typed_note(uuid,uuid,uuid)','EXECUTE')
 or has_schema_privilege('authenticated','bm_intake_private','USAGE') then
  raise exception 'Client role can access private typed-note lookup';
 end if;
end;
$test$;
set role service_role;
do $test$
declare
 org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 actor uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 stranger uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 req uuid:='88888888-8888-4888-8888-888888888888';
 saved_id uuid;
 result record;
begin
 if (select count(*) from bm_intake_private.lookup_typed_note(
    org,actor,req))<>0 then
   raise exception 'Absent own request must have no lookup row';
 end if;
 select source_id into saved_id from bm_intake_private.create_typed_note(
  org,actor,req,'Inspect 4 windows');
 select * into result from bm_intake_private.lookup_typed_note(org,actor,req);
 if not found or result.authenticated_actor_id<>actor
   or result.text_sha256<>encode(sha256(convert_to('Inspect 4 windows','UTF8')),'hex')
   or result.record->>'organizationId'<>org::text
   or result.record->>'sourceId'<>saved_id::text
   or (result.record->>'revision')::integer<>1
   or result.record->'original'->>'text'<>'Inspect 4 windows'
   or result.record->'original'->>'kind'<>'typed-note'
   or result.record->'creationAudit'->>'actorId'<>actor::text
   or result.record->'creationAudit'->>'requestId'<>req::text
   or result.record->'creationAudit'->>'textSha256'<>result.text_sha256
   or result.record->'review'<>'null'::jsonb
   or result.record->'scopeReview'<>'null'::jsonb
   or result.record->'extractionAudit'<>'[]'::jsonb
   or (select count(*) from jsonb_object_keys(result.record))<>8
 then
  raise exception 'Ledger receipt does not reconstruct exact source evidence';
 end if;
 -- Even another active user in the same organization must not see the
 -- original creator's actor-scoped request ledger.
 if (select count(*) from bm_intake_private.lookup_typed_note(
   org,stranger,req))<>0 then
   raise exception 'Other tenant member inherited actor-scoped request';
 end if;
 begin
  perform 1 from bm_intake_private.lookup_typed_note(other,actor,req);
  raise exception 'Foreign tenant lookup was allowed';
 exception when insufficient_privilege then null; end;

 update public.bm_intake_sources set revision=2,
   review='{"state":"needs-human-review"}'::jsonb,
   extraction_audit='[{"sourceRevision":2}]'::jsonb
 where organization_id=org and id=saved_id;
 select * into result from bm_intake_private.lookup_typed_note(org,actor,req);
 if (result.record->>'revision')::integer<>2
   or result.record->'review'->>'state'<>'needs-human-review' then
   raise exception 'Lookup failed after extraction without duplicate write';
 end if;
 update public.bm_intake_sources set revision=3,
   scope_review='{"state":"reviewed-for-proposal-draft"}'::jsonb
 where organization_id=org and id=saved_id;
 select * into result from bm_intake_private.lookup_typed_note(org,actor,req);
 if (result.record->>'revision')::integer<>3
   or result.record->'creationAudit'->>'requestId'<>req::text then
   raise exception 'Lookup lost original after human-reviewed progression';
 end if;
 if (select count(*) from public.bm_intake_sources
   where organization_id=org and created_by=actor)<>1 then
   raise exception 'Read-only lookup created or duplicated source';
 end if;
end;
$test$;
reset role;

delete from public.bm_memberships where
 organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 and user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
set role service_role;
do $test$
begin
 begin
  perform 1 from bm_intake_private.lookup_typed_note(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '88888888-8888-4888-8888-888888888888');
  raise exception 'Revoked member received a ledger row';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from bm_intake_private.lookup_typed_note(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '99999999-9999-4999-8999-999999999999');
  raise exception 'Revoked member learned absence from ledger';
 exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
select 'PASS: authorized read-only typed-note reconciliation and revocation';
