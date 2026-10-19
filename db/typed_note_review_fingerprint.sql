-- STAGED / disposable PostgreSQL: reproduce the narrow deterministic
-- TypeScript source/review/policy fingerprint contract. NOT an Auth signature
-- or quote approval. Called AFTER tenant ownership + review shape checks.
create function bm_intake_private.review_workbench_sha256(
 p_source_sha text,p_candidates_sha text,p_policy_sha text
) returns text
language plpgsql immutable security invoker
set search_path=pg_catalog,public
as $key$
begin
 if p_source_sha is null or p_source_sha !~ '^[0-9a-f]{64}$'
   or p_candidates_sha is null or p_candidates_sha !~ '^[0-9a-f]{64}$'
   or p_policy_sha is null or p_policy_sha !~ '^[0-9a-f]{64}$' then
   raise exception 'Invalid review fingerprint inputs' using errcode='22023';
 end if;
 -- Exact JSON.stringify([sourceSha, candidatesSha, policySha]) UTF-8 bytes.
 return encode(sha256(convert_to(
   '['||to_json(p_source_sha)::text||','
      ||to_json(p_candidates_sha)::text||','
      ||to_json(p_policy_sha)::text||']','UTF8')),'hex');
end;
$key$;
revoke all on function bm_intake_private.review_workbench_sha256(
 text,text,text) from public,anon,authenticated;
grant execute on function bm_intake_private.review_workbench_sha256(
 text,text,text) to service_role;

create function bm_intake_private.reviewed_selection_sha256(
 p_review jsonb,p_selected jsonb,p_acknowledged jsonb,p_policy_sha text
) returns text
language plpgsql immutable security invoker
set search_path=pg_catalog,public
as $selection$
declare
 v_candidates jsonb;
 v_part jsonb;
 v_position jsonb;
 v_index integer;
 v_count integer:=0;
 v_previous integer:=-1;
 v_payload text:='[';
 v_code text;
 v_units text;
 v_start text;
 v_end text;
 v_seen text[]:=array[]::text[];
 v_addon text;
begin
 if p_review is null or jsonb_typeof(p_review) is distinct from 'object'
   or p_selected is null or jsonb_typeof(p_selected) is distinct from 'array'
   or p_acknowledged is null
   or jsonb_typeof(p_acknowledged) is distinct from 'array'
   or p_policy_sha is null or p_policy_sha !~ '^[0-9a-f]{64}$'
   or coalesce(p_review->>'sourceSha256','') !~ '^[0-9a-f]{64}$'
   or coalesce(p_review->>'candidatesSha256','') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_review->'candidates') is distinct from 'array' then
   raise exception 'Invalid selected source fingerprint inputs' using errcode='22023';
 end if;
 v_candidates:=p_review->'candidates';
 if jsonb_array_length(p_selected) not between 1 and 50
   or jsonb_array_length(p_acknowledged)>50 then
   raise exception 'Invalid reviewed selection length' using errcode='22023';
 end if;
 for v_position in select value from jsonb_array_elements(p_selected) loop
   if jsonb_typeof(v_position) is distinct from 'number'
     or coalesce(v_position#>>'{}','') !~ '^(0|[1-9][0-9]{0,5})$' then
     raise exception 'Invalid reviewed selection index' using errcode='22023';
   end if;
   v_index:=(v_position#>>'{}')::integer;
   if v_index<=v_previous or v_index>=jsonb_array_length(v_candidates) then
     raise exception 'Duplicate or out-of-order reviewed selection'
       using errcode='22023';
   end if;
   v_previous:=v_index;
   v_part:=v_candidates->v_index;
   v_code:=v_part->>'serviceCode';
   v_units:=v_part->>'units';
   v_start:=v_part->>'start';
   v_end:=v_part->>'end';
   if v_code is null or v_code=any(v_seen)
     or v_units is null or v_units !~ '^[1-9][0-9]{0,15}$'
     or v_start is null or v_start !~ '^(0|[1-9][0-9]{0,15})$'
     or v_end is null or v_end !~ '^[1-9][0-9]{0,15}$' then
     raise exception 'Malformed selected original candidate' using errcode='22023';
   end if;
   v_seen:=array_append(v_seen,v_code);
   if v_count>0 then v_payload:=v_payload||','; end if;
   -- Exactly JSON.stringify of JS selectedServices object insertion order:
   -- serviceCode,units,start,end,and optional addonAccepted:true.
   v_payload:=v_payload||'{"serviceCode":'||to_json(v_code)::text
     ||',"units":'||v_units||',"start":'||v_start
     ||',"end":'||v_end;
   if p_acknowledged ? v_code then
     v_payload:=v_payload||',"addonAccepted":true';
   end if;
   v_payload:=v_payload||'}';
   v_count:=v_count+1;
 end loop;
 -- Every explicitly accepted code must be a unique selected service.
 for v_position in select value from jsonb_array_elements(p_acknowledged) loop
   if jsonb_typeof(v_position) is distinct from 'string' then
     raise exception 'Invalid add-on acknowledgement' using errcode='22023';
   end if;
   v_addon:=v_position#>>'{}';
   if not v_addon=any(v_seen) then
     raise exception 'Unselected add-on acknowledgement' using errcode='22023';
   end if;
 end loop;
 if (select count(*) from jsonb_array_elements_text(p_acknowledged))
     <> (select count(distinct value) from jsonb_array_elements_text(p_acknowledged)) then
   raise exception 'Repeated add-on acknowledgement' using errcode='22023';
 end if;
 v_payload:=v_payload||']';
 return encode(sha256(convert_to(
   '['||to_json(p_review->>'sourceSha256')::text||','
      ||to_json(p_review->>'candidatesSha256')::text||','
      ||v_payload||','||to_json(p_policy_sha)::text||']','UTF8')),'hex');
end;
$selection$;
revoke all on function bm_intake_private.reviewed_selection_sha256(
 jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function bm_intake_private.reviewed_selection_sha256(
 jsonb,jsonb,jsonb,text) to service_role;
