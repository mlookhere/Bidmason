-- Disposable Postgres only. Verify the source review CAS observes the
-- locked ACTIVE approved policy, not an arbitrary policy SHA in the request.
do $policy$
begin
 if has_table_privilege('anon',
    'bm_intake_private.approved_policy_versions','SELECT')
 or has_table_privilege('authenticated',
    'bm_intake_private.active_policy_heads','SELECT')
 or has_function_privilege('authenticated',
    'bm_intake_private.activate_scope_policy(uuid,uuid,uuid,integer,text)','EXECUTE') then
  raise exception 'Public access to company policy activation tables';
 end if;
end;
$policy$;

insert into public.bm_memberships(organization_id,user_id,member_role)
 values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '12121212-1212-4212-8212-121212121212','operator');

set role service_role;
do $policy$
declare
 v_org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_creator uuid:='12121212-1212-4212-8212-121212121212';
 v_reviewer uuid:='88888888-8888-4888-8888-888888888888';
 v_other uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 v_text text:='Paint office and clean hall';
 v_source uuid;
 v_source2 uuid;
 v_orig text;
 v_source_sha text;
 v_candidates jsonb;
 v_review jsonb;
 v_scope jsonb;
 v_active record;
 v_policy jsonb;
 v_reply record;
begin
 select source_id,original_sha256 into v_source,v_orig
 from bm_intake_private.create_typed_note(
   v_org,v_creator,'14141414-1414-4414-8414-141414141414',v_text);
 v_source_sha:=encode(sha256(convert_to('typed-note','UTF8')
    ||decode('00','hex')||convert_to(v_text,'UTF8')),'hex');
 v_candidates:=jsonb_build_array(
   jsonb_build_object('serviceCode','painting','units',1,
      'start',0,'end',5,'excerpt','Paint'),
   jsonb_build_object('serviceCode','cleaning','units',1,
      'start',17,'end',22,'excerpt','clean'));
 v_review:=jsonb_build_object(
   'state','needs-human-review','kind','typed-note',
   'sourceSha256',v_source_sha,
   'candidatesSha256',bm_intake_private.canonical_candidate_sha256(v_candidates),
   'candidates',v_candidates);
 select * into v_reply from bm_intake_private.commit_typed_note_extraction(
   v_org,v_creator,v_source,v_orig,v_review);
 if v_reply.source_revision<>2 then raise exception 'Extraction setup failed'; end if;
 select revision,policy_sha256 into v_active from
 bm_intake_private.active_policy_heads where organization_id=v_org;
 if v_active.revision<>1 then raise exception 'Prior policy activation missing'; end if;
 v_scope:=jsonb_build_object(
   'state','reviewed-for-proposal-draft','sourceRevision',3,
   'reviewedBy',v_creator::text,'reviewKey',repeat('1',64),
   'sourceSha256',v_source_sha,
   'candidatesSha256',v_review->>'candidatesSha256',
   'selectedIndices','[1]'::jsonb,'acceptedAddonCodes','[]'::jsonb,
   'policyRevision',1,'policySha256',v_active.policy_sha256,
   'reviewedSelectionSha256',repeat('3',64));
 -- Cleaning is pending in rev 1, even though the browser knows the code.
 begin
   perform 1 from bm_intake_private.commit_typed_note_scope_review(
     v_org,v_creator,v_source,v_source_sha,
     v_review->>'candidatesSha256',v_scope);
   raise exception 'Pending commercial terms were selected';
 exception when invalid_parameter_value then null; end;
 -- A pricing activation requires two different CURRENT same-tenant actors.
 v_policy:=jsonb_build_object(
   'revision',2,
   'pricing',jsonb_build_object('policyId','synthetic-painting-v2',
     'currency','USD',
     'minimum',jsonb_build_object('rule','none','cents',0),
     'calculationOrder','surcharge-then-discount',
     'services',jsonb_build_object(
      'painting',jsonb_build_object('label','Painting','unit','room',
        'billing','charged','rateCents',27500,'optionalAddon',true),
      'cleaning',jsonb_build_object('label','Cleaning','unit','visit',
        'billing','charged','rateCents',12000))),
   'tax',jsonb_build_object('method','none','bps',0));
 perform bm_intake_private.ci_stage_approved_policy(
   v_org,v_creator,v_reviewer,v_policy::text);
 begin
   perform 1 from bm_intake_private.activate_scope_policy(
      v_org,v_creator,v_creator,2,v_policy::text);
   raise exception 'Policy self-approval succeeded';
 exception when invalid_parameter_value then null; end;
 begin
   perform 1 from bm_intake_private.activate_scope_policy(
      v_org,v_creator,v_other,2,v_policy::text);
   raise exception 'Nonmember approved company pricing';
 exception when insufficient_privilege then null; end;
 begin
   perform 1 from bm_intake_private.activate_scope_policy(
      v_org,v_creator,v_reviewer,4,v_policy::text);
   raise exception 'Non-sequential policy head advanced';
 exception when invalid_parameter_value or serialization_failure then null; end;
 select * into v_active from bm_intake_private.activate_scope_policy(
    v_org,v_creator,v_reviewer,2,v_policy::text);
 if v_active.activated_revision<>2 then
   raise exception 'Approved policy v2 activation failed'; end if;
 -- The caller's old policy hash is stale, even for still-valid painting.
 v_scope:=jsonb_set(v_scope,'{selectedIndices}','[0]'::jsonb);
 begin
   perform 1 from bm_intake_private.commit_typed_note_scope_review(
     v_org,v_creator,v_source,v_source_sha,
     v_review->>'candidatesSha256',v_scope);
   raise exception 'Old ratecard policy bound to current source';
 exception when serialization_failure then null; end;
 v_scope:=jsonb_set(v_scope,'{policyRevision}','2'::jsonb);
 v_scope:=jsonb_set(v_scope,'{policySha256}',
    to_jsonb(v_active.activated_sha256));
 v_scope:=jsonb_set(v_scope,'{reviewKey}',to_jsonb(
   bm_intake_private.review_workbench_sha256(
     v_source_sha,v_review->>'candidatesSha256',v_active.activated_sha256)));
 -- Painting is optional in the now-active approved policy.
 begin
   perform 1 from bm_intake_private.commit_typed_note_scope_review(
     v_org,v_creator,v_source,v_source_sha,
     v_review->>'candidatesSha256',v_scope);
   raise exception 'Optional painting scope lacked explicit acknowledgement';
 exception when invalid_parameter_value then null; end;
 v_scope:=jsonb_set(v_scope,'{acceptedAddonCodes}','["painting"]'::jsonb);
 v_scope:=jsonb_set(v_scope,'{reviewedSelectionSha256}',to_jsonb(
   bm_intake_private.reviewed_selection_sha256(
     v_review,v_scope->'selectedIndices',v_scope->'acceptedAddonCodes',
     v_active.activated_sha256)));
 select * into v_reply from bm_intake_private.commit_typed_note_scope_review(
     v_org,v_creator,v_source,v_source_sha,
     v_review->>'candidatesSha256',v_scope);
 if v_reply.source_revision<>3 or
   (select scope_review from public.bm_intake_sources
     where organization_id=v_org and id=v_source)<>v_scope then
   raise exception 'Current approved optional service was not reviewable'; end if;
 -- Immutable approvals cannot be silently rewritten after activation.
 begin
  update bm_intake_private.approved_policy_versions
   set policy_sha256=repeat('0',64) where organization_id=v_org
     and revision=2;
  raise exception 'Approved policy version was mutable';
 exception when insufficient_privilege then null; end;
 -- Direct pointer rollback must fail even though the old approved
 -- revision is still present in immutable history.
 begin
   update bm_intake_private.active_policy_heads
   set revision=1,policy_sha256=(
     select policy_sha256 from bm_intake_private.approved_policy_versions
      where organization_id=v_org and revision=1)
   where organization_id=v_org;
   raise exception 'Direct approved policy rollback was allowed';
 exception when insufficient_privilege then null; end;
 if (select revision from bm_intake_private.active_policy_heads
   where organization_id=v_org)<>2 then
   raise exception 'Unauthorized approval changed the active head'; end if;
end;
$policy$;
reset role;
select 'PASS: only the current, distinct-two-actor company policy unlocks eligible review';
