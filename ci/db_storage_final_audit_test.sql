\set ON_ERROR_STOP on
-- Each adversarial policy mutation is automatically rolled back.
begin;
create policy ci_unreviewed_permissive_read on storage.objects
  for select to authenticated using (true);
do $test$
begin
  begin
    perform pg_temp.bm_assert_final_evidence_storage_policies();
    raise exception 'Final audit accepted an extra permissive Storage policy';
  exception when raise_exception then
    if sqlerrm = 'Final audit accepted an extra permissive Storage policy' then
      raise;
    end if;
    if position('Unreviewed final Storage policies' in sqlerrm)=0 then raise; end if;
  end;
end
$test$;
rollback;

begin;
alter policy bm_evidence_verified_receipt_read on storage.objects using (true);
do $test$
begin
  begin
    perform pg_temp.bm_assert_final_evidence_storage_policies();
    raise exception 'Final audit accepted missing trusted-receipt predicate';
  exception when raise_exception then
    if sqlerrm = 'Final audit accepted missing trusted-receipt predicate' then raise; end if;
    if position('quarantine predicate' in sqlerrm)=0 then raise; end if;
  end;
end
$test$;
rollback;

begin;
alter policy bm_evidence_server_only_insert on storage.objects with check (true);
do $test$
begin
  begin
    perform pg_temp.bm_assert_final_evidence_storage_policies();
    raise exception 'Final audit accepted unrestricted signed-in Storage upload';
  exception when raise_exception then
    if sqlerrm = 'Final audit accepted unrestricted signed-in Storage upload' then raise; end if;
    if position('raw-upload lockdown' in sqlerrm)=0 then raise; end if;
  end;
end
$test$;
rollback;

begin;
drop policy bm_evidence_verified_receipt_read on storage.objects;
do $test$
begin
  begin
    perform pg_temp.bm_assert_final_evidence_storage_policies();
    raise exception 'Final audit accepted a removed receipt-gate policy';
  exception when raise_exception then
    if sqlerrm = 'Final audit accepted a removed receipt-gate policy' then raise; end if;
    if position('Missing or modified final Storage policy' in sqlerrm)=0 then raise; end if;
  end;
end
$test$;
rollback;

select pg_temp.bm_assert_final_evidence_storage_policies();
\echo PASS: final Storage auditor fails closed on extra, removed and weakened policies
