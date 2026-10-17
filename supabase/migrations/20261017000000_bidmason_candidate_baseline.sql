-- BIDMASON CANDIDATE ONLY -- NEVER APPLY TO AN UNAUTHORIZED PROJECT.
-- Needs a dedicated Supabase project, Storage-schema/DDL compatibility review,
-- migration-owner approval, and live tenant tests before production use.
-- Do not package CI-only auth/Storage stubs or synthetic fixtures.
begin;

-- BEGIN AUTHORITATIVE SOURCE db/schema.sql
-- BidMason tenant model draft: evaluated only against isolated PostgreSQL CI.
-- Not a deployed Supabase migration. No unreviewed business claim is publishable.
--
-- The organizations and membership roster are provisioned only by a trusted
-- backend using server-side authorization. No client grant allows self-promotion.

create table public.bm_organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 1 and 160),
  created_at timestamptz not null default now()
);

create table public.bm_memberships (
  organization_id uuid not null references public.bm_organizations(id),
  user_id uuid not null,
  member_role text not null check (member_role in ('owner', 'operator', 'contractor')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index bm_memberships_user_org_idx on public.bm_memberships(user_id, organization_id);

create table public.bm_business_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.bm_organizations(id),
  fact_key text not null check (length(trim(fact_key)) between 1 and 100),
  claimed_value jsonb not null,
  evidence_reference text,
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'verified')),
  created_by uuid not null default auth.uid(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint bm_fact_review_consistency check (
    (verification_state = 'unverified' and reviewed_by is null and reviewed_at is null)
    or (verification_state = 'verified' and reviewed_by is not null and reviewed_at is not null)
  )
);

create index bm_business_facts_org_idx on public.bm_business_facts(organization_id);

-- Independent, immutable operator review. A submitted fact is never sufficient
-- to make a claim publishable; the evidence path needs later Storage validation.
create table public.bm_fact_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  fact_id uuid not null,
  decision text not null check (decision in ('verified', 'rejected')),
  evidence_reference text not null check (length(trim(evidence_reference)) between 1 and 1024),
  rationale text not null check (length(trim(rationale)) between 1 and 4000),
  reviewed_by uuid not null default auth.uid(),
  reviewed_at timestamptz not null default now(),
  unique (organization_id, fact_id),
  foreign key (organization_id, fact_id) references public.bm_business_facts(organization_id, id)
);
create index bm_fact_reviews_org_idx on public.bm_fact_reviews(organization_id);

create table public.bm_brief_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.bm_organizations(id),
  revision integer not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint bm_revision_digest_matches_document check (
    content_sha256 = encode(sha256(convert_to(document::text, 'UTF8')), 'hex')
  ),
  submitted_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, revision)
);

create index bm_brief_revisions_org_revision_idx
  on public.bm_brief_revisions(organization_id, revision desc);

create table public.bm_brief_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  revision_id uuid not null,
  approved_by uuid not null default auth.uid(),
  approved_at timestamptz not null default now(),
  unique (organization_id, revision_id),
  foreign key (organization_id, revision_id)
    references public.bm_brief_revisions(organization_id, id)
);

create index bm_brief_approvals_org_idx on public.bm_brief_approvals(organization_id);

alter table public.bm_organizations enable row level security;
alter table public.bm_memberships enable row level security;
alter table public.bm_business_facts enable row level security;
alter table public.bm_fact_reviews enable row level security;
alter table public.bm_brief_revisions enable row level security;
alter table public.bm_brief_approvals enable row level security;

revoke all on public.bm_organizations, public.bm_memberships,
  public.bm_business_facts, public.bm_fact_reviews,
  public.bm_brief_revisions, public.bm_brief_approvals
  from public, anon, authenticated;

grant select on public.bm_organizations, public.bm_memberships,
  public.bm_business_facts, public.bm_fact_reviews,
  public.bm_brief_revisions, public.bm_brief_approvals
  to authenticated;

-- Supplying review identity, submitted-by identity or an audit timestamp
-- is denied by column privileges, even for legitimate tenant members.
grant insert (id, organization_id, fact_key, claimed_value, evidence_reference)
  on public.bm_business_facts to authenticated;
grant insert (organization_id, fact_id, decision, evidence_reference, rationale)
  on public.bm_fact_reviews to authenticated;
grant insert (id, organization_id, revision, document, content_sha256)
  on public.bm_brief_revisions to authenticated;
grant insert (organization_id, revision_id)
  on public.bm_brief_approvals to authenticated;

-- Membership rows can be read only by the individual user. Provisioning is
-- intentionally server-only; client users cannot invite, promote or remove.
create policy bm_membership_self on public.bm_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy bm_organization_member_read on public.bm_organizations
  for select to authenticated using (
    exists (select 1 from public.bm_memberships m
      where m.organization_id = id and m.user_id = (select auth.uid()))
  );

create policy bm_fact_member_read on public.bm_business_facts
  for select to authenticated using (
    exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_business_facts.organization_id
        and m.user_id = (select auth.uid()))
  );

-- Contractor submissions are immutable, unverified evidence, never
-- immediately published "verified facts" merely because a user asserted them.
create policy bm_fact_unverified_submit on public.bm_business_facts
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and verification_state = 'unverified'
    and reviewed_by is null and reviewed_at is null
    and exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_business_facts.organization_id
        and m.user_id = (select auth.uid()))
  );

create policy bm_review_member_read on public.bm_fact_reviews
  for select to authenticated using (
    exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_fact_reviews.organization_id
        and m.user_id = (select auth.uid()))
  );

create policy bm_review_operator_submit on public.bm_fact_reviews
  for insert to authenticated with check (
    reviewed_by = (select auth.uid())
    and exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_fact_reviews.organization_id
        and m.user_id = (select auth.uid())
        and m.member_role in ('owner', 'operator'))
  );

create view public.bm_current_verified_facts
  with (security_invoker = true)
as
  select f.organization_id, f.id as fact_id, f.fact_key, f.claimed_value,
         r.evidence_reference, r.rationale, r.reviewed_by, r.reviewed_at
  from public.bm_business_facts f
  join public.bm_fact_reviews r
    on r.organization_id = f.organization_id and r.fact_id = f.id
  where r.decision = 'verified';

revoke all on public.bm_current_verified_facts from public, anon, authenticated;
grant select on public.bm_current_verified_facts to authenticated;

create policy bm_revision_member_read on public.bm_brief_revisions
  for select to authenticated using (
    exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_brief_revisions.organization_id
        and m.user_id = (select auth.uid()))
  );

create policy bm_revision_member_submit on public.bm_brief_revisions
  for insert to authenticated with check (
    submitted_by = (select auth.uid())
    and exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_brief_revisions.organization_id
        and m.user_id = (select auth.uid()))
  );

create policy bm_approval_member_read on public.bm_brief_approvals
  for select to authenticated using (
    exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_brief_approvals.organization_id
        and m.user_id = (select auth.uid()))
  );

create policy bm_approval_operator_submit on public.bm_brief_approvals
  for insert to authenticated with check (
    approved_by = (select auth.uid())
    and exists (select 1 from public.bm_memberships m
      where m.organization_id = bm_brief_approvals.organization_id
        and m.user_id = (select auth.uid())
        and m.member_role in ('owner', 'operator'))
    and exists (select 1 from public.bm_brief_revisions r
      where r.organization_id = bm_brief_approvals.organization_id
        and r.id = revision_id
        and r.revision = (
          select max(latest.revision) from public.bm_brief_revisions latest
          where latest.organization_id = bm_brief_approvals.organization_id
        ))
  );

-- Any newer revision automatically invalidates the former approval *for
-- current use*, retaining the historic approval as audit evidence.
create view public.bm_current_approved_briefs
  with (security_invoker = true)
as
  select b.organization_id, b.id as revision_id, b.revision, b.document,
         b.content_sha256, a.approved_by, a.approved_at
  from public.bm_brief_revisions b
  join public.bm_brief_approvals a
    on a.organization_id = b.organization_id and a.revision_id = b.id
  where b.revision = (
    select max(latest.revision)
    from public.bm_brief_revisions latest
    where latest.organization_id = b.organization_id
  );

revoke all on public.bm_current_approved_briefs from public, anon, authenticated;
grant select on public.bm_current_approved_briefs to authenticated;
-- END AUTHORITATIVE SOURCE db/schema.sql

-- BEGIN AUTHORITATIVE SOURCE db/evidence_receipts.sql
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
-- END AUTHORITATIVE SOURCE db/evidence_receipts.sql

-- BEGIN AUTHORITATIVE SOURCE db/storage_policies.sql
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

create policy bm_evidence_upload_boundary on storage.objects
as restrictive
for insert to public
with check (bucket_id <> 'bm-evidence' or (
  bucket_id = 'bm-evidence'
  and owner_id = (select auth.uid()::text)
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg)$'
  and exists (
    select 1 from public.bm_memberships m
    where m.organization_id::text = split_part(storage.objects.name, '/', 1)
      and m.user_id = (select auth.uid())
  )
));


create policy bm_evidence_read_boundary on storage.objects
as restrictive
for select to public
using (bucket_id <> 'bm-evidence' or (
  bucket_id = 'bm-evidence'
  and exists (
    select 1 from public.bm_memberships m
    where m.organization_id::text = split_part(storage.objects.name, '/', 1)
      and m.user_id = (select auth.uid())
      and (m.member_role in ('owner', 'operator')
           or storage.objects.owner_id = (select auth.uid()::text))
  )
));


-- Deny even if an unrelated permissive policy later adds UPDATE/DELETE.
create policy bm_evidence_block_update on storage.objects as restrictive
for update to public using (bucket_id <> 'bm-evidence')
with check (bucket_id <> 'bm-evidence');
create policy bm_evidence_block_delete on storage.objects as restrictive
for delete to public using (bucket_id <> 'bm-evidence');

-- No BidMason permissive UPDATE/DELETE or anonymous grants exist.
-- Defense-in-depth restrictive boundaries AND with all permissive policies.
-- Replace/update/upload overwrites are denied. Evidence is append-only until
-- an independently audited administrative retention/deletion workflow exists.
-- END AUTHORITATIVE SOURCE db/storage_policies.sql

-- BEGIN AUTHORITATIVE SOURCE db/storage_policy_audit.sql
-- Preflight audit of the *effective policy set*, not just BidMason's
-- six controlled policy names. Run in a separate psql session on a candidate database.
-- Creates a session-local function only; does not alter live Storage policies.
-- Conservative by design: ANY other storage.objects policy requires review,
-- even when it targets a different bucket. PostgreSQL ORs permissive policies.
create or replace function pg_temp.bm_audit_evidence_storage_policies()
returns void language plpgsql as $bm_audit$
declare
  conflicting_policies text;
  upload record;
  reader record;
  restrictive_read record;
  restrictive_upload record;
  forbidden_update record;
  forbidden_delete record;
begin
  if (select public from storage.buckets where id = 'bm-evidence')
      is distinct from false then
    raise exception 'bm-evidence bucket must exist and be private';
  end if;

  if (select file_size_limit from storage.buckets where id = 'bm-evidence')
      is distinct from 15728640 then
    raise exception 'bm-evidence size limit drifted';
  end if;

  if (select allowed_mime_types @> array[
      'application/pdf','image/png','image/jpeg']::text[]
      from storage.buckets where id = 'bm-evidence') is distinct from true then
    raise exception 'bm-evidence MIME allowlist is incomplete';
  end if;

  if (select relrowsecurity
      from pg_class where oid = 'storage.objects'::regclass) is distinct from true then
    raise exception 'storage.objects RLS is disabled';
  end if;

  -- Other permissive OR-composed policies could grant the bm-evidence bucket
  -- access even when both of our known policies are restrictive enough.
  select string_agg(policyname, ', ' order by policyname)
    into conflicting_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname not in (
      'bm_evidence_member_upload', 'bm_evidence_private_read',
      'bm_evidence_upload_boundary', 'bm_evidence_read_boundary',
      'bm_evidence_block_update', 'bm_evidence_block_delete');

  if conflicting_policies is not null then
    raise exception 'Unreviewed storage.objects policies: %', conflicting_policies;
  end if;

  select * into upload from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'bm_evidence_member_upload';
  select * into reader from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'bm_evidence_private_read';
  select * into restrictive_upload from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'bm_evidence_upload_boundary';
  select * into restrictive_read from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'bm_evidence_read_boundary';
  select * into forbidden_update from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'bm_evidence_block_update';
  select * into forbidden_delete from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'bm_evidence_block_delete';

  if not found or upload.policyname is null then
    raise exception 'Missing BidMason evidence policies';
  end if;

  if upload.policyname is null or reader.policyname is null
     or restrictive_upload.policyname is null or restrictive_read.policyname is null
     or forbidden_update.policyname is null or forbidden_delete.policyname is null
     or upload.cmd != 'INSERT' or reader.cmd != 'SELECT'
     or upload.permissive != 'PERMISSIVE' or reader.permissive != 'PERMISSIVE'
     or upload.roles != array['authenticated']::name[]
     or reader.roles != array['authenticated']::name[]
     or restrictive_upload.cmd != 'INSERT' or restrictive_read.cmd != 'SELECT'
     or restrictive_upload.permissive != 'RESTRICTIVE'
     or restrictive_read.permissive != 'RESTRICTIVE'
     or restrictive_upload.roles != array['public']::name[]
     or restrictive_read.roles != array['public']::name[]
     or forbidden_update.cmd != 'UPDATE' or forbidden_delete.cmd != 'DELETE'
     or forbidden_update.permissive != 'RESTRICTIVE'
     or forbidden_delete.permissive != 'RESTRICTIVE'
     or forbidden_update.roles != array['public']::name[]
     or forbidden_delete.roles != array['public']::name[]
     or position('bm-evidence' in forbidden_update.qual) = 0
     or position('<>' in forbidden_update.qual) = 0
     or position('bm-evidence' in forbidden_delete.qual) = 0
     or position('<>' in forbidden_delete.qual) = 0
     or position('bm-evidence' in forbidden_update.with_check) = 0
     or position('<>' in forbidden_update.with_check) = 0
     or position('bm-evidence' in restrictive_upload.with_check) = 0
     or position('bm_memberships' in restrictive_upload.with_check) = 0
     or position('auth.uid' in restrictive_upload.with_check) = 0
     or position('owner_id' in restrictive_upload.with_check) = 0
     or position('bm-evidence' in restrictive_read.qual) = 0
     or position('bm_memberships' in restrictive_read.qual) = 0
     or position('auth.uid' in restrictive_read.qual) = 0
     or position('owner_id' in restrictive_read.qual) = 0 then
    raise exception 'BidMason Storage policy role/command drift';
  end if;

  -- Basic definitions are checked in addition to runtime isolation tests.
  -- These are NOT a proof that arbitrary SQL expressions are safe; perform
  -- true Storage Auth integration tests before production use.
  if upload.with_check is null
     or position('bm-evidence' in upload.with_check) = 0
     or position('bm_memberships' in upload.with_check) = 0
     or position('auth.uid' in upload.with_check) = 0
     or position('owner_id' in upload.with_check) = 0
     or reader.qual is null
     or position('bm-evidence' in reader.qual) = 0
     or position('bm_memberships' in reader.qual) = 0
     or position('auth.uid' in reader.qual) = 0
     or position('owner_id' in reader.qual) = 0 then
    raise exception 'BidMason Storage tenant/ownership predicate drift';
  end if;
end
$bm_audit$;

select pg_temp.bm_audit_evidence_storage_policies();
-- END AUTHORITATIVE SOURCE db/storage_policy_audit.sql

commit;
