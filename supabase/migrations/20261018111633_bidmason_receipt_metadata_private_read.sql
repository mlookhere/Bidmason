-- BidMason managed migration: 20261018111633 bidmason_receipt_metadata_private_read
-- Additive, restrictive signed-in receipt metadata visibility boundary.
-- Prevent same-tenant contractors from enumerating another uploader's
-- private evidence path, digest, size or MIME through PostgREST.
-- This is separate from the Storage object SELECT policies and preserves
-- the server-only receipt INSERT / immutable metadata protections.
--
-- Deny by default when uploaded_by is NULL (legacy receipts). Tenant
-- owners/operators retain evidence-review metadata within their tenant.
-- The restrictive SELECT boundary prevents any later permissive policy
-- from restoring broad contractor metadata access.
alter policy bm_receipt_member_read on public.bm_evidence_receipts
  using (
    exists (
      select 1 from public.bm_memberships m
      where m.organization_id = bm_evidence_receipts.organization_id
        and m.user_id = (select auth.uid())
        and (
          m.member_role in ('owner', 'operator')
          or bm_evidence_receipts.uploaded_by = (select auth.uid())
        )
    )
  );

create policy bm_receipt_member_boundary
  on public.bm_evidence_receipts as restrictive
  for select to authenticated
  using (
    exists (
      select 1 from public.bm_memberships m
      where m.organization_id = bm_evidence_receipts.organization_id
        and m.user_id = (select auth.uid())
        and (
          m.member_role in ('owner', 'operator')
          or bm_evidence_receipts.uploaded_by = (select auth.uid())
        )
    )
  );
