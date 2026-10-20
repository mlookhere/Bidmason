-- STAGED / DISPOSABLE POSTGRES ONLY. Durable history for existing trusted
-- policy domain. A trusted server MUST derive actors from live Auth; UUID
-- arguments cannot serve as browser-approved identity or human consent.
create table bm_intake_private.policy_draft_events(
 organization_id uuid not null references public.bm_organizations(id),
 revision integer not null check(revision between 1 and 1000),
 policy_sha256 text not null check(policy_sha256 ~ '^[0-9a-f]{64}$'),
 policy jsonb not null check(jsonb_typeof(policy)='object'),
 submitted_by uuid not null,
 submitted_at timestamptz not null default now(),
 primary key(organization_id,revision),
 unique(organization_id,revision,policy_sha256)
);
create table bm_intake_private.policy_decision_events(
 organization_id uuid not null,
 revision integer not null,
 policy_sha256 text not null,
 decision text not null check(decision in ('approved','rejected')),
 reviewed_by uuid not null,
 reviewed_at timestamptz not null default now(),
 primary key(organization_id,revision),
 foreign key(organization_id,revision,policy_sha256)
 references bm_intake_private.policy_draft_events(
  organization_id,revision,policy_sha256) on update restrict on delete restrict
);
create table bm_intake_private.policy_submission_heads(
 organization_id uuid primary key references public.bm_organizations(id),
 revision integer not null,
 policy_sha256 text not null,
 foreign key(organization_id,revision,policy_sha256)
 references bm_intake_private.policy_draft_events(
  organization_id,revision,policy_sha256) on update restrict on delete restrict
);
revoke all on bm_intake_private.policy_draft_events,
 bm_intake_private.policy_decision_events,
 bm_intake_private.policy_submission_heads from public,anon,authenticated;
grant select,insert,update on bm_intake_private.policy_draft_events,
 bm_intake_private.policy_decision_events,
 bm_intake_private.policy_submission_heads to service_role;
alter table bm_intake_private.policy_draft_events enable row level security;
alter table bm_intake_private.policy_draft_events force row level security;
alter table bm_intake_private.policy_decision_events enable row level security;
alter table bm_intake_private.policy_decision_events force row level security;
alter table bm_intake_private.policy_submission_heads enable row level security;
alter table bm_intake_private.policy_submission_heads force row level security;
-- No actor, including privileged service_role, can rewrite original events.
create trigger bm_policy_draft_append_only
 before update or delete on bm_intake_private.policy_draft_events
 for each row execute function bm_intake_private.deny_approved_policy_rewrite();
create trigger bm_policy_decision_append_only
 before update or delete on bm_intake_private.policy_decision_events
 for each row execute function bm_intake_private.deny_approved_policy_rewrite();
-- Heads only ever progress exactly one new submitted revision.
create function bm_intake_private.guard_policy_submission_head()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $guard$
begin
 if tg_op='DELETE' then
   raise exception 'Policy submission head cannot be removed' using errcode='42501';
 end if;
 if new.organization_id is distinct from old.organization_id
   or new.revision is distinct from old.revision+1 then
   raise exception 'Policy submission head must increment once' using errcode='42501';
 end if;
 return new;
end;
$guard$;
create trigger bm_policy_submission_head_monotonic
 before update or delete on bm_intake_private.policy_submission_heads
 for each row execute function bm_intake_private.guard_policy_submission_head();

-- Serialized append. A previous revision must be separately decided
-- before a subsequent proposal is accepted; rejects still occupy revisions.
create function bm_intake_private.submit_policy_history_draft(
 p_org uuid,p_actor uuid,p_expected_revision integer,p_expected_sha text,
 p_canonical text
) returns table(submitted_revision integer,submitted_sha256 text)
language plpgsql security invoker
set search_path=pg_catalog,public as $submit$
declare v_rev integer;v_sha text;v_policy jsonb;v_current integer;v_current_sha text;
begin
 if p_org is null or p_actor is null or p_expected_revision is null
   or p_expected_revision not between 0 and 999
   or (p_expected_revision=0 and p_expected_sha is not null)
   or (p_expected_revision>0 and
      coalesce(p_expected_sha,'') !~ '^[0-9a-f]{64}$')
   or p_canonical is null or octet_length(p_canonical) not between 2 and 65536 then
   raise exception 'Invalid submitted company policy parameters' using errcode='22023';
 end if;
 perform 1 from public.bm_memberships where organization_id=p_org
   and user_id=p_actor and member_role in ('owner','operator','contractor')
   for share;
 if not found then raise exception 'Current policy submitter required'
   using errcode='42501'; end if;
 -- The organization lock serializes even concurrent first-ever submissions.
 -- Transaction-scoped per-tenant lock also serializes concurrent first writes.
 -- Hash collisions can only serialize unrelated tenants, never mix their data.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 select h.revision,h.policy_sha256 into v_current,v_current_sha
   from bm_intake_private.policy_submission_heads h
   where organization_id=p_org for update;
 if not found then
    v_current:=0;v_current_sha:=null;
 end if;
 if v_current is distinct from p_expected_revision
    or v_current_sha is distinct from p_expected_sha then
    raise exception 'Stale immutable policy submission head' using errcode='40001';
 end if;
 if v_current>0 and not exists(
   select 1 from bm_intake_private.policy_decision_events
   where organization_id=p_org and revision=v_current) then
   raise exception 'Earlier company policy requires independent review'
     using errcode='40001';
 end if;
 v_rev:=v_current+1;
 v_policy:=p_canonical::jsonb;
 if jsonb_typeof(v_policy) is distinct from 'object'
   or jsonb_typeof(v_policy->'revision') is distinct from 'number'
   or v_policy->>'revision' is distinct from v_rev::text
   or jsonb_typeof(v_policy->'pricing'->'services') is distinct from 'object'
   or v_policy->'pricing'->>'currency' is distinct from 'USD'
   or jsonb_typeof(v_policy->'tax') is distinct from 'object' then
   raise exception 'Malformed company policy draft' using errcode='22023';
 end if;
 v_sha:=encode(sha256(convert_to(p_canonical,'UTF8')),'hex');
 insert into bm_intake_private.policy_draft_events(
   organization_id,revision,policy_sha256,policy,submitted_by)
 values(p_org,v_rev,v_sha,v_policy,p_actor);
 insert into bm_intake_private.policy_submission_heads(
   organization_id,revision,policy_sha256)
 values(p_org,v_rev,v_sha)
 on conflict(organization_id) do update
 set revision=excluded.revision,policy_sha256=excluded.policy_sha256;
 return query select v_rev,v_sha;
end;
$submit$;

create function bm_intake_private.review_policy_history_draft(
 p_org uuid,p_actor uuid,p_revision integer,p_expected_sha text,
 p_decision text
) returns table(reviewed_revision integer,reviewed_sha256 text,reviewed_status text)
language plpgsql security invoker
set search_path=pg_catalog,public as $review$
declare v_draft bm_intake_private.policy_draft_events%rowtype;
 v_head integer;v_sha text;
begin
 if p_org is null or p_actor is null or p_revision is null
   or p_revision not between 1 and 1000
   or coalesce(p_expected_sha,'') !~ '^[0-9a-f]{64}$'
   or p_decision is null or p_decision not in ('approve','reject') then
   raise exception 'Invalid independent policy review' using errcode='22023';
 end if;
 perform 1 from public.bm_memberships where organization_id=p_org
   and user_id=p_actor and member_role in ('owner','operator') for share;
 if not found then
   raise exception 'Current independently authorized reviewer required'
     using errcode='42501';
 end if;
 -- Transaction-scoped per-tenant lock also serializes concurrent first writes.
 -- Hash collisions can only serialize unrelated tenants, never mix their data.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 select revision,policy_sha256 into v_head,v_sha
 from bm_intake_private.policy_submission_heads
 where organization_id=p_org for share;
 if not found or v_head is distinct from p_revision
   or v_sha is distinct from p_expected_sha then
   raise exception 'Stale policy review head' using errcode='40001';
 end if;
 select * into v_draft from bm_intake_private.policy_draft_events
 where organization_id=p_org and revision=p_revision for share;
 if not found or v_draft.submitted_by=p_actor
   or v_draft.policy_sha256 is distinct from p_expected_sha then
   raise exception 'Policy cannot be self-reviewed or changed'
     using errcode='42501';
 end if;
 insert into bm_intake_private.policy_decision_events(
   organization_id,revision,policy_sha256,decision,reviewed_by)
 values(p_org,p_revision,p_expected_sha,
   case when p_decision='approve' then 'approved' else 'rejected' end,p_actor);
 return query select p_revision,p_expected_sha,
   case when p_decision='approve' then 'approved' else 'rejected' end;
end;
$review$;

-- A single membership-checked snapshot, assembled entirely from event rows.
-- This matches PolicyHistory's exact fields, including rejected revisions.
create function bm_intake_private.read_policy_history(
 p_org uuid,p_actor uuid
) returns jsonb
language plpgsql security invoker
set search_path=pg_catalog,public as $read$
declare v_history jsonb;v_active integer;
begin
 if p_org is null or p_actor is null then
   raise exception 'Invalid policy history selector' using errcode='22023';
 end if;
 perform 1 from public.bm_memberships where organization_id=p_org
  and user_id=p_actor and member_role in ('owner','operator','contractor')
  for share;
 if not found then
   raise exception 'Current tenant membership required for policy history'
     using errcode='42501';
 end if;
 -- Keep active pointer and revisions on one transaction-scoped snapshot.
 -- No response can mix revisions before and after a concurrent decision.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 select max(d.revision) into v_active
 from bm_intake_private.policy_draft_events d
 join bm_intake_private.policy_decision_events e
  on d.organization_id=e.organization_id and d.revision=e.revision
 where d.organization_id=p_org and e.decision='approved';
 select jsonb_agg(jsonb_build_object(
   'organizationId',d.organization_id::text,'revision',d.revision,
   'status',coalesce(e.decision,'draft'),
   'submittedBy',d.submitted_by::text,
   'reviewedBy',e.reviewed_by::text,
   'policySha256',d.policy_sha256,'policy',d.policy
 ) order by d.revision) into v_history
 from bm_intake_private.policy_draft_events d
 left join bm_intake_private.policy_decision_events e
   on e.organization_id=d.organization_id and e.revision=d.revision
 where d.organization_id=p_org;
 if v_history is null then return null; end if;
 return jsonb_build_object('organizationId',p_org::text,
   'activeRevision',v_active,'revisions',v_history);
end;
$read$;
-- Every activated revision, ADJACENT or after rejected submissions,
-- requires an independently reviewed target event. Skips additionally require each immutable draft to
-- have a separately recorded rejection and the target approved event to
-- match the exact policy SHA and the two actual recorded actors.
create function bm_intake_private.approved_policy_gap_is_reviewed(
 p_org uuid,p_previous integer,p_target integer,p_sha text,
 p_submitter uuid,p_reviewer uuid
) returns boolean
language sql stable security invoker
set search_path=pg_catalog,public
as $gap$
 select p_org is not null
   and p_previous is not null and p_previous>=0
   and p_target is not null and p_target>p_previous
   and p_target<=1000
   and p_submitter is not null and p_reviewer is not null
   and p_submitter<>p_reviewer
   and p_sha ~ '^[0-9a-f]{64}$'
   and exists (
     select 1
     from bm_intake_private.policy_draft_events d
     join bm_intake_private.policy_decision_events e
       on e.organization_id=d.organization_id
       and e.revision=d.revision and e.policy_sha256=d.policy_sha256
     where d.organization_id=p_org and d.revision=p_target
       and d.policy_sha256=p_sha and d.submitted_by=p_submitter
       and e.reviewed_by=p_reviewer and e.decision='approved'
   )
   and not exists (
     select 1
     from generate_series(p_previous+1,p_target-1) n(revision)
     left join bm_intake_private.policy_draft_events d
       on d.organization_id=p_org and d.revision=n.revision
     left join bm_intake_private.policy_decision_events e
       on e.organization_id=d.organization_id
       and e.revision=d.revision and e.policy_sha256=d.policy_sha256
     where d.revision is null or e.decision is distinct from 'rejected'
   );
$gap$;
revoke all on function bm_intake_private.approved_policy_gap_is_reviewed(
 uuid,integer,integer,text,uuid,uuid) from public,anon,authenticated;
grant execute on function bm_intake_private.approved_policy_gap_is_reviewed(
 uuid,integer,integer,text,uuid,uuid) to service_role;

revoke all on function bm_intake_private.submit_policy_history_draft(
 uuid,uuid,integer,text,text),
 bm_intake_private.review_policy_history_draft(uuid,uuid,integer,text,text),
 bm_intake_private.read_policy_history(uuid,uuid) from public,anon,authenticated;
grant execute on function bm_intake_private.submit_policy_history_draft(
 uuid,uuid,integer,text,text),
 bm_intake_private.review_policy_history_draft(uuid,uuid,integer,text,text),
 bm_intake_private.read_policy_history(uuid,uuid) to service_role;
