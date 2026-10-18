\\set ON_ERROR_STOP on
-- This runs AFTER every historical read/receipt test, against both the
-- reviewed SQL source and the replay of all managed migrations.
do $$
declare p record;
begin
  select * into p from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bm_evidence_verified_receipt_read';
  if p.policyname is null or p.cmd <> 'SELECT'
    or p.permissive <> 'RESTRICTIVE'
    or p.roles <> array['public']::name[]
    or position('bm-evidence' in p.qual)=0
    or position('bm_evidence_receipts' in p.qual)=0
    or position('object_path' in p.qual)=0 then
    raise exception 'Verified-receipt Storage quarantine boundary missing or modified';
  end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  -- The fixtures contain verified path 001 and server-owned verified 081.
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 2 then
    raise exception 'Owner sees unreceipted evidence or lost receipt-backed access';
  end if;
  if (select count(*) from storage.objects where name =
    '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000081.pdf') <> 1 then
    raise exception 'Owner lost server-committed evidence read';
  end if;
  if (select count(*) from storage.objects where name =
    '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000082.pdf') <> 0 then
    raise exception 'Owner read service-owned object before receipt commitment';
  end if;
end $$;
reset request.jwt.claim.sub;
reset role;

-- A service-owned existing object loses read access immediately if its
-- matching trusted receipt is absent. All fixture mutations roll back.
begin;
delete from public.bm_evidence_receipts
  where object_path =
    '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000081.pdf';
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  if (select count(*) from storage.objects where name =
    '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000081.pdf') <> 0 then
    raise exception 'Owner read an object after its receipt disappeared';
  end if;
end $$;
reset request.jwt.claim.sub;
reset role;
rollback;

-- An overly broad PERMISSIVE read policy cannot bypass the restrictive
-- quarantine gate. Neither owner nor contractor can see orphan objects.
begin;
create policy ci_shadow_unverified_read on storage.objects
  for select to authenticated using (true);
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 2 then
    raise exception 'Shadow policy bypassed receipt-gated Storage visibility';
  end if;
end $$;
set request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
begin
  if (select count(*) from storage.objects where bucket_id='bm-evidence') <> 0 then
    raise exception 'Other contractor accessed receipt-gated evidence';
  end if;
end $$;
reset request.jwt.claim.sub;
reset role;
rollback;

\\echo PASS: only receipt-backed evidence is visible to signed-in users; scanning-stage and orphan objects are quarantined
