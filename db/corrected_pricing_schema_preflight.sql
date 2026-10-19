-- READ-ONLY, CATALOG-ONLY deployment preflight for corrected internal
-- pricing. Safe to run on an existing Supabase project; no data rows,
-- JWTs, Auth sessions, private policy or customer content are returned.
-- "staged_schema_ready" is NOT a production acceptance/release decision.
with probes(check_name,passed) as (
 values
 ('organizations_rls',
    coalesce((select relrowsecurity from pg_catalog.pg_class
      where oid=to_regclass('public.bm_organizations')),false)),
 ('memberships_rls',
    coalesce((select relrowsecurity from pg_catalog.pg_class
      where oid=to_regclass('public.bm_memberships')),false)),
 ('typed_source_rls',
    coalesce((select relrowsecurity from pg_catalog.pg_class
      where oid=to_regclass('public.bm_intake_sources')),false)),
 ('typed_source_browser_denied',
    to_regclass('public.bm_intake_sources') is not null
    and not coalesce(has_table_privilege('anon',
      to_regclass('public.bm_intake_sources'),'SELECT'),true)
    and not coalesce(has_table_privilege('authenticated',
      to_regclass('public.bm_intake_sources'),'SELECT'),true)),
 ('private_schema_service_usage',
    to_regnamespace('bm_intake_private') is not null
    and coalesce(has_schema_privilege('service_role',
      to_regnamespace('bm_intake_private'),'USAGE'),false)
    and not coalesce(has_schema_privilege('anon',
      to_regnamespace('bm_intake_private'),'USAGE'),true)
    and not coalesce(has_schema_privilege('authenticated',
      to_regnamespace('bm_intake_private'),'USAGE'),true)),
 ('correction_activation_receipt',
    to_regclass('bm_intake_private.correction_activations') is not null),
 ('corrected_scope_receipt',
    to_regclass('bm_intake_private.corrected_scope_review_drafts') is not null),
 ('corrected_commercial_receipt',
    to_regclass('bm_intake_private.corrected_commercial_decisions') is not null),
 ('active_policy_head',
    to_regclass('bm_intake_private.active_policy_heads') is not null),
 ('auth_session_table',
    to_regclass('auth.sessions') is not null
    and exists(select 1 from pg_catalog.pg_attribute
       where attrelid=to_regclass('auth.sessions')
         and attname='id' and not attisdropped)
    and exists(select 1 from pg_catalog.pg_attribute
       where attrelid=to_regclass('auth.sessions')
         and attname='user_id' and not attisdropped)),
 ('auth_session_probe_private',
    to_regprocedure('bm_intake_private.auth_session_is_active(uuid,uuid)')
       is not null
    and coalesce(has_function_privilege('service_role',
       to_regprocedure('bm_intake_private.auth_session_is_active(uuid,uuid)'),
       'EXECUTE'),false)
    and not coalesce(has_function_privilege('anon',
       to_regprocedure('bm_intake_private.auth_session_is_active(uuid,uuid)'),
       'EXECUTE'),true)
    and not coalesce(has_function_privilege('authenticated',
       to_regprocedure('bm_intake_private.auth_session_is_active(uuid,uuid)'),
       'EXECUTE'),true)),
 ('session_locked_preview_private',
    to_regprocedure(
      'bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text)')
        is not null
    and coalesce(has_function_privilege('service_role',
       to_regprocedure(
       'bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text)'),
       'EXECUTE'),false)
    and not coalesce(has_function_privilege('anon',
       to_regprocedure(
       'bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text)'),
       'EXECUTE'),true)
    and not coalesce(has_function_privilege('authenticated',
       to_regprocedure(
       'bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text)'),
       'EXECUTE'),true)),
 ('internal_preview_private',
    to_regprocedure(
      'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)')
       is not null
    and coalesce(has_function_privilege('service_role',
      to_regprocedure(
      'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)'),
      'EXECUTE'),false)
    and not coalesce(has_function_privilege('anon',
      to_regprocedure(
      'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)'),
      'EXECUTE'),true)
    and not coalesce(has_function_privilege('authenticated',
      to_regprocedure(
      'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)'),
      'EXECUTE'),true)),
 ('private_commercial_receipt_direct_dml_denied',
   to_regclass('bm_intake_private.corrected_commercial_decisions') is not null
   and not coalesce(has_table_privilege('service_role',
     to_regclass('bm_intake_private.corrected_commercial_decisions'),'INSERT'),true)
   and not coalesce(has_table_privilege('authenticated',
     to_regclass('bm_intake_private.corrected_commercial_decisions'),'SELECT'),true))
)
select jsonb_build_object(
  'contract','bm-corrected-pricing-schema-preflight-v1',
  'staged_schema_ready',bool_and(coalesce(passed,false)),
  'checked',count(*),
  'passed',count(*) filter (where passed is true),
  'missing',coalesce(jsonb_agg(check_name order by check_name)
    filter(where passed is not true),'[]'::jsonb)
) as report from probes;
