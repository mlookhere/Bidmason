\set ON_ERROR_STOP on
-- Runs after ci/db_rls_test.sql and ci/db_fact_review_test.sql.
-- Read/write assertions exercise real PostgreSQL RLS and Supabase-style
-- owner_id semantics, not a simulated JS allow/deny function.
do $$
begin
  if (select public from storage.buckets where id='bm-evidence') is not false then
    raise exception 'Evidence bucket must be private';
  end if;
  if (select allowed_mime_types @> array['application/pdf','image/png','image/jpeg']::text[]
      from storage.buckets where id='bm-evidence') is not true then
    raise exception 'Evidence type allowlist is missing';
  end if;
  if (select file_size_limit from storage.buckets where id='bm-evidence') != 15728640 then
    raise exception 'Evidence size limit is missing';
  end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
-- User A can upload/read original evidence in its own organization.
insert into storage.objects(bucket_id, name, owner_id) values (
 'bm-evidence',
 '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001.pdf',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
do $$
declare allowed boolean := false;
begin
  if (select count(*) from storage.objects) != 1 then
    raise exception 'Owner cannot read own private evidence';
  end if;
  begin
    insert into storage.objects(bucket_id,name,owner_id) values (
      'bm-evidence',
      '10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000002.pdf',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Cross-organization upload accepted'; end if;

  allowed := false;
  begin
    insert into storage.objects(bucket_id,name,owner_id) values (
      'bm-evidence', '10000000-0000-4000-8000-000000000001/../escape.pdf',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Unsafe traversal-like evidence path accepted'; end if;

  allowed := false;
  begin
    insert into storage.objects(bucket_id,name,owner_id) values (
      'bm-evidence',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000003.pdf',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Spoofed storage owner_id accepted'; end if;

  allowed := false;
  begin
    insert into storage.objects(bucket_id,name,owner_id) values (
      'other-bucket',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000004.pdf',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    allowed := true;
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
  if allowed then raise exception 'Storage policy permitted wrong bucket'; end if;

  begin
    update storage.objects set name =
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000009.pdf';
    if found then raise exception 'Client can overwrite evidence'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    delete from storage.objects;
    if found then raise exception 'Client can delete evidence'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- Same-tenant contractor cannot enumerate other uploaders' private evidence.
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  if (select count(*) from storage.objects) != 0 then
    raise exception 'Same-organization contractor can read another uploader evidence';
  end if;
end $$;
insert into storage.objects(bucket_id, name, owner_id) values (
  'bm-evidence',
  '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000005.png',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);
do $$
begin
  if (select count(*) from storage.objects) != 1 then
    raise exception 'Uploader cannot read own storage file';
  end if;
end $$;

set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  if (select count(*) from storage.objects) != 2 then
    raise exception 'Organization owner cannot read organization evidence';
  end if;
end $$;

set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
declare allowed boolean := false;
begin
  if (select count(*) from storage.objects) != 0 then
    raise exception 'Tenant B can read tenant A evidence';
  end if;
  begin
    insert into storage.objects(bucket_id, name, owner_id) values (
      'bm-evidence',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000006.pdf',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Tenant B can upload to tenant A prefix'; end if;
end $$;

reset request.jwt.claim.sub;
do $$
begin
  if (select count(*) from storage.objects) != 0 then
    raise exception 'Missing user identity can read evidence';
  end if;
end $$;
reset role;

do $$
begin
  if (select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname in ('bm_evidence_member_upload', 'bm_evidence_private_read')) != 2 then
    raise exception 'Missing private evidence Storage policies';
  end if;
  if (select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname like 'bm_evidence_%' and cmd in ('UPDATE','DELETE','ALL')) != 0 then
    raise exception 'Evidence may be modified or deleted';
  end if;
end $$;
\echo PASS: tenant-private object policies, append-only uploads, owner checks, traversal rejection, no cross-tenant reads
