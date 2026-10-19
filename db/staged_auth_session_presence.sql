-- Staged, server-only session-revocation probe. The target auth.sessions
-- table is owned by Supabase Auth in production and MUST NOT be created here.
-- Only an independently Auth-verified JWT may supply these selectors.
create function bm_intake_private.auth_session_is_active(
 p_user uuid, p_session uuid
) returns boolean language plpgsql volatile security definer
set search_path=pg_catalog,auth,bm_intake_private as $guard$
begin
 if p_user is null or p_session is null then
  return false;
 end if;
 -- Shared row lock prevents concurrent deletion until statement ends.
 perform 1 from auth.sessions
 where id=p_session and user_id=p_user for share;
 return found;
end;
$guard$;
revoke all on function bm_intake_private.auth_session_is_active(uuid,uuid)
 from public,anon,authenticated;
grant execute on function bm_intake_private.auth_session_is_active(uuid,uuid)
 to service_role;
