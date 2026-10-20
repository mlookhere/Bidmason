-- Real disposable PostgreSQL: rev5 correction uses a NEW company-owned,
-- two-actor-approved policy for human scope, while remaining NON-QUOTABLE.
do $perm$
begin
 if has_function_privilege('anon',
    'bm_intake_private.review_corrected_scope_pending(uuid,uuid,uuid,text,text,integer,text,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('authenticated',
    'bm_intake_private.review_corrected_scope_pending(uuid,uuid,uuid,text,text,integer,text,jsonb,jsonb)','EXECUTE')
 or has_table_privilege('service_role',
    'bm_intake_private.corrected_scope_review_drafts','SELECT')
 or has_table_privilege('service_role',
    'bm_intake_private.corrected_scope_review_drafts','INSERT')
 or has_table_privilege('authenticated',
    'bm_intake_private.corrected_scope_review_drafts','SELECT') then
   raise exception 'Private corrected-scope review access leaked';
 end if;
end;
$perm$;

set role service_role;
do $review$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 creator uuid:='abababab-abab-4bab-8bab-abababababab';
 reviewer uuid:='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
 unrelated uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 src uuid;
 activation_sha text;
 proposed_sha text;
 source_review jsonb;
 v_prior_text text;
 source_hold jsonb;
 policy jsonb;
 policy_canonical text;
 active record;
 candidates jsonb;
 selected jsonb:='[0]'::jsonb;
 addons jsonb:='[]'::jsonb;
 response record;
 bad jsonb;
begin
 select s.id,s.review,s.original_text,s.correction_hold,
  correction_activation->>'activationSha256',
  correction_activation->>'proposedCandidatesSha256'
 into src,source_review,v_prior_text,source_hold,activation_sha,proposed_sha
 from public.bm_intake_sources s
 where s.organization_id=org and s.created_by=creator and s.revision=5;
 if not found then raise exception 'Rev5 correction activation fixture absent'; end if;
 -- No company policy has ever been approved for THIS tenant before now.
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,src,activation_sha,proposed_sha,1,repeat('1',64),selected,addons);
  raise exception 'No company-approved policy permitted corrected selection';
 exception when insufficient_privilege then null; end;
 policy:=jsonb_build_object(
  'revision',1,
  'pricing',jsonb_build_object('policyId','correction-painting-v1',
   'currency','USD','calculationOrder','surcharge-then-discount',
   'minimum',jsonb_build_object('rule','none','cents',0),
   'services',jsonb_build_object(
     'painting',jsonb_build_object('label','Painting','unit','room',
       'billing','charged','rateCents',23000,'optionalAddon',false),
     'cleaning',jsonb_build_object('label','Cleaning','unit','visit',
       'billing','pending','rateCents',9900))),
  'tax',jsonb_build_object('method','none','bps',0));
 -- JSONB::text is NOT the canonical TypeScript policy serialization.
 -- Store the actual canonical UTF-8 bytes; never accept a visually
 -- equivalent JSON policy whose SHA differs from the approved ratecard.
 policy_canonical:='{"pricing":{"calculationOrder":"surcharge-then-discount","currency":"USD","minimum":{"cents":0,"rule":"none"},"policyId":"correction-painting-v1","services":{"cleaning":{"billing":"pending","label":"Cleaning","rateCents":9900,"unit":"visit"},"painting":{"billing":"charged","label":"Painting","optionalAddon":false,"rateCents":23000,"unit":"room"}}},"revision":1,"tax":{"bps":0,"method":"none"}}';
 if policy_canonical::jsonb is distinct from policy then
  raise exception 'Canonical corrected policy fixture drifted from approved bytes';
 end if;
 perform bm_intake_private.ci_stage_approved_policy(
   org,creator,reviewer,policy_canonical);
 select * into active from bm_intake_private.activate_scope_policy(
   org,creator,reviewer,1,policy_canonical);
 if active.activated_revision<>1 then
  raise exception 'Two-person company policy approval fixture unavailable';
 end if;
 -- All denial cases run before one final successful immutable INSERT.
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,unrelated,src,activation_sha,proposed_sha,1,
   active.activated_sha256,selected,addons);
  raise exception 'Unrelated same-tenant member chose private corrected scope';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',creator,src,
   activation_sha,proposed_sha,1,active.activated_sha256,selected,addons);
  raise exception 'Foreign tenant selected corrected scope';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,gen_random_uuid(),activation_sha,proposed_sha,1,
   active.activated_sha256,selected,addons);
  raise exception 'Missing private corrected source was reviewed';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,src,repeat('0',64),proposed_sha,1,
   active.activated_sha256,selected,addons);
  raise exception 'Forged correction activation SHA accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,src,activation_sha,repeat('0',64),1,
   active.activated_sha256,selected,addons);
  raise exception 'Forged corrected candidate SHA accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,src,activation_sha,proposed_sha,1,
   repeat('0',64),selected,addons);
  raise exception 'Forged approved policy fingerprint accepted';
 exception when serialization_failure then null; end;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,src,activation_sha,proposed_sha,2,
   active.activated_sha256,selected,addons);
  raise exception 'Stale or unapproved ratecard revision accepted';
 exception when serialization_failure then null; end;
 -- A selection of nonexistent, duplicated or pending services must fail.
 foreach bad in array array[
   '[]'::jsonb,'[0,0]'::jsonb,'[1]'::jsonb,'[20]'::jsonb,
   '["0"]'::jsonb,'[null]'::jsonb
 ] loop
  begin
   perform bm_intake_private.review_corrected_scope_pending(
    org,creator,src,activation_sha,proposed_sha,1,
    active.activated_sha256,bad,addons);
   raise exception 'Invalid human selection accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,src,activation_sha,proposed_sha,1,
   active.activated_sha256,selected,'["painting"]'::jsonb);
  raise exception 'Nonoptional addon acknowledgement accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,src,activation_sha,proposed_sha,1,
   active.activated_sha256,selected,'["unknown"]'::jsonb);
  raise exception 'Unselected add-on was accepted';
 exception when invalid_parameter_value then null; end;
 begin
  insert into bm_intake_private.corrected_scope_review_drafts(
    organization_id,source_id,reviewed_by,source_sha256,
    corrected_candidates_sha256,activation_sha256,policy_revision,
    policy_sha256,selected_indices,accepted_addon_codes,
    review_key,reviewed_selection_sha256,review_receipt_sha256)
  values(org,src,creator,repeat('1',64),proposed_sha,activation_sha,1,
    active.activated_sha256,selected,addons,repeat('2',64),
    repeat('3',64),repeat('4',64));
  raise exception 'Direct service-role private review write accepted';
 exception when insufficient_privilege then null; end;
 select * into response from bm_intake_private.review_corrected_scope_pending(
   org,creator,src,activation_sha,proposed_sha,1,
   active.activated_sha256,selected,addons);
 if response.recorded_selection_sha256 !~ '^[a-f0-9]{64}$'
 or response.recorded_receipt_sha256 !~ '^[a-f0-9]{64}$' then
   raise exception 'New corrected-scope receipt malformed';
 end if;
 if (select count(*) from public.bm_intake_sources
  where organization_id=org and id=src and revision=5
   and original_text=v_prior_text and review=source_review
   and correction_hold=source_hold and scope_review is null)<>1 then
   raise exception 'Renewed review bypassed nonquotable source protection';
 end if;
 begin
  perform bm_intake_private.review_corrected_scope_pending(
   org,creator,src,activation_sha,proposed_sha,1,
   active.activated_sha256,selected,addons);
  raise exception 'Duplicate renewed human review accepted';
 exception when unique_violation then null; end;
 begin
  perform bm_intake_private.commit_typed_note_scope_review(
   org,creator,src,source_review->>'sourceSha256',
   source_review->>'candidatesSha256','{}'::jsonb);
  raise exception 'Legacy source review quoted corrected rev5';
 exception when serialization_failure then null; end;
end;
$review$;
reset role;
do $verify$
declare
 r bm_intake_private.corrected_scope_review_drafts%rowtype;
 s public.bm_intake_sources%rowtype;
 a bm_intake_private.correction_activations%rowtype;
 p bm_intake_private.active_policy_heads%rowtype;
 d bm_intake_private.correction_candidate_drafts%rowtype;
 v_review jsonb;
begin
 select * into r from bm_intake_private.corrected_scope_review_drafts
 where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found then raise exception 'Immutable corrected-scope review missing'; end if;
 select * into s from public.bm_intake_sources
 where organization_id=r.organization_id and id=r.source_id;
 select * into a from bm_intake_private.correction_activations
 where organization_id=r.organization_id and source_id=r.source_id;
 select * into d from bm_intake_private.correction_candidate_drafts
 where organization_id=r.organization_id and source_id=r.source_id;
 select * into p from bm_intake_private.active_policy_heads
 where organization_id=r.organization_id;
 v_review:=jsonb_build_object(
  'sourceSha256',r.source_sha256,
  'candidatesSha256',r.corrected_candidates_sha256,
  'candidates',d.proposed_candidates);
 if s.revision<>5 or s.scope_review is not null
 or r.activation_sha256 is distinct from a.activation_sha256
 or r.policy_revision is distinct from p.revision
 or r.policy_sha256 is distinct from p.policy_sha256
 or r.corrected_candidates_sha256 is distinct from d.proposed_candidates_sha256
 or r.review_key is distinct from bm_intake_private.review_workbench_sha256(
    r.source_sha256,r.corrected_candidates_sha256,r.policy_sha256)
 or r.reviewed_selection_sha256 is distinct from
    bm_intake_private.reviewed_selection_sha256(
     v_review,r.selected_indices,r.accepted_addon_codes,r.policy_sha256) then
   raise exception 'Review did not persist current corrected policy evidence';
 end if;
 begin
  delete from bm_intake_private.corrected_scope_review_drafts
  where organization_id=r.organization_id;
  raise exception 'Private reviewed scope receipt deleted';
 exception when insufficient_privilege then null; end;
 begin
  update bm_intake_private.corrected_scope_review_drafts
   set policy_sha256=repeat('0',64) where organization_id=r.organization_id;
  raise exception 'Private reviewed scope receipt rewritten';
 exception when insufficient_privilege then null; end;
end;
$verify$;
select 'PASS: current-policy corrected scope review remains nonquotable rev5';
