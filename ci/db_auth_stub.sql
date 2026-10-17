-- Isolated CI ONLY: emulate the auth.uid contract and role separation.
-- This file must NEVER be run against a real Supabase project.
create schema auth;
-- PostgreSQL roles are cluster-wide, even with isolated CI databases.
-- Only create these disposable test roles when they do not yet exist.
do $bm_ci_roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
end
$bm_ci_roles$;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
