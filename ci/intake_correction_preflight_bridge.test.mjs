/** Disposable PostgreSQL-only correction read compatibility evidence.
 * Uses the REAL private source lookup but NEVER installs a correction write. */
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {readExtractionCorrectionContext} from "../lib/tenant-extraction-correction.ts";
import {createTrustedPostgresCorrectionPreflightStore}
 from "../lib/trusted-postgres-correction-preflight.ts";

const note="Paint 🧱 two rooms";
function psql(script,params={}){
 const flags=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
 for(const [name,value] of Object.entries(params)){
  if(!/^p[1-9]$/.test(name)||typeof value!=="string")
    throw Error("Invalid disposable SQL fixture");
  flags.push("-v",name+"="+value);
 }
 return execFileSync("psql",[...flags,"-f","-"],{
  input:script,encoding:"utf8",timeout:13000,stdio:["pipe","pipe","pipe"],
 }).trim();
}
function query(statement,params){
 if(!statement.startsWith("select record from bm_intake_private.read_typed_note_for_extraction(")
  || params.length!==3 || params.some(v=>typeof v!=="string"))
  throw Error("Unexpected non-read-only SQL");
 const vars=Object.fromEntries(params.map((x,i)=>["p"+(i+1),x]));
 const sql=statement.replace(/\$([1-3])(?=::)/g,(_match,n)=>":'p"+n+"'");
 if(sql.includes("$"))throw Error("Unbound SQL parameter");
 const result=psql("set role service_role;select row_to_json(t) from ("+sql+") t;",vars);
 return {rows:result?[JSON.parse(result)]:[]};
}
function fixture(){
 const org=randomUUID(),creator=randomUUID(),other=randomUUID(),
  outsider=randomUUID(),request=randomUUID();
 psql(`insert into public.bm_organizations(id,slug,name)
  values (:'p1'::uuid,:'p2'::text,'Correction preflight');
  insert into public.bm_memberships(organization_id,user_id,member_role)
  values (:'p1'::uuid,:'p3'::uuid,'operator'),
         (:'p1'::uuid,:'p4'::uuid,'contractor');`,{
  p1:org,p2:"correction-"+org,p3:creator,p4:other,
 });
 const sourceId=psql(`set role service_role;
  select source_id from bm_intake_private.create_typed_note(
    :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,{
  p1:org,p2:creator,p3:request,p4:note,
 });
 const original={kind:"typed-note",text:note};
 const review=prepareExtractionReview(original,[{
  serviceCode:"painting",units:2,start:0,end:note.length,excerpt:note,
 }]);
 const textSha=createHash("sha256").update(note).digest("hex");
 const commit=psql(`set role service_role;
  select source_revision from bm_intake_private.commit_typed_note_extraction(
    :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::jsonb);`,{
  p1:org,p2:creator,p3:sourceId,p4:textSha,p5:JSON.stringify(review),
 });
 assert.equal(commit,"2");
 let actor=creator,revoked=false,queries=0;
 const auth={async verifyActiveSession(session){
  if(revoked||session!=="verified-staged-session")throw Error("Auth revoked");
  return {userId:actor};
 }};
 const db={async query(sql,params){
  queries++;return query(sql,params);
 }};
 return {org,creator,other,outsider,sourceId,auth,db,
  get queries(){return queries;},
  store:createTrustedPostgresCorrectionPreflightStore(auth,db),
  as:user=>actor=user,revoke:()=>revoked=true,
  removeMembership(user){psql(`delete from public.bm_memberships
    where organization_id=:'p1'::uuid and user_id=:'p2'::uuid;`,{
    p1:org,p2:user,
  });},
  observed(){return psql(`select revision from public.bm_intake_sources
    where organization_id=:'p1'::uuid and id=:'p2'::uuid;`,{
    p1:org,p2:sourceId,
  });},
 };
}
test("real PostgreSQL + Auth adapter prepares source-bound correction, never persists",async()=>{
 const f=fixture(),target={organizationId:f.org,sourceId:f.sourceId};
 const decision=await readExtractionCorrectionContext(
  f.store,"verified-staged-session",target);
 assert.equal(decision.state,"requires-human-extraction-correction");
 assert.equal(decision.expectedRevision,2);
 assert.match(decision.expectedSnapshotSha256,/^[a-f0-9]{64}$/);
 assert.equal(f.queries,2);
 let callback=0;
 await assert.rejects(f.store.mutateAuthorized({
  ...target,session:"verified-staged-session",permission:"correct-extraction",
  transform(){callback++;throw Error("Never execute SQL write");},
 }),/persistence unavailable/);
 assert.equal(callback,0);
 assert.equal(f.queries,2);
 assert.equal(f.observed(),"2");
});
test("real PostgreSQL denies same-tenant noncreator, other-tenant and revoked sessions",async()=>{
 const f=fixture(),target={organizationId:f.org,sourceId:f.sourceId};
 f.as(f.other);
 await assert.rejects(f.store.readAuthorized({
  ...target,session:"verified-staged-session"}),/unavailable/);
 f.as(f.outsider);
 await assert.rejects(f.store.readAuthorized({
  ...target,session:"verified-staged-session"}),/membership|required/i);
 f.as(f.creator);f.removeMembership(f.creator);
 await assert.rejects(f.store.readAuthorized({
  ...target,session:"verified-staged-session"}),/membership|required/i);
 f.revoke();
 await assert.rejects(f.store.readAuthorized({
  ...target,session:"verified-staged-session"}),/revoked/);
});
