-- STAGING ONLY: source-bound private correction DRAFT, NOT activation.
-- Requires typed_note_correction_quarantine.sql and extraction digest helpers.
-- Quarantined revision 4 and old scope remain unchanged and unquotable.
create table bm_intake_private.correction_candidate_drafts (
 organization_id uuid not null,
 source_id uuid not null,
 actor_id uuid not null,
 request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
 hold_sha256 text not null check(hold_sha256 ~ '^[0-9a-f]{64}$'),
 original_candidates_sha256 text not null check(original_candidates_sha256 ~ '^[0-9a-f]{64}$'),
 proposed_candidates_sha256 text not null check(proposed_candidates_sha256 ~ '^[0-9a-f]{64}$'),
 proposed_candidates jsonb not null check(jsonb_typeof(proposed_candidates)='array'),
 correction_actions jsonb not null check(jsonb_typeof(correction_actions)='array'),
 actions_sha256 text not null check(actions_sha256 ~ '^[0-9a-f]{64}
 reason text not null check(length(reason) between 1 and 500 and octet_length(reason)<=1000),
 draft_sha256 text not null check(draft_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 primary key(organization_id,source_id),
 foreign key(organization_id,source_id)
  references public.bm_intake_sources(organization_id,id)
  on update restrict on delete restrict,
 check(original_candidates_sha256 <> proposed_candidates_sha256)
);
revoke all on bm_intake_private.correction_candidate_drafts
 from public,anon,authenticated,service_role;
create trigger bm_correction_candidate_draft_immutable
 before update or delete on bm_intake_private.correction_candidate_drafts
 for each row execute function bm_intake_private.reject_correction_hold_mutation();


-- Apply human edits independently against the immutable provider snapshot.
-- This is NOT a quote approval or the JS correctionSha256 algorithm.
create function bm_intake_private.replay_correction_actions(
 p_original jsonb,p_changes jsonb,p_proposed jsonb
) returns boolean language plpgsql immutable security invoker
set search_path=pg_catalog,public,bm_intake_private as $replay$
declare
 v_action jsonb;
 v_candidate jsonb;
 v_edits jsonb:='{}'::jsonb;
 v_added jsonb:='[]'::jsonb;
 v_result jsonb:='[]'::jsonb;
 v_kind text;
 v_reason text;
 v_index integer;
 v_count integer;
 v_allowed text[];
begin
 if p_original is null or jsonb_typeof(p_original) is distinct from 'array'
   or p_proposed is null or jsonb_typeof(p_proposed) is distinct from 'array'
   or p_changes is null or jsonb_typeof(p_changes) is distinct from 'array'
   or pg_column_size(p_changes)>32768
   or jsonb_array_length(p_changes) not between 1 and 100 then
   return false;
 end if;
 v_count:=jsonb_array_length(p_original);
 if v_count not between 1 and 50 then return false; end if;
 for v_action in select value from jsonb_array_elements(p_changes) loop
   if jsonb_typeof(v_action) is distinct from 'object' then return false; end if;
   v_kind:=v_action->>'action';
   v_allowed:=case v_kind
     when 'add' then array['action','candidate','reason']
     when 'replace' then array['action','index','candidate','reason']
     when 'remove' then array['action','index','reason']
     else null end;
   if v_allowed is null
     or (select count(*) from jsonb_object_keys(v_action))<>array_length(v_allowed,1)
     or exists (select 1 from jsonb_object_keys(v_action) k where k <> all(v_allowed))
     or jsonb_typeof(v_action->'reason') is distinct from 'string' then
     return false;
   end if;
   v_reason:=v_action->>'reason';
   if v_reason is null or v_reason<>btrim(v_reason)
     or length(v_reason) not between 1 and 500
     or octet_length(v_reason)>1000 or v_reason ~ '[[:cntrl:]]' then
     return false;
   end if;
   if v_kind in ('add','replace') then
     v_candidate:=v_action->'candidate';
     -- The caller's FINAL candidates have already passed the full schema,
     -- provenance, UTF-16 offset and duplicate-service validations.
     if jsonb_typeof(v_candidate) is distinct from 'object'
       or not exists (select 1 from jsonb_array_elements(p_proposed) c
         where c.value=v_candidate) then
       return false;
     end if;
   end if;
   if v_kind='add' then
     v_added:=v_added||jsonb_build_array(v_candidate);
   else
     if jsonb_typeof(v_action->'index') is distinct from 'number'
       or coalesce(v_action->>'index','') !~ '^(0|[1-9][0-9]{0,5})
-- This function is not an HTTP endpoint, provider integration or approval.
create function bm_intake_private.stage_correction_candidate_draft(
 p_org uuid,p_actor uuid,p_source uuid,p_request_sha text,
 p_expected_hold_sha text,p_candidates jsonb,p_changes jsonb,p_reason text
) returns table(stored_candidates_sha256 text,stored_draft_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private
as $stage$
declare
 v_source public.bm_intake_sources%rowtype;
 v_hold bm_intake_private.correction_holds%rowtype;
 v_hold_sha text;
 v_original_sha text;
 v_proposed_sha text;
 v_draft_sha text;
 v_actions_sha text;
 v_count integer;
begin
 if p_org is null or p_actor is null or p_source is null
   or coalesce(p_request_sha,'') !~ '^[0-9a-f]{64}$'
   or coalesce(p_expected_hold_sha,'') !~ '^[0-9a-f]{64}$'
   or p_candidates is null or jsonb_typeof(p_candidates) is distinct from 'array'
   or pg_column_size(p_candidates)>32768
   or p_reason is null or p_reason<>btrim(p_reason)
   or length(p_reason) not between 1 and 500
   or octet_length(p_reason)>1000 or p_reason ~ '[[:cntrl:]]' then
   raise exception 'Invalid staged correction candidate request' using errcode='22023';
 end if;
 -- Lock CURRENT membership before disclosing either source or absence.
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=p_actor
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 select * into v_source from public.bm_intake_sources
  where organization_id=p_org and id=p_source and created_by=p_actor for update;
 if not found then
   raise exception 'Private quarantined source unavailable' using errcode='42501';
 end if;
 if v_source.revision<>4 or v_source.scope_review is not null
   or jsonb_typeof(v_source.correction_hold) is distinct from 'object'
   or v_source.correction_hold->>'state' is distinct from
      'quarantined-awaiting-correction'
   or v_source.review is null
   or jsonb_typeof(v_source.review->'candidates') is distinct from 'array'
   or jsonb_typeof(v_source.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_source.extraction_audit)<>1 then
   raise exception 'Correction source not quarantined or stale' using errcode='40001';
 end if;
 select * into v_hold from bm_intake_private.correction_holds
  where organization_id=p_org and source_id=p_source for share;
 v_hold_sha:=encode(sha256(convert_to(v_source.correction_hold::text,'UTF8')),'hex');
 v_original_sha:=bm_intake_private.canonical_candidate_sha256(
  v_source.review->'candidates');
 if not found or v_hold.actor_id is distinct from p_actor
   or v_hold.previous_revision not in (2,3)
   or v_hold.request_sha256 is distinct from p_request_sha
   or v_hold.hold is distinct from v_source.correction_hold
   or v_hold_sha is distinct from p_expected_hold_sha
   or v_source.correction_hold->>'requestSha256' is distinct from p_request_sha
   or v_source.correction_hold->>'candidatesSha256' is distinct from v_original_sha
   or v_source.review->>'candidatesSha256' is distinct from v_original_sha
   or v_source.extraction_audit->0->>'candidatesSha256' is distinct from v_original_sha
   or v_source.extraction_audit->0->>'actorId' is distinct from p_actor::text
   or v_source.extraction_audit->0->>'sourceRevision' is distinct from '2'
   or v_source.review->>'sourceSha256' is distinct from
     encode(sha256(convert_to('typed-note','UTF8')||decode('00','hex')
       ||convert_to(v_source.original_text,'UTF8')),'hex') then
   raise exception 'Correction quarantine receipt does not match original'
    using errcode='22023';
 end if;
 v_count:=jsonb_array_length(p_candidates);
 if v_count not between 1 and 50 or exists (
  select 1 from jsonb_array_elements(p_candidates) c
  where jsonb_typeof(c) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(
      case when jsonb_typeof(c)='object' then c else '{}'::jsonb end))<>5
    or exists (select 1 from jsonb_object_keys(
      case when jsonb_typeof(c)='object' then c else '{}'::jsonb end) k
      where k not in ('serviceCode','units','start','end','excerpt'))
    or jsonb_typeof(c->'serviceCode') is distinct from 'string'
    or coalesce(c->>'serviceCode','') !~ '^[a-z][a-z0-9_-]{0,63}$'
    or jsonb_typeof(c->'units') is distinct from 'number'
    or coalesce(c->>'units','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(c->'start') is distinct from 'number'
    or coalesce(c->>'start','') !~ '^(0|[1-9][0-9]{0,15})$'
    or jsonb_typeof(c->'end') is distinct from 'number'
    or coalesce(c->>'end','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(c->'excerpt') is distinct from 'string'
    or length(btrim(coalesce(c->>'excerpt','')))=0
    or not bm_intake_private.matches_typed_note_utf16_excerpt(
      v_source.original_text,c)
 ) then
   raise exception 'Malformed or source-inexact proposed correction'
    using errcode='22023';
 end if;
 if (select count(distinct c->>'serviceCode')
     from jsonb_array_elements(p_candidates) c)<>v_count then
   raise exception 'Duplicate corrected services' using errcode='22023';
 end if;
 v_proposed_sha:=bm_intake_private.canonical_candidate_sha256(p_candidates);
 if v_proposed_sha=v_original_sha then
   raise exception 'Proposed correction must change source candidates'
    using errcode='22023';
 end if;
 if not bm_intake_private.replay_correction_actions(
   v_source.review->'candidates',p_changes,p_candidates) then
   raise exception 'Correction actions cannot replay immutable extraction'
    using errcode='22023';
 end if;
 -- SQL-side JSONB fingerprint is a stored consistency binding, NOT the
 -- JavaScript correctionSha256 or independent human signoff.
 v_actions_sha:=encode(sha256(convert_to(p_changes::text,'UTF8')),'hex');
 -- Database-produced receipt digest: consistency evidence, NOT approval.
 v_draft_sha:=encode(sha256(convert_to(jsonb_build_array(
   p_org::text,p_source::text,p_actor::text,p_request_sha,v_hold_sha,
   v_original_sha,v_proposed_sha,v_actions_sha,p_reason)::text,'UTF8')),'hex');
 insert into bm_intake_private.correction_candidate_drafts(
  organization_id,source_id,actor_id,request_sha256,hold_sha256,
  original_candidates_sha256,proposed_candidates_sha256,
  proposed_candidates,correction_actions,actions_sha256,reason,draft_sha256
 ) values (p_org,p_source,p_actor,p_request_sha,v_hold_sha,v_original_sha,
   v_proposed_sha,p_candidates,p_changes,v_actions_sha,p_reason,v_draft_sha);
 return query select v_proposed_sha,v_draft_sha;
end;
$stage$;
revoke all on function bm_intake_private.stage_correction_candidate_draft(
 uuid,uuid,uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function bm_intake_private.stage_correction_candidate_draft(
 uuid,uuid,uuid,text,text,jsonb,jsonb,text) to service_role;
),
 reason text not null check(length(reason) between 1 and 500 and octet_length(reason)<=1000),
 draft_sha256 text not null check(draft_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 primary key(organization_id,source_id),
 foreign key(organization_id,source_id)
  references public.bm_intake_sources(organization_id,id)
  on update restrict on delete restrict,
 check(original_candidates_sha256 <> proposed_candidates_sha256)
);
revoke all on bm_intake_private.correction_candidate_drafts
 from public,anon,authenticated,service_role;
create trigger bm_correction_candidate_draft_immutable
 before update or delete on bm_intake_private.correction_candidate_drafts
 for each row execute function bm_intake_private.reject_correction_hold_mutation();

-- The trusted SERVER must supply an actor from a fresh verified Auth session.
-- This function is not an HTTP endpoint, provider integration or approval.
create function bm_intake_private.stage_correction_candidate_draft(
 p_org uuid,p_actor uuid,p_source uuid,p_request_sha text,
 p_expected_hold_sha text,p_candidates jsonb,p_reason text
) returns table(stored_candidates_sha256 text,stored_draft_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private
as $stage$
declare
 v_source public.bm_intake_sources%rowtype;
 v_hold bm_intake_private.correction_holds%rowtype;
 v_hold_sha text;
 v_original_sha text;
 v_proposed_sha text;
 v_draft_sha text;
 v_count integer;
begin
 if p_org is null or p_actor is null or p_source is null
   or coalesce(p_request_sha,'') !~ '^[0-9a-f]{64}$'
   or coalesce(p_expected_hold_sha,'') !~ '^[0-9a-f]{64}$'
   or p_candidates is null or jsonb_typeof(p_candidates) is distinct from 'array'
   or pg_column_size(p_candidates)>32768
   or p_reason is null or p_reason<>btrim(p_reason)
   or length(p_reason) not between 1 and 500
   or octet_length(p_reason)>1000 or p_reason ~ '[[:cntrl:]]' then
   raise exception 'Invalid staged correction candidate request' using errcode='22023';
 end if;
 -- Lock CURRENT membership before disclosing either source or absence.
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=p_actor
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 select * into v_source from public.bm_intake_sources
  where organization_id=p_org and id=p_source and created_by=p_actor for update;
 if not found then
   raise exception 'Private quarantined source unavailable' using errcode='42501';
 end if;
 if v_source.revision<>4 or v_source.scope_review is not null
   or jsonb_typeof(v_source.correction_hold) is distinct from 'object'
   or v_source.correction_hold->>'state' is distinct from
      'quarantined-awaiting-correction'
   or v_source.review is null
   or jsonb_typeof(v_source.review->'candidates') is distinct from 'array'
   or jsonb_typeof(v_source.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_source.extraction_audit)<>1 then
   raise exception 'Correction source not quarantined or stale' using errcode='40001';
 end if;
 select * into v_hold from bm_intake_private.correction_holds
  where organization_id=p_org and source_id=p_source for share;
 v_hold_sha:=encode(sha256(convert_to(v_source.correction_hold::text,'UTF8')),'hex');
 v_original_sha:=bm_intake_private.canonical_candidate_sha256(
  v_source.review->'candidates');
 if not found or v_hold.actor_id is distinct from p_actor
   or v_hold.previous_revision not in (2,3)
   or v_hold.request_sha256 is distinct from p_request_sha
   or v_hold.hold is distinct from v_source.correction_hold
   or v_hold_sha is distinct from p_expected_hold_sha
   or v_source.correction_hold->>'requestSha256' is distinct from p_request_sha
   or v_source.correction_hold->>'candidatesSha256' is distinct from v_original_sha
   or v_source.review->>'candidatesSha256' is distinct from v_original_sha
   or v_source.extraction_audit->0->>'candidatesSha256' is distinct from v_original_sha
   or v_source.extraction_audit->0->>'actorId' is distinct from p_actor::text
   or v_source.extraction_audit->0->>'sourceRevision' is distinct from '2'
   or v_source.review->>'sourceSha256' is distinct from
     encode(sha256(convert_to('typed-note','UTF8')||decode('00','hex')
       ||convert_to(v_source.original_text,'UTF8')),'hex') then
   raise exception 'Correction quarantine receipt does not match original'
    using errcode='22023';
 end if;
 v_count:=jsonb_array_length(p_candidates);
 if v_count not between 1 and 50 or exists (
  select 1 from jsonb_array_elements(p_candidates) c
  where jsonb_typeof(c) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(
      case when jsonb_typeof(c)='object' then c else '{}'::jsonb end))<>5
    or exists (select 1 from jsonb_object_keys(
      case when jsonb_typeof(c)='object' then c else '{}'::jsonb end) k
      where k not in ('serviceCode','units','start','end','excerpt'))
    or jsonb_typeof(c->'serviceCode') is distinct from 'string'
    or coalesce(c->>'serviceCode','') !~ '^[a-z][a-z0-9_-]{0,63}$'
    or jsonb_typeof(c->'units') is distinct from 'number'
    or coalesce(c->>'units','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(c->'start') is distinct from 'number'
    or coalesce(c->>'start','') !~ '^(0|[1-9][0-9]{0,15})$'
    or jsonb_typeof(c->'end') is distinct from 'number'
    or coalesce(c->>'end','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(c->'excerpt') is distinct from 'string'
    or length(btrim(coalesce(c->>'excerpt','')))=0
    or not bm_intake_private.matches_typed_note_utf16_excerpt(
      v_source.original_text,c)
 ) then
   raise exception 'Malformed or source-inexact proposed correction'
    using errcode='22023';
 end if;
 if (select count(distinct c->>'serviceCode')
     from jsonb_array_elements(p_candidates) c)<>v_count then
   raise exception 'Duplicate corrected services' using errcode='22023';
 end if;
 v_proposed_sha:=bm_intake_private.canonical_candidate_sha256(p_candidates);
 if v_proposed_sha=v_original_sha then
   raise exception 'Proposed correction must change source candidates'
    using errcode='22023';
 end if;
 -- Database-produced receipt digest: consistency evidence, NOT approval.
 v_draft_sha:=encode(sha256(convert_to(jsonb_build_array(
   p_org::text,p_source::text,p_actor::text,p_request_sha,v_hold_sha,
   v_original_sha,v_proposed_sha,p_reason)::text,'UTF8')),'hex');
 insert into bm_intake_private.correction_candidate_drafts(
  organization_id,source_id,actor_id,request_sha256,hold_sha256,
  original_candidates_sha256,proposed_candidates_sha256,
  proposed_candidates,reason,draft_sha256
 ) values (p_org,p_source,p_actor,p_request_sha,v_hold_sha,v_original_sha,
   v_proposed_sha,p_candidates,p_reason,v_draft_sha);
 return query select v_proposed_sha,v_draft_sha;
end;
$stage$;
revoke all on function bm_intake_private.stage_correction_candidate_draft(
 uuid,uuid,uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function bm_intake_private.stage_correction_candidate_draft(
 uuid,uuid,uuid,text,text,jsonb,jsonb,text) to service_role;
 then
       return false;
     end if;
     v_index:=(v_action->>'index')::integer;
     if v_index>=v_count or v_edits ? v_index::text then return false; end if;
     if v_kind='replace' and v_candidate=p_original->v_index then
       return false;
     end if;
     v_edits:=jsonb_set(v_edits,array[v_index::text],v_action,true);
   end if;
 end loop;
 for v_index in 0..v_count-1 loop
   v_action:=v_edits->v_index::text;
   if v_action->>'action'='remove' then continue; end if;
   v_result:=v_result||jsonb_build_array(
     case when v_action->>'action'='replace'
       then v_action->'candidate' else p_original->v_index end);
 end loop;
 for v_candidate in select value from jsonb_array_elements(v_added)
   order by (value->>'start')::bigint,(value->>'end')::bigint,
     (value->>'serviceCode') collate "C"
 loop
   v_result:=v_result||jsonb_build_array(v_candidate);
 end loop;
 return v_result=p_proposed;
end;
$replay$;
revoke all on function bm_intake_private.replay_correction_actions(
 jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function bm_intake_private.replay_correction_actions(
 jsonb,jsonb,jsonb) to service_role;

-- The trusted SERVER must supply an actor from a fresh verified Auth session.
-- This function is not an HTTP endpoint, provider integration or approval.
create function bm_intake_private.stage_correction_candidate_draft(
 p_org uuid,p_actor uuid,p_source uuid,p_request_sha text,
 p_expected_hold_sha text,p_candidates jsonb,p_reason text
) returns table(stored_candidates_sha256 text,stored_draft_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private
as $stage$
declare
 v_source public.bm_intake_sources%rowtype;
 v_hold bm_intake_private.correction_holds%rowtype;
 v_hold_sha text;
 v_original_sha text;
 v_proposed_sha text;
 v_draft_sha text;
 v_count integer;
begin
 if p_org is null or p_actor is null or p_source is null
   or coalesce(p_request_sha,'') !~ '^[0-9a-f]{64}$'
   or coalesce(p_expected_hold_sha,'') !~ '^[0-9a-f]{64}$'
   or p_candidates is null or jsonb_typeof(p_candidates) is distinct from 'array'
   or pg_column_size(p_candidates)>32768
   or p_reason is null or p_reason<>btrim(p_reason)
   or length(p_reason) not between 1 and 500
   or octet_length(p_reason)>1000 or p_reason ~ '[[:cntrl:]]' then
   raise exception 'Invalid staged correction candidate request' using errcode='22023';
 end if;
 -- Lock CURRENT membership before disclosing either source or absence.
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=p_actor
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 select * into v_source from public.bm_intake_sources
  where organization_id=p_org and id=p_source and created_by=p_actor for update;
 if not found then
   raise exception 'Private quarantined source unavailable' using errcode='42501';
 end if;
 if v_source.revision<>4 or v_source.scope_review is not null
   or jsonb_typeof(v_source.correction_hold) is distinct from 'object'
   or v_source.correction_hold->>'state' is distinct from
      'quarantined-awaiting-correction'
   or v_source.review is null
   or jsonb_typeof(v_source.review->'candidates') is distinct from 'array'
   or jsonb_typeof(v_source.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_source.extraction_audit)<>1 then
   raise exception 'Correction source not quarantined or stale' using errcode='40001';
 end if;
 select * into v_hold from bm_intake_private.correction_holds
  where organization_id=p_org and source_id=p_source for share;
 v_hold_sha:=encode(sha256(convert_to(v_source.correction_hold::text,'UTF8')),'hex');
 v_original_sha:=bm_intake_private.canonical_candidate_sha256(
  v_source.review->'candidates');
 if not found or v_hold.actor_id is distinct from p_actor
   or v_hold.previous_revision not in (2,3)
   or v_hold.request_sha256 is distinct from p_request_sha
   or v_hold.hold is distinct from v_source.correction_hold
   or v_hold_sha is distinct from p_expected_hold_sha
   or v_source.correction_hold->>'requestSha256' is distinct from p_request_sha
   or v_source.correction_hold->>'candidatesSha256' is distinct from v_original_sha
   or v_source.review->>'candidatesSha256' is distinct from v_original_sha
   or v_source.extraction_audit->0->>'candidatesSha256' is distinct from v_original_sha
   or v_source.extraction_audit->0->>'actorId' is distinct from p_actor::text
   or v_source.extraction_audit->0->>'sourceRevision' is distinct from '2'
   or v_source.review->>'sourceSha256' is distinct from
     encode(sha256(convert_to('typed-note','UTF8')||decode('00','hex')
       ||convert_to(v_source.original_text,'UTF8')),'hex') then
   raise exception 'Correction quarantine receipt does not match original'
    using errcode='22023';
 end if;
 v_count:=jsonb_array_length(p_candidates);
 if v_count not between 1 and 50 or exists (
  select 1 from jsonb_array_elements(p_candidates) c
  where jsonb_typeof(c) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(
      case when jsonb_typeof(c)='object' then c else '{}'::jsonb end))<>5
    or exists (select 1 from jsonb_object_keys(
      case when jsonb_typeof(c)='object' then c else '{}'::jsonb end) k
      where k not in ('serviceCode','units','start','end','excerpt'))
    or jsonb_typeof(c->'serviceCode') is distinct from 'string'
    or coalesce(c->>'serviceCode','') !~ '^[a-z][a-z0-9_-]{0,63}$'
    or jsonb_typeof(c->'units') is distinct from 'number'
    or coalesce(c->>'units','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(c->'start') is distinct from 'number'
    or coalesce(c->>'start','') !~ '^(0|[1-9][0-9]{0,15})$'
    or jsonb_typeof(c->'end') is distinct from 'number'
    or coalesce(c->>'end','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(c->'excerpt') is distinct from 'string'
    or length(btrim(coalesce(c->>'excerpt','')))=0
    or not bm_intake_private.matches_typed_note_utf16_excerpt(
      v_source.original_text,c)
 ) then
   raise exception 'Malformed or source-inexact proposed correction'
    using errcode='22023';
 end if;
 if (select count(distinct c->>'serviceCode')
     from jsonb_array_elements(p_candidates) c)<>v_count then
   raise exception 'Duplicate corrected services' using errcode='22023';
 end if;
 v_proposed_sha:=bm_intake_private.canonical_candidate_sha256(p_candidates);
 if v_proposed_sha=v_original_sha then
   raise exception 'Proposed correction must change source candidates'
    using errcode='22023';
 end if;
 -- Database-produced receipt digest: consistency evidence, NOT approval.
 v_draft_sha:=encode(sha256(convert_to(jsonb_build_array(
   p_org::text,p_source::text,p_actor::text,p_request_sha,v_hold_sha,
   v_original_sha,v_proposed_sha,p_reason)::text,'UTF8')),'hex');
 insert into bm_intake_private.correction_candidate_drafts(
  organization_id,source_id,actor_id,request_sha256,hold_sha256,
  original_candidates_sha256,proposed_candidates_sha256,
  proposed_candidates,reason,draft_sha256
 ) values (p_org,p_source,p_actor,p_request_sha,v_hold_sha,v_original_sha,
   v_proposed_sha,p_candidates,p_reason,v_draft_sha);
 return query select v_proposed_sha,v_draft_sha;
end;
$stage$;
revoke all on function bm_intake_private.stage_correction_candidate_draft(
 uuid,uuid,uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function bm_intake_private.stage_correction_candidate_draft(
 uuid,uuid,uuid,text,text,jsonb,jsonb,text) to service_role;
),
 reason text not null check(length(reason) between 1 and 500 and octet_length(reason)<=1000),
 draft_sha256 text not null check(draft_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 primary key(organization_id,source_id),
 foreign key(organization_id,source_id)
  references public.bm_intake_sources(organization_id,id)
  on update restrict on delete restrict,
 check(original_candidates_sha256 <> proposed_candidates_sha256)
);
revoke all on bm_intake_private.correction_candidate_drafts
 from public,anon,authenticated,service_role;
create trigger bm_correction_candidate_draft_immutable
 before update or delete on bm_intake_private.correction_candidate_drafts
 for each row execute function bm_intake_private.reject_correction_hold_mutation();

-- The trusted SERVER must supply an actor from a fresh verified Auth session.
-- This function is not an HTTP endpoint, provider integration or approval.
create function bm_intake_private.stage_correction_candidate_draft(
 p_org uuid,p_actor uuid,p_source uuid,p_request_sha text,
 p_expected_hold_sha text,p_candidates jsonb,p_reason text
) returns table(stored_candidates_sha256 text,stored_draft_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private
as $stage$
declare
 v_source public.bm_intake_sources%rowtype;
 v_hold bm_intake_private.correction_holds%rowtype;
 v_hold_sha text;
 v_original_sha text;
 v_proposed_sha text;
 v_draft_sha text;
 v_count integer;
begin
 if p_org is null or p_actor is null or p_source is null
   or coalesce(p_request_sha,'') !~ '^[0-9a-f]{64}$'
   or coalesce(p_expected_hold_sha,'') !~ '^[0-9a-f]{64}$'
   or p_candidates is null or jsonb_typeof(p_candidates) is distinct from 'array'
   or pg_column_size(p_candidates)>32768
   or p_reason is null or p_reason<>btrim(p_reason)
   or length(p_reason) not between 1 and 500
   or octet_length(p_reason)>1000 or p_reason ~ '[[:cntrl:]]' then
   raise exception 'Invalid staged correction candidate request' using errcode='22023';
 end if;
 -- Lock CURRENT membership before disclosing either source or absence.
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=p_actor
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 select * into v_source from public.bm_intake_sources
  where organization_id=p_org and id=p_source and created_by=p_actor for update;
 if not found then
   raise exception 'Private quarantined source unavailable' using errcode='42501';
 end if;
 if v_source.revision<>4 or v_source.scope_review is not null
   or jsonb_typeof(v_source.correction_hold) is distinct from 'object'
   or v_source.correction_hold->>'state' is distinct from
      'quarantined-awaiting-correction'
   or v_source.review is null
   or jsonb_typeof(v_source.review->'candidates') is distinct from 'array'
   or jsonb_typeof(v_source.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_source.extraction_audit)<>1 then
   raise exception 'Correction source not quarantined or stale' using errcode='40001';
 end if;
 select * into v_hold from bm_intake_private.correction_holds
  where organization_id=p_org and source_id=p_source for share;
 v_hold_sha:=encode(sha256(convert_to(v_source.correction_hold::text,'UTF8')),'hex');
 v_original_sha:=bm_intake_private.canonical_candidate_sha256(
  v_source.review->'candidates');
 if not found or v_hold.actor_id is distinct from p_actor
   or v_hold.previous_revision not in (2,3)
   or v_hold.request_sha256 is distinct from p_request_sha
   or v_hold.hold is distinct from v_source.correction_hold
   or v_hold_sha is distinct from p_expected_hold_sha
   or v_source.correction_hold->>'requestSha256' is distinct from p_request_sha
   or v_source.correction_hold->>'candidatesSha256' is distinct from v_original_sha
   or v_source.review->>'candidatesSha256' is distinct from v_original_sha
   or v_source.extraction_audit->0->>'candidatesSha256' is distinct from v_original_sha
   or v_source.extraction_audit->0->>'actorId' is distinct from p_actor::text
   or v_source.extraction_audit->0->>'sourceRevision' is distinct from '2'
   or v_source.review->>'sourceSha256' is distinct from
     encode(sha256(convert_to('typed-note','UTF8')||decode('00','hex')
       ||convert_to(v_source.original_text,'UTF8')),'hex') then
   raise exception 'Correction quarantine receipt does not match original'
    using errcode='22023';
 end if;
 v_count:=jsonb_array_length(p_candidates);
 if v_count not between 1 and 50 or exists (
  select 1 from jsonb_array_elements(p_candidates) c
  where jsonb_typeof(c) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(
      case when jsonb_typeof(c)='object' then c else '{}'::jsonb end))<>5
    or exists (select 1 from jsonb_object_keys(
      case when jsonb_typeof(c)='object' then c else '{}'::jsonb end) k
      where k not in ('serviceCode','units','start','end','excerpt'))
    or jsonb_typeof(c->'serviceCode') is distinct from 'string'
    or coalesce(c->>'serviceCode','') !~ '^[a-z][a-z0-9_-]{0,63}$'
    or jsonb_typeof(c->'units') is distinct from 'number'
    or coalesce(c->>'units','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(c->'start') is distinct from 'number'
    or coalesce(c->>'start','') !~ '^(0|[1-9][0-9]{0,15})$'
    or jsonb_typeof(c->'end') is distinct from 'number'
    or coalesce(c->>'end','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(c->'excerpt') is distinct from 'string'
    or length(btrim(coalesce(c->>'excerpt','')))=0
    or not bm_intake_private.matches_typed_note_utf16_excerpt(
      v_source.original_text,c)
 ) then
   raise exception 'Malformed or source-inexact proposed correction'
    using errcode='22023';
 end if;
 if (select count(distinct c->>'serviceCode')
     from jsonb_array_elements(p_candidates) c)<>v_count then
   raise exception 'Duplicate corrected services' using errcode='22023';
 end if;
 v_proposed_sha:=bm_intake_private.canonical_candidate_sha256(p_candidates);
 if v_proposed_sha=v_original_sha then
   raise exception 'Proposed correction must change source candidates'
    using errcode='22023';
 end if;
 -- Database-produced receipt digest: consistency evidence, NOT approval.
 v_draft_sha:=encode(sha256(convert_to(jsonb_build_array(
   p_org::text,p_source::text,p_actor::text,p_request_sha,v_hold_sha,
   v_original_sha,v_proposed_sha,p_reason)::text,'UTF8')),'hex');
 insert into bm_intake_private.correction_candidate_drafts(
  organization_id,source_id,actor_id,request_sha256,hold_sha256,
  original_candidates_sha256,proposed_candidates_sha256,
  proposed_candidates,reason,draft_sha256
 ) values (p_org,p_source,p_actor,p_request_sha,v_hold_sha,v_original_sha,
   v_proposed_sha,p_candidates,p_reason,v_draft_sha);
 return query select v_proposed_sha,v_draft_sha;
end;
$stage$;
revoke all on function bm_intake_private.stage_correction_candidate_draft(
 uuid,uuid,uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function bm_intake_private.stage_correction_candidate_draft(
 uuid,uuid,uuid,text,text,jsonb,jsonb,text) to service_role;
