-- DISPOSABLE CI POSTGRES ONLY. Not a production migration.
-- Test setup records ACTUAL separate immutable submit/review events rather
-- than bypassing the production activation precondition with synthetic actors.
create function bm_intake_private.ci_stage_approved_policy(
 p_org uuid,p_submitter uuid,p_reviewer uuid,p_canonical text
) returns text
language plpgsql security invoker
set search_path=pg_catalog,public
as $fixture$
declare v_prev integer:=0;v_prev_sha text;
 v_revision integer;v_sha text;v_status text;
begin
 if p_org is null or p_submitter is null or p_reviewer is null
   or p_submitter=p_reviewer or p_canonical is null then
   raise exception 'Invalid synthetic approval fixture' using errcode='22023';
 end if;
 v_revision:=(p_canonical::jsonb->>'revision')::integer;
 select revision,policy_sha256 into v_prev,v_prev_sha
 from bm_intake_private.policy_submission_heads
 where organization_id=p_org;
 if not found then v_prev:=0;v_prev_sha:=null; end if;
 select submitted_sha256 into v_sha
 from bm_intake_private.submit_policy_history_draft(
   p_org,p_submitter,v_prev,v_prev_sha,p_canonical);
 select reviewed_status into v_status
 from bm_intake_private.review_policy_history_draft(
   p_org,p_reviewer,v_revision,v_sha,'approve');
 if v_status is distinct from 'approved' then
   raise exception 'Fixture did not persist independent approval' using errcode='42501';
 end if;
 return v_sha;
end;
$fixture$;
revoke all on function bm_intake_private.ci_stage_approved_policy(
 uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function bm_intake_private.ci_stage_approved_policy(
 uuid,uuid,uuid,text) to service_role;
