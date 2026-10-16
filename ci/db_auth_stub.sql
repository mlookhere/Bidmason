-- Isolated CI ONLY: emulate the auth.uid contract and role separation.
-- This file must NEVER be run against a real Supabase project.
create schema auth;
create role anon nologin;
create role authenticated nologin;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
