-- Disposable CI only. In a real Supabase project auth.sessions is
-- already created and owned by Supabase Auth. NEVER deploy this fixture.
create schema if not exists auth;
revoke all on schema auth from public,anon,authenticated,service_role;
create table auth.sessions (
 id uuid primary key,
 user_id uuid not null
);
revoke all on auth.sessions from public,anon,authenticated,service_role;
insert into auth.sessions(id,user_id) values
 ('11111111-1111-4111-8111-111111111111',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
 ('22222222-2222-4222-8222-222222222222',
  'abababab-abab-4bab-8bab-abababababab');
\i db/staged_auth_session_presence.sql
do $roles$
begin
 if has_table_privilege('service_role','auth.sessions','SELECT')
 or has_table_privilege('authenticated','auth.sessions','SELECT')
 or has_function_privilege('authenticated',
  'bm_intake_private.auth_session_is_active(uuid,uuid)','EXECUTE')
 or has_function_privilege('anon',
  'bm_intake_private.auth_session_is_active(uuid,uuid)','EXECUTE')
 or not has_function_privilege('service_role',
  'bm_intake_private.auth_session_is_active(uuid,uuid)','EXECUTE') then
   raise exception 'Auth session guard leaked privileges';
 end if;
end;
$roles$;
set role service_role;
do $probe$
begin
 if bm_intake_private.auth_session_is_active(
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '11111111-1111-4111-8111-111111111111') is not true then
  raise exception 'Active matching session rejected';
 end if;
 if bm_intake_private.auth_session_is_active(
   'abababab-abab-4bab-8bab-abababababab',
   '11111111-1111-4111-8111-111111111111') is not false then
  raise exception 'Cross-user session accepted';
 end if;
 if bm_intake_private.auth_session_is_active(
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '22222222-2222-4222-8222-222222222222') is not false then
  raise exception 'Foreign session accepted';
 end if;
 if bm_intake_private.auth_session_is_active(
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '33333333-3333-4333-8333-333333333333') is not false then
  raise exception 'Nonexistent session accepted';
 end if;
 if bm_intake_private.auth_session_is_active(null,
   '11111111-1111-4111-8111-111111111111') is not false then
  raise exception 'Null identity permitted';
 end if;
end;
$probe$;
reset role;
-- Supabase sign-out deletes the session row; simulate it in CI.
delete from auth.sessions
where id='11111111-1111-4111-8111-111111111111';
set role service_role;
do $revoked$
begin
 if bm_intake_private.auth_session_is_active(
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '11111111-1111-4111-8111-111111111111') is not false then
  raise exception 'Revoked session still authorized';
 end if;
 if bm_intake_private.auth_session_is_active(
   'abababab-abab-4bab-8bab-abababababab',
   '22222222-2222-4222-8222-222222222222') is not true then
  raise exception 'Other active session incorrectly revoked';
 end if;
end;
$revoked$;
reset role;
select 'PASS: scoped auth.sessions membership with signout revocation';
