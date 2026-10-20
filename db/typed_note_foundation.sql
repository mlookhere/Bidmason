-- STAGED ITEM 4 DDL: isolated PostgreSQL CI only. NOT deployed.
-- Item 3 Auth/RLS and two-user acceptance remain mandatory.
create schema if not exists bm_intake_private;
revoke all on schema bm_intake_private from public, anon, authenticated;
grant usage on schema bm_intake_private to service_role;

create table public.bm_intake_sources (
 organization_id uuid not null references public.bm_organizations(id),
 id uuid not null default gen_random_uuid(),
 created_by uuid not null,
 request_id uuid not null,
 kind text not null default 'typed-note' check (kind = 'typed-note'),
 original_text text not null check (
   octet_length(original_text) between 1 and 65536
   and length(btrim(original_text)) > 0),
 text_sha256 text not null check (
   text_sha256 ~ '^[0-9a-f]{64}$'
   and text_sha256 = encode(sha256(convert_to(original_text,'UTF8')),'hex')),
 revision integer not null default 1 constraint bm_source_revision_range check (revision between 1 and 3),
 review jsonb,
 extraction_audit jsonb not null default '[]'::jsonb,
 scope_review jsonb,
 created_at timestamptz not null default now(),
 primary key (organization_id,id),
 unique (organization_id,created_by,request_id),
 unique (organization_id,id,created_by,request_id,text_sha256),
 constraint bm_source_lifecycle check (
   (revision = 1 and review is null and extraction_audit = '[]'::jsonb
     and scope_review is null)
   or (revision = 2 and review is not null and jsonb_typeof(review) = 'object'
     and jsonb_typeof(extraction_audit) = 'array'
     and jsonb_array_length(extraction_audit) = 1
     and scope_review is null)
   or (revision = 3 and review is not null and jsonb_typeof(review) = 'object'
     and jsonb_typeof(extraction_audit) = 'array'
     and jsonb_array_length(extraction_audit) = 1
     and scope_review is not null and jsonb_typeof(scope_review) = 'object')
 )
);
create table public.bm_typed_note_requests (
 organization_id uuid not null,
 actor_id uuid not null,
 request_id uuid not null,
 source_id uuid not null,
 text_sha256 text not null,
 created_at timestamptz not null default now(),
 primary key (organization_id,actor_id,request_id),
 unique (organization_id,source_id),
 foreign key (organization_id,source_id,actor_id,request_id,text_sha256)
   references public.bm_intake_sources
    (organization_id,id,created_by,request_id,text_sha256)
   on update restrict on delete restrict
);
create index bm_intake_sources_actor_lookup
 on public.bm_intake_sources(organization_id,created_by,created_at desc);
alter table public.bm_intake_sources enable row level security;
alter table public.bm_intake_sources force row level security;
alter table public.bm_typed_note_requests enable row level security;
alter table public.bm_typed_note_requests force row level security;
revoke all on public.bm_intake_sources,public.bm_typed_note_requests
 from public,anon,authenticated;
-- Row locks for idempotent replay require UPDATE rights as well as SELECT.
-- Never extend these rights to anon/authenticated browser sessions.
grant select,insert,update on public.bm_intake_sources,public.bm_typed_note_requests to service_role;
-- FOR SHARE requires UPDATE privileges in addition to SELECT.
-- Only service_role is trusted; never grant UPDATE to browsers.
grant select, update on public.bm_memberships to service_role;

-- No public RPC. Trusted server MUST pass an actor derived from verified Auth.
-- The membership row is locked against concurrent revocation until COMMIT.
create function bm_intake_private.create_typed_note(
 p_organization_id uuid,p_actor_id uuid,p_request_id uuid,p_text text
) returns table(source_id uuid,source_revision integer,original_sha256 text)
language plpgsql security invoker set search_path=pg_catalog,public
as $body$
declare
 v_id uuid;
 v_note public.bm_intake_sources%rowtype;
 v_ledger public.bm_typed_note_requests%rowtype;
 v_digest text;
begin
 if p_organization_id is null or p_actor_id is null or p_request_id is null
   or p_text is null or octet_length(p_text) not between 1 and 65536
   or length(btrim(p_text))=0 then
   raise exception 'Invalid typed-note request' using errcode='22023';
 end if;
 perform 1 from public.bm_memberships
  where organization_id=p_organization_id and user_id=p_actor_id
    and member_role in ('owner','operator','contractor') for share;
 if not found then
   raise exception 'Current tenant membership required' using errcode='42501';
 end if;
 v_digest:=encode(sha256(convert_to(p_text,'UTF8')),'hex');
 insert into public.bm_intake_sources(
   organization_id,created_by,request_id,original_text,text_sha256
 ) values (p_organization_id,p_actor_id,p_request_id,p_text,v_digest)
 on conflict (organization_id,created_by,request_id) do nothing
 returning id into v_id;
 select * into v_note from public.bm_intake_sources
  where organization_id=p_organization_id and created_by=p_actor_id
    and request_id=p_request_id for update;
 if not found or v_note.text_sha256<>v_digest or v_note.original_text<>p_text then
   raise exception 'Idempotency key payload conflict' using errcode='23505';
 end if;
 insert into public.bm_typed_note_requests(
  organization_id,actor_id,request_id,source_id,text_sha256
 ) values (p_organization_id,p_actor_id,p_request_id,v_note.id,v_note.text_sha256)
 on conflict (organization_id,actor_id,request_id) do nothing;
 select * into v_ledger from public.bm_typed_note_requests
  where organization_id=p_organization_id and actor_id=p_actor_id
    and request_id=p_request_id for update;
 if not found or v_ledger.source_id<>v_note.id
   or v_ledger.text_sha256<>v_note.text_sha256 then
   raise exception 'Typed-note ledger integrity conflict' using errcode='23505';
 end if;
 return query select v_note.id,v_note.revision,v_note.text_sha256;
end;
$body$;
revoke all on function bm_intake_private.create_typed_note(uuid,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function bm_intake_private.create_typed_note(uuid,uuid,uuid,text)
 to service_role;

-- Database-level immutability: trusting a worker is NOT permission to rewrite
-- original evidence, reassign source identity or erase its audit. Owner/superuser
-- bypasses remain outside this boundary; these are not production Auth checks.
create function bm_intake_private.enforce_source_transition()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public
as $guard$
begin
 if tg_op = 'DELETE' then
   raise exception 'Intake source deletion forbidden'
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
   and old.scope_review is null
   and new.review is not null
   and jsonb_typeof(new.review)='object'
   and jsonb_typeof(new.extraction_audit)='array'
   and jsonb_array_length(new.extraction_audit)=1
   and new.scope_review is null then
   return new;
 end if;
 if old.revision=2 and new.revision=3
   and new.review is not distinct from old.review
   and new.extraction_audit is not distinct from old.extraction_audit
   and old.scope_review is null
   and new.scope_review is not null
   and jsonb_typeof(new.scope_review)='object' then
   return new;
 end if;
 raise exception 'Invalid intake revision transition'
   using errcode='42501';
end;
$guard$;
create trigger bm_intake_source_guard
 before update or delete on public.bm_intake_sources
 for each row execute function bm_intake_private.enforce_source_transition();

create function bm_intake_private.enforce_ledger_append_only()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public
as $guard$
begin
 raise exception 'Typed-note request ledger is append-only'
   using errcode='42501';
end;
$guard$;
create trigger bm_typed_note_request_guard
 before update or delete on public.bm_typed_note_requests
 for each row execute function bm_intake_private.enforce_ledger_append_only();
revoke all on function bm_intake_private.enforce_source_transition()
 from public,anon,authenticated;
revoke all on function bm_intake_private.enforce_ledger_append_only()
 from public,anon,authenticated;
