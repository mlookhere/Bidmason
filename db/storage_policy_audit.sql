-- Preflight audit of the *effective policy set*, not just BidMason's
-- two policy names. Run in a separate psql session on a candidate database.
-- Creates a session-local function only; does not alter live Storage policies.
-- Conservative by design: ANY other storage.objects policy requires review,
-- even when it targets a different bucket. PostgreSQL ORs permissive policies.
create or replace function pg_temp.bm_audit_evidence_storage_policies()
returns void language plpgsql as $bm_audit$
declare
  conflicting_policies text;
  upload record;
  reader record;
begin
  if (select public from storage.buckets where id = 'bm-evidence')
      is distinct from false then
    raise exception 'bm-evidence bucket must exist and be private';
  end if;

  if (select file_size_limit from storage.buckets where id = 'bm-evidence')
      is distinct from 15728640 then
    raise exception 'bm-evidence size limit drifted';
  end if;

  if (select allowed_mime_types @> array[
      'application/pdf','image/png','image/jpeg']::text[]
      from storage.buckets where id = 'bm-evidence') is distinct from true then
    raise exception 'bm-evidence MIME allowlist is incomplete';
  end if;

  if (select relrowsecurity
      from pg_class where oid = 'storage.objects'::regclass) is distinct from true then
    raise exception 'storage.objects RLS is disabled';
  end if;

  -- Other permissive OR-composed policies could grant the bm-evidence bucket
  -- access even when both of our known policies are restrictive enough.
  select string_agg(policyname, ', ' order by policyname)
    into conflicting_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname not in ('bm_evidence_member_upload', 'bm_evidence_private_read');

  if conflicting_policies is not null then
    raise exception 'Unreviewed storage.objects policies: %', conflicting_policies;
  end if;

  select * into upload from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'bm_evidence_member_upload';
  select * into reader from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'bm_evidence_private_read';

  if not found or upload.policyname is null then
    raise exception 'Missing BidMason evidence policies';
  end if;

  if upload.cmd != 'INSERT' or reader.cmd != 'SELECT'
     or upload.permissive != 'PERMISSIVE' or reader.permissive != 'PERMISSIVE'
     or upload.roles != array['authenticated']::name[]
     or reader.roles != array['authenticated']::name[] then
    raise exception 'BidMason Storage policy role/command drift';
  end if;

  -- Basic definitions are checked in addition to runtime isolation tests.
  -- These are NOT a proof that arbitrary SQL expressions are safe; perform
  -- true Storage Auth integration tests before production use.
  if upload.with_check is null
     or position('bm-evidence' in upload.with_check) = 0
     or position('bm_memberships' in upload.with_check) = 0
     or position('auth.uid' in upload.with_check) = 0
     or position('owner_id' in upload.with_check) = 0
     or reader.qual is null
     or position('bm-evidence' in reader.qual) = 0
     or position('bm_memberships' in reader.qual) = 0
     or position('auth.uid' in reader.qual) = 0
     or position('owner_id' in reader.qual) = 0 then
    raise exception 'BidMason Storage tenant/ownership predicate drift';
  end if;
end
$bm_audit$;

select pg_temp.bm_audit_evidence_storage_policies();
\echo PASS: isolated policy-set preflight finds only tenant-scoped read/insert policies
