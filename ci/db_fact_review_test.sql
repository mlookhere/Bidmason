\set ON_ERROR_STOP on
-- Run only after ci/db_rls_test.sql on the same disposable PostgreSQL database.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
begin
  if (select count(*) from public.bm_current_verified_facts) != 0 then
    raise exception 'Unreviewed business claim was exposed as verified';
  end if;
end $$;

insert into public.bm_fact_reviews (
  organization_id, fact_id, decision, evidence_reference, rationale)
values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'verified', '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001.pdf',
  'Verified only for synthetic integration test');

do $$
declare allowed boolean;
begin
  if (select count(*) from public.bm_current_verified_facts) != 1 then
    raise exception 'Reviewed claim missing from verified view';
  end if;
  if (select count(*) from public.bm_fact_reviews
      where reviewed_by = (select auth.uid())
        and reviewed_at between now() - interval '5 minutes'
                           and now() + interval '5 minutes') != 1 then
    raise exception 'Database did not assign reviewer identity/timestamp';
  end if;

  -- Client must not override server-owned audit fields.
  allowed := false;
  begin
    insert into public.bm_business_facts(
      organization_id, fact_key, claimed_value, created_at)
    values ('10000000-0000-4000-8000-000000000001',
      'fake_timestamp', '"forged"', now() - interval '1 year');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Client forged fact created_at'; end if;

  allowed := false;
  begin
    insert into public.bm_fact_reviews(
      organization_id, fact_id, decision, evidence_reference, rationale, reviewed_at)
    values ('10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'verified', 'fake', 'fake', now() - interval '1 year');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Client forged fact reviewer timestamp'; end if;

  allowed := false;
  begin
    insert into public.bm_brief_approvals(
      organization_id, revision_id, approved_at)
    values ('10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003', now() - interval '1 year');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Client forged approval timestamp'; end if;

  allowed := false;
  begin
    insert into public.bm_fact_reviews(
      organization_id, fact_id, decision, evidence_reference, rationale)
    values ('10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'verified', '   ', 'some rationale');
    allowed := true;
  exception when check_violation then null;
  end;
  if allowed then raise exception 'Blank evidence accepted as review'; end if;
end $$;

-- Contractor in same organization can submit an unverified fact but cannot
-- authenticate it as verified, nor overwrite existing verified evidence.
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into public.bm_business_facts(id, organization_id, fact_key, claimed_value)
values ('20000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000001', 'contractor_claim', '"unverified"');
do $$
declare allowed boolean := false;
begin
  begin
    insert into public.bm_fact_reviews(
      organization_id, fact_id, decision, evidence_reference, rationale)
    values ('10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000002',
            'verified', 'fake', 'contractor self-approval');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Contractor verified its own claim'; end if;
  if (select count(*) from public.bm_current_verified_facts) != 1 then
    raise exception 'Unreviewed contractor claim appeared verified';
  end if;
end $$;

-- Tenant B can see neither fact review nor verified view of tenant A.
set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
declare allowed boolean := false;
begin
  if (select count(*) from public.bm_fact_reviews) != 0
    or (select count(*) from public.bm_current_verified_facts) != 0 then
    raise exception 'Cross-tenant evidence disclosure';
  end if;
  begin
    insert into public.bm_fact_reviews(
      organization_id, fact_id, decision, evidence_reference, rationale)
    values ('10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'verified', 'fake', 'cross-tenant forged review');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Cross-tenant review permitted'; end if;
end $$;

reset request.jwt.claim.sub;
do $$
begin
  if (select count(*) from public.bm_current_verified_facts) != 0 then
    raise exception 'Anonymous user identity can read verified facts';
  end if;
end $$;
reset role;

-- DDL/grant assertions directly exercise least-privilege: not merely a
-- successful denial from a coincidental unique index.
do $$
begin
  if has_column_privilege('authenticated','public.bm_fact_reviews','reviewed_at','INSERT')
     or has_column_privilege('authenticated','public.bm_brief_approvals','approved_at','INSERT')
     or has_column_privilege('authenticated','public.bm_business_facts','created_at','INSERT')
     or has_column_privilege('authenticated','public.bm_brief_revisions','submitted_by','INSERT')
     or has_table_privilege('authenticated','public.bm_fact_reviews','UPDATE')
     or has_table_privilege('authenticated','public.bm_fact_reviews','DELETE') then
    raise exception 'Client has privileged audit or mutating access';
  end if;
end $$;
\echo PASS: reviewed-fact RLS, independent operator review, tenant isolation, blocked timestamp forgery, verified-only view
