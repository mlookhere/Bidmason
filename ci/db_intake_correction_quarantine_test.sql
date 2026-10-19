-- Disposable PostgreSQL adversarial quarantine proof; NO corrected candidate write.
do $test$
begin
 if has_function_privilege('anon',
  'bm_intake_private.quarantine_typed_note_for_correction(uuid,uuid,uuid,integer,text,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
  'bm_intake_private.quarantine_typed_note_for_correction(uuid,uuid,uuid,integer,text,text,text,text)','EXECUTE')
 or has_table_privilege('service_role','bm_intake_private.correction_holds','INSERT')
 or has_table_privilege('authenticated','bm_intake_private.correction_holds','SELECT') then
  raise exception 'Untrusted direct correction ledger access';
 end if;
end;
$test$;

insert into public.bm_organizations(id,slug,name)
values ('dededede-dede-4ede-8ede-dededededede','correction-quarantine-fixture','Synthetic Correction Quarantine');
insert into public.bm_memberships(organization_id,user_id,member_role)
values ('dededede-dede-4ede-8ede-dededededede',
 'abababab-abab-4bab-8bab-abababababab','operator'),
 ('dededede-dede-4ede-8ede-dededededede',
 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd','operator');

set role service_role;
do $test$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 creator uuid:='abababab-abab-4bab-8bab-abababababab';
 foreign_actor uuid:='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
 src uuid;
 txt text:='Paint 🧱 two rooms';
 text_sha text;
 source_sha text;
 candidate_sha text;
 candidates jsonb;
 expected_review jsonb;
 outcome record;
begin
 select source_id,original_sha256 into src,text_sha from
  bm_intake_private.create_typed_note(org,creator,
   'aaaa1111-1111-4111-8111-111111111111',txt);
 source_sha:=encode(sha256(convert_to('typed-note','UTF8')
  ||decode('00','hex')||convert_to(txt,'UTF8')),'hex');
 candidates:=jsonb_build_array(jsonb_build_object(
   'serviceCode','painting','units',2,
   'start',0,'end',length(txt)+1,'excerpt',txt));
 candidate_sha:=bm_intake_private.canonical_candidate_sha256(candidates);
 expected_review:=jsonb_build_object('state','needs-human-review','kind','typed-note',
  'sourceSha256',source_sha,'candidatesSha256',candidate_sha,
  'candidates',candidates);
 perform bm_intake_private.commit_typed_note_extraction(
  org,creator,src,text_sha,expected_review);

 -- Untrusted direct update cannot create a quarantined source without a
 -- private receipt, even with service_role UPDATE rights.
 begin
  update public.bm_intake_sources set revision=4,
   correction_hold=jsonb_build_object('state','quarantined-awaiting-correction')
   where organization_id=org and id=src;
  raise exception 'Direct quarantine update bypassed private receipt';
 exception when insufficient_privilege then null; end;

 -- Foreign actor, tenant, invalid digest/reason must NOT create ledger rows.
 begin
  perform bm_intake_private.quarantine_typed_note_for_correction(
   org,creator,src,null,source_sha,candidate_sha,repeat('1',64),'Reason');
  raise exception 'Null expected revision bypassed optimistic lock';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.quarantine_typed_note_for_correction(
   org,creator,src,2,repeat('0',64),candidate_sha,repeat('1',64),'Reason');
  raise exception 'Forged source fingerprint quarantined source';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.quarantine_typed_note_for_correction(
   org,foreign_actor,src,2,source_sha,candidate_sha,repeat('1',64),'Reason');
  raise exception 'Same-company noncreator quarantined source';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.quarantine_typed_note_for_correction(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',creator,src,2,
   source_sha,candidate_sha,repeat('1',64),'Reason');
  raise exception 'Foreign tenant quarantined source';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.quarantine_typed_note_for_correction(
   org,creator,src,2,source_sha,repeat('0',64),repeat('1',64),'Reason');
  raise exception 'Forged candidate fingerprint quarantined source';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.quarantine_typed_note_for_correction(
   org,creator,src,2,source_sha,candidate_sha,repeat('1',64),' ');
  raise exception 'Blank reason quarantined source';
 exception when invalid_parameter_value then null; end;

 select * into outcome from bm_intake_private.quarantine_typed_note_for_correction(
  org,creator,src,2,source_sha,candidate_sha,repeat('1',64),
  'Original model candidates need human correction');
 if outcome.quarantined_revision<>4
   or outcome.hold_sha256 !~ '^[a-f0-9]{64}$' then
   raise exception 'Quarantine returned invalid state';
 end if;
 if (select count(*) from public.bm_intake_sources
  where organization_id=org and id=src and revision=4
   and original_text=txt and text_sha256=text_sha and review=expected_review
   and scope_review is null
   and correction_hold->>'state'='quarantined-awaiting-correction')<>1
 or (select count(*) from bm_intake_private.correction_holds
   where organization_id=org and source_id=src
   and request_sha256=repeat('1',64) and previous_revision=2
   and invalidated_scope is null)<>1 then
   raise exception 'Correction quarantine did not persist immutable evidence';
 end if;
 -- A legacy human-scope writer must deny a quarantined revision.
 begin
  perform bm_intake_private.commit_typed_note_scope_review(
   org,creator,src,source_sha,candidate_sha,'{}'::jsonb);
  raise exception 'Legacy scope review accepted quarantined source';
 exception when serialization_failure then null; end;
 -- Old extraction SQL likewise rejects changed revision.
 begin
  perform bm_intake_private.commit_typed_note_extraction(
   org,creator,src,text_sha,expected_review);
  raise exception 'Legacy extraction accepted quarantined source';
 exception when serialization_failure then null; end;
 -- Replay / stale hash / double hold impossible.
 begin
  perform bm_intake_private.quarantine_typed_note_for_correction(
   org,creator,src,2,source_sha,candidate_sha,repeat('1',64),'Reason');
  raise exception 'Duplicate correction quarantine accepted';
 exception when serialization_failure then null; end;
 -- Preserve private ledger and immutable original even for privileged UPDATE.
 begin
  update public.bm_intake_sources set correction_hold='{}'::jsonb
   where organization_id=org and id=src;
  raise exception 'Correction hold was overwritten';
 exception when insufficient_privilege then null; end;
 if (select count(*) from bm_intake_private.correction_holds
   where organization_id=org and source_id=src)<>1 then
   raise exception 'Correction hold ledger duplicated';
 end if;
end;
$test$;
reset role;
select 'PASS: immutable staged correction quarantine and legacy scope denial';