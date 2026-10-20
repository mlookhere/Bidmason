-- STAGING ONLY: accepted correction evidence -> nonquotable revision 5.
do $fixture$
declare r bm_intake_private.correction_evidence_reviews%rowtype;
 d bm_intake_private.correction_candidate_drafts%rowtype;
 s public.bm_intake_sources%rowtype;
begin
 select * into r from bm_intake_private.correction_evidence_reviews
 where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found or r.decision is distinct from 'accept-evidence' then
   raise exception 'Independent accepted evidence fixture missing';
 end if;
 select * into d from bm_intake_private.correction_candidate_drafts
 where organization_id=r.organization_id and source_id=r.source_id;
 select * into s from public.bm_intake_sources
 where organization_id=r.organization_id and id=r.source_id;
 if not found or s.revision<>4 or s.scope_review is not null
 or s.created_by is distinct from r.submitted_by
 or d.draft_sha256 is distinct from r.draft_sha256 then
  raise exception 'Invalid accepted evidence fixture state';
 end if;
 perform set_config('bm_ci.activate_source',r.source_id::text,false);
 perform set_config('bm_ci.activate_draft',r.draft_sha256,false);
 perform set_config('bm_ci.activate_review',r.evidence_review_sha256,false);
end;
$fixture$;

insert into public.bm_memberships(organization_id,user_id,member_role)
values ('dededede-dede-4ede-8ede-dededededede',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','owner');
do $priv$
begin
 if has_function_privilege('anon',
   'bm_intake_private.activate_reviewed_correction(uuid,uuid,uuid,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
   'bm_intake_private.activate_reviewed_correction(uuid,uuid,uuid,text,text)','EXECUTE')
 or has_table_privilege('service_role',
   'bm_intake_private.correction_activations','SELECT')
 or has_table_privilege('service_role',
   'bm_intake_private.correction_activations','INSERT')
 or has_table_privilege('authenticated',
   'bm_intake_private.correction_activations','SELECT') then
  raise exception 'Untrusted activation permission detected';
 end if;
end;
$priv$;

set role service_role;
do $test$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 creator uuid:='abababab-abab-4bab-8bab-abababababab';
 reviewer uuid:='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
 third uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 src uuid:=current_setting('bm_ci.activate_source')::uuid;
 draft_sha text:=current_setting('bm_ci.activate_draft');
 review_sha text:=current_setting('bm_ci.activate_review');
 prior public.bm_intake_sources%rowtype;
 receipt record;
begin
 select * into prior from public.bm_intake_sources
 where organization_id=org and id=src;
 if not found then raise exception 'Quarantine source missing'; end if;
 -- A fabricated revision 5 update has no matching private receipt.
 begin
  update public.bm_intake_sources set revision=5,
   correction_activation='{"state":"awaiting-renewed-human-scope-review"}'::jsonb
  where organization_id=org and id=src;
  raise exception 'Direct activation bypassed private ledger';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   org,creator,src,draft_sha,review_sha);
  raise exception 'Creator self-activated corrected evidence';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   org,third,src,draft_sha,review_sha);
  raise exception 'Unrelated owner accepted another review';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   org,'ffffffff-ffff-4fff-8fff-ffffffffffff',src,draft_sha,review_sha);
  raise exception 'Nonmember activated correction';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reviewer,src,draft_sha,review_sha);
  raise exception 'Foreign tenant activated correction';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   org,reviewer,gen_random_uuid(),draft_sha,review_sha);
  raise exception 'Missing source activated correction';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   org,reviewer,src,repeat('0',64),review_sha);
  raise exception 'Forged draft digest activated';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   org,reviewer,src,draft_sha,repeat('0',64));
  raise exception 'Forged evidence review digest activated';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   org,reviewer,src,null,review_sha);
  raise exception 'Null draft SHA activated';
 exception when invalid_parameter_value then null; end;
 select * into receipt from bm_intake_private.activate_reviewed_correction(
  org,reviewer,src,draft_sha,review_sha);
 if receipt.source_revision<>5
 or receipt.activation_sha256 !~ '^[a-f0-9]{64}$' then
  raise exception 'Activation receipt missing or malformed';
 end if;
 if (select count(*) from public.bm_intake_sources
   where organization_id=org and id=src and revision=5
     and review=prior.review
     and extraction_audit=prior.extraction_audit
     and original_text=prior.original_text
     and correction_hold=prior.correction_hold
     and scope_review is null
     and correction_activation->>'state'='awaiting-renewed-human-scope-review'
     and correction_activation->>'draftSha256'=draft_sha
     and correction_activation->>'evidenceReviewSha256'=review_sha)<>1 then
  raise exception 'Activation rewrote original or old scope';
 end if;
 begin
  perform bm_intake_private.activate_reviewed_correction(
   org,reviewer,src,draft_sha,review_sha);
  raise exception 'Stale activation replay allowed';
 exception when serialization_failure then null; end;
 begin
  update public.bm_intake_sources
   set correction_activation='{}'::jsonb
   where organization_id=org and id=src;
  raise exception 'Activation marker rewrite allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.commit_typed_note_scope_review(
   org,creator,src,prior.review->>'sourceSha256',
   prior.review->>'candidatesSha256','{}'::jsonb);
  raise exception 'Legacy scope review accepted correction rev5';
 exception when serialization_failure then null; end;
 begin
  perform bm_intake_private.stage_correction_candidate_draft(
   org,creator,src,prior.correction_hold->>'requestSha256',
   encode(sha256(convert_to(prior.correction_hold::text,'UTF8')),'hex'),
   prior.review->'candidates','[]'::jsonb,'Duplicate');
  raise exception 'Rev5 accepted new correction draft';
 exception when serialization_failure then null; end;
end;
$test$;
reset role;
do $owner$
declare
 a bm_intake_private.correction_activations%rowtype;
 s public.bm_intake_sources%rowtype;
 r bm_intake_private.correction_evidence_reviews%rowtype;
begin
 select * into a from bm_intake_private.correction_activations
 where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found then raise exception 'Private activation receipt missing'; end if;
 select * into s from public.bm_intake_sources
 where organization_id=a.organization_id and id=a.source_id;
 select * into r from bm_intake_private.correction_evidence_reviews
 where organization_id=a.organization_id and source_id=a.source_id;
 if s.revision<>5 or s.scope_review is not null
 or s.correction_activation is distinct from a.activation_marker
 or a.draft_sha256 is distinct from r.draft_sha256
 or a.evidence_review_sha256 is distinct from r.evidence_review_sha256
 or a.submitted_by=a.activated_by then
  raise exception 'Activation not linked to immutable reviewer evidence';
 end if;
 begin
  delete from bm_intake_private.correction_activations
  where organization_id=a.organization_id;
  raise exception 'Private activation deleted';
 exception when insufficient_privilege then null; end;
 begin
  update bm_intake_private.correction_activations
    set activated_by=submitted_by where organization_id=a.organization_id;
  raise exception 'Private activation rewritten';
 exception when insufficient_privilege then null; end;
end;
$owner$;
select 'PASS: independently accepted evidence -> revision5, no quote';
