-- Real disposable PostgreSQL stage: corrections remain unapproved and unquotable.
do $test$
begin
 if has_function_privilege('anon',
  'bm_intake_private.stage_correction_candidate_draft(uuid,uuid,uuid,text,text,jsonb,jsonb,text)','EXECUTE')
 or has_function_privilege('authenticated',
  'bm_intake_private.stage_correction_candidate_draft(uuid,uuid,uuid,text,text,jsonb,jsonb,text)','EXECUTE')
 or has_table_privilege('service_role',
  'bm_intake_private.correction_candidate_drafts','INSERT')
 or has_table_privilege('service_role',
  'bm_intake_private.correction_candidate_drafts','SELECT')
 or has_table_privilege('authenticated',
  'bm_intake_private.correction_candidate_drafts','SELECT') then
  raise exception 'Private correction candidate draft accessible to client';
 end if;
end;
$test$;

set role service_role;
do $test$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 creator uuid:='abababab-abab-4bab-8bab-abababababab';
 other uuid:='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
 src uuid;
 note_text text;
 current_review jsonb;
 hold jsonb;
 source_sha text;
 candidate_sha text;
 hold_sha text;
 proposed jsonb;
 actions jsonb;
 invalid_actions jsonb;
 result_row record;
begin
 select id,original_text,review,correction_hold
  into src,note_text,current_review,hold
 from public.bm_intake_sources
 where organization_id=org and created_by=creator and revision=4;
 if not found then raise exception 'Previous quarantine fixture missing'; end if;
 source_sha:=current_review->>'sourceSha256';
 candidate_sha:=current_review->>'candidatesSha256';
 hold_sha:=encode(sha256(convert_to(hold::text,'UTF8')),'hex');
 proposed:=jsonb_build_array(jsonb_build_object(
  'serviceCode','painting','units',3,'start',0,
  'end',length(note_text)+1,'excerpt',note_text));
 actions:=jsonb_build_array(jsonb_build_object(
  'action','replace','index',0,'candidate',proposed->0,
  'reason','Correct model quantity'));
 if bm_intake_private.canonical_candidate_sha256(proposed)=candidate_sha then
  raise exception 'Fixture did not change candidates';
 end if;
 -- Absent source / unowned source / foreign tenant all deny before exposing it.
 begin
  perform bm_intake_private.stage_correction_candidate_draft(
   org,other,src,repeat('1',64),hold_sha,proposed,actions,'Correct model quantity');
  raise exception 'Unrelated member staged private correction';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.stage_correction_candidate_draft(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',creator,src,
    repeat('1',64),hold_sha,proposed,actions,'Correct model quantity');
  raise exception 'Foreign organization staged correction';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.stage_correction_candidate_draft(
   org,creator,gen_random_uuid(),repeat('1',64),hold_sha,proposed,actions,'Correct model quantity');
  raise exception 'Missing original staged correction';
 exception when insufficient_privilege then null; end;
 -- Source/excerpt, schema, digest and bounded human explanation are required.
 for result_row in select value as candidate from jsonb_array_elements(
   jsonb_build_array(
     jsonb_set(proposed,'{0,start}','1'::jsonb),
     jsonb_set(proposed,'{0,excerpt}',to_jsonb('invented'::text)),
     jsonb_set(proposed,'{0,rateCents}','12'::jsonb),
     jsonb_build_array(proposed->0,proposed->0),
     current_review->'candidates'
   )) loop
  begin
   perform bm_intake_private.stage_correction_candidate_draft(
    org,creator,src,repeat('1',64),hold_sha,result_row.candidate,actions,
    'Correct model quantity');
   raise exception 'Invalid corrected candidate accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 begin
  perform bm_intake_private.stage_correction_candidate_draft(
   org,creator,src,repeat('0',64),hold_sha,proposed,actions,'Correct model quantity');
  raise exception 'Different correction request fingerprint accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.stage_correction_candidate_draft(
   org,creator,src,repeat('1',64),repeat('0',64),proposed,'Correct model quantity');
  raise exception 'Forged quarantine fingerprint accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.stage_correction_candidate_draft(
   org,creator,src,repeat('1',64),hold_sha,proposed,actions,' ');
  raise exception 'Blank human correction reason accepted';
 exception when invalid_parameter_value then null; end;
 -- An action list must reconstruct the final candidates exactly.
 foreach invalid_actions in array array[
   '[]'::jsonb,
   jsonb_build_array(jsonb_build_object('action','replace','index',0,
     'candidate',proposed->0,'reason',' ')),
   jsonb_build_array(jsonb_build_object('action','replace','index',1,
     'candidate',proposed->0,'reason','Invalid index')),
   jsonb_build_array(jsonb_build_object('action','replace','index',0,
     'candidate',current_review->'candidates'->0,'reason','No-op')),
   jsonb_build_array(actions->0,actions->0),
   jsonb_build_array(jsonb_build_object('action','remove','index',0,
     'reason','Would yield nothing')),
   jsonb_build_array(jsonb_build_object('action','add',
     'candidate',proposed->0,'reason','Would duplicate original')),
   jsonb_build_array((actions->0)||'{"approved":true}'::jsonb),
   jsonb_build_array(jsonb_build_object('action','replace','index',0,
     'candidate',jsonb_set(proposed->0,'{units}','6'::jsonb),
     'reason','Different quantity'))
 ] loop
  begin
   perform bm_intake_private.stage_correction_candidate_draft(
    org,creator,src,repeat('1',64),hold_sha,proposed,invalid_actions,
    'Correct model quantity');
   raise exception 'Invalid correction action lineage accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 -- A privileged app role cannot directly forge private correction drafts.
 begin
  insert into bm_intake_private.correction_candidate_drafts(
   organization_id,source_id,actor_id,request_sha256,hold_sha256,
   original_candidates_sha256,proposed_candidates_sha256,
   proposed_candidates,correction_actions,actions_sha256,reason,draft_sha256
  ) values (org,src,creator,repeat('1',64),hold_sha,candidate_sha,
    repeat('2',64),proposed,actions,repeat('4',64),'Forged',repeat('3',64));
  raise exception 'Direct service-role correction draft insert succeeded';
 exception when insufficient_privilege then null; end;
 select * into result_row from bm_intake_private.stage_correction_candidate_draft(
  org,creator,src,repeat('1',64),hold_sha,proposed,actions,'Correct model quantity');
 if result_row.stored_candidates_sha256 is distinct from
    bm_intake_private.canonical_candidate_sha256(proposed)
 or result_row.stored_draft_sha256 !~ '^[0-9a-f]{64}$' then
  raise exception 'Correction draft did not return verified SHA receipts';
 end if;
 -- A correction draft cannot resurrect the old scope or activate anything.
 if (select count(*) from public.bm_intake_sources
   where organization_id=org and id=src and revision=4
     and scope_review is null and correction_hold=hold
     and review=current_review and original_text=note_text)<>1 then
  raise exception 'Draft changed source or restored commercial scope';
 end if;
 begin
  perform bm_intake_private.stage_correction_candidate_draft(
   org,creator,src,repeat('1',64),hold_sha,proposed,actions,'Correct model quantity');
  raise exception 'Duplicate draft accepted';
 exception when unique_violation then null; end;
 begin
  perform bm_intake_private.commit_typed_note_scope_review(
   org,creator,src,source_sha,candidate_sha,'{}'::jsonb);
  raise exception 'Legacy scope writer accepted correction draft';
 exception when serialization_failure then null; end;
end;
$test$;
reset role;
-- Only the ephemeral SQL owner inspects the private receipt, including its
-- append-only enforcement. Never grant the service role direct SELECT.
do $test$
declare
 v_org uuid:='dededede-dede-4ede-8ede-dededededede';
 v_record bm_intake_private.correction_candidate_drafts%rowtype;
begin
 select * into v_record from bm_intake_private.correction_candidate_drafts
  where organization_id=v_org;
 if not found
   or v_record.proposed_candidates_sha256 is distinct from
    bm_intake_private.canonical_candidate_sha256(v_record.proposed_candidates)
   or v_record.proposed_candidates->0->>'units' is distinct from '3'
   or v_record.original_candidates_sha256=
    v_record.proposed_candidates_sha256
   or jsonb_array_length(v_record.correction_actions)<>1
   or v_record.correction_actions->0->>'action' is distinct from 'replace'
   or v_record.actions_sha256 is distinct from encode(sha256(
     convert_to(v_record.correction_actions::text,'UTF8')),'hex')
   or not bm_intake_private.replay_correction_actions(
     (select s.review->'candidates' from public.bm_intake_sources s
      where s.organization_id=v_record.organization_id
        and s.id=v_record.source_id),
     v_record.correction_actions,v_record.proposed_candidates) then
  raise exception 'Durable correction candidate record mismatch';
 end if;
 begin
  delete from bm_intake_private.correction_candidate_drafts
   where organization_id=v_org;
  raise exception 'Private correction draft deletion was allowed';
 exception when insufficient_privilege then null; end;
 begin
  update bm_intake_private.correction_candidate_drafts
    set reason='Changed after commit' where organization_id=v_org;
  raise exception 'Private correction draft rewrite was allowed';
 exception when insufficient_privilege then null; end;
end;
$test$;
select 'PASS: source-bound, append-only pending candidate draft; quote blocked';
