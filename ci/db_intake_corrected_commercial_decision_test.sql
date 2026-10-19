-- Disposable PostgreSQL: third independent current reviewer records private
-- INTERNAL commercial decision. This MUST NOT make revision 5 quotable.
do $priv$
begin
 if has_function_privilege('anon',
 'bm_intake_private.review_corrected_commercial_draft(uuid,uuid,uuid,text,integer,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
 'bm_intake_private.review_corrected_commercial_draft(uuid,uuid,uuid,text,integer,text,text,text)','EXECUTE')
 or has_table_privilege('service_role',
   'bm_intake_private.corrected_commercial_decisions','SELECT')
 or has_table_privilege('service_role',
   'bm_intake_private.corrected_commercial_decisions','INSERT')
 or has_table_privilege('authenticated',
   'bm_intake_private.corrected_commercial_decisions','SELECT') then
   raise exception 'Untrusted commercial decision privilege' using errcode='42501';
 end if;
end;
$priv$;
-- Only isolated CI owner can SELECT private receipts and save fixture
-- values. The service role remains unable to SELECT private evidence.
do $fixture$
declare
 r bm_intake_private.corrected_scope_review_drafts%rowtype;
 h bm_intake_private.active_policy_heads%rowtype;
 s public.bm_intake_sources%rowtype;
begin
 select * into r from bm_intake_private.corrected_scope_review_drafts
 where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found then raise exception 'Prior corrected scope review fixture absent'; end if;
 select * into h from bm_intake_private.active_policy_heads
 where organization_id=r.organization_id;
 select * into s from public.bm_intake_sources
 where organization_id=r.organization_id and id=r.source_id;
 if not found or s.revision<>5 or s.scope_review is not null
 or r.policy_revision is distinct from h.revision
 or r.policy_sha256 is distinct from h.policy_sha256 then
  raise exception 'Prior scope/policy fixture inconsistent';
 end if;
 perform set_config('bm_ci.commercial_source',r.source_id::text,false);
 perform set_config('bm_ci.commercial_scope_sha',r.review_receipt_sha256,false);
 perform set_config('bm_ci.commercial_policy_sha',h.policy_sha256,false);
 perform set_config('bm_ci.commercial_policy_rev',h.revision::text,false);
end;
$fixture$;
set role service_role;
do $proof$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 creator uuid:='abababab-abab-4bab-8bab-abababababab';
 evidence_reviewer uuid:='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
 commercial_reviewer uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 src uuid:=current_setting('bm_ci.commercial_source')::uuid;
 scope_sha text:=current_setting('bm_ci.commercial_scope_sha');
 policy_sha text:=current_setting('bm_ci.commercial_policy_sha');
 policy_rev integer:=current_setting('bm_ci.commercial_policy_rev')::integer;
 before_source public.bm_intake_sources%rowtype;
 reply record;
begin
 select * into before_source from public.bm_intake_sources
 where organization_id=org and id=src;
 if not found then raise exception 'Corrected source absent'; end if;
 -- The original human scope reviewer and evidence reviewer are barred.
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,creator,src,scope_sha,policy_rev,policy_sha,
   'approve-internal-draft','I approve my own correction');
  raise exception 'Original creator made own commercial decision';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,evidence_reviewer,src,scope_sha,policy_rev,policy_sha,
   'approve-internal-draft','I already reviewed evidence');
  raise exception 'Evidence reviewer made commercial decision';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,'ffffffff-ffff-4fff-8fff-ffffffffffff',src,
   scope_sha,policy_rev,policy_sha,'approve-internal-draft','Nonmember');
  raise exception 'Unauthorized nonmember made commercial decision';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',commercial_reviewer,src,
   scope_sha,policy_rev,policy_sha,'approve-internal-draft','Cross tenant');
  raise exception 'Cross-tenant commercial decision succeeded';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,gen_random_uuid(),
   scope_sha,policy_rev,policy_sha,'approve-internal-draft','Not this source');
  raise exception 'Absent private source commercial decision succeeded';
 exception when insufficient_privilege then null; end;
 -- Every SHA/revision is bound to immutable evidence and current policy.
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,src,repeat('0',64),policy_rev,policy_sha,
   'approve-internal-draft','Changed human scope');
  raise exception 'Forged scope SHA passed decision';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,src,scope_sha,policy_rev+1,policy_sha,
   'approve-internal-draft','Changed approved policy');
  raise exception 'Stale policy revision passed decision';
 exception when serialization_failure then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,src,scope_sha,policy_rev,repeat('0',64),
   'approve-internal-draft','Changed approved policy digest');
  raise exception 'Stale policy fingerprint passed decision';
 exception when serialization_failure then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,src,scope_sha,policy_rev,policy_sha,
   'approve-customer-quote','Not an internal-only outcome');
  raise exception 'Commercial quote/send decision was allowed';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,src,scope_sha,policy_rev,policy_sha,
   'approve-internal-draft',' ');
  raise exception 'Missing independent reason accepted';
 exception when invalid_parameter_value then null; end;
 begin
  insert into bm_intake_private.corrected_commercial_decisions(
   organization_id,source_id,original_creator,evidence_reviewer,
   commercial_reviewer,activation_sha256,corrected_candidates_sha256,
   selection_receipt_sha256,policy_revision,policy_sha256,decision,
   reviewer_reason,decision_sha256)
  values(org,src,creator,evidence_reviewer,commercial_reviewer,
   repeat('0',64),repeat('1',64),scope_sha,policy_rev,policy_sha,
   'approve-internal-draft','Faked',repeat('2',64));
  raise exception 'Service role forged commercial decision directly';
 exception when insufficient_privilege then null; end;
 select * into reply from bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,src,scope_sha,policy_rev,policy_sha,
   'approve-internal-draft','I independently reviewed the corrected internal selection');
 if reply.recorded_decision is distinct from 'approve-internal-draft'
 or reply.recorded_decision_sha256 !~ '^[0-9a-f]{64}$' then
  raise exception 'Third-actor decision receipt malformed';
 end if;
 -- Even commercial INTERNAL approval does not authorize a quote.
 if (select count(*) from public.bm_intake_sources
  where organization_id=org and id=src
   and revision=before_source.revision and revision=5
   and original_text=before_source.original_text
   and review=before_source.review
   and scope_review is null
   and correction_hold=before_source.correction_hold
   and correction_activation=before_source.correction_activation)<>1 then
  raise exception 'Commercial decision changed protected source / revived scope';
 end if;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,src,scope_sha,policy_rev,policy_sha,
   'approve-internal-draft','Replay');
  raise exception 'Duplicate internal commercial decision succeeded';
 exception when unique_violation then null; end;
 begin
  perform bm_intake_private.review_corrected_commercial_draft(
   org,commercial_reviewer,src,scope_sha,policy_rev,policy_sha,
   'reject-internal-draft','Overwrite prior decision');
  raise exception 'Commercial internal decision rewrite succeeded';
 exception when unique_violation then null; end;
 begin
  perform bm_intake_private.commit_typed_note_scope_review(
   org,creator,src,before_source.review->>'sourceSha256',
   before_source.review->>'candidatesSha256','{}'::jsonb);
  raise exception 'Legacy scope writer quoted internal approved correction';
 exception when serialization_failure then null; end;
end;
$proof$;
reset role;
do $owner$
declare
 d bm_intake_private.corrected_commercial_decisions%rowtype;
 s public.bm_intake_sources%rowtype;
 r bm_intake_private.corrected_scope_review_drafts%rowtype;
begin
 select * into d from bm_intake_private.corrected_commercial_decisions
 where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found or d.original_creator=d.commercial_reviewer
 or d.evidence_reviewer=d.commercial_reviewer
 or d.original_creator=d.evidence_reviewer then
  raise exception 'Third-party commercial evidence missing/invalid';
 end if;
 select * into r from bm_intake_private.corrected_scope_review_drafts
 where organization_id=d.organization_id and source_id=d.source_id;
 select * into s from public.bm_intake_sources
 where organization_id=d.organization_id and id=d.source_id;
 if d.selection_receipt_sha256 is distinct from r.review_receipt_sha256
 or d.policy_revision is distinct from r.policy_revision
 or d.policy_sha256 is distinct from r.policy_sha256
 or d.corrected_candidates_sha256 is distinct from r.corrected_candidates_sha256
 or s.scope_review is not null or s.revision<>5 then
  raise exception 'Third-party decision not bound to correct private scope';
 end if;
 begin
  delete from bm_intake_private.corrected_commercial_decisions
  where organization_id=d.organization_id;
  raise exception 'Immutable decision deleted';
 exception when insufficient_privilege then null; end;
 begin
  update bm_intake_private.corrected_commercial_decisions
   set decision='reject-internal-draft' where organization_id=d.organization_id;
  raise exception 'Immutable decision changed';
 exception when insufficient_privilege then null; end;
end;
$owner$;
select 'PASS: three actors, active company policy, INTERNAL decision, no quote';
