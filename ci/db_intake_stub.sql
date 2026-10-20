-- Disposable PostgreSQL CI ONLY. Not an Item 3 import or production setup.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public.bm_organizations (
 id uuid primary key,
 slug text not null,
 name text not null
);
create table public.bm_memberships (
 organization_id uuid not null references public.bm_organizations(id),
 user_id uuid not null,
 member_role text not null check (member_role in ('owner','operator','contractor')),
 primary key (organization_id,user_id)
);
alter table public.bm_organizations enable row level security;
alter table public.bm_memberships enable row level security;
grant usage on schema public to service_role;
