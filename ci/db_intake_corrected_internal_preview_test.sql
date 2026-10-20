-- Disposable PostgreSQL: ONLY current distinct internal commercial reviewer
-- can retrieve company-owned economics inputs; NEVER a customer quote.
do $roles$
begin
 if has_function_privilege('anon',
  'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)','EXECUTE')
 or has_function_privilege('authenticated',
  'bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text)','EXECUTE') then
  raise exception 'Untrusted browser role can read internal preview';
 end if;
end;
$roles$;
do $owner$
declare v bm_intake_private.corrected_commercial_decisions%rowtype;
begin
 select * into v from bm_intake_private.corrected_commercial_decisions
 where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found or v.decision is distinct from 'approve-internal-draft' then
  raise exception 'Internal approval fixture missing';
 end if;
 perform set_config('bm_ci.preview_source',v.source_id::text,false);
 perform set_config('bm_ci.preview_sha',v.decision_sha256,false);
end;
$owner$;
set role service_role;
do $check$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 reviewer uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 source uuid:=current_setting('bm_ci.preview_source')::uuid;
 expected_sha text:=current_setting('bm_ci.preview_sha');
 prior public.bm_intake_sources%rowtype;
 outcome jsonb;
begin
 select * into prior from public.bm_intake_sources
 where organization_id=org and id=source;
 begin
  perform bm_intake_private.read_corrected_internal_preview_inputs(
   org,'abababab-abab-4bab-8bab-abababababab',source,expected_sha);
  raise exception 'Creator viewed internal commercial data';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.read_corrected_internal_preview_inputs(
   org,'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',source,expected_sha);
  raise exception 'Evidence reviewer viewed commercial preview';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.read_corrected_internal_preview_inputs(
   org,gen_random_uuid(),source,expected_sha);
  raise exception 'Nonmember viewed internal commercial data';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.read_corrected_internal_preview_inputs(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reviewer,source,expected_sha);
  raise exception 'Cross tenant preview disclosed data';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.read_corrected_internal_preview_inputs(
   org,reviewer,gen_random_uuid(),expected_sha);
  raise exception 'Missing source disclosed data';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.read_corrected_internal_preview_inputs(
   org,reviewer,source,repeat('0',64));
  raise exception 'Forged commercial decision approved data read';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.read_corrected_internal_preview_inputs(
   org,reviewer,source,null);
  raise exception 'Null decision digest accepted';
 exception when invalid_parameter_value then null; end;
 outcome:=bm_intake_private.read_corrected_internal_preview_inputs(
  org,reviewer,source,expected_sha);
 if outcome->>'state' is distinct from 'preview-only'
 or outcome->'deliveryAuthorized' is distinct from 'false'::jsonb
 or outcome->'evidence'->>'internalDecisionSha256' is distinct from expected_sha
 or outcome->'evidence'->>'revision' is distinct from '5'
 or outcome->'policy'->'pricing'->'services'->'painting'->>'rateCents'
    is distinct from '23000'
 or outcome->'requested' is distinct from
    '[{"serviceCode":"painting","units":3}]'::jsonb
 or outcome ? 'recipient' or outcome ? 'send'
 or outcome ? 'quote' or outcome ? 'totalCents' then
   raise exception 'Preview unexpectedly promoted or distorted private economics';
 end if;
 if (select count(*) from public.bm_intake_sources
  where organization_id=org and id=source and revision=5
   and scope_review is null and review=prior.review
   and original_text=prior.original_text
   and correction_hold=prior.correction_hold
   and correction_activation=prior.correction_activation)<>1 then
    raise exception 'Read-only preview mutated original source or scope';
 end if;
end;
$check$;
reset role;
select 'PASS: tenant-private corrected economics preview inputs, not quote';
