-- Atomic, project-owned evidence upload quota. Installed only on the dedicated
-- BidMason Supabase project after isolated PostgreSQL testing and review.
-- No browser role can call this function or read/write its accounting rows.
create table public.bm_upload_quota (
  organization_id uuid not null references public.bm_organizations(id),
  user_id uuid not null,
  hour_bucket bigint not null,
  attempts smallint not null check (attempts between 1 and 12),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, hour_bucket)
);

alter table public.bm_upload_quota enable row level security;
revoke all on public.bm_upload_quota from public, anon, authenticated;
grant select, insert, update on public.bm_upload_quota to service_role;
-- The invoker checks the real membership roster under the trusted role.
grant select on public.bm_memberships to service_role;

-- A SECURITY INVOKER function, executable ONLY by the trusted service role.
-- PostgreSQL's INSERT .. ON CONFLICT UPDATE is atomic across app instances.
-- Do not use a browser key to invoke this RPC; every reservation consumes an
-- attempt, including uploads that fail later (conservative abuse policy).
create function public.bm_reserve_upload_quota(
  p_user_id uuid,
  p_organization_id uuid
) returns boolean
language plpgsql volatile security invoker
set search_path = ''
as $bm$
declare reserved boolean := false;
begin
  if p_user_id is null or p_organization_id is null then
    return false;
  end if;
  if not exists (
    select 1 from public.bm_memberships m
    where m.user_id = p_user_id and m.organization_id = p_organization_id
  ) then
    return false;
  end if;

  insert into public.bm_upload_quota(
    organization_id, user_id, hour_bucket, attempts
  ) values (
    p_organization_id, p_user_id,
    floor(extract(epoch from clock_timestamp()) / 3600)::bigint, 1
  )
  on conflict (organization_id, user_id, hour_bucket)
  do update set attempts = public.bm_upload_quota.attempts + 1
  where public.bm_upload_quota.attempts < 12
  returning true into reserved;

  return coalesce(reserved, false);
end;
$bm$;

revoke all on function public.bm_reserve_upload_quota(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.bm_reserve_upload_quota(uuid, uuid) to service_role;
