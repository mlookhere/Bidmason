-- STAGED / ISOLATED POSTGRES ONLY. NOT a production ratecard migration.
-- Immutable approved versions + a single per-tenant active head. Approval must
-- come from TWO distinct current tenant members, identities derived by a
-- separate fresh server Auth verifier. Never accept browser actor IDs.
create table bm_intake_private.approved_policy_versions(
 organization_id uuid not null references public.bm_organizations(id),
 revision integer not null check(revision between 1 and 1000000),
 policy_sha256 text not null check(policy_sha256 ~ '^[0-9a-f]{64}$'),
 policy jsonb not null check(jsonb_typeof(policy)='object'),
 submitted_by uuid not null,
 reviewed_by uuid not null,
 activated_at timestamptz not null default now(),
 check(submitted_by<>reviewed_by),
 primary key(organization_id,revision),
 unique(organization_id,revision,policy_sha256)
);
create table bm_intake_private.active_policy_heads(
 organization_id uuid primary key references public.bm_organizations(id),
 revision integer not null,
 policy_sha256 text not null,
 foreign key(organization_id,revision,policy_sha256)
 references bm_intake_private.approved_policy_versions(
   organization_id,revision,policy_sha256) on update restrict on delete restrict
);
revoke all on bm_intake_private.approved_policy_versions,
 bm_intake_private.active_policy_heads from public,anon,authenticated;
-- FOR SHARE on policy versions needs UPDATE privilege; the BEFORE trigger
-- rejects any actual attempt to rewrite historical approved evidence.
grant select,insert,update on bm_intake_private.approved_policy_versions to service_role;
grant select,insert,update on bm_intake_private.active_policy_heads to service_role;
alter table bm_intake_private.approved_policy_versions enable row level security;
alter table bm_intake_private.approved_policy_versions force row level security;
alter table bm_intake_private.active_policy_heads enable row level security;
alter table bm_intake_private.active_policy_heads force row level security;

-- Append-only approved versions, also when invoked by the trusted service role.
create function bm_intake_private.deny_approved_policy_rewrite()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public
as $guard$
begin
 raise exception 'Approved policy versions are immutable' using errcode='42501';
end;
$guard$;
create trigger bm_approved_policy_immutable
before update or delete on bm_intake_private.approved_policy_versions
for each row execute function bm_intake_private.deny_approved_policy_rewrite();

-- Staged two-actor approved activation, not a public RPC. The policy JSON
-- must have been validated by company-policy-revisions.ts before this call.
-- JSON text is the canonical, server-generated stable serialized policy;
-- its SHA is stored from the actual UTF-8 bytes, not trusted from a client.
create function bm_intake_private.activate_scope_policy(
 p_org uuid,p_submitter uuid,p_reviewer uuid,p_revision integer,
 p_canonical_policy_text text
) returns table(activated_revision integer, activated_sha256 text)
language plpgsql security invoker
set search_path=pg_catalog,public
as $activate$
declare
 v_policy jsonb;
 v_sha text;
 v_previous integer;
begin
 if p_org is null or p_submitter is null or p_reviewer is null
   or p_submitter=p_reviewer
   or p_revision is null or p_revision not between 1 and 1000000
   or p_canonical_policy_text is null
   or octet_length(p_canonical_policy_text) not between 2 and 65536 then
  raise exception 'Invalid policy activation request' using errcode='22023';
 end if;
 -- Role and membership validation happens before reading the existing head.
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=p_submitter
   and member_role in ('owner','operator','contractor') for share;
 if not found then
  raise exception 'Current policy submitter membership required'
   using errcode='42501';
 end if;
 perform 1 from public.bm_memberships
 where organization_id=p_org and user_id=p_reviewer
   and member_role in ('owner','operator') for share;
 if not found then
  raise exception 'Current policy reviewer membership required'
   using errcode='42501';
 end if;
 v_policy:=p_canonical_policy_text::jsonb;
 if jsonb_typeof(v_policy) is distinct from 'object'
   or jsonb_typeof(v_policy->'revision') is distinct from 'number'
   or v_policy->>'revision' is distinct from p_revision::text
   or jsonb_typeof(v_policy->'pricing'->'services') is distinct from 'object'
   or v_policy->'pricing'->>'currency' is distinct from 'USD'
   or jsonb_typeof(v_policy->'tax') is distinct from 'object' then
   raise exception 'Policy snapshot is invalid or mismatched'
   using errcode='22023';
 end if;
 v_sha:=encode(sha256(convert_to(p_canonical_policy_text,'UTF8')),'hex');
 -- A single organization row serializes activation against scope CAS FOR SHARE.
 select revision into v_previous from bm_intake_private.active_policy_heads
 where organization_id=p_org for update;
 if found then
  if p_revision<>v_previous+1 then
   raise exception 'Stale active company policy head' using errcode='40001';
  end if;
 else
  if p_revision<>1 then
   raise exception 'First approved policy must be revision 1'
    using errcode='40001';
  end if;
 end if;
 insert into bm_intake_private.approved_policy_versions(
  organization_id,revision,policy_sha256,policy,submitted_by,reviewed_by
 ) values(p_org,p_revision,v_sha,v_policy,p_submitter,p_reviewer);
 insert into bm_intake_private.active_policy_heads(
  organization_id,revision,policy_sha256
 ) values(p_org,p_revision,v_sha)
 on conflict(organization_id) do update set
  revision=excluded.revision,policy_sha256=excluded.policy_sha256;
 return query select p_revision,v_sha;
end;
$activate$;
revoke all on function bm_intake_private.activate_scope_policy(
 uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function bm_intake_private.activate_scope_policy(
 uuid,uuid,uuid,integer,text) to service_role;
