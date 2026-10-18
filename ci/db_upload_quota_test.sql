\\set ON_ERROR_STOP on
-- Runs in isolated PostgreSQL with synthetic tenant fixtures.
begin;
set role service_role;
do $bm$
declare i int;
begin
  for i in 1..12 loop
    if public.bm_reserve_upload_quota(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '10000000-0000-4000-8000-000000000001'
    ) is not true then
      raise exception 'An authorized request within hourly quota was denied: %', i;
    end if;
  end loop;
  if public.bm_reserve_upload_quota(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000001'
  ) is not false then
    raise exception 'Thirteenth request exceeded quota but was allowed';
  end if;
  if public.bm_reserve_upload_quota(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '10000000-0000-4000-8000-000000000002'
  ) is not true then
    raise exception 'Independent tenant did not receive its own quota';
  end if;
  if public.bm_reserve_upload_quota(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000002'
  ) is not false then
    raise exception 'Cross-tenant quota reservation was allowed';
  end if;
  if public.bm_reserve_upload_quota(
    null, '10000000-0000-4000-8000-000000000001'
  ) is not false then
    raise exception 'Missing actor obtained quota';
  end if;
  if (select attempts from public.bm_upload_quota where
    organization_id='10000000-0000-4000-8000-000000000001'
    and user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') != 12 then
    raise exception 'Atomic quota accounting incorrect';
  end if;
end;
$bm$;
reset role;

set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $bm$
declare permitted boolean := false;
begin
  begin
    perform public.bm_reserve_upload_quota(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '10000000-0000-4000-8000-000000000001');
    permitted := true;
  exception when insufficient_privilege then null;
  end;
  if permitted then raise exception 'Regular user can invoke privileged upload quota RPC'; end if;

  permitted := false;
  begin
    perform 1 from public.bm_upload_quota;
    permitted := true;
  exception when insufficient_privilege then null;
  end;
  if permitted then raise exception 'Regular user can read quota rows'; end if;

  permitted := false;
  begin
    insert into public.bm_upload_quota(
      organization_id,user_id,hour_bucket,attempts
    ) values (
      '10000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,1
    );
    permitted := true;
  exception when insufficient_privilege then null;
  end;
  if permitted then raise exception 'Regular user can mint quota rows'; end if;
end;
$bm$;
reset role;
do $bm$
begin
  if (select relrowsecurity from pg_class
    where oid='public.bm_upload_quota'::regclass) is not true then
    raise exception 'Upload quota table must have RLS';
  end if;
  if (select prosecdef from pg_proc
    where oid='public.bm_reserve_upload_quota(uuid,uuid)'::regprocedure) is not false then
    raise exception 'Upload quota RPC must run as SECURITY INVOKER';
  end if;
  if has_function_privilege('anon', 'public.bm_reserve_upload_quota(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.bm_reserve_upload_quota(uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.bm_reserve_upload_quota(uuid,uuid)', 'EXECUTE')
  then raise exception 'Upload quota RPC executable by untrusted role'; end if;
end;
$bm$;
rollback;
\\echo PASS: atomic hourly quota ceiling, cross-tenant denial, no direct client/RPC access
