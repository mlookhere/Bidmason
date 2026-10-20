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

-- Never roll back the active pointer or skip an unreviewed revision.
-- Gaps are permitted only with immutable submitted+rejected events for EVERY
-- intervening revision and a matching distinct-actor approved target event.
create function bm_intake_private.enforce_policy_head_transition()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public
as $headguard$
declare v_approved bm_intake_private.approved_policy_versions%rowtype;
begin
 if tg_op='DELETE' then
   raise exception 'Active approved policy cannot be deleted'
     using errcode='42501';
 end if;
 if tg_op='UPDATE' then
   if new.organization_id is distinct from old.organization_id
     or new.revision<=old.revision then
     raise exception 'Approved policy head cannot roll back'
       using errcode='42501';
   end if;
   -- Adjacent versions require the same immutable target approval as gaps.
 end if;
 select * into v_approved
 from bm_intake_private.approved_policy_versions
 where organization_id=new.organization_id and revision=new.revision
   and policy_sha256=new.policy_sha256;
 if not found or not bm_intake_private.approved_policy_gap_is_reviewed(
   new.organization_id,case when tg_op='INSERT' then 0 else old.revision end,
   new.revision,new.policy_sha256,v_approved.submitted_by,
   v_approved.reviewed_by) then
   raise exception 'Approved policy head cannot skip unreviewed revisions'
     using errcode='42501';
 end if;
 return new;
end;
$headguard$;
create trigger bm_active_policy_head_monotonic
before update or delete on bm_intake_private.active_policy_heads
for each row execute function bm_intake_private.enforce_policy_head_transition();

-- AFTER INSERT is required: INSERT ... ON CONFLICT DO UPDATE still invokes
-- BEFORE INSERT, which must not misclassify an existing-head update as an
-- initial revision. This guard runs only when a new row truly persisted.
create function bm_intake_private.enforce_first_policy_head()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $firsthead$
declare v_approved bm_intake_private.approved_policy_versions%rowtype;
begin
 -- Including first revision 1: no policy may activate without review.
 select * into v_approved
 from bm_intake_private.approved_policy_versions
 where organization_id=new.organization_id and revision=new.revision
   and policy_sha256=new.policy_sha256;
 if not found or not bm_intake_private.approved_policy_gap_is_reviewed(
   new.organization_id,0,new.revision,new.policy_sha256,
   v_approved.submitted_by,v_approved.reviewed_by) then
   raise exception 'First approved head cannot skip unreviewed revisions'
     using errcode='42501';
 end if;
 return new;
end;
$firsthead$;
create trigger bm_first_policy_head_verified
after insert on bm_intake_private.active_policy_heads
for each row execute function bm_intake_private.enforce_first_policy_head();

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
 v_service record;
 v_adjustment text;
 v_exclusion jsonb;
 v_excluded text[]:=array[]::text[];
 v_code text;
 v_cost record;
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
   or coalesce(v_policy->'pricing'->>'calculationOrder','')
        not in ('surcharge-then-discount','discount-then-surcharge')
   or coalesce(v_policy->'pricing'->'minimum'->>'rule','')
        not in ('none','per-line','quote')
   or jsonb_typeof(v_policy->'pricing'->'minimum'->'cents')
        is distinct from 'number'
   or coalesce(v_policy->'pricing'->'minimum'->>'cents','')
        !~ '^(0|[1-9][0-9]{0,15})$'
   or jsonb_typeof(v_policy->'tax') is distinct from 'object'
   or coalesce(v_policy->'tax'->>'method','')
        not in ('none','exclusive-all-charged')
   or jsonb_typeof(v_policy->'tax'->'bps') is distinct from 'number'
   or coalesce(v_policy->'tax'->>'bps','')
        !~ '^(0|[1-9][0-9]{0,4})$'
   or (v_policy->'tax'->>'bps')::integer>10000 then
   raise exception 'Policy snapshot is invalid or mismatched'
   using errcode='22023';
 end if;
 if (v_policy->'pricing'->'minimum'->>'cents')::numeric>9007199254740991 then
   raise exception 'Company minimum exceeds JS safe integer'
     using errcode='22023';
 end if;
 -- These commercial invariants are independently enforced in SQL.
 -- A trusted TypeScript review cannot substitute for database validation.
 if length(btrim(coalesce(v_policy->'pricing'->>'policyId','')))=0
   or (v_policy->'pricing'->'minimum'->>'rule'='none'
       and (v_policy->'pricing'->'minimum'->>'cents')::numeric<>0)
   or (v_policy->'tax'->>'method'='none'
       and (v_policy->'tax'->>'bps')::numeric<>0) then
    raise exception 'Contradictory or unidentified approved company pricing'
      using errcode='22023';
 end if;
 if (select count(*) from jsonb_object_keys(v_policy->'pricing'->'services'))=0 then
  raise exception 'Approved company policy must contain services'
    using errcode='22023';
 end if;
 for v_service in select key,value from jsonb_each(v_policy->'pricing'->'services') loop
   if v_service.key !~ '^[a-z][a-z0-9_-]{0,63}$'
     or jsonb_typeof(v_service.value) is distinct from 'object'
     or length(btrim(coalesce(v_service.value->>'label','')))=0
     or length(btrim(coalesce(v_service.value->>'unit','')))=0
     or coalesce(v_service.value->>'billing','')
       not in ('charged','included','pending')
     or jsonb_typeof(v_service.value->'rateCents') is distinct from 'number'
     or coalesce(v_service.value->>'rateCents','')
       !~ '^(0|[1-9][0-9]{0,15})$'
     or (v_service.value ? 'optionalAddon'
       and jsonb_typeof(v_service.value->'optionalAddon')
         is distinct from 'boolean') then
     raise exception 'Invalid approved company service configuration'
       using errcode='22023';
   end if;
   if (v_service.value->>'rateCents')::numeric>9007199254740991 then
     raise exception 'Company rate exceeds JS safe integer'
       using errcode='22023';
   end if;
   -- Validate BOTH optional line adjustments for all services, including
   -- pending/included services that may later become chargeable.
   foreach v_adjustment in array array['surchargeBps','discountBps'] loop
     if v_service.value ? v_adjustment then
       if jsonb_typeof(v_service.value->v_adjustment) is distinct from 'number'
         or coalesce(v_service.value->>v_adjustment,'')
             !~ '^(0|[1-9][0-9]{0,4})$' then
         raise exception 'Invalid company service percentage'
           using errcode='22023';
       end if;
       if (v_service.value->>v_adjustment)::numeric>10000 then
         raise exception 'Company service percentage exceeds 10000 bps'
           using errcode='22023';
       end if;
     end if;
   end loop;
 end loop;
 -- Exclusions must be unique, present in the approved service catalog and
 -- literal JSON strings. Do not accept JSON objects, duplicate exclusions,
 -- or references to unlisted services.
 if v_policy ? 'excludedServiceCodes' then
   if jsonb_typeof(v_policy->'excludedServiceCodes') is distinct from 'array' then
     raise exception 'Company exclusions must be an array' using errcode='22023';
   end if;
   for v_exclusion in select value from
     jsonb_array_elements(v_policy->'excludedServiceCodes') loop
     if jsonb_typeof(v_exclusion) is distinct from 'string' then
       raise exception 'Company exclusion must be a service code'
         using errcode='22023';
     end if;
     v_code:=v_exclusion#>>'{}';
     if not (v_policy->'pricing'->'services' ? v_code)
       or v_code=any(v_excluded) then
       raise exception 'Unknown or repeated company exclusion'
         using errcode='22023';
     end if;
     v_excluded:=array_append(v_excluded,v_code);
   end loop;
 end if;
 -- Optional unit direct costs must be nonnegative integer cents and belong
 -- only to known service codes; malformed economics never reach active heads.
 if v_policy ? 'unitDirectCostsCents' then
   if jsonb_typeof(v_policy->'unitDirectCostsCents') is distinct from 'object' then
     raise exception 'Invalid company direct cost schedule'
       using errcode='22023';
   end if;
   for v_cost in select key,value from
     jsonb_each(v_policy->'unitDirectCostsCents') loop
     if not (v_policy->'pricing'->'services' ? v_cost.key)
       or jsonb_typeof(v_cost.value) is distinct from 'number'
       or coalesce(v_cost.value#>>'{}','')
            !~ '^(0|[1-9][0-9]{0,15})$' then
       raise exception 'Invalid company direct cost entry'
         using errcode='22023';
     end if;
     if (v_cost.value#>>'{}')::numeric>9007199254740991 then
       raise exception 'Company direct cost exceeds JS safe integer'
         using errcode='22023';
     end if;
   end loop;
 end if;
 v_sha:=encode(sha256(convert_to(p_canonical_policy_text,'UTF8')),'hex');
 -- Shared with durable draft/review decisions to prevent concurrent
 -- submit/review events from changing while a noncontiguous activation is
 -- being validated. Preserve existing scope-CAS row lock serialization.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 select revision into v_previous from bm_intake_private.active_policy_heads
 where organization_id=p_org for update;
 if not found then v_previous:=0; end if;
 if p_revision<=v_previous then
   raise exception 'Stale active company policy head' using errcode='40001';
 end if;
 -- Even revision 1 and consecutive approvals require a matching, separately
 -- reviewed immutable target event. Skips ALSO require every intermediate
 -- rejection. A pair of valid member UUIDs is never approval evidence.
 if not bm_intake_private.approved_policy_gap_is_reviewed(
     p_org,v_previous,p_revision,v_sha,p_submitter,p_reviewer) then
   raise exception 'Unproven independently reviewed policy activation'
     using errcode='40001';
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
