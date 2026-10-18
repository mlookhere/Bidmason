\set ON_ERROR_STOP on
-- Run after the restrictive direct-INSERT lockdown and all historical tests.
-- Three real PostgreSQL RLS roles and four JWT identities are exercised.
-- Signed-in evidence contractors may see exactly their own verified
-- service-owned objects (owner_id NULL), not other contractors' evidence.
do $$
declare
  policy_row record;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bm_evidence_receipts'
      and column_name = 'uploaded_by' and data_type = 'uuid'
  ) then raise exception 'Uploader attribution column is missing'; end if;
  if has_table_privilege('authenticated', 'public.bm_evidence_receipts', 'INSERT')
     or has_table_privilege('authenticated', 'public.bm_evidence_receipts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.bm_evidence_receipts', 'DELETE') then
    raise exception 'Client can forge trusted uploader attribution'; end if;
  for policy_row in select * from pg_policies where schemaname='storage'
      and tablename='objects' and policyname in
      ('bm_evidence_private_read','bm_evidence_read_boundary') loop
    if policy_row.qual not like '%bm_evidence_receipts%'
       or policy_row.qual not like '%uploaded_by%'
       or policy_row.qual not like '%bm_memberships%'
       or policy_row.qual not like '%auth.uid%' then
      raise exception 'Read policy omits scoped trusted uploader check %', policy_row.policyname;
    end if;
  end loop;
  if (select count(*) from pg_policies where schemaname='storage'
      and tablename='objects' and policyname in
      ('bm_evidence_private_read','bm_evidence_read_boundary')) <> 2 then
    raise exception 'Missing scoped Storage read policies'; end if;
end $$;

-- The earlier receipt test deliberately revoked contractor B. Restore B
-- in this final isolated fixture and add a SECOND contractor D in the SAME
-- organization to demonstrate that membership alone is insufficient.
insert into public.bm_memberships(organization_id, user_id, member_role) values
  ('10000000-0000-4000-8000-000000000001',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'contractor'),
  ('10000000-0000-4000-8000-000000000001',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'contractor');

-- True service-owned object: Storage has no authenticated end-user owner_id.
-- Only trusted backend (privileged CI fixture) creates object and receipt.
insert into storage.objects(bucket_id, name, owner_id) values (
  'bm-evidence',
  '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000081.pdf',
  null
);
insert into public.bm_evidence_receipts
  (organization_id, object_path, content_sha256, byte_length, content_type, uploaded_by)
values (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000081.pdf',
  repeat('8',64), 1024, 'application/pdf',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);
-- Object with no verified receipt: even its exact same-tenant prefix cannot
-- grant the contractor access without a trusted receipt.
insert into storage.objects(bucket_id, name, owner_id) values (
  'bm-evidence',
  '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000082.pdf',
  null
);

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare permitted boolean := false;
begin
  if (select count(*) from storage.objects
    where bucket_id='bm-evidence' and owner_id is null) <> 1 then
    raise exception 'Correct contractor cannot access own server-issued receipt'; end if;
  if (select count(*) from storage.objects where bucket_id='bm-evidence'
    and name like '%000000000082.pdf') <> 0 then
    raise exception 'Contractor saw an unreceipted server-owned object'; end if;
  begin
    insert into storage.objects(bucket_id,name,owner_id) values
      ('bm-evidence',
       '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000083.pdf',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    permitted := true;
  exception when insufficient_privilege then null;
  end;
  if permitted then raise exception 'Contractor bypassed server-only scan/quota'; end if;
  permitted := false;
  begin
    update public.bm_evidence_receipts set uploaded_by =
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    permitted := true;
  exception when insufficient_privilege then null;
  end;
  if permitted then raise exception 'Contractor forged trusted uploader attribution'; end if;
end $$;

set request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 0 then
    raise exception 'Another same-tenant contractor saw other uploader evidence'; end if;
end $$;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence'
    and owner_id is null) <> 2 then
    raise exception 'Tenant owner cannot review service-managed tenant evidence'; end if;
end $$;
set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 0 then
    raise exception 'Foreign tenant can read service-managed evidence'; end if;
end $$;
reset request.jwt.claim.sub;
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 0 then
    raise exception 'Missing caller identity can read evidence'; end if;
end $$;
reset role;

-- Broad permissive shadow READ must not bypass the restrictive tenant/read
-- boundary even when a same-tenant contractor has other membership access.
begin;
create policy ci_shadow_uploader_read on storage.objects
  for select to authenticated using (true);
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 0 then
    raise exception 'Permissive shadow bypassed contractor receipt restriction'; end if;
end $$;
set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 0 then
    raise exception 'Permissive shadow bypassed tenant boundary'; end if;
end $$;
reset request.jwt.claim.sub;
reset role;
rollback;

-- Immediate revocation with the original JWT user identity must remove the
-- contractor's object access; immutable receipt remains for audit.
delete from public.bm_memberships where
  organization_id='10000000-0000-4000-8000-000000000001'
  and user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 0 then
    raise exception 'Revoked contractor retained server-owned evidence'; end if;
end $$;
reset request.jwt.claim.sub;
reset role;
\echo PASS: trusted uploader receipt grants only own service-owned evidence while current membership, without cross-tenant or shadow access
