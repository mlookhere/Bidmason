-- Isolated CI only. Item 3 must come from the pinned genuine
-- work/4-tenant-rls commit, not the minimal Item4 tenant stub.
do $compat$
declare
 table_name text;
begin
 for table_name in select unnest(array[
  'bm_business_facts','bm_fact_reviews','bm_brief_revisions',
  'bm_brief_approvals','bm_organizations','bm_memberships'])
 loop
  if to_regclass('public.'||table_name) is null then
    raise exception 'Actual Item3 table % missing',table_name;
  end if;
  if not (select relrowsecurity from pg_class
    where oid=to_regclass('public.'||table_name)) then
    raise exception 'Item3 RLS disabled on %',table_name;
  end if;
 end loop;
 if not exists (select 1 from pg_policies
    where schemaname='public'
      and tablename='bm_memberships' and policyname='bm_membership_self')
 or not exists (select 1 from pg_policies
    where schemaname='public'
      and tablename='bm_organizations'
      and policyname='bm_organization_member_read')
 or not exists (select 1 from pg_policies
    where schemaname='public'
      and tablename='bm_business_facts'
      and policyname='bm_fact_member_read') then
   raise exception 'Item3 authoritative membership RLS policies were altered';
 end if;
 if not (select relforcerowsecurity from pg_class
    where oid='public.bm_intake_sources'::regclass)
 or not (select relforcerowsecurity from pg_class
    where oid='public.bm_typed_note_requests'::regclass) then
   raise exception 'Item4 tenant-bound intake lacks FORCE RLS';
 end if;
 if has_table_privilege('authenticated','public.bm_memberships','INSERT')
 or has_table_privilege('authenticated','public.bm_memberships','UPDATE')
 or has_table_privilege('authenticated','public.bm_memberships','DELETE')
 or has_table_privilege('authenticated','public.bm_intake_sources','SELECT')
 or has_table_privilege('authenticated','public.bm_intake_sources','INSERT')
 or has_table_privilege('anon','public.bm_intake_sources','SELECT')
 or has_schema_privilege('authenticated','bm_intake_private','USAGE') then
  raise exception 'Combined Item3/4 permits direct tenant self-promotion or private intake';
 end if;
 -- The actual cross-tenant intake CAS, duplicate/replay and immutability
 -- proof is executed by ci/db_intake_test.sql in the same real schema.
end;
$compat$;
select 'PASS: real pinned Item3 tenant RLS plus Item4 source contract';
