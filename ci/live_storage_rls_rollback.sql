-- Live Supabase RLS diagnostic (ROLLBACK-ONLY; never a migration).
-- Approved project: jgbogpunyzkoytrclqdl; require EMPTY test fixture tables.
-- This emulates PostgreSQL authenticated JWT claims. It does NOT establish
-- genuine Supabase Auth login or HTTP Storage API session behavior.
-- Re-run only under privileged audited operator access, after preflight.
BEGIN;
DO $guard$
BEGIN
 IF (SELECT count(*) FROM auth.users) <> 0
  OR (SELECT count(*) FROM public.bm_organizations) <> 0
  OR (SELECT count(*) FROM public.bm_memberships) <> 0
  OR (SELECT count(*) FROM public.bm_evidence_receipts) <> 0
  OR (SELECT count(*) FROM storage.objects WHERE bucket_id='bm-evidence') <> 0
 THEN RAISE EXCEPTION 'Refusing live synthetic probe: project is not empty'; END IF;
END $guard$;

INSERT INTO public.bm_organizations(id,slug,name) VALUES
 ('10000000-0000-4000-8000-000000000001','bm-rollback-probe-a','Synthetic A (ROLLBACK)'),
 ('10000000-0000-4000-8000-000000000002','bm-rollback-probe-b','Synthetic B (ROLLBACK)');
INSERT INTO public.bm_memberships(organization_id,user_id,member_role) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner'),
 ('10000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','contractor'),
 ('10000000-0000-4000-8000-000000000001','dddddddd-dddd-4ddd-8ddd-dddddddddddd','contractor'),
 ('10000000-0000-4000-8000-000000000002','cccccccc-cccc-4ccc-8ccc-cccccccccccc','owner');
-- Storage metadata ONLY; no real blob or signed URLs are created.
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
 ('bm-evidence','10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000081.pdf',NULL),
 ('bm-evidence','10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000082.pdf',NULL),
 ('bm-evidence','10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000083.pdf',NULL);
INSERT INTO public.bm_evidence_receipts
 (organization_id,object_path,content_sha256,byte_length,content_type,uploaded_by)
 VALUES
 ('10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000081.pdf',
  repeat('a',64),100,'application/pdf','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000083.pdf',
  repeat('b',64),100,'application/pdf','cccccccc-cccc-4ccc-8ccc-cccccccccccc');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $own$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='bm-evidence') <> 1
 THEN RAISE EXCEPTION 'Uploader contractor must see only own receipt-backed object'; END IF;
END $own$;
SET LOCAL request.jwt.claim.sub='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $other$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='bm-evidence') <> 0
 THEN RAISE EXCEPTION 'Other same-tenant contractor could see uploader object'; END IF;
END $other$;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $owner$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='bm-evidence') <> 2
 THEN RAISE EXCEPTION 'Organization A owner cannot review both A files'; END IF;
END $owner$;
SET LOCAL request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DO $foreign$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='bm-evidence') <> 1
 THEN RAISE EXCEPTION 'Organization B owner breached tenant isolation'; END IF;
END $foreign$;
SET LOCAL request.jwt.claim.sub='';
DO $anonymous$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='bm-evidence') <> 0
 THEN RAISE EXCEPTION 'Missing Auth identity could see evidence'; END IF;
END $anonymous$;

-- No direct user-JWT Storage INSERT can evade scanner/quota.
SET LOCAL request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $direct$ DECLARE accepted boolean := false; BEGIN
 BEGIN
  INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
   ('bm-evidence',
    '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000084.pdf',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  accepted := true;
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 IF accepted THEN RAISE EXCEPTION 'Authenticated user bypassed direct-INSERT lockdown'; END IF;
END $direct$;
RESET ROLE;
DELETE FROM public.bm_memberships
 WHERE user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $revoked$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='bm-evidence') <> 0
 THEN RAISE EXCEPTION 'Revoked contractor still has Storage visibility'; END IF;
END $revoked$;
RESET ROLE;

-- ALWAYS LAST before displaying result. Nothing above may persist.
ROLLBACK;
SELECT 'PASS live Supabase PostgreSQL RLS; transaction rolled back' AS result;
