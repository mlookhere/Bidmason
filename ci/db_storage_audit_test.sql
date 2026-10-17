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

select pg_temp.bm_audit_evidence_storage_policies();
\echo PASS: policy audit rejects permissive shadow policies and unrestricted owner/tenant predicates
