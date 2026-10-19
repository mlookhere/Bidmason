-- Staging only: independently reject commercially invalid or forged
-- company policy parameters in real disposable PostgreSQL, not just JS.
do $economics$
declare
 v_org uuid:=gen_random_uuid();
 v_submitter uuid:=gen_random_uuid();
 v_reviewer uuid:=gen_random_uuid();
 v_policy jsonb;
 v_bad jsonb;
 v_cases jsonb[];
 v_activation record;
 v_reject_count integer:=0;
begin
 insert into public.bm_organizations(id,slug,name)
 values(v_org,'economics-'||v_org::text,'Synthetic policy economics');
 insert into public.bm_memberships(organization_id,user_id,member_role)
 values(v_org,v_submitter,'operator'),(v_org,v_reviewer,'owner');
 v_policy:=jsonb_build_object(
  'revision',1,
  'pricing',jsonb_build_object('policyId','strict-economics-v1',
    'currency','USD','calculationOrder','discount-then-surcharge',
    'minimum',jsonb_build_object('rule','none','cents',0),
    'services',jsonb_build_object(
      'office',jsonb_build_object('label','Office clean','unit','visit',
        'rateCents',7500,'billing','charged',
        'surchargeBps',250,'discountBps',100,'optionalAddon',false),
      'quarterly',jsonb_build_object('label','Quarterly','unit','visit',
        'rateCents',12000,'billing','pending'))),
  'tax',jsonb_build_object('method','none','bps',0),
  'excludedServiceCodes',jsonb_build_array('quarterly'),
  'unitDirectCostsCents',jsonb_build_object('office',2000));
 v_cases:=array[
   jsonb_set(v_policy,'{pricing,policyId}','""'::jsonb),
   jsonb_set(v_policy,'{pricing,minimum,cents}','1'::jsonb),
   jsonb_set(v_policy,'{tax,bps}','1'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,surchargeBps}','10001'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,surchargeBps}','-1'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,surchargeBps}','1.5'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,surchargeBps}','"100"'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,discountBps}','10001'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,discountBps}','-1'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,discountBps}','1.5'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,discountBps}','null'::jsonb),
   jsonb_set(v_policy,'{excludedServiceCodes}',jsonb_build_array('unknown')),
   jsonb_set(v_policy,'{excludedServiceCodes}',
      jsonb_build_array('quarterly','quarterly')),
   jsonb_set(v_policy,'{excludedServiceCodes}',jsonb_build_array(100)),
   jsonb_set(v_policy,'{excludedServiceCodes}','{}'::jsonb),
   jsonb_set(v_policy,'{unitDirectCostsCents}','[]'::jsonb),
   jsonb_set(v_policy,'{unitDirectCostsCents,unknown}','25'::jsonb),
   jsonb_set(v_policy,'{unitDirectCostsCents,office}','-1'::jsonb),
   jsonb_set(v_policy,'{unitDirectCostsCents,office}','2.5'::jsonb),
   jsonb_set(v_policy,'{unitDirectCostsCents,office}','"2000"'::jsonb),
   jsonb_set(v_policy,'{unitDirectCostsCents,office}','9007199254740992'::jsonb),
   jsonb_set(v_policy,'{pricing,minimum,cents}','9007199254740992'::jsonb),
   jsonb_set(v_policy,'{pricing,services,office,rateCents}',
      '9007199254740992'::jsonb)
 ];
 foreach v_bad in array v_cases loop
   begin
     perform 1 from bm_intake_private.activate_scope_policy(
       v_org,v_submitter,v_reviewer,1,v_bad::text);
     raise exception 'Invalid economics activated: %',v_bad
       using errcode='P0001';
   exception when invalid_parameter_value then
     v_reject_count:=v_reject_count+1;
   end;
 end loop;
 if v_reject_count<>array_length(v_cases,1)
    or exists(select 1 from bm_intake_private.active_policy_heads
       where organization_id=v_org)
    or exists(select 1 from bm_intake_private.approved_policy_versions
       where organization_id=v_org) then
   raise exception 'Rejected economics left a policy head or approval';
 end if;
 perform bm_intake_private.ci_stage_approved_policy(
    v_org,v_submitter,v_reviewer,v_policy::text);
 select * into v_activation from bm_intake_private.activate_scope_policy(
    v_org,v_submitter,v_reviewer,1,v_policy::text);
 if v_activation.activated_revision<>1
   or v_activation.activated_sha256<>encode(
      sha256(convert_to(v_policy::text,'UTF8')),'hex') then
   raise exception 'Valid company economics or checksum were not activated';
 end if;
 -- Invalid next revision may not overtake a previously valid active policy.
 v_bad:=jsonb_set(jsonb_set(v_policy,'{revision}','2'::jsonb),
     '{tax,bps}','1'::jsonb);
 begin
    perform 1 from bm_intake_private.activate_scope_policy(
      v_org,v_submitter,v_reviewer,2,v_bad::text);
    raise exception 'Invalid revision 2 unexpectedly activated';
 exception when invalid_parameter_value then null;
 end;
 if (select revision from bm_intake_private.active_policy_heads
     where organization_id=v_org)<>1
   or (select count(*) from bm_intake_private.approved_policy_versions
     where organization_id=v_org)<>1 then
   raise exception 'Rejected successor mutated immutable company policy';
 end if;
 raise notice 'PASS: % invalid economics rejected, valid version persisted',v_reject_count;
end;
$economics$;
select 'PASS: independent SQL company economics validation; no sending or billing';
