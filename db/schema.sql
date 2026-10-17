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
