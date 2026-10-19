-- Staged correction QUARANTINE CAS, disposable PostgreSQL only.
-- This holds a correction request and invalidates any older reviewed scope.
-- It does NOT persist/approve corrected candidates, activate a review or send.
-- Requires the staged original/extraction/scope functions already installed.
alter table public.bm_intake_sources add column correction_hold jsonb;
alter table public.bm_intake_sources drop constraint bm_source_revision_range;
alter table public.bm_intake_sources add constraint bm_source_revision_range
 check (revision between 1 and 4);
alter table public.bm_intake_sources drop constraint bm_source_lifecycle;
alter table public.bm_intake_sources add constraint bm_source_lifecycle check (
 (revision=1 and review is null and extraction_audit='[]'::jsonb
   and scope_review is null and correction_hold is null)
 or (revision=2 and review is not null and jsonb_typeof(review)='object'
   and jsonb_typeof(extraction_audit)='array'
   and jsonb_array_length(extraction_audit)=1 and scope_review is null
   and correction_hold is null)
 or (revision=3 and review is not null and jsonb_typeof(review)='object'
   and jsonb_typeof(extraction_audit)='array'
   and jsonb_array_length(extraction_audit)=1 and scope_review is not null
   and jsonb_typeof(scope_review)='object' and correction_hold is null)
 or (revision=4 and review is not null and jsonb_typeof(review)='object'
   and jsonb_typeof(extraction_audit)='array'
   and jsonb_array_length(extraction_audit)=1 and scope_review is null
   and correction_hold is not null
   and jsonb_typeof(correction_hold)='object'
   and correction_hold->>'state'='quarantined-awaiting-correction')
);

-- This private ledger is inaccessible to service_role direct DML; only
-- an explicitly authorized SECURITY DEFINER function can insert. The table
-- has no public SELECT route. The trigger checks this receipt before rev 4.
create table bm_intake_private.correction_holds (
 organization_id uuid not null,
 source_id uuid not null,
 previous_revision integer not null check(previous_revision in (2,3)),
 actor_id uuid not null,
 request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
 reason text not null check (length(reason) between 1 and 500
   and octet_length(reason) <= 1000),
 invalidated_scope jsonb,
 hold jsonb not null,
 created_at timestamptz not null default now(),
 primary key (organization_id,source_id),
 foreign key (organization_id,source_id) references
   public.bm_intake_sources(organization_id,id) on delete restrict
);
revoke all on bm_intake_private.correction_holds
 from public,anon,authenticated,service_role;
create function bm_intake_private.reject_correction_hold_mutation()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,bm_intake_private as $guard$
begin
 raise exception 'Correction hold ledger is append-only' using errcode='42501';
end;
$guard$;
create trigger bm_correction_hold_immutable
 before update or delete on bm_intake_private.correction_holds
 for each row execute function bm_intake_private.reject_correction_hold_mutation();
revoke all on function bm_intake_private.reject_correction_hold_mutation()
 from public,anon,authenticated,service_role;

-- Keep old exact transition guards; the ONLY new transition is a
-- quarantined 2/3 -> 4 backed by a private immutable ledger receipt.
create or replace function bm_intake_private.enforce_source_transition()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,bm_intake_private as $guard$
begin
 if tg_op='DELETE' then
   raise exception 'Intake source deletion forbidden' using errcode='42501';
 end if;
 if row(new.organization_id,new.id,new.created_by,new.request_id,
        new.kind,new.original_text,new.text_sha256,new.created_at,
        new.review,new.extraction_audit)
    is distinct from
    row(old.organization_id,old.id,old.created_by,old.request_id,
        old.kind,old.original_text,old.text_sha256,old.created_at,
        old.review,old.extraction_audit)
    and old.revision <> 1 then
   raise exception 'Immutable extracted original or audit changed'
     using errcode='42501';
 end if;
 if row(new.organization_id,new.id,new.created_by,new.request_id,
        new.kind,new.original_text,new.text_sha256,new.created_at)
    is distinct from
    row(old.organization_id,old.id,old.created_by,old.request_id,
        old.kind,old.original_text,old.text_sha256,old.created_at) then
   raise exception 'Immutable intake source identity changed'
     using errcode='42501';
 end if;
 if old.revision=1 and new.revision=2
   and old.review is null and old.extraction_audit='[]'::jsonb
   and old.scope_review is null and old.correction_hold is null
   and new.review is not null and jsonb_typeof(new.review)='object'
   and jsonb_typeof(new.extraction_audit)='array'
   and jsonb_array_length(new.extraction_audit)=1
   and new.scope_review is null and new.correction_hold is null then
   return new;
 end if;
 if old.revision=2 and new.revision=3
   and new.review is not distinct from old.review
   and new.extraction_audit is not distinct from old.extraction_audit
   and old.scope_review is null and old.correction_hold is null
   and new.scope_review is not null
   and jsonb_typeof(new.scope_review)='object'
   and new.correction_hold is null then
   return new;
 end if;
 if old.revision in (2,3) and new.revision=4
   and old.correction_hold is null
   and new.review is not distinct from old.review
   and new.extraction_audit is not distinct from old.extraction_audit
   and new.scope_review is null
   and new.correction_hold is not null
   and exists (
    select 1 from bm_intake_private.correction_holds h
    where h.organization_id=old.organization_id and h.source_id=old.id
      and h.previous_revision=old.revision
      and h.actor_id=old.created_by
      and h.invalidated_scope is not distinct from old.scope_review
      and h.hold=new.correction_hold
   ) then
   return new;
 end if;
 raise exception 'Invalid intake revision transition' using errcode='42501';
end;
$guard$;

-- Deliberately accepts only an opaque digest of a *request to correct* and a
-- human reason, not corrected candidate data. The latter requires a separate,
-- stronger human correction/activation workflow. No idempotent replay success.
create function bm_intake_private.quarantine_typed_note_for_correction(
 p_org uuid,p_actor uuid,p_source uuid,p_expected_revision integer,
 p_expected_source_sha text,p_expected_candidates_sha text,
 p_request_sha text,p_reason text
) returns table(quarantined_revision integer,hold_sha256 text)
language plpgsql security definer
set search_path=pg_catalog,public,bm_intake_private as $hold$
declare
 v_note public.bm_intake_sources%rowtype;
 v_source_sha text;
 v_hold jsonb;
begin
 if p_org is null or p_actor is null or p_source is null
   or p_expected_revision is null or p_expected_revision not in (2,3)
   or coalesce(p_expected_source_sha,'') !~ '^[a-f0-9]{64}$'
   or coalesce(p_expected_candidates_sha,'') !~ '^[a-f0-9]{64}$'
   or coalesce(p_request_sha,'') !~ '^[a-f0-9]{64}$'
   or p_reason is null or p_reason<>btrim(p_reason)
   or length(p_reason) not between 1 and 500
   or octet_length(p_reason)>1000
   or p_reason ~ '[[:cntrl:]]' then
   raise exception 'Invalid correction quarantine request' using errcode='22023';
 end if;
 -- Membership before source lookup. Both locks last through commit.
 perform 1 from public.bm_memberships
  where organization_id=p_org and user_id=p_actor
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 select * into v_note from public.bm_intake_sources
  where organization_id=p_org and id=p_source and created_by=p_actor for update;
 if not found then
   raise exception 'Correction source unavailable' using errcode='42501';
 end if;
 if v_note.revision<>p_expected_revision
   or v_note.correction_hold is not null
   or v_note.review is null
   or jsonb_typeof(v_note.review->'candidates') is distinct from 'array'
   or jsonb_typeof(v_note.extraction_audit) is distinct from 'array'
   or jsonb_array_length(v_note.extraction_audit)<>1 then
   raise exception 'Stale correction quarantine source' using errcode='40001';
 end if;
 v_source_sha:=encode(sha256(convert_to('typed-note','UTF8')
   || decode('00','hex') || convert_to(v_note.original_text,'UTF8')),'hex');
 if v_note.review->>'sourceSha256' is distinct from v_source_sha
   or v_source_sha is distinct from p_expected_source_sha
   or v_note.review->>'candidatesSha256' is distinct from p_expected_candidates_sha
   or v_note.extraction_audit->0->>'sourceSha256' is distinct from v_source_sha
   or v_note.extraction_audit->0->>'candidatesSha256'
      is distinct from p_expected_candidates_sha
   or v_note.extraction_audit->0->>'actorId' is distinct from p_actor::text
   or v_note.extraction_audit->0->>'sourceRevision' is distinct from '2'
   or bm_intake_private.canonical_candidate_sha256(
     v_note.review->'candidates') is distinct from p_expected_candidates_sha then
   raise exception 'Immutable correction source fingerprint mismatch'
     using errcode='22023';
 end if;
 v_hold:=jsonb_build_object(
  'state','quarantined-awaiting-correction',
  'previousRevision',v_note.revision,
  'sourceRevision',4,
  'actorId',p_actor::text,
  'requestSha256',p_request_sha,
  'sourceSha256',v_source_sha,
  'candidatesSha256',p_expected_candidates_sha);
 insert into bm_intake_private.correction_holds (
  organization_id,source_id,previous_revision,actor_id,request_sha256,
  reason,invalidated_scope,hold
 ) values (p_org,p_source,v_note.revision,p_actor,p_request_sha,
   p_reason,v_note.scope_review,v_hold);
 update public.bm_intake_sources
   set revision=4,scope_review=null,correction_hold=v_hold
 where organization_id=p_org and id=p_source and revision=v_note.revision;
 if not found then
   raise exception 'Concurrent correction quarantine failed' using errcode='40001';
 end if;
 return query select 4,encode(sha256(convert_to(v_hold::text,'UTF8')),'hex');
end;
$hold$;
revoke all on function bm_intake_private.quarantine_typed_note_for_correction(
 uuid,uuid,uuid,integer,text,text,text,text)
 from public,anon,authenticated;
grant execute on function bm_intake_private.quarantine_typed_note_for_correction(
 uuid,uuid,uuid,integer,text,text,text,text) to service_role;
