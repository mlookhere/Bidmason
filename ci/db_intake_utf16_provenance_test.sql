-- Disposably execute AFTER staged source and extraction CAS have been installed.
-- PostgreSQL must independently reject forged UTF-16 offsets and excerpts;
-- JavaScript UTF-16 spans count a non-BMP emoji as TWO code units.
do $check$
begin
 if has_function_privilege('authenticated',
  'bm_intake_private.matches_typed_note_utf16_excerpt(text,jsonb)','EXECUTE')
 or has_function_privilege('anon',
  'bm_intake_private.matches_typed_note_utf16_excerpt(text,jsonb)','EXECUTE') then
  raise exception 'Browser can call private UTF-16 source validator';
 end if;
end;
$check$;

insert into public.bm_memberships(organization_id,user_id,member_role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '33333333-3333-4333-8333-333333333333','operator');
set role service_role;
do $check$
declare
 v_org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_actor uuid:='33333333-3333-4333-8333-333333333333';
 v_req uuid:='55555555-5555-4555-8555-555555555555';
 v_text text:='Paint 🧱 two rooms';
 v_source uuid;
 v_sha text;
 v_review jsonb;
 v_bad jsonb;
 v_result record;
begin
 select source_id,original_sha256 into v_source,v_sha
 from bm_intake_private.create_typed_note(v_org,v_actor,v_req,v_text);
 v_review:=jsonb_build_object(
  'state','needs-human-review','kind','typed-note',
  'sourceSha256',encode(sha256(convert_to('typed-note','UTF8')
   ||decode('00','hex')||convert_to(v_text,'UTF8')),'hex'),
  'candidatesSha256',repeat('b',64),
  'candidates',jsonb_build_array(
   jsonb_build_object('serviceCode','painting','units',1,
     'start',6,'end',8,'excerpt','🧱'),
   jsonb_build_object('serviceCode','painting','units',2,
     'start',9,'end',12,'excerpt','two')));
 v_review:=jsonb_set(v_review,'{candidatesSha256}',to_jsonb(
   bm_intake_private.canonical_candidate_sha256(v_review->'candidates')));

 if not bm_intake_private.matches_typed_note_utf16_excerpt(v_text,
      v_review->'candidates'->0)
  or not bm_intake_private.matches_typed_note_utf16_excerpt(v_text,
      v_review->'candidates'->1)
  or bm_intake_private.matches_typed_note_utf16_excerpt(v_text,
      jsonb_build_object('start',7,'end',8,'excerpt','🧱'))
 then raise exception 'UTF-16 validator mishandled surrogate pair bounds'; end if;

 -- A forged excerpt must not be accepted even if source and digest match.
 v_bad:=jsonb_set(v_review,'{candidates,0,excerpt}',to_jsonb('fake'::text));
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
    v_org,v_actor,v_source,v_sha,v_bad);
  raise exception 'Invented excerpt passed private CAS';
 exception when invalid_parameter_value then null; end;

 -- Unicode scalar-offset confusion: emoji has 2 UTF-16 units.
 v_bad:=jsonb_set(v_review,'{candidates,0,start}','7'::jsonb);
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
    v_org,v_actor,v_source,v_sha,v_bad);
  raise exception 'Half-surrogate start passed private CAS';
 exception when invalid_parameter_value then null; end;
 v_bad:=jsonb_set(v_review,'{candidates,0,end}','7'::jsonb);
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
    v_org,v_actor,v_source,v_sha,v_bad);
  raise exception 'Half-surrogate end passed private CAS';
 exception when invalid_parameter_value then null; end;

 -- Following an emoji, codepoint offsets differ from UTF-16 positions.
 v_bad:=jsonb_set(v_review,'{candidates,1,start}','8'::jsonb);
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
    v_org,v_actor,v_source,v_sha,v_bad);
  raise exception 'Codepoint offset accepted as UTF-16';
 exception when invalid_parameter_value then null; end;

 v_bad:=jsonb_set(v_review,'{candidates,1,end}','131073'::jsonb);
 begin
  perform 1 from bm_intake_private.commit_typed_note_extraction(
    v_org,v_actor,v_source,v_sha,v_bad);
  raise exception 'Huge out-of-source offset accepted';
 exception when invalid_parameter_value then null; end;

 if (select revision from public.bm_intake_sources
   where organization_id=v_org and id=v_source)<>1 then
   raise exception 'Rejected invalid spans changed immutable source';
 end if;
 select * into v_result from bm_intake_private.commit_typed_note_extraction(
   v_org,v_actor,v_source,v_sha,v_review);
 if v_result.source_revision<>2 or v_result.original_sha256<>v_sha
 or (select review from public.bm_intake_sources
   where organization_id=v_org and id=v_source)<>v_review then
   raise exception 'Valid exact UTF-16 review was not persisted';
 end if;
end;
$check$;
reset role;
select 'PASS: independent PostgreSQL original-excerpt and UTF-16 surrogate-boundary proof';
