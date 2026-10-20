-- Disposable PostgreSQL: a different current actor reviews immutable
-- corrected-candidate EVIDENCE, never activates source or priced scope.
do $check$
begin
 if has_function_privilege('anon',
   'bm_intake_private.review_correction_evidence(uuid,uuid,uuid,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
   'bm_intake_private.review_correction_evidence(uuid,uuid,uuid,text,text,text)','EXECUTE')
 or has_table_privilege('service_role',
   'bm_intake_private.correction_evidence_reviews','SELECT')
 or has_table_privilege('service_role',
   'bm_intake_private.correction_evidence_reviews','INSERT')
 or has_table_privilege('authenticated',
   'bm_intake_private.correction_evidence_reviews','SELECT') then
   raise exception 'Private correction review privileges leaked';
 end if;
end;
$check$;
set role service_role;
do $check$
declare
 org uuid:='dededede-dede-4ede-8ede-dededededede';
 creator uuid:='abababab-abab-4bab-8bab-abababababab';
 reviewer uuid:='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
 src uuid;
 draft_sha text;
 existing_review jsonb;
 existing_original text;
 existing_hold jsonb;
 answer record;
begin
 select id,review,original_text,correction_hold
  into src,existing_review,existing_original,existing_hold
  from public.bm_intake_sources where organization_id=org
    and created_by=creator and revision=4;
 if not found then raise exception 'Correction quarantine fixture missing'; end if;
 -- The trusted service role is intentionally unable to read private draft
 -- tables. Only ephemeral CI owner can retrieve exact digest to test a call.
 -- This well-defined receipt was returned by the draft writer, so derive
 -- it from immutable original + stored known test fields in the CI fixture.
 draft_sha:=encode(sha256(convert_to(jsonb_build_array(
  org::text,src::text,creator::text,
  existing_hold->>'requestSha256',
  encode(sha256(convert_to(existing_hold::text,'UTF8')),'hex'),
  existing_review->>'candidatesSha256',
  bm_intake_private.canonical_candidate_sha256(jsonb_build_array(
    jsonb_build_object('serviceCode','painting','units',3,
      'start',0,'end',length(existing_original)+1,'excerpt',existing_original))),
  encode(sha256(convert_to(jsonb_build_array(jsonb_build_object(
     'action','replace','index',0,
     'candidate',jsonb_build_object('serviceCode','painting','units',3,
       'start',0,'end',length(existing_original)+1,'excerpt',existing_original),
     'reason','Correct model quantity'))::text,'UTF8')),'hex'),
  'Correct model quantity')::text,'UTF8')),'hex');
 -- Self review, wrong actor or tenant must not disclose private draft.
 begin
  perform bm_intake_private.review_correction_evidence(
   org,creator,src,draft_sha,'accept-evidence','Looks correct');
  raise exception 'Creator independently accepted own correction';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.review_correction_evidence(
   org,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',src,draft_sha,
   'accept-evidence','Looks correct');
  raise exception 'Nonmember reviewed private correction evidence';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_correction_evidence(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reviewer,src,draft_sha,
   'accept-evidence','Looks correct');
  raise exception 'Foreign tenant reviewed private correction evidence';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_correction_evidence(
   org,reviewer,gen_random_uuid(),draft_sha,'accept-evidence','Looks correct');
  raise exception 'Missing private source reviewed';
 exception when insufficient_privilege then null; end;
 begin
  perform bm_intake_private.review_correction_evidence(
   org,reviewer,src,repeat('0',64),'accept-evidence','Looks correct');
  raise exception 'Forged candidate draft hash accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.review_correction_evidence(
   org,reviewer,src,draft_sha,'approve','Looks correct');
  raise exception 'Commercial approval masqueraded as evidence review';
 exception when invalid_parameter_value then null; end;
 begin
  perform bm_intake_private.review_correction_evidence(
   org,reviewer,src,draft_sha,'accept-evidence',' ');
  raise exception 'Empty reviewer explanation accepted';
 exception when invalid_parameter_value then null; end;
 begin
  insert into bm_intake_private.correction_evidence_reviews(
   organization_id,source_id,submitted_by,reviewed_by,request_sha256,
   draft_sha256,proposed_candidates_sha256,decision,reviewer_reason,
   evidence_review_sha256
  ) values(org,src,creator,reviewer,repeat('1',64),draft_sha,
   repeat('2',64),'accept-evidence','Forgery',repeat('3',64));
  raise exception 'Service-role direct evidence review insert succeeded';
 exception when insufficient_privilege then null; end;
 select * into answer from bm_intake_private.review_correction_evidence(
   org,reviewer,src,draft_sha,'accept-evidence',
   'I independently reviewed this source-bound correction evidence');
 if answer.recorded_decision is distinct from 'accept-evidence'
   or answer.recorded_review_sha256 !~ '^[a-f0-9]{64}$' then
   raise exception 'Independent review receipt malformed';
 end if;
 -- Evidence acceptance does NOT change a source or commercial scope.
 if (select count(*) from public.bm_intake_sources
  where organization_id=org and id=src and revision=4
    and review=existing_review and original_text=existing_original
    and correction_hold=existing_hold and scope_review is null)<>1 then
   raise exception 'Evidence-only review accidentally activated source';
 end if;
 begin
  perform bm_intake_private.review_correction_evidence(
   org,reviewer,src,draft_sha,'accept-evidence','Repeat');
  raise exception 'Evidence review was replayed';
 exception when unique_violation then null; end;
 begin
  perform bm_intake_private.review_correction_evidence(
   org,reviewer,src,draft_sha,'reject-evidence','Changed decision');
  raise exception 'Evidence acceptance overwritten by rejection';
 exception when unique_violation then null; end;
 begin
  perform bm_intake_private.commit_typed_note_scope_review(
   org,creator,src,existing_review->>'sourceSha256',
   existing_review->>'candidatesSha256','{}'::jsonb);
  raise exception 'Evidence receipt bypassed legacy scope gate';
 exception when serialization_failure then null; end;
end;
$check$;
reset role;
-- Only isolated test owner can inspect and attempt mutation of private rows.
do $check$
declare
 rowdata bm_intake_private.correction_evidence_reviews%rowtype;
 source_data public.bm_intake_sources%rowtype;
 draft_data bm_intake_private.correction_candidate_drafts%rowtype;
begin
 select * into rowdata from bm_intake_private.correction_evidence_reviews
  where organization_id='dededede-dede-4ede-8ede-dededededede';
 if not found or rowdata.submitted_by=rowdata.reviewed_by
   or rowdata.decision is distinct from 'accept-evidence' then
  raise exception 'Reviewer receipt missing or self-approved';
 end if;
 select * into draft_data from bm_intake_private.correction_candidate_drafts
  where organization_id=rowdata.organization_id and source_id=rowdata.source_id;
 select * into source_data from public.bm_intake_sources
  where organization_id=rowdata.organization_id and id=rowdata.source_id;
 if rowdata.draft_sha256 is distinct from draft_data.draft_sha256
   or rowdata.proposed_candidates_sha256 is distinct from
       draft_data.proposed_candidates_sha256
   or not bm_intake_private.replay_correction_actions(
      source_data.review->'candidates',draft_data.correction_actions,
      draft_data.proposed_candidates) then
   raise exception 'Independent reviewer receipt not source-bound';
 end if;
 begin
  delete from bm_intake_private.correction_evidence_reviews
   where organization_id=rowdata.organization_id;
  raise exception 'Immutable reviewer receipt deletion succeeded';
 exception when insufficient_privilege then null; end;
 begin
  update bm_intake_private.correction_evidence_reviews
   set decision='reject-evidence' where organization_id=rowdata.organization_id;
  raise exception 'Immutable reviewer receipt decision changed';
 exception when insufficient_privilege then null; end;
end;
$check$;
select 'PASS: independent correction evidence reviewer, no quote activation';
