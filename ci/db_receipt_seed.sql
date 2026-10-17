-- Privileged synthetic ingestion fixtures. CI does NOT store real file bytes.
-- These server-only rows exercise path/tenant linkage, not blob authenticity.
insert into public.bm_evidence_receipts
  (organization_id, object_path, content_sha256, byte_length, content_type)
values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001.pdf', repeat('a',64), 2048, 'application/pdf'),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000002.pdf', repeat('b',64), 1536, 'application/pdf');
