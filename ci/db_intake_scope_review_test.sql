-- Disposable PostgreSQL only: NEVER evidence of an approved ratecard,
-- authentic Supabase session, or authorization to send a proposal.
do $test$
begin
 if has_function_privilege('anon',
   'bm_intake_private.commit_typed_note_scope_review(uuid,uuid,uuid,text,text,jsonb)','EXECUTE')
 or has_function_privilege('authenticated',
   'bm_intake_private.commit_typed_note_scope_review(uuid,uuid,uuid,text,text,jsonb)','EXECUTE') then
   raise exception 'Browser can commit staged scope decisions';
 end if;
end;
$test$;

insert into public.bm_memberships(organization_id,user_id,member_role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '77777777-7777-4777-8777-777777777777','operator'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '88888888-8888-4888-8888-888888888888','operator');

set role service_role;
do $test$
declare
 v_org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_other_org uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_creator uuid:='77777777-7777-4777-8777-777777777777';
 v_unrelated uuid:='88888888-8888-4888-8888-888888888888';
 v_request uuid:='21212121-2121-4212-8212-212121212121';
 v_text text:='Paint two rooms and clean hallway';
 v_original_sha text;
 v_source_sha text;
 v_candidates_sha text;
 v_id uuid;
 v_candidates jsonb;
 v_review jsonb;
 v_scope jsonb;
 v_bad jsonb;
 v_reply record;
 v_activation record;
 v_policy jsonb;
begin
 select source_id,original_sha256 into v_id,v_original_sha
 from bm_intake_private.create_typed_note(
   v_org,v_creator,v_request,v_text);
 v_source_sha:=encode(sha256(convert_to('typed-note','UTF8')
   ||decode('00','hex')||convert_to(v_text,'UTF8')),'hex');
 v_candidates:=jsonb_build_array(
  jsonb_build_object('serviceCode','painting','units',2,
    'start',0,'end',5,'excerpt','Paint'),
  jsonb_build_object('serviceCode','cleaning','units',1,
    'start',20,'end',13,'excerpt','INVALID'));
 -- Use the exact stored original span; preserve indexed selection determinism.
 v_candidates:=jsonb_set(v_candidates,'{1}',jsonb_build_object(
  'serviceCode','cleaning','units',1,
  'start',20,'end',33,'excerpt','clean hallway'));
 v_candidates_sha:=bm_intake_private.canonical_candidate_sha256(v_candidates);
 v_review:=jsonb_build_object(
  'state','needs-human-review','kind','typed-note',
  'sourceSha256',v_source_sha,'candidatesSha256',v_candidates_sha,
  'candidates',v_candidates);
 select source_revision into v_reply
 from bm_intake_private.commit_typed_note_extraction(
  v_org,v_creator,v_id,v_original_sha,v_review);
 if v_reply.source_revision<>2 then raise exception 'Setup extraction failed'; end if;

 -- The first approved policy requires a second active reviewer;
 -- never infer approval from any draft or request-supplied digest.
 v_policy:=jsonb_build_object(
   'revision',1,
   'pricing',jsonb_build_object('policyId','synthetic-painting-v1',
     'currency','USD',
     'services',jsonb_build_object(
       'painting',jsonb_build_object('label','Painting','unit','room',
         'billing','charged','rateCents',25000,'optionalAddon',false),
       'cleaning',jsonb_build_object('label','Cleaning','unit','visit',
         'billing','pending','rateCents',12000))),
   'tax',jsonb_build_object('method','none','bps',0));
 select * into v_activation from bm_intake_private.activate_scope_policy(
   v_org,v_creator,v_unrelated,1,v_policy::text);
 if v_activation.activated_revision<>1 then
   raise exception 'Test policy activation failed';
 end if;

 v_scope:=jsonb_build_object(
  'state','reviewed-for-proposal-draft','sourceRevision',3,
  'reviewedBy',v_creator::text,'reviewKey',repeat('1',64),
  'sourceSha256',v_source_sha,'candidatesSha256',v_candidates_sha,
  'selectedIndices',jsonb_build_array(0),
  'acceptedAddonCodes','[]'::jsonb,
  'policyRevision',1,'policySha256',v_activation.activated_sha256,
  'reviewedSelectionSha256',repeat('3',64));

 -- Absent source and different-tenant/creator denial before data disclosure.
 begin
  perform 1 from bm_intake_private.commit_typed_note_scope_review(
    v_other_org,v_creator,v_id,v_source_sha,v_candidates_sha,v_scope);
  raise exception 'Foreign tenant reviewed a source';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from bm_intake_private.commit_typed_note_scope_review(
    v_org,v_unrelated,v_id,v_source_sha,v_candidates_sha,v_scope);
  raise exception 'Same-tenant noncreator reviewed a private source';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from bm_intake_private.commit_typed_note_scope_review(
    v_org,v_creator,gen_random_uuid(),v_source_sha,v_candidates_sha,v_scope);
  raise exception 'Nonexistent scope-review source was accepted';
 exception when insufficient_privilege then null; end;

 -- SQL NULL is never a valid expected-version marker: three-valued
 -- comparison must not bypass the optimistic source/candidate binding.
 begin
  perform 1 from bm_intake_private.commit_typed_note_scope_review(
   v_org,v_creator,v_id,null::text,v_candidates_sha,v_scope);
  raise exception 'Null expected original source hash passed CAS';
 exception when invalid_parameter_value then null; end;
 begin
  perform 1 from bm_intake_private.commit_typed_note_scope_review(
   v_org,v_creator,v_id,v_source_sha,null::text,v_scope);
  raise exception 'Null expected candidate digest passed CAS';
 exception when invalid_parameter_value then null; end;

 -- Do not accept client-provided pricing/approval or actor impersonation.
 foreach v_bad in array array[
  v_scope||'{"approved":true}'::jsonb,
  v_scope||'{"rateCents":1}'::jsonb,
  jsonb_set(v_scope,'{reviewedBy}',to_jsonb(v_unrelated::text)),
  jsonb_set(v_scope,'{sourceSha256}',to_jsonb(repeat('0',64))),
  jsonb_set(v_scope,'{candidatesSha256}',to_jsonb(repeat('0',64))),
  jsonb_set(v_scope,'{selectedIndices}','[]'::jsonb),
  jsonb_set(v_scope,'{selectedIndices}','[0,0]'::jsonb),
  jsonb_set(v_scope,'{selectedIndices}','[1,0]'::jsonb),
  jsonb_set(v_scope,'{selectedIndices}','[2]'::jsonb),
  jsonb_set(v_scope,'{acceptedAddonCodes}','["unselected"]'::jsonb),
  jsonb_set(v_scope,'{acceptedAddonCodes}','["painting","painting"]'::jsonb),
  jsonb_set(v_scope,'{reviewKey}','null'::jsonb),
  jsonb_set(v_scope,'{policySha256}','null'::jsonb),
  jsonb_set(v_scope,'{reviewedSelectionSha256}','null'::jsonb),
  jsonb_set(v_scope,'{policyRevision}','null'::jsonb)
 ] loop
  begin
   perform 1 from bm_intake_private.commit_typed_note_scope_review(
     v_org,v_creator,v_id,v_source_sha,v_candidates_sha,v_bad);
   raise exception 'Forged scope-review snapshot accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 if (select revision from public.bm_intake_sources
  where organization_id=v_org and id=v_id)<>2 then
   raise exception 'Invalid scope review mutated extraction';
 end if;
 select * into v_reply from bm_intake_private.commit_typed_note_scope_review(
   v_org,v_creator,v_id,v_source_sha,v_candidates_sha,v_scope);
 if v_reply.source_revision<>3 or
   v_reply.reviewed_selection_sha256<>repeat('3',64) then
   raise exception 'Valid scope transition returned incorrect revision'; end if;
 if (select count(*) from public.bm_intake_sources
    where organization_id=v_org and id=v_id
      and revision=3 and scope_review=v_scope
      and review=v_review and original_text=v_text
      and text_sha256=v_original_sha
      and jsonb_array_length(extraction_audit)=1
      and extraction_audit->0->>'candidatesSha256'=v_candidates_sha)<>1 then
   raise exception 'Scope review rewrote extraction evidence or audit';
 end if;
 begin
  perform 1 from bm_intake_private.commit_typed_note_scope_review(
    v_org,v_creator,v_id,v_source_sha,v_candidates_sha,v_scope);
  raise exception 'Duplicate scope decision accepted';
 exception when serialization_failure then null; end;
end;
$test$;
reset role;

delete from public.bm_memberships
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 and user_id='77777777-7777-4777-8777-777777777777';
set role service_role;
do $test$
begin
 begin
  perform 1 from bm_intake_private.commit_typed_note_scope_review(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '77777777-7777-4777-8777-777777777777',
   gen_random_uuid(),repeat('0',64),repeat('0',64),'{}'::jsonb);
  raise exception 'Revoked user was allowed to probe scope review';
 exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
select 'PASS: narrow staged human scope decision CAS; no approval or send';
