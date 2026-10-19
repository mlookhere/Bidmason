-- Disposable PostgreSQL CI only. Expected digests are independently
-- derived from ECMAScript JSON.stringify([[code,units,start,end,excerpt],...])
-- with Unicode left unescaped, followed by UTF-8 SHA-256.
do $check$
begin
 if has_function_privilege('anon',
  'bm_intake_private.canonical_candidate_sha256(jsonb)','EXECUTE')
 or has_function_privilege('authenticated',
  'bm_intake_private.canonical_candidate_sha256(jsonb)','EXECUTE') then
   raise exception 'Browser can execute the private canonical digest function';
 end if;
end;
$check$;

set role service_role;
do $check$
declare
 v_one jsonb:=jsonb_build_array(jsonb_build_object(
  'serviceCode','painting','units',2,'start',0,'end',5,'excerpt','Paint'));
 v_unicode jsonb:=jsonb_build_array(
  jsonb_build_object('serviceCode','painting','units',1,
   'start',6,'end',8,'excerpt','🧱'),
  jsonb_build_object('serviceCode','painting','units',2,
   'start',9,'end',12,'excerpt','two'));
 v_escape jsonb:=jsonb_build_array(jsonb_build_object(
  'serviceCode','inspection','units',1,'start',0,'end',12,
  'excerpt','Quote "line"' || chr(10) || chr(92) || ' 🧱'));
begin
 if bm_intake_private.canonical_candidate_sha256(v_one)<>
     'cffc3959e4701c97f16e37bc457c43d640d887435a01cbdcfb8a923666dfae45'
 or bm_intake_private.canonical_candidate_sha256(v_unicode)<>
     '224c893424cb3920e6b44eb1d3e6b579e5d52895b125c2f743b681bf748743a8'
 or bm_intake_private.canonical_candidate_sha256(v_escape)<>
     '669aaf9a30b8e16fbebbeea08e7aeac51cfce474cce3ae5385947acf564e0ace'
 then
    raise exception 'PostgreSQL candidate digest diverged from JS canonical JSON';
 end if;
 if bm_intake_private.canonical_candidate_sha256(
   jsonb_set(v_one,'{0,units}','3'::jsonb))
   =bm_intake_private.canonical_candidate_sha256(v_one) then
   raise exception 'A different candidate unit count reused the same digest';
 end if;
 if bm_intake_private.canonical_candidate_sha256(
   jsonb_set(v_unicode,'{0,excerpt}',to_jsonb('not the emoji'::text)))
   =bm_intake_private.canonical_candidate_sha256(v_unicode) then
   raise exception 'A different excerpt reused the same digest';
 end if;
 begin
   perform bm_intake_private.canonical_candidate_sha256('[]'::jsonb);
   raise exception 'Empty candidate list was hashed as valid';
 exception when invalid_parameter_value then null; end;
 begin
   perform bm_intake_private.canonical_candidate_sha256(
     jsonb_set(v_one,'{0,units}','9007199254740992'::jsonb));
   raise exception 'Unsafe integer was hashed as valid';
 exception when invalid_parameter_value then null; end;
 begin
   perform bm_intake_private.canonical_candidate_sha256(
     jsonb_set(v_one,'{0,rateCents}','1000'::jsonb));
   raise exception 'Model rate field was hashed as valid';
 exception when invalid_parameter_value then null; end;
end;
$check$;
reset role;
select 'PASS: PostgreSQL SHA-256 exactly matches Unicode/escaped JS candidate tuples';
