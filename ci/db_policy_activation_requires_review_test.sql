-- Disposable isolated PostgreSQL only: even two CURRENT member UUIDs are
-- insufficient to activate a ratecard without a separately recorded review.
do $contract$
declare
 v_org uuid:=gen_random_uuid();v_submitter uuid:=gen_random_uuid();
 v_reviewer uuid:=gen_random_uuid();v_other uuid:=gen_random_uuid();
 v_policy jsonb;v_modified jsonb;v_sha text;v_receipt record;
begin
 insert into public.bm_organizations(id,slug,name)
 values(v_org,'proof-'+v_org::text,'Independent policy approval proof');
 insert into public.bm_memberships(organization_id,user_id,member_role)
 values(v_org,v_submitter,'operator'),(v_org,v_reviewer,'owner'),
       (v_org,v_other,'owner');
 v_policy:=jsonb_build_object('revision',1,
   'pricing',jsonb_build_object('policyId','verified-activation-v1',
     'currency','USD','calculationOrder','discount-then-surcharge',
     'minimum',jsonb_build_object('rule','none','cents',0),
     'services',jsonb_build_object('cleaning',
        jsonb_build_object('label','Cleaning','unit','visit',
          'billing','charged','rateCents',12345))),
   'tax',jsonb_build_object('method','none','bps',0));
 v_sha:=encode(sha256(convert_to(v_policy::text,'UTF8')),'hex');
 -- Bypassing the activation function must NOT be possible by inserting a
 -- syntactically valid immutable approved version and active head directly.
 begin
   insert into bm_intake_private.approved_policy_versions(
     organization_id,revision,policy_sha256,policy,submitted_by,reviewed_by)
   values(v_org,1,v_sha,v_policy,v_submitter,v_reviewer);
   insert into bm_intake_private.active_policy_heads(
     organization_id,revision,policy_sha256) values(v_org,1,v_sha);
   raise exception 'First active head accepted without any review evidence';
 exception when insufficient_privilege then null;
 end;
 begin
   perform 1 from bm_intake_private.activate_scope_policy(
     v_org,v_submitter,v_reviewer,1,v_policy::text);
   raise exception 'Private activation accepted two member UUIDs as approval';
 exception when serialization_failure then null;
 end;
 if exists(select 1 from bm_intake_private.active_policy_heads
      where organization_id=v_org)
   or exists(select 1 from bm_intake_private.approved_policy_versions
      where organization_id=v_org) then
   raise exception 'Unreviewed activation left private policy version/head';
 end if;
 select submitted_sha256 into v_receipt
 from bm_intake_private.submit_policy_history_draft(
   v_org,v_submitter,0,null,v_policy::text);
 if v_receipt.submitted_sha256<>v_sha then
   raise exception 'Synthetic submitted SHA inconsistent'; end if;
 begin
   perform 1 from bm_intake_private.activate_scope_policy(
     v_org,v_submitter,v_reviewer,1,v_policy::text);
   raise exception 'Unreviewed draft activated';
 exception when serialization_failure then null; end;
 perform 1 from bm_intake_private.review_policy_history_draft(
   v_org,v_reviewer,1,v_sha,'approve');
 begin
   perform 1 from bm_intake_private.activate_scope_policy(
     v_org,v_submitter,v_other,1,v_policy::text);
   raise exception 'Another current owner impersonated the real reviewer';
 exception when serialization_failure then null; end;
 v_modified:=jsonb_set(v_policy,'{pricing,policyId}',
   '"modified-without-new-review"'::jsonb);
 begin
   perform 1 from bm_intake_private.activate_scope_policy(
     v_org,v_submitter,v_reviewer,1,v_modified::text);
   raise exception 'Changed policy bytes activated with older approval';
 exception when serialization_failure then null; end;
 select * into v_receipt from bm_intake_private.activate_scope_policy(
   v_org,v_submitter,v_reviewer,1,v_policy::text);
 if v_receipt.activated_revision<>1
   or v_receipt.activated_sha256<>v_sha then
   raise exception 'Genuine independently reviewed policy did not activate';
 end if;
 -- A service role cannot jump the head by inserting a fake adjacent
 -- immutable approved row: HEAD triggers must enforce recorded approvals.
 v_modified:=jsonb_set(jsonb_set(v_policy,'{revision}','2'::jsonb),
   '{pricing,policyId}','"invented-adjacent-v2"'::jsonb);
 begin
   insert into bm_intake_private.approved_policy_versions(
     organization_id,revision,policy_sha256,policy,submitted_by,reviewed_by)
   values(v_org,2,
     encode(sha256(convert_to(v_modified::text,'UTF8')),'hex'),
     v_modified,v_submitter,v_reviewer);
   update bm_intake_private.active_policy_heads
   set revision=2,policy_sha256=
      encode(sha256(convert_to(v_modified::text,'UTF8')),'hex')
   where organization_id=v_org;
   raise exception 'Head accepted adjacent policy without independent review';
 exception when insufficient_privilege then null; end;
 if (select revision from bm_intake_private.active_policy_heads
      where organization_id=v_org)<>1
   or (select count(*) from bm_intake_private.approved_policy_versions
      where organization_id=v_org)<>1 then
   raise exception 'Forged head or approved version persisted';
 end if;
 raise notice 'PASS: initial and adjacent policy activation require immutable two-person review';
end;
$contract$;
