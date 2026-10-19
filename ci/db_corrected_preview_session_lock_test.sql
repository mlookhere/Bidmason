-- Ephemeral Postgres only. Existing previous Auth revocation test
-- deleted this synthetic session, proving a missing row blocks preview.
do $setup$
declare
 x bm_intake_private.corrected_commercial_decisions%rowtype;
begin
 select * into x from bm_intake_private.corrected_commercial_decisions
 where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found or x.decision is distinct from 'approve-internal-draft' then
  raise exception 'Approved corrected scope fixture missing';
 end if;
 perform set_config('bm_ci.locked_src',x.source_id::text,false);
 perform set_config('bm_ci.locked_decision',x.decision_sha256,false);
 if has_function_privilege('anon',
   'bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text)','EXECUTE')
 or has_function_privilege('authenticated',
   'bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text)','EXECUTE')
 or not has_function_privilege('service_role',
   'bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text)','EXECUTE')
 or has_table_privilege('service_role','auth.sessions','SELECT') then
   raise exception 'Session-locked private preview privilege violation';
 end if;
end;
$setup$;
set role service_role;
do $revoked$
begin
 begin
 perform bm_intake_private.read_corrected_internal_preview_session_locked(
   'dededede-dede-4ede-8ede-dededededede',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '11111111-1111-4111-8111-111111111111',
   current_setting('bm_ci.locked_src')::uuid,
   current_setting('bm_ci.locked_decision'));
 raise exception 'Revoked session bypassed locked SQL preview';
 exception when insufficient_privilege then null; end;
end;
$revoked$;
reset role;
-- Restore the ephemeral valid session; no real Supabase mutation occurs.
insert into auth.sessions(id,user_id)
values('11111111-1111-4111-8111-111111111111',
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
set role service_role;
do $positive$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 reviewer uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 session uuid:='11111111-1111-4111-8111-111111111111';
 src uuid:=current_setting('bm_ci.locked_src')::uuid;
 sha text:=current_setting('bm_ci.locked_decision');
 p jsonb;
begin
 begin
 perform bm_intake_private.read_corrected_internal_preview_session_locked(
  org,reviewer,'22222222-2222-4222-8222-222222222222',src,sha);
 raise exception 'Different user session accepted';
 exception when insufficient_privilege then null; end;
 begin
 perform bm_intake_private.read_corrected_internal_preview_session_locked(
  org,'abababab-abab-4bab-8bab-abababababab',session,src,sha);
 raise exception 'Creator session impersonated commercial reviewer';
 exception when insufficient_privilege then null; end;
 begin
 perform bm_intake_private.read_corrected_internal_preview_session_locked(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  reviewer,session,src,sha);
 raise exception 'Foreign tenant accessed locked preview';
 exception when insufficient_privilege then null; end;
 begin
 perform bm_intake_private.read_corrected_internal_preview_session_locked(
  org,reviewer,session,gen_random_uuid(),sha);
 raise exception 'Absent source exposed private inputs';
 exception when insufficient_privilege then null; end;
 begin
 perform bm_intake_private.read_corrected_internal_preview_session_locked(
  org,reviewer,session,src,repeat('0',64));
 raise exception 'Forged decision digest accepted';
 exception when invalid_parameter_value then null; end;
 p:=bm_intake_private.read_corrected_internal_preview_session_locked(
   org,reviewer,session,src,sha);
 if p->>'state' is distinct from 'preview-only'
  or p->'deliveryAuthorized' is distinct from 'false'::jsonb
  or p->'evidence'->>'sourceRevision' is not null
  or p->'evidence'->>'revision' is distinct from '5'
  or p->'evidence'->>'internalDecisionSha256' is distinct from sha
  or p->'requested' is distinct from '[{"serviceCode":"painting","units":3}]'::jsonb
  or p ? 'recipient' or p ? 'quote' or p ? 'send'
 then
  raise exception 'Locked projection changed quote/preview semantics';
 end if;
end;
$positive$;
reset role;
delete from auth.sessions
 where id='11111111-1111-4111-8111-111111111111';
set role service_role;
do $again$
begin
 begin
 perform bm_intake_private.read_corrected_internal_preview_session_locked(
   'dededede-dede-4ede-8ede-dededededede',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '11111111-1111-4111-8111-111111111111',
   current_setting('bm_ci.locked_src')::uuid,
   current_setting('bm_ci.locked_decision'));
 raise exception 'Post-signout preview still accessible';
 exception when insufficient_privilege then null; end;
end;
$again$;
reset role;
select 'PASS: session lock and corrected preview share one statement';
