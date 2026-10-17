\set ON_ERROR_STOP on
-- Run in the SAME psql session as db/storage_policy_audit.sql.
-- These changes are always rolled back. A silent acceptance fails CI.
begin;
create policy ci_permissive_shadow_read on storage.objects
  for select to authenticated using (true);
do $bm_test$
declare blocked boolean := false;
begin
  begin
    perform pg_temp.bm_audit_evidence_storage_policies();
  exception when raise_exception then
    blocked := true;
  end;
  if not blocked then
    raise exception 'Policy auditor accepted a broad additional SELECT policy';
  end if;
end
$bm_test$;
rollback;

begin;
alter policy bm_evidence_member_upload on storage.objects
  with check (true);
do $bm_test$
declare blocked boolean := false;
begin
  begin
    perform pg_temp.bm_audit_evidence_storage_policies();
  exception when raise_exception then
    blocked := true;
  end;
  if not blocked then
    raise exception 'Policy auditor accepted an unrestricted INSERT predicate';
  end if;
end
$bm_test$;
rollback;

begin;
alter policy bm_evidence_private_read on storage.objects
  using (true);
do $bm_test$
declare blocked boolean := false;
begin
  begin
    perform pg_temp.bm_audit_evidence_storage_policies();
  exception when raise_exception then
    blocked := true;
  end;
  if not blocked then
    raise exception 'Policy auditor accepted an unrestricted SELECT predicate';
  end if;
end
$bm_test$;
rollback;


-- Defense in depth: an accidentally added permissive SELECT/INSERT/UPDATE/
-- DELETE policy must not broaden actual access to this bucket, even before
-- the auditor runs. All changes are rolled back.
begin;
create policy ci_broad_shadow_all on storage.objects
  for all to authenticated using (true) with check (true);
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $bm_shadow$
declare
  inserted boolean := false;
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') != 0 then
    raise exception 'Cross-tenant SELECT bypassed restrictive Storage policy';
  end if;
  begin
    insert into storage.objects(bucket_id, name, owner_id) values (
      'bm-evidence',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-0000000000f1.pdf',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    inserted := true;
  exception when insufficient_privilege then null;
  end;
  if inserted then raise exception 'Cross-tenant INSERT bypassed restrictive Storage policy'; end if;
end
$bm_shadow$;
reset request.jwt.claim.sub;
reset role;
rollback;

-- Owner A has normal read permission; permissive UPDATE/DELETE nevertheless
-- cannot affect evidence because restrictive denial remains in force.
begin;
create policy ci_broad_shadow_write on storage.objects
  for all to authenticated using (true) with check (true);
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $bm_shadow$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') != 2 then
    raise exception 'Broad policy fixture could not see owner evidence';
  end if;
  update storage.objects set name =
    '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-0000000000f2.pdf'
  where bucket_id = 'bm-evidence';
  if found then raise exception 'Shadow policy bypassed restrictive UPDATE denial'; end if;
  delete from storage.objects where bucket_id='bm-evidence';
  if found then raise exception 'Shadow policy bypassed restrictive DELETE denial'; end if;
end
$bm_shadow$;
reset request.jwt.claim.sub;
reset role;
rollback;

select pg_temp.bm_audit_evidence_storage_policies();
\echo PASS: policy audit rejects permissive shadow policies and unrestricted owner/tenant predicates
