import test from "node:test";
import assert from "node:assert/strict";
import {createSupabaseActiveSessionVerifier}
 from "../lib/supabase-active-session-verifier.ts";
import {createTrustedCorrectedEconomicsPreview}
 from "../lib/trusted-corrected-economics-preview.ts";
import {companyPolicySha256}
 from "../lib/company-policy-fingerprint.ts";

const origin="https://staging-project.supabase.co";
const key="sb_publishable_test_explicit_server_only";
const token="x".repeat(20)+"."+"y".repeat(30)+"."+"z".repeat(48);
const user="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const org="dededede-dede-4ede-8ede-dededededede";
const source="aaaa1111-aaaa-4aaa-8aaa-aaaa1111aaaa";
const sha="a".repeat(64),supportSha="b".repeat(64);
const policy={revision:1,pricing:{
 policyId:"auth-verified-paint",currency:"USD",
 calculationOrder:"surcharge-then-discount",
 minimum:{rule:"none",cents:0},
 services:{painting:{label:"Painting",unit:"room",billing:"charged",
  rateCents:23000,optionalAddon:false}}},
 tax:{method:"none",bps:0}};
function makeFetch(handler){
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  return handler(url,options,calls.length);
 };
 return {calls,fetcher};
}
function okay(userInfo={id:user}){
 return new Response(JSON.stringify(userInfo),{
  status:200,headers:{"content-type":"application/json"}
 });
}
function verifier(fetcher){
 return createSupabaseActiveSessionVerifier({
  projectUrl:origin,publishableKey:key,fetcher,timeoutMs:1500});
}

test("contacts actual Supabase Auth endpoint twice without local JWT claims or cache",async()=>{
 const {calls,fetcher}=makeFetch(()=>okay({
  id:user,user_metadata:{userId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
  app_metadata:{role:"not-a-commercial-reviewer"}}));
 const auth=verifier(fetcher);
 assert.deepEqual(await auth.verifyActiveSession(token),{userId:user});
 assert.deepEqual(await auth.verifyActiveSession(token),{userId:user});
 assert.equal(calls.length,2);
 for(const call of calls){
  assert.equal(call.url,origin+"/auth/v1/user");
  assert.equal(call.options.method,"GET");
  assert.equal(call.options.headers.apikey,key);
  assert.equal(call.options.headers.Authorization,"Bearer "+token);
  assert.equal(call.options.redirect,"error");
  assert.equal(call.options.cache,"no-store");
  assert.equal(call.options.credentials,"omit");
  assert.ok(call.options.signal instanceof AbortSignal);
 }
});

test("refuses malformed session, forged local identity, and token with header injection",async()=>{
 const f=makeFetch(()=>okay());
 const auth=verifier(f.fetcher);
 for(const bad of [null,undefined,"",{}, {id:user},{accessToken:token,userId:user},
  token+"\r\nother: value","a.b.c"," ".repeat(50),"x".repeat(16385)]){
  await assert.rejects(auth.verifyActiveSession(bad),/verification required/);
 }
 assert.equal(f.calls.length,0);
});

test("rejects untrusted origins, secrets, query strings and redirects in configuration",()=>{
 const f=makeFetch(()=>okay());
 for(const url of ["http://staging-project.supabase.co",
  "https://evil.example.com","https://staging-project.supabase.co.evil.com",
  "https://user:password@staging-project.supabase.co",
  "https://staging-project.supabase.co/auth/v1",
  "https://staging-project.supabase.co?redirect=https://evil.com",
  "https://staging-project.supabase.co#suffix","https://127.0.0.1"]){
  assert.throws(()=>createSupabaseActiveSessionVerifier({
   projectUrl:url,publishableKey:key,fetcher:f.fetcher}));
 }
 for(const secret of ["sb_secret_service_only_private_secret","some\r\nheader",
  "service_role",""]){
  assert.throws(()=>createSupabaseActiveSessionVerifier({
   projectUrl:origin,publishableKey:secret,fetcher:f.fetcher}));
 }
 assert.throws(()=>createSupabaseActiveSessionVerifier({
  projectUrl:origin,publishableKey:key,timeoutMs:999,fetcher:f.fetcher}));
});

test("rejects network errors, Auth failure, redirects, HTML, malformed JSON and anonymous users",async()=>{
 const variants=[
  ()=>{throw Error("private token in exception must never leak");},
  ()=>({status:401,redirected:false,headers:new Headers({"content-type":"application/json"}),
   json:async()=>({id:user})}),
  ()=>({status:200,redirected:true,headers:new Headers({"content-type":"application/json"}),
   json:async()=>({id:user})}),
  ()=>({status:200,redirected:false,headers:new Headers({"content-type":"text/html"}),
   json:async()=>({id:user})}),
  ()=>({status:200,redirected:false,headers:new Headers({"content-type":"application/json"}),
   json:async()=>{throw Error("returned malformed JSON "+token);}}),
  ()=>okay({id:user,is_anonymous:true}),
  ()=>okay({id:"bad"}),
  ()=>okay({user:{id:user}}),
  ()=>({status:200,redirected:false,
   headers:new Headers({"content-type":"application/json","content-length":"999999"}),
   json:async()=>({id:user})}),
 ];
 for(const response of variants){
  const {fetcher}=makeFetch(response),auth=verifier(fetcher);
  await assert.rejects(auth.verifyActiveSession(token),err=>{
   assert.equal(err.message,"Fresh Supabase Auth verification required");
   assert.equal(err.message.includes(token),false);
   return true;
  });
 }
});

test("recheck from real Auth transport rejects revoked mid-read and never queries twice",async()=>{
 let allow=true,lookups=0,authRequests=0;
 const fetcher=async()=>{authRequests++;
  return allow?okay():{status:401,redirected:false,
   headers:new Headers({"content-type":"application/json"}),
   async json(){return {message:"revoked"};}};
 };
 const auth=verifier(fetcher);
 const db={async query(){
  lookups++;allow=false;return {rows:[{projection:{
   state:"preview-only",deliveryAuthorized:false,
   policy,requested:[{serviceCode:"painting",units:3}],
   evidence:{organizationId:org,sourceId:source,revision:5,
    sourceSha256:supportSha,correctedCandidatesSha256:supportSha,
    scopeReceiptSha256:supportSha,internalDecisionSha256:sha,
    policySha256:companyPolicySha256(policy),policyRevision:1},
  }}]};
 }};
 const adapter=createTrustedCorrectedEconomicsPreview(auth,db,"disposable-postgres-test-no-session-lock");
 await assert.rejects(adapter.preview({
  organizationId:org,sourceId:source,expectedDecisionSha256:sha,session:token}));
 assert.equal(lookups,1);
 // A future call fails before any DB lookup.
 await assert.rejects(adapter.preview({
  organizationId:org,sourceId:source,expectedDecisionSha256:sha,session:token}),
  /verification required/);
 assert.equal(lookups,1);
 assert.ok(authRequests>=2);
});

test("Auth-backed internal pricing succeeds only for an approved canonical projection",async()=>{
 let requests=0,queries=0;
 const auth=verifier(async()=>{
  requests++;return okay();
 });
 const db={async query(sql,params){
  queries++;
  assert.match(sql,/read_corrected_internal_preview_inputs/);
  assert.deepEqual(params,[org,user,source,sha]);
  return {rows:[{projection:{
   state:"preview-only",deliveryAuthorized:false,
   policy,requested:[{serviceCode:"painting",units:3}],
   evidence:{organizationId:org,sourceId:source,revision:5,
    sourceSha256:supportSha,correctedCandidatesSha256:supportSha,
    scopeReceiptSha256:supportSha,internalDecisionSha256:sha,
    policySha256:companyPolicySha256(policy),policyRevision:1},
  }}]};
 }};
 const api=createTrustedCorrectedEconomicsPreview(auth,db,"disposable-postgres-test-no-session-lock");
 const preview=await api.preview({
  organizationId:org,sourceId:source,expectedDecisionSha256:sha,session:token});
 assert.equal(preview.economics.quote.totalCents,69000);
 assert.equal(preview.deliveryAuthorized,false);
 assert.equal(requests,2);
 assert.equal(queries,1);
 assert.equal(Object.hasOwn(preview,"policy"),false);
});


test("streamed Auth JSON accepts bounded chunks, including split UTF-8",async()=>{
 const valid=JSON.stringify({id:user,note:"verified 🧱 source"});
 const bytes=new TextEncoder().encode(valid);
 const stream=new ReadableStream({
  start(controller){
   for(let i=0;i<bytes.length;i+=1)controller.enqueue(bytes.slice(i,i+1));
   controller.close();
  }
 });
 const auth=verifier(async()=>new Response(stream,{
  headers:{"content-type":"application/json; charset=utf-8"}
 }));
 assert.deepEqual(await auth.verifyActiveSession(token),{userId:user});
});

test("untrusted Auth payload cannot exceed 64 KiB, even with a fake short header",async()=>{
 const base=JSON.stringify({id:user,padding:""}).length;
 const max=64*1024;
 const capped=JSON.stringify({id:user,padding:"x".repeat(max-base)});
 const over=JSON.stringify({id:user,padding:"x".repeat(max+1-base)});
 assert.equal(Buffer.byteLength(capped),max);
 assert.equal(Buffer.byteLength(over),max+1);
 let auth=verifier(async()=>new Response(capped,{
  headers:{"content-type":"application/json"}
 }));
 assert.deepEqual(await auth.verifyActiveSession(token),{userId:user});
 for(const [raw,headers] of [
  [over,{"content-type":"application/json"}],
  [over,{"content-type":"application/json","content-length":"20"}],
  [capped,{"content-type":"application/json","content-length":"65537"}],
  [capped,{"content-type":"application/json","content-length":"999999999999999999999999"}],
 ]){
  auth=verifier(async()=>new Response(raw,{headers}));
  await assert.rejects(auth.verifyActiveSession(token),
   /Fresh Supabase Auth verification required/);
 }
});

test("invalid UTF-8 and malformed streamed JSON are denied without token leaks",async()=>{
 for(const bytes of [
  new Uint8Array([0xff,0xfe]),
  new TextEncoder().encode('{"id":"'+user+'",'),
  new Uint8Array(0),
 ]){
  const auth=verifier(async()=>new Response(bytes,{
   headers:{"content-type":"application/json"}
  }));
  await assert.rejects(auth.verifyActiveSession(token),err=>{
   assert.equal(err.message,"Fresh Supabase Auth verification required");
   assert.equal(err.message.includes(token),false);
   return true;
  });
 }
});

test("one absolute Auth deadline denies a stalled streamed body after headers",async()=>{
 let cancelled=false;
 const auth=createSupabaseActiveSessionVerifier({
  projectUrl:origin,publishableKey:key,timeoutMs:1000,
  fetcher:async(_url,options)=>{
   const stream=new ReadableStream({
    start(controller){
     controller.enqueue(new TextEncoder().encode('{"id":"'+user+'"'));
     // Simulate headers received but provider never completes JSON.
    },
    cancel(){cancelled=true;}
   });
   assert.ok(options.signal instanceof AbortSignal);
   return new Response(stream,{headers:{"content-type":"application/json"}});
  },
 });
 const start=Date.now();
 await assert.rejects(auth.verifyActiveSession(token),
  /Fresh Supabase Auth verification required/);
 assert.ok(Date.now()-start<3000,"Auth stream exceeded absolute deadline");
 assert.equal(cancelled,true);
});

test("late 200 headers cannot authorize even when injected transport ignores abort",async()=>{
 const {setTimeout:delay}=await import("node:timers/promises");
 let requestSignal;
 const auth=createSupabaseActiveSessionVerifier({
  projectUrl:origin,publishableKey:key,timeoutMs:1000,
  fetcher:async(_url,options)=>{
   requestSignal=options.signal;
   await delay(1200); // transport ignores cancellation and returns HTTP 200
   return okay();
  },
 });
 await assert.rejects(auth.verifyActiveSession(token),
  /Fresh Supabase Auth verification required/);
 assert.equal(requestSignal.aborted,true);
});
