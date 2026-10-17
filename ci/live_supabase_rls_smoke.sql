-- BidMason live, rollback-only RLS verification.
-- Run only against approved BidMason project jgbogpunyzkoytrclqdl.
-- This is a role simulation using the real managed auth.uid(), not a real Auth session.
-- NO customer data and NO permanent rows; transaction ends with ROLLBACK.
BEGIN;
INSERT INTO public.bm_organizations(id,slug,name) VALUES
 ('10000000-0000-4000-8000-000000000001','live-ci-tenant-a','Temporary tenant A'),
 ('10000000-0000-4000-8000-000000000002','live-ci-tenant-b','Temporary tenant B');
INSERT INTO public.bm_memberships(organization_id,user_id,member_role) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner'),
 ('10000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','contractor'),
 ('10000000-0000-4000-8000-000000000002','cccccccc-cccc-4ccc-8ccc-cccccccccccc','owner');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $bm$
BEGIN
 IF (SELECT count(*) FROM public.bm_organizations) <> 1 THEN
  RAISE EXCEPTION 'Live managed Supabase RLS exposed cross-tenant organization A';
 END IF;
 IF (SELECT count(*) FROM public.bm_memberships) <> 1 THEN
  RAISE EXCEPTION 'Live managed Supabase RLS exposed another membership';
 END IF;
END $bm$;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
DO $bm$
DECLARE permitted boolean := false;
BEGIN
 IF (SELECT count(*) FROM public.bm_organizations) <> 1 THEN
  RAISE EXCEPTION 'Live managed Supabase RLS exposed cross-tenant organization B';
 END IF;
 BEGIN
  INSERT INTO public.bm_business_facts(organization_id,fact_key,claimed_value)
    VALUES ('10000000-0000-4000-8000-000000000001','forbidden_claim','"bad"'::jsonb);
  permitted := true;
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
 END;
 IF permitted THEN RAISE EXCEPTION 'Cross-tenant insertion was allowed'; END IF;
END $bm$;
ROLLBACK;

-- Verify no temporary identity or synthetic data persisted.
SELECT jsonb_build_object(
  'organizations',(SELECT count(*) FROM public.bm_organizations),
  'memberships',(SELECT count(*) FROM public.bm_memberships),
  'facts',(SELECT count(*) FROM public.bm_business_facts)
) AS after_rollback;
