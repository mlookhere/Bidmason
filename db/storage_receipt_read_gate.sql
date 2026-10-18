-- No client SELECT of bm-evidence before a trusted receipt is committed.
-- Owners/operators and object owners are NOT exempt from this quarantine.
-- Preserve all existing tenant, role, uploader and no-write boundaries.
-- Privileged service-role readback for scanning bypasses RLS as before.
create policy bm_evidence_verified_receipt_read
  on storage.objects as restrictive
  for select to public
  using (
    bucket_id <> 'bm-evidence'
    or exists (
      select 1 from public.bm_evidence_receipts r
      where r.organization_id::text = split_part(storage.objects.name, '/', 1)
        and r.object_path = storage.objects.name
    )
  );
