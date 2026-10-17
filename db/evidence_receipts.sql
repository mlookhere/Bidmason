-- Draft, isolated CI only. Apply AFTER db/schema.sql and BEFORE review inserts.
-- Trusted ingestion must hash and inspect the private Storage object's bytes
-- BEFORE issuing this receipt; clients are deliberately unable to insert one.
create table public.bm_evidence_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.bm_organizations(id),
  object_path text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_length integer not null check (byte_length between 1 and 15728640),
  content_type text not null check (
    content_type in ('application/pdf', 'image/png', 'image/jpeg')),
  received_at timestamptz not null default now(),
  unique (organization_id, object_path),
  constraint bm_evidence_receipt_path check (
    split_part(object_path, '/', 1) = organization_id::text
    and object_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg)$'
  )
);
create index bm_evidence_receipts_org_idx
  on public.bm_evidence_receipts(organization_id);

-- Composite FK prevents a same-org reviewer from citing an arbitrary string
-- or another tenant's existing Storage evidence receipt.
alter table public.bm_fact_reviews
  add constraint bm_review_evidence_same_tenant
  foreign key (organization_id, evidence_reference)
  references public.bm_evidence_receipts(organization_id, object_path);

alter table public.bm_evidence_receipts enable row level security;
revoke all on public.bm_evidence_receipts from public, anon, authenticated;
grant select on public.bm_evidence_receipts to authenticated;

create policy bm_receipt_member_read on public.bm_evidence_receipts
  for select to authenticated using (
    exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_evidence_receipts.organization_id
        and m.user_id = (select auth.uid()))
  );
