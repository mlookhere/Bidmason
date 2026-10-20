-- STAGED only. The validated server actor/session pair is rechecked
-- and locked in the SAME database statement that reads the private
-- corrected internal economics inputs. No writes, quote or delivery.
-- auth.sessions belongs to Supabase Auth; never create that table here.
create function bm_intake_private.read_corrected_internal_preview_session_locked(
 p_org uuid,p_actor uuid,p_session uuid,p_source uuid,p_decision_sha text
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,auth,bm_intake_private,public
as $atomic$
declare
 v_result jsonb;
begin
 if p_org is null or p_actor is null or p_session is null
  or p_source is null or coalesce(p_decision_sha,'') !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid session-locked internal preview request'
     using errcode='22023';
 end if;
 -- A row lock is held to the end of the current SQL transaction.
 -- A concurrent logout DELETE cannot complete while this statement
 -- constructs the internal preview, preventing check/use separation.
 perform 1 from auth.sessions
 where id=p_session and user_id=p_actor for share;
 if not found then
   raise exception 'Current verified session row required'
     using errcode='42501';
 end if;
 -- The existing private implementation locks the current three actor
 -- tenant membership rows and approved company policy for this read.
 v_result:=bm_intake_private.read_corrected_internal_preview_inputs(
   p_org,p_actor,p_source,p_decision_sha);
 if v_result->>'state' is distinct from 'preview-only'
   or v_result->'deliveryAuthorized' is distinct from 'false'::jsonb then
   raise exception 'Preview cannot authorize commercial delivery'
     using errcode='42501';
 end if;
 return v_result;
end;
$atomic$;
revoke all on function
 bm_intake_private.read_corrected_internal_preview_session_locked(
  uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function
 bm_intake_private.read_corrected_internal_preview_session_locked(
  uuid,uuid,uuid,uuid,text) to service_role;
