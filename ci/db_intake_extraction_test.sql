-- Only against disposable isolated PostgreSQL after the source/ledger suites.
-- The SQL primitive validates membership, source creator and CAS; the future
-- server adapter must also validate candidate UTF-16 offsets + canonical hash.
insert into public.bm_memberships(organization_id,user_id,member_role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '99999999-9999-4999-8999-999999999999','operator');

do $test$
begin
 if has_function_privilege('anon',
    'bm_intake_private.commit_typed_note_extraction(uuid,uuid,uuid,text,jsonb)','EXECUTE')
 or has_function_privilege('authenticated',
    'bm_intake_private.commit_typed_note_extraction(uuid,uuid,uuid,text,jsonb)','EXECUTE')
 or has_schema_privilege('authenticated','bm_intake_private','USAGE') then
   raise exception 'Untrusted client can commit an extraction';
 end if;
end;
$test$;

set role service_role;
do $test$
declare
 v_org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_actor uuid:='99999999-9999-4999-8999-999999999999';
 v_stranger uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 v_req uuid:='66666666-6666-4666-8666-666666666666';
 v_source uuid;
 v_text text:='Paint 2 rooms, café';
 v_original_sha text;
 v_source_sha text;
 v_review jsonb;
 v_result record;
begin
 select source_id,original_sha256 into v_source,v_original_sha
 from bm_intake_private.create_typed_note(v_org,v_actor,v_req,v_text);
 v_source_sha:=encode(sha256(
   convert_to('typed-note','UTF8') || decode('00','hex')
   || convert_to(v_text,'UTF8')),'hex');
 v_review:=jsonb_build_object(
   'state','needs-human-review','kind','typed-note',
   'sourceSha256',v_source_sha,'candidatesSha256',(v_review->>'candidatesSha256'),
   'candidates',jsonb_build_array(jsonb_build_object(
     'serviceCode','painting','units',2,
     'start',0,'end',5,'excerpt','Paint')));
 v_review:=jsonb_set(v_review,'{candidatesSha256}',to_jsonb(
   bm_intake_private.canonical_candidate_sha256(v_review->'candidates')));

 -- A valid foreign tenant and same-tenant non-creator cannot extract.
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_other,v_actor,v_source,v_original_sha,v_review);
  raise exception 'Cross-tenant review committed';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_org,v_stranger,v_source,v_original_sha,v_review);
  raise exception 'Same-tenant unrelated actor extracted source';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,gen_random_uuid(),v_original_sha,v_review);
  raise exception 'Absent source was distinguishable through success';
 exception when insufficient_privilege then null; end;

 -- Invalid expected revision, source binding and forged customer-facing
 -- controls fail without mutating the immutable original or extraction.
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,v_source,repeat('0',64),v_review);
  raise exception 'Wrong original digest committed';
 exception when serialization_failure then null; end;
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,v_source,v_original_sha,
   jsonb_set(v_review,'{sourceSha256}',to_jsonb(repeat('0',64))));
  raise exception 'Wrong source hash committed';
 exception when invalid_parameter_value then null; end;
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,v_source,v_original_sha,
   v_review||'{"approved":true}'::jsonb);
  raise exception 'Hidden approval field committed';
 exception when invalid_parameter_value then null; end;
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,v_source,v_original_sha,
   jsonb_set(v_review,'{candidates,0}',jsonb_build_object(
    'serviceCode','painting','units',2,'start',0,'end',5,
    'excerpt','Paint','rateCents',1)));
  raise exception 'Hidden price field committed';
 exception when invalid_parameter_value then null; end;
 if (select revision from public.bm_intake_sources
   where organization_id=v_org and id=v_source)<>1 then
   raise exception 'Rejected extraction mutated a source';
 end if;

 select * into v_result from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,v_source,v_original_sha,v_review);
 if v_result.source_revision<>2 or v_result.original_sha256<>v_original_sha
   or v_result.candidates_sha256<>(v_review->>'candidatesSha256') then
   raise exception 'Authorized extraction CAS returned wrong revision or hash';
 end if;
 if (select count(*) from public.bm_intake_sources
   where organization_id=v_org and id=v_source and revision=2
    and original_text=v_text and text_sha256=v_original_sha
    and review=v_review and scope_review is null
    and extraction_audit->0->>'actorId'=v_actor::text
    and (extraction_audit->0->>'sourceRevision')::integer=2
    and extraction_audit->0->>'sourceSha256'=v_source_sha
    and extraction_audit->0->>'candidatesSha256'=(v_review->>'candidatesSha256'))<>1 then
   raise exception 'Extraction CAS lost original evidence or actor audit';
 end if;
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,v_source,v_original_sha,v_review);
  raise exception 'Duplicate extraction changed an already reviewed source';
 exception when serialization_failure then null; end;
 if (select count(*) from public.bm_intake_sources
   where organization_id=v_org and created_by=v_actor)<>1 then
   raise exception 'Retry created a second source';
 end if;
end;
$test$;
reset role;

-- A revoked original creator cannot run CAS even when their source exists.
delete from public.bm_memberships
where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id='99999999-9999-4999-8999-999999999999';
set role service_role;
do $test$
declare
 v_source uuid;
 v_org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_actor uuid:='99999999-9999-4999-8999-999999999999';
begin
 select id into v_source from public.bm_intake_sources
 where organization_id=v_org and created_by=v_actor;
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,v_source,repeat('0',64),'{}'::jsonb);
  raise exception 'Revoked creator committed or learned source state';
 exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
select 'PASS: staged tenant-scoped typed-note extraction CAS and adverse cases';
