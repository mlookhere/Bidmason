-- BidMason candidate managed Supabase migration: 20261018104109 bidmason_evidence_uploader_read_access
-- Additive receipt uploader attribution and narrowed read-only Storage policy.
-- Trusted uploader attribution for server-created evidence files.
-- The prior signed-in direct INSERT lockdown remains mandatory. Uploaded
-- objects may have NULL storage.objects.owner_id under service-key writes.
-- Only privileged receipt insertion records uploader identity from Auth.
alter table public.bm_evidence_receipts
  add column uploaded_by uuid;
create index bm_evidence_receipts_uploader_lookup_idx
  on public.bm_evidence_receipts(organization_id, uploaded_by, object_path)
  where uploaded_by is not null;

-- No new insert/update/delete grant to authenticated or anon. Legacy receipts
-- have NULL uploaded_by and do not gain new contractor read privileges.
-- Both permissive AND restrictive SELECT policies must agree: a contractor
-- needs a current same-tenant membership and a server-issued matching receipt.
alter policy bm_evidence_private_read on storage.objects
using (
  bucket_id = 'bm-evidence'
  and exists (
    select 1 from public.bm_memberships m
    where m.organization_id::text = split_part(storage.objects.name, '/', 1)
      and m.user_id = (select auth.uid())
      and (
        m.member_role in ('owner', 'operator')
        or storage.objects.owner_id = (select auth.uid()::text)
        or exists (
          select 1 from public.bm_evidence_receipts r
          where r.organization_id = m.organization_id
            and r.object_path = storage.objects.name
            and r.uploaded_by = (select auth.uid())
        )
      )
  )
);

alter policy bm_evidence_read_boundary on storage.objects
using (
  bucket_id <> 'bm-evidence'
  or (
    bucket_id = 'bm-evidence'
    and exists (
      select 1 from public.bm_memberships m
      where m.organization_id::text = split_part(storage.objects.name, '/', 1)
        and m.user_id = (select auth.uid())
        and (
          m.member_role in ('owner', 'operator')
          or storage.objects.owner_id = (select auth.uid()::text)
          or exists (
            select 1 from public.bm_evidence_receipts r
            where r.organization_id = m.organization_id
              and r.object_path = storage.objects.name
              and r.uploaded_by = (select auth.uid())
          )
        )
    )
  )
);
