\set ON_ERROR_STOP on
-- End-state read-only policy audit, after all nine candidate migrations.
-- Run against an isolated database. No policy or live-data mutations here.
create or replace function pg_temp.bm_assert_final_evidence_storage_policies()
returns void language plpgsql as $audit$
declare
  expected record;
  actual record;
  unexpected text;
begin
  if (select relrowsecurity from pg_class
      where oid = 'storage.objects'::regclass) is distinct from true
     or (select public from storage.buckets where id='bm-evidence')
       is distinct from false
     or (select relrowsecurity from pg_class
       where oid='public.bm_evidence_receipts'::regclass) is distinct from true
     or has_table_privilege('authenticated','public.bm_evidence_receipts','INSERT')
     or has_table_privilege('authenticated','public.bm_evidence_receipts','UPDATE')
     or has_table_privilege('authenticated','public.bm_evidence_receipts','DELETE') then
    raise exception 'Final evidence bucket or receipt write boundary drift';
  end if;

  select string_agg(policyname, ', ' order by policyname) into unexpected
  from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname not in (
      'bm_evidence_member_upload', 'bm_evidence_private_read',
      'bm_evidence_upload_boundary', 'bm_evidence_read_boundary',
      'bm_evidence_block_update', 'bm_evidence_block_delete',
      'bm_evidence_server_only_insert', 'bm_evidence_verified_receipt_read'
    );
  if unexpected is not null then
    raise exception 'Unreviewed final Storage policies: %', unexpected;
  end if;

  for expected in
    select * from (values
      ('bm_evidence_member_upload','INSERT','PERMISSIVE','authenticated'),
      ('bm_evidence_private_read','SELECT','PERMISSIVE','authenticated'),
      ('bm_evidence_upload_boundary','INSERT','RESTRICTIVE','public'),
      ('bm_evidence_read_boundary','SELECT','RESTRICTIVE','public'),
      ('bm_evidence_block_update','UPDATE','RESTRICTIVE','public'),
      ('bm_evidence_block_delete','DELETE','RESTRICTIVE','public'),
      ('bm_evidence_server_only_insert','INSERT','RESTRICTIVE','public'),
      ('bm_evidence_verified_receipt_read','SELECT','RESTRICTIVE','public')
    ) as p(name, cmd, kind, target_role)
  loop
    select * into actual from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname=expected.name;
    if actual.policyname is null
       or actual.cmd <> expected.cmd
       or actual.permissive <> expected.kind
       or actual.roles <> array[expected.target_role::name] then
      raise exception 'Missing or modified final Storage policy: %', expected.name;
    end if;
  end loop;

  select * into actual from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bm_evidence_verified_receipt_read';
  if actual.qual is null
    or position('bm-evidence' in actual.qual)=0
    or position('bm_evidence_receipts' in actual.qual)=0
    or position('organization_id' in actual.qual)=0
    or position('object_path' in actual.qual)=0
    or position('storage.objects.name' in actual.qual)=0 then
    raise exception 'Final Storage quarantine predicate missing receipt or tenant binding';
  end if;

  select * into actual from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bm_evidence_server_only_insert';
  if actual.with_check is distinct from '(bucket_id <> ''bm-evidence''::text)' then
    raise exception 'Final Storage raw-upload lockdown was modified';
  end if;
end
$audit$;

select pg_temp.bm_assert_final_evidence_storage_policies();
\echo PASS: final eight-policy Storage set is strict, receipt-gated and write-locked
