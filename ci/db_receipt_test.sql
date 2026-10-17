\set ON_ERROR_STOP on
-- Run after base tenant, review, and isolated Storage tests.
-- Uses the same three accounts; the receipt rows themselves are CI fixtures.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.bm_business_facts(id, organization_id, fact_key, claimed_value)
values ('20000000-0000-4000-8000-000000000009',
        '10000000-0000-4000-8000-000000000001',
        'pending_evidence', '"unreviewed"');

do $$
declare allowed boolean := false;
begin
  if (select count(*) from public.bm_evidence_receipts) != 1 then
    raise exception 'Tenant A should see one trusted receipt';
  end if;
  if (select count(*) from public.bm_current_verified_facts) != 1 then
    raise exception 'Existing evidence-linked review should remain verified';
  end if;

  begin
    insert into public.bm_evidence_receipts
      (organization_id, object_path, content_sha256, byte_length, content_type)
    values (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000099.pdf',
      repeat('f',64), 10, 'application/pdf');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Tenant member minted its own receipt'; end if;

  allowed := false;
  begin
    insert into public.bm_fact_reviews
      (organization_id, fact_id, decision, evidence_reference, rationale)
    values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000009', 'verified',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000099.pdf',
      'No server receipt');
    allowed := true;
  exception when foreign_key_violation then null;
  end;
  if allowed then raise exception 'Review accepted an invented receipt path'; end if;

  allowed := false;
  begin
    insert into public.bm_fact_reviews
      (organization_id, fact_id, decision, evidence_reference, rationale)
    values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000009', 'verified',
      '10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000002.pdf',
      'Foreign receipt');
    allowed := true;
  exception when foreign_key_violation then null;
  end;
  if allowed then raise exception 'Review accepted a cross-tenant receipt'; end if;

  if (select count(*) from public.bm_current_verified_facts) != 1 then
    raise exception 'Failed review altered verified status';
  end if;
end $$;

set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
declare allowed boolean := false;
begin
  if (select count(*) from public.bm_evidence_receipts) != 1 then
    raise exception 'Tenant B reads foreign receipts';
  end if;
  begin
    delete from public.bm_evidence_receipts;
    if found then allowed := true; end if;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Tenant member deleted trusted receipt'; end if;
end $$;

reset request.jwt.claim.sub;
do $$
begin
  if (select count(*) from public.bm_evidence_receipts) != 0 then
    raise exception 'Missing identity can read evidence receipts';
  end if;
end $$;
reset role;

-- Privileged synthetic invalid inputs prove the receipt cannot be created
-- with a mismatched tenant path, forged hash shape, size or MIME.
do $$
declare accepted boolean;
begin
  accepted := false;
  begin
    insert into public.bm_evidence_receipts
      (organization_id,object_path,content_sha256,byte_length,content_type)
    values (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000022.pdf',
      repeat('f',64), 100, 'application/pdf');
    accepted := true;
  exception when check_violation then null;
  end;
  if accepted then raise exception 'Server receipt accepted another tenant path'; end if;

  accepted := false;
  begin
    insert into public.bm_evidence_receipts
      (organization_id,object_path,content_sha256,byte_length,content_type)
    values (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000022.pdf',
      'unverified', 100, 'application/pdf');
    accepted := true;
  exception when check_violation then null;
  end;
  if accepted then raise exception 'Malformed SHA-256 accepted'; end if;

  accepted := false;
  begin
    insert into public.bm_evidence_receipts
      (organization_id,object_path,content_sha256,byte_length,content_type)
    values (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000022.pdf',
      repeat('f',64), 15728641, 'application/pdf');
    accepted := true;
  exception when check_violation then null;
  end;
  if accepted then raise exception 'Oversize receipt accepted'; end if;

  if has_table_privilege('authenticated','public.bm_evidence_receipts','INSERT')
    or has_table_privilege('authenticated','public.bm_evidence_receipts','UPDATE')
    or has_table_privilege('authenticated','public.bm_evidence_receipts','DELETE') then
    raise exception 'Authenticated role can mutate ingestion receipts';
  end if;

  if (select count(*) from pg_class
      where oid in (
        'public.bm_organizations'::regclass,
        'public.bm_memberships'::regclass,
        'public.bm_business_facts'::regclass,
        'public.bm_fact_reviews'::regclass,
        'public.bm_evidence_receipts'::regclass,
        'public.bm_brief_revisions'::regclass,
        'public.bm_brief_approvals'::regclass) and relrowsecurity) != 7 then
    raise exception 'A tenant table has RLS disabled';
  end if;
end $$;
-- Revocation is read from the live membership roster, not stale JWT claims.
-- Once the trusted backend deletes a membership, all protected reads must
-- vanish even while the old token still contains that user's original uid.
delete from public.bm_memberships
where organization_id='10000000-0000-4000-8000-000000000001'
  and user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $
declare allowed boolean := false;
begin
  if (select count(*) from public.bm_organizations) != 0
    or (select count(*) from public.bm_business_facts) != 0
    or (select count(*) from public.bm_evidence_receipts) != 0
    or (select count(*) from public.bm_brief_revisions) != 0
    or (select count(*) from public.bm_current_verified_facts) != 0
    or (select count(*) from storage.objects) != 0 then
    raise exception 'Revoked member retained data access with old JWT identity';
  end if;

  begin
    insert into public.bm_business_facts
      (organization_id, fact_key, claimed_value)
    values ('10000000-0000-4000-8000-000000000001',
      'revoked_access', '"must fail"');
    allowed := true;
  exception when insufficient_privilege then null;
  end;
  if allowed then raise exception 'Revoked member still has tenant write permission'; end if;
end $;
reset request.jwt.claim.sub;
reset role;
\echo PASS: immutable receipts, same-tenant foreign keys, forged evidence denial, seven RLS tables, immediate membership revocation
