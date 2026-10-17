\set ON_ERROR_STOP on
-- Runs as the isolated PostgreSQL service superuser; real backend provisioning
-- creates organizations/memberships. Client roles never get this privilege.
insert into public.bm_organizations(id, slug, name) values
 ('10000000-0000-4000-8000-000000000001','demo-a','Tenant A'),
 ('10000000-0000-4000-8000-000000000002','demo-b','Tenant B');

insert into public.bm_memberships(organization_id, user_id, member_role) values
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner'),
 ('10000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','contractor'),
 ('10000000-0000-4000-8000-000000000002','cccccccc-cccc-4ccc-8ccc-cccccccccccc','owner');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
begin
 if (select count(*) from public.bm_organizations) != 1 then
   raise exception 'Tenant A should see exactly one organization';
 end if;
 if (select count(*) from public.bm_memberships) != 1 then
   raise exception 'Tenant A can read another user membership';
 end if;
end $$;

insert into public.bm_business_facts(
 id, organization_id, fact_key, claimed_value)
values ('20000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001', 'service_area', '"San Diego"');

insert into public.bm_brief_revisions(
 id, organization_id, revision, document, content_sha256)
values ('30000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001', 1, '{"status":"draft"}',
  encode(sha256(convert_to('{"status":"draft"}'::jsonb::text, 'UTF8')), 'hex'));

insert into public.bm_brief_approvals(
 organization_id, revision_id) values
 ('10000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001');

do $$
declare allowed boolean := false;
begin
 if (select count(*) from public.bm_current_approved_briefs) != 1 then
    raise exception 'Current revision should be approved';
 end if;
 begin
   insert into public.bm_business_facts(organization_id, fact_key, claimed_value)
     values ('10000000-0000-4000-8000-000000000002', 'secret', '"leak"');
   allowed := true;
 exception when insufficient_privilege or check_violation or foreign_key_violation then null;
 end;
 if allowed then raise exception 'Cross-tenant fact write was allowed'; end if;

 allowed := false;
 begin
   insert into public.bm_business_facts(organization_id, fact_key, claimed_value,
       verification_state, reviewed_by, reviewed_at)
     values ('10000000-0000-4000-8000-000000000001', 'license', '"verified"',
       'verified', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now());
   allowed := true;
 exception when insufficient_privilege or check_violation then null;
 end;
 if allowed then raise exception 'Client self-verified a credential'; end if;

 allowed := false;
 begin
   update public.bm_memberships set member_role='owner'
     where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
   allowed := true;
 exception when insufficient_privilege then null;
 end;
 if allowed then raise exception 'Client was allowed to modify membership'; end if;
end $$;

insert into public.bm_brief_revisions(
 id, organization_id, revision, document, content_sha256)
values ('30000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000001', 2, '{"status":"changed"}',
  encode(sha256(convert_to('{"status":"changed"}'::jsonb::text, 'UTF8')), 'hex'));

do $$
declare allowed boolean := false;
begin
 if (select count(*) from public.bm_current_approved_briefs) != 0 then
   raise exception 'New revision failed to invalidate old approval';
 end if;
 begin
   insert into public.bm_brief_approvals(organization_id, revision_id)
     values ('10000000-0000-4000-8000-000000000001',
     '30000000-0000-4000-8000-000000000001');
   allowed := true;
 exception when unique_violation or insufficient_privilege then null;
 end;
 if allowed then raise exception 'Stale revision approval accepted'; end if;
end $$;


-- A missing or forged hash must not reach the review queue.
do $$
declare allowed boolean := false;
begin
 begin
   insert into public.bm_brief_revisions(
     organization_id, revision, document, content_sha256)
   values ('10000000-0000-4000-8000-000000000001', 3,
           '{"status":"tampered"}', repeat('f',64));
   allowed := true;
 exception when check_violation then null;
 end;
 if allowed then raise exception 'Forged content digest was accepted'; end if;
end $$;

-- A revision that was never approved becomes stale once newer content arrives.
-- This checks the actual latest-revision policy, not merely a uniqueness failure.
insert into public.bm_brief_revisions(
 id, organization_id, revision, document, content_sha256)
values ('30000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000001', 3, '{"status":"latest"}',
 encode(sha256(convert_to('{"status":"latest"}'::jsonb::text,'UTF8')), 'hex'));
do $$
declare allowed boolean := false;
begin
 begin
  insert into public.bm_brief_approvals(organization_id, revision_id)
   values ('10000000-0000-4000-8000-000000000001',
           '30000000-0000-4000-8000-000000000002');
  allowed := true;
 exception when insufficient_privilege then null;
 end;
 if allowed then raise exception 'Approved a stale, previously unapproved revision'; end if;
end $$;

set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare allowed boolean := false;
begin
 if (select count(*) from public.bm_organizations) != 1 then
   raise exception 'Contractor cannot read own organization';
 end if;
 if (select count(*) from public.bm_current_approved_briefs) != 0 then
   raise exception 'Contractor sees stale approval';
 end if;
 begin
   insert into public.bm_brief_approvals(organization_id, revision_id)
     values ('10000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000002');
   allowed := true;
 exception when insufficient_privilege then null;
 end;
 if allowed then raise exception 'Contractor self-approved brief'; end if;
end $$;

set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
declare allowed boolean := false;
begin
 if (select count(*) from public.bm_organizations) != 1 then
    raise exception 'Tenant B can read Tenant A organization';
 end if;
 if (select count(*) from public.bm_business_facts) != 0 then
    raise exception 'Tenant B can read Tenant A facts';
 end if;
 if (select count(*) from public.bm_brief_revisions) != 0 then
    raise exception 'Tenant B can read Tenant A revisions';
 end if;
 if (select count(*) from public.bm_brief_approvals) != 0 then
    raise exception 'Tenant B can read Tenant A approvals';
 end if;
 begin
   insert into public.bm_brief_approvals(organization_id, revision_id)
     values ('10000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000002');
   allowed := true;
 exception when insufficient_privilege or foreign_key_violation then null;
 end;
 if allowed then raise exception 'Cross-tenant approval permitted'; end if;
end $$;

reset request.jwt.claim.sub;
do $$
begin
 if (select count(*) from public.bm_organizations) != 0 then
   raise exception 'Unauthenticated identity can read tenant records';
 end if;
end $$;
reset role;
-- Schema assertions: every public base table has RLS, and approval view
-- executes as the calling identity (not the owner).
do $$
begin
 if (select count(*) from pg_class
     where oid in ('public.bm_organizations'::regclass,
                   'public.bm_memberships'::regclass,
                   'public.bm_business_facts'::regclass,
                   'public.bm_fact_reviews'::regclass,
                   'public.bm_brief_revisions'::regclass,
                   'public.bm_brief_approvals'::regclass)
       and relrowsecurity) != 6 then
    raise exception 'A tenant table has RLS disabled';
 end if;
 if (select reloptions @> array['security_invoker=true']::text[]
     from pg_class where oid='public.bm_current_approved_briefs'::regclass) is not true then
    raise exception 'Approval view must be security_invoker';
 end if;
 if (select reloptions @> array['security_invoker=true']::text[]
     from pg_class where oid='public.bm_current_verified_facts'::regclass) is not true then
    raise exception 'Fact-review view must be security_invoker';
 end if;
end $$;
\echo PASS: two-tenant read/write isolation, unverified evidence, membership privilege, stale approval invalidation, schema RLS
