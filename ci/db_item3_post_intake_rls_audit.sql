-- Real Item3 + Item4 same-database *post-intake* RLS audit.
-- Isolated CI only, after BOTH upstream Item3 and Item4 suites.
-- The two fixtures intentionally grant actor ccccc... two different
-- legitimate tenant memberships. Explicitly permit those two and NO others.
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $cross$
declare
 actual uuid[];
 expected uuid[]:=array[
  '10000000-0000-4000-8000-000000000002'::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
 ];
begin
 select array_agg(id order by id) into actual
 from public.bm_organizations;
 if actual is distinct from expected then
  raise exception 'Combined fixture cross-tenant organization visibility changed: %',actual;
 end if;
 if (select count(*) from public.bm_memberships) <> 2 then
  raise exception 'Own membership RLS did not reflect both legitimate memberships';
 end if;
 if (select count(*) from public.bm_business_facts) <> 0
   or (select count(*) from public.bm_fact_reviews) <> 0
   or (select count(*) from public.bm_brief_revisions) <> 0
   or (select count(*) from public.bm_brief_approvals) <> 0 then
  raise exception 'Cross-tenant Item3 fact or approval leaked after Item4 intake';
 end if;
 begin
  perform 1 from public.bm_intake_sources;
  raise exception 'Item4 private source read exposed to browser role';
 exception when insufficient_privilege then null; end;
end;
$cross$;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $owner$
declare
 actual uuid[];
begin
 select array_agg(id order by id) into actual from public.bm_organizations;
 if actual is distinct from array[
  '10000000-0000-4000-8000-000000000001'::uuid] then
  raise exception 'Item3 Tenant A owner sees another tenant after intake';
 end if;
 if (select count(*) from public.bm_business_facts) <> 1
   or (select count(*) from public.bm_brief_revisions) <> 3
   or (select count(*) from public.bm_current_approved_briefs) <> 0 then
  raise exception 'Item3 genuine owner view/invalidated brief changed after Item4';
 end if;
end;
$owner$;
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $contractor$
begin
 if (select count(*) from public.bm_organizations) <> 1
   or (select count(*) from public.bm_memberships) <> 1
   or (select count(*) from public.bm_current_approved_briefs) <> 0 then
  raise exception 'Item3 contractor cross-tenant or stale-approval disclosure';
 end if;
end;
$contractor$;
reset request.jwt.claim.sub;
do $nobody$
begin
 if (select count(*) from public.bm_organizations) <> 0
   or (select count(*) from public.bm_business_facts) <> 0
   or (select count(*) from public.bm_memberships) <> 0 then
  raise exception 'Null Auth identity can see tenant data';
 end if;
end;
$nobody$;
reset role;
select 'PASS: post-intake Item3 RLS, dual legitimate membership, private source and stale approvals';
