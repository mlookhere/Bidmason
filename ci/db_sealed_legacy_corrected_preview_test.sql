-- Real, disposable PostgreSQL: legacy 4-argument bypass cannot be
-- invoked by service_role. The 5-argument session-locked wrapper remains
-- functional for the SAME source, actor and policy under a valid session.
do $checks$
begin
 if has_function_privilege('service_role',
  'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)','EXECUTE')
 or has_function_privilege('authenticated',
  'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)','EXECUTE')
 or has_function_privilege('anon',
  'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)','EXECUTE')
 or not has_function_privilege('service_role',
  'bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text)','EXECUTE')
 then
  raise exception 'Unbound private pricing privilege was not sealed';
 end if;
end;
$checks$;

-- Read the synthetic, already-approved corrected decision fixture using
-- the privileged CI fixture owner. Never inspect real Auth or customer data.
do $setup$
declare d bm_intake_private.corrected_commercial_decisions%rowtype;
begin
 select * into d from bm_intake_private.corrected_commercial_decisions
  where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found or d.decision is distinct from 'approve-internal-draft' then
  raise exception 'Approved internal commercial decision fixture missing';
 end if;
 perform set_config('bm_ci.sealed_source',d.source_id::text,false);
 perform set_config('bm_ci.sealed_decision',d.decision_sha256,false);
end;
$setup$;

-- The prior bridge test removed the temporary session. Restore a row
-- only in this disposable CI PostgreSQL fixture.
insert into auth.sessions (id,user_id)
values ('11111111-1111-4111-8111-111111111111',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

set role service_role;
do $test$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 actor uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 sid uuid:='11111111-1111-4111-8111-111111111111';
 source uuid:=current_setting('bm_ci.sealed_source')::uuid;
 decision text:=current_setting('bm_ci.sealed_decision');
 projection jsonb;
begin
 -- SQL-level denial, not just a TypeScript or NODE_ENV guard.
 begin
  perform bm_intake_private.read_corrected_internal_preview_inputs(
   org,actor,source,decision);
  raise exception 'Legacy four-argument pricing bypass is callable';
 exception when insufficient_privilege then
  null;
 end;
 projection:=bm_intake_private.read_corrected_internal_preview_session_locked(
  org,actor,sid,source,decision);
 if projection->>'state' is distinct from 'preview-only'
  or projection->'deliveryAuthorized' is distinct from 'false'::jsonb
  or projection->'evidence'->>'internalDecisionSha256' is distinct from decision
  or projection->'requested' is distinct from
    '[{"serviceCode":"painting","units":3}]'::jsonb
  or projection ? 'recipient' or projection ? 'quote'
  or projection ? 'send' or projection ? 'totalCents' then
   raise exception 'Session-locked private projection changed after sealing';
 end if;
end;
$test$;
reset role;

delete from auth.sessions
 where id='11111111-1111-4111-8111-111111111111';
set role service_role;
do $revoked$
begin
 begin
  perform bm_intake_private.read_corrected_internal_preview_session_locked(
   'dededede-dede-4ede-8ede-dededededede',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '11111111-1111-4111-8111-111111111111',
   current_setting('bm_ci.sealed_source')::uuid,
   current_setting('bm_ci.sealed_decision'));
  raise exception 'Sealed wrapper bypassed session deletion';
 exception when insufficient_privilege then null;
 end;
end;
$revoked$;
reset role;
select 'PASS: service_role cannot call legacy preview; locked preview still works';
