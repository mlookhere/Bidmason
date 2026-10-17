-- Draft Supabase Storage policies for BidMason evidence.
-- Run only after db/schema.sql on an authorized Supabase project whose
-- Storage schema is confirmed compatible. Not yet deployed.
-- Naming: <organization_uuid>/<object_uuid>.<pdf|png|jpg|jpeg>
-- Credential documents remain private; owner/operator or uploader can read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bm-evidence', 'bm-evidence', false, 15728640,
        array['application/pdf', 'image/png', 'image/jpeg']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy bm_evidence_member_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'bm-evidence'
  and owner_id = (select auth.uid()::text)
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg)$'
  and exists (
    select 1 from public.bm_memberships m
    where m.organization_id::text = split_part(storage.objects.name, '/', 1)
      and m.user_id = (select auth.uid())
  )
);

create policy bm_evidence_private_read on storage.objects
for select to authenticated
using (
  bucket_id = 'bm-evidence'
  and exists (
    select 1 from public.bm_memberships m
    where m.organization_id::text = split_part(storage.objects.name, '/', 1)
      and m.user_id = (select auth.uid())
      and (m.member_role in ('owner', 'operator')
           or storage.objects.owner_id = (select auth.uid()::text))
  )
);

-- Intentional: no UPDATE, DELETE, public bucket, or anonymous policies.
-- Replace/update/upload overwrites are denied. Evidence is append-only until
-- an independently audited administrative retention/deletion workflow exists.
