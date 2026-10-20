-- STAGED ITEM 4: canonical digest of a reviewed candidate list.
-- Matches lib/intake-review.ts candidatesDigest: JSON.stringify of ordered
-- [serviceCode, units, start, end, excerpt] tuples. Never hashes JSONB's
-- lexical representation or object-key ordering.
create function bm_intake_private.canonical_candidate_sha256(
 p_candidates jsonb
) returns text
language plpgsql immutable security invoker
set search_path=pg_catalog,public
as $hash$
declare
 v_candidate jsonb;
 v_payload text:='[';
 v_count integer;
 v_index integer:=0;
 v_units bigint;
 v_start bigint;
 v_end bigint;
begin
 if p_candidates is null
    or jsonb_typeof(p_candidates) is distinct from 'array' then
   raise exception 'Invalid candidate array' using errcode='22023';
 end if;
 v_count:=jsonb_array_length(p_candidates);
 if v_count not between 1 and 50 then
   raise exception 'Invalid candidate count' using errcode='22023';
 end if;
 for v_candidate in select value from jsonb_array_elements(p_candidates) loop
   if jsonb_typeof(v_candidate) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v_candidate))<>5
     or exists (select 1 from jsonb_object_keys(v_candidate) k
       where k not in ('serviceCode','units','start','end','excerpt'))
     or jsonb_typeof(v_candidate->'serviceCode') is distinct from 'string'
     or (v_candidate->>'serviceCode') !~ '^[a-z][a-z0-9_-]{0,63}$'
     or jsonb_typeof(v_candidate->'units') is distinct from 'number'
     or (v_candidate->>'units') !~ '^[1-9][0-9]{0,15}$'
     or jsonb_typeof(v_candidate->'start') is distinct from 'number'
     or (v_candidate->>'start') !~ '^(0|[1-9][0-9]{0,15})$'
     or jsonb_typeof(v_candidate->'end') is distinct from 'number'
     or (v_candidate->>'end') !~ '^[1-9][0-9]{0,15}$'
     or jsonb_typeof(v_candidate->'excerpt') is distinct from 'string'
     or length(btrim(v_candidate->>'excerpt'))=0 then
     raise exception 'Invalid candidate digest input' using errcode='22023';
   end if;
   v_units:=(v_candidate->>'units')::bigint;
   v_start:=(v_candidate->>'start')::bigint;
   v_end:=(v_candidate->>'end')::bigint;
   if v_units>9007199254740991 or v_end<=v_start or v_end>131072 then
     raise exception 'Unsafe candidate numeric value' using errcode='22023';
   end if;
   if v_index>0 then v_payload:=v_payload||','; end if;
   -- to_json(text) escapes quotes, slashes and control characters just as
   -- ECMAScript JSON.stringify does. All numbers are normalized integers.
   v_payload:=v_payload||'['
     ||to_json(v_candidate->>'serviceCode')::text||','
     ||v_units::text||','||v_start::text||','||v_end::text||','
     ||to_json(v_candidate->>'excerpt')::text||']';
   v_index:=v_index+1;
 end loop;
 v_payload:=v_payload||']';
 return encode(sha256(convert_to(v_payload,'UTF8')),'hex');
end;
$hash$;
revoke all on function bm_intake_private.canonical_candidate_sha256(jsonb)
 from public,anon,authenticated;
grant execute on function bm_intake_private.canonical_candidate_sha256(jsonb)
 to service_role;
