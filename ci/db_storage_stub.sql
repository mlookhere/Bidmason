-- ISOLATED CI STUB ONLY. Never install this in a Supabase project.
-- Real Supabase Storage already owns storage.buckets and storage.objects.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text unique not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner_id text,
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
-- No client bucket admin grants; privileged postgres fixture creates the bucket.
