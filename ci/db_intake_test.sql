-- This MUST run against the disposable CI database only. No real user data.
insert into public.bm_organizations(id,slug,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','tenant-a','Synthetic A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','tenant-b','Synthetic B');
insert into public.bm_memberships(organization_id,user_id,member_role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','operator');

do $test$
begin
 if not (select relrowsecurity and relforcerowsecurity
    from pg_class where oid='public.bm_intake_sources'::regclass)
 or not (select relrowsecurity and relforcerowsecurity
    from pg_class where oid='public.bm_typed_note_requests'::regclass) then
  raise exception 'RLS must be enabled and forced for BOTH intake tables';
 end if;
 if has_table_privilege('anon','public.bm_intake_sources','SELECT')
 or has_table_privilege('authenticated','public.bm_intake_sources','SELECT')
 or has_table_privilege('authenticated','public.bm_intake_sources','INSERT')
 or has_table_privilege('authenticated','public.bm_intake_sources','UPDATE')
 or has_table_privilege('authenticated','public.bm_typed_note_requests','SELECT')
 or has_table_privilege('authenticated','public.bm_typed_note_requests','INSERT')
 or has_schema_privilege('authenticated','bm_intake_private','USAGE')
 or has_function_privilege('authenticated',
   'bm_intake_private.create_typed_note(uuid,uuid,uuid,text)','EXECUTE')
 or has_function_privilege('anon',
   'bm_intake_private.create_typed_note(uuid,uuid,uuid,text)','EXECUTE') then
  raise exception 'Client/anonymous privileges expose private intake data';
 end if;
end;
$test$;

set role service_role;
do $test$
declare
 v_org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_actor uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 v_request uuid:='11111111-1111-4111-8111-111111111111';
 v_source uuid;
 v_replay uuid;
 v_sha text;
begin
 select source_id,original_sha256 into v_source,v_sha
  from bm_intake_private.create_typed_note(v_org,v_actor,v_request,'Paint 2 rooms');
 if v_source is null or v_sha<>
  encode(sha256(convert_to('Paint 2 rooms','UTF8')),'hex') then
  raise exception 'First create returned wrong source/digest';
 end if;
 select source_id into v_replay
  from bm_intake_private.create_typed_note(v_org,v_actor,v_request,'Paint 2 rooms');
 if v_source<>v_replay
  or (select count(*) from public.bm_intake_sources
    where organization_id=v_org)<>1
  or (select count(*) from public.bm_typed_note_requests
    where organization_id=v_org)<>1 then
  raise exception 'Duplicate request created duplicate source or ledger';
 end if;
 begin
  perform 1 from bm_intake_private.create_typed_note(
   v_org,v_actor,v_request,'Paint 20 rooms');
  raise exception 'Different payload was accepted';
 exception when unique_violation then null;
 end;
 begin
  perform 1 from bm_intake_private.create_typed_note(
   v_other,v_actor,v_request,'Paint 2 rooms');
  raise exception 'Cross-tenant actor was accepted';
 exception when insufficient_privilege then null;
 end;
 begin
  perform 1 from bm_intake_private.create_typed_note(
   v_org,v_actor,'22222222-2222-4222-8222-222222222222',repeat('A',65537));
  raise exception 'Unbounded text accepted';
 exception when invalid_parameter_value then null;
 end;
 begin
  insert into public.bm_typed_note_requests(
   organization_id,actor_id,request_id,source_id,text_sha256)
  values(v_org,v_actor,'33333333-3333-4333-8333-333333333333',
   v_source,repeat('0',64));
  raise exception 'Forged source/request/digest FK accepted';
 exception when foreign_key_violation then null;
 end;
 begin
  insert into public.bm_intake_sources(
   organization_id,created_by,request_id,original_text,text_sha256)
  values(v_org,v_actor,'44444444-4444-4444-8444-444444444444',
    'text',repeat('0',64));
  raise exception 'Forged digest accepted';
 exception when check_violation then null;
 end;
end;
$test$;
reset role;

-- Revoking membership blocks even a replay against a still-present ledger.
delete from public.bm_memberships where
 organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 and user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set role service_role;
do $test$
begin
 begin
  perform 1 from bm_intake_private.create_typed_note(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '11111111-1111-4111-8111-111111111111','Paint 2 rooms');
  raise exception 'Revoked member can still replay note';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
reset role;
select 'PASS: isolated intake DB tenant identity, original SHA, FK, RLS, idempotency and revoked membership';
