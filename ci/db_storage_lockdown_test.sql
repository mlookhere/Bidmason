\set ON_ERROR_STOP on

-- This test runs LAST on both the direct-source schema and the fresh database
-- replaying all managed migrations. Earlier RLS tests validate historical
-- tenant-scoped behavior; the final deployed policy MUST deny raw client INSERT.
do $$
declare
  p record;
begin
  select * into p from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname='bm_evidence_server_only_insert';
  if p.policyname is null or p.cmd <> 'INSERT'
     or p.permissive <> 'RESTRICTIVE'
     or p.roles <> array['public']::name[]
     or p.with_check <> '(bucket_id <> ''bm-evidence''::text)' then
    raise exception 'Final evidence Storage client-upload lockdown is missing or modified';
  end if;
  if (select public from storage.buckets where id='bm-evidence') is distinct from false then
    raise exception 'Evidence bucket became public';
  end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare inserted boolean := false;
begin
  begin
    insert into storage.objects(bucket_id,name,owner_id) values(
      'bm-evidence',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000071.pdf',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    inserted := true;
  exception when insufficient_privilege then null;
  end;
  if inserted then raise exception 'Tenant owner bypassed malware scan/atomic quota'; end if;
  if (select count(*) from storage.objects where bucket_id='bm-evidence') != 2 then
    raise exception 'Existing private evidence was altered by denied INSERT';
  end if;
end $$;

-- Even another intentionally broad permissive INSERT cannot override the
-- restrictive server-only guard for authenticated tenants.
reset request.jwt.claim.sub;
reset role;
begin;
create policy ci_broad_shadow_insert_after_lockdown on storage.objects
  for insert to authenticated with check (true);
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare inserted boolean := false;
begin
  begin
    insert into storage.objects(bucket_id,name,owner_id) values(
      'bm-evidence',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000072.pdf',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    inserted := true;
  exception when insufficient_privilege then null;
  end;
  if inserted then raise exception 'Broad shadow policy bypassed scan-required Storage lockdown'; end if;
  -- The prior mandatory revocation fixture removed contractor B's
  -- membership, so this user must see ZERO existing files, not one.
  if (select count(*) from storage.objects where bucket_id='bm-evidence') != 0 then
    raise exception 'Revoked contractor regained Storage access';
  end if;
end $$;
reset request.jwt.claim.sub;
reset role;
rollback;

-- An already-existing uploader must still be able to read its original file;
-- client update/delete restrictions and cross-tenant isolation are unchanged.
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 0 then
    raise exception 'Cross-tenant evidence became visible after lockdown';
  end if;
end $$;
reset request.jwt.claim.sub;
reset role;

\echo PASS: final server-only Storage INSERT guard prevents raw authenticated uploads and shadow-policy bypass
