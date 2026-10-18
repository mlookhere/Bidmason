\set ON_ERROR_STOP on
-- Execute AFTER prior historical RLS/revocation and seventh migration tests,
-- both on source schema and on the exact managed migration replay.
do $$
declare p record;
begin
 if (select count(*) from pg_policies where schemaname='public'
     and tablename='bm_evidence_receipts'
     and policyname in ('bm_receipt_member_read', 'bm_receipt_member_boundary')) <> 2
 then raise exception 'Missing both receipt metadata SELECT boundary policies'; end if;
 for p in select * from pg_policies where schemaname='public'
    and tablename='bm_evidence_receipts'
    and policyname in ('bm_receipt_member_read', 'bm_receipt_member_boundary') loop
    if p.cmd <> 'SELECT' or p.roles <> array['authenticated']::name[]
       or p.qual not like '%uploaded_by%'
       or p.qual not like '%bm_memberships%'
       or p.qual not like '%member_role%'
    then raise exception 'Receipt metadata policy missing strict uploader/membership check: %',p.policyname;end if;
    if p.policyname='bm_receipt_member_boundary' and p.permissive<>'RESTRICTIVE'
    then raise exception 'Receipt metadata boundary must be restrictive';end if;
 end loop;
 if has_table_privilege('authenticated','public.bm_evidence_receipts','INSERT')
    or has_table_privilege('authenticated','public.bm_evidence_receipts','UPDATE')
    or has_table_privilege('authenticated','public.bm_evidence_receipts','DELETE')
 then raise exception 'Untrusted clients can mutate immutable receipts'; end if;
end $$;

-- Prior tests revoke B and create D within organization A.
-- Restore B as a synthetic trusted uploader for metadata visibility tests.
insert into public.bm_memberships (organization_id,user_id,member_role)
 values ('10000000-0000-4000-8000-000000000001',
         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','contractor');

set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
 if (select count(*) from public.bm_evidence_receipts) <> 1
 then raise exception 'Uploader B must see own verified receipt, not legacy/other receipts';end if;
 if (select count(*) from public.bm_evidence_receipts
     where uploaded_by='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1
 then raise exception 'Uploader B lost exact authenticated receipt';end if;
end $$;
set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$ begin
 if (select count(*) from public.bm_evidence_receipts) <> 0
 then raise exception 'Same-tenant contractor D saw B evidence hash/path metadata';end if;
end $$;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
 if (select count(*) from public.bm_evidence_receipts) <> 2
 then raise exception 'Tenant A owner cannot review own legacy and server-issued receipts';end if;
end $$;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ begin
 if (select count(*) from public.bm_evidence_receipts) <> 1
 then raise exception 'Tenant B owner cannot review own receipt, or sees tenant A';end if;
end $$;
reset request.jwt.claim.sub;
do $$ begin
 if (select count(*) from public.bm_evidence_receipts) <> 0
 then raise exception 'Missing signed-in identity accessed evidence metadata';end if;
end $$;
reset role;

-- A later accidental broad PERMISSIVE read must still fail against
-- the independent RESTRICTIVE boundary.
begin;
create policy ci_shadow_permissive_receipt_metadata
  on public.bm_evidence_receipts for select to authenticated using (true);
set role authenticated;
set request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$ begin
 if (select count(*) from public.bm_evidence_receipts) <> 0
 then raise exception 'Permissive shadow leaked uploader metadata to D';end if;
end $$;
set request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ begin
 if (select count(*) from public.bm_evidence_receipts) <> 1
 then raise exception 'Permissive shadow leaked cross-tenant receipt metadata';end if;
end $$;
reset request.jwt.claim.sub;
reset role;
rollback;

-- Immediate revocation must deny receipt metadata even with the old user ID.
delete from public.bm_memberships where
 organization_id='10000000-0000-4000-8000-000000000001'
 and user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set role authenticated;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
 if (select count(*) from public.bm_evidence_receipts) <> 0
 then raise exception 'Revoked B still sees evidence receipt metadata';end if;
end $$;
reset request.jwt.claim.sub;
reset role;
\echo PASS: immutable receipt metadata is private to verified uploader or tenant reviewer, despite permissive shadows and revocation
