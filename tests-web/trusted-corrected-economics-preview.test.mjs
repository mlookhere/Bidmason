// Intentional opt-in for isolated legacy SQL test fixtures only.
process.env.BIDMASON_CI_DISPOSABLE_POSTGRES="1";

import test from "node:test";
import assert from "node:assert/strict";
import {companyPolicySha256} from "../lib/company-policy-fingerprint.ts";
import {createTrustedCorrectedEconomicsPreview}
 from "../lib/trusted-corrected-economics-preview.ts";

const org="dededede-dede-4ede-8ede-dededededede";
const source="aaaa1111-aaaa-4aaa-8aaa-aaaa1111aaaa";
const actor="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const other="abababab-abab-4bab-8bab-abababababab";
const decision="a".repeat(64),digest="b".repeat(64);
const policy={revision:1,pricing:{
 policyId:"synthetic-corrected-private",currency:"USD",
 minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
 services:{painting:{label:"Painting",unit:"room",rateCents:23000,
  billing:"charged",optionalAddon:false}},
},tax:{method:"none",bps:0},unitDirectCostsCents:{painting:10000}};
const payload=()=>({
 state:"preview-only",deliveryAuthorized:false,
 policy:structuredClone(policy),
 requested:[{serviceCode:"painting",units:3}],
 evidence:{organizationId:org,sourceId:source,revision:5,
  sourceSha256:digest,correctedCandidatesSha256:digest,
  scopeReceiptSha256:digest,internalDecisionSha256:decision,
  policySha256:companyPolicySha256(policy),policyRevision:1},
});
function fixture(afterQuery){
 let current=actor,revoked=false,authCalls=0,sqlCalls=0;
 let projection=payload();
 const calls=[];
 const auth={async verifyActiveSession(token) {
  authCalls++;if(revoked||token!=="trusted-private-session")
   throw Error("Session revoked");
  return {userId:current};
 }};
 const db={async query(sql,params) {
  sqlCalls++;calls.push({sql,params});
  assert.match(sql,/^select bm_intake_private\.read_corrected_internal_preview_inputs/);
  assert.deepEqual(params,[org,actor,source,decision]);
  afterQuery?.({revoke:()=>revoked=true,swap:()=>current=other});
  return {rows:[{projection}]};
 }};
 return {api:createTrustedCorrectedEconomicsPreview(auth,db,"disposable-postgres-test-no-session-lock"),
  request:()=>({organizationId:org,sourceId:source,
   expectedDecisionSha256:decision,session:"trusted-private-session"}),
  get authCalls(){return authCalls;},get sqlCalls(){return sqlCalls;},
  calls,setProjection(next){projection=next},
  revoke:()=>revoked=true,swap:()=>current=other};
}

test("only private corrected data is priced from canonical approved policy",async()=>{
 const f=fixture();
 const v=await f.api.preview(f.request());
 assert.equal(v.state,"preview-only");
 assert.equal(v.deliveryAuthorized,false);
 assert.equal(v.economics.quote.totalCents,69000);
 assert.equal(v.economics.totalWithTaxCents,69000);
 assert.equal(v.economics.estimatedDirectCostsCents,30000);
 assert.equal(v.economics.policySha256,companyPolicySha256(policy));
 assert.equal(v.evidence.policySha256,v.economics.policySha256);
 assert.equal(f.authCalls,2);assert.equal(f.sqlCalls,1);
 assert.equal(Object.hasOwn(v,"policy"),false);
 for(const k of ["send","recipient","approvedQuote","delivery","customer"]) {
  assert.equal(Object.hasOwn(v,k),false);
 }
});

test("caller cannot inject policy, prices, actor, delivery or another target",async()=>{
 for(const added of [
  {policy},{requested:[{serviceCode:"painting",units:999}]},
  {actorId:actor},{userId:actor},{approved:true},
  {send:true},{recipient:"buyer@example.invalid"},{rateCents:1},
  {organizationId:"foreign"},{sourceId:"bad"},
  {expectedDecisionSha256:"xyz"},{session:null},
 ]) {
  const f=fixture();
  await assert.rejects(f.api.preview({...f.request(),...added}),TypeError);
  assert.equal(f.sqlCalls,0);
 }
});

test("wrong and uncanonical approved policy cannot produce preview pricing",async()=>{
 const changes=[
  p=>p.evidence.policySha256="c".repeat(64),
  p=>p.policy.pricing.services.painting.rateCents=1,
  p=>p.evidence.policyRevision=2,
  p=>p.policy.tax.bps=100,
  p=>p.requested=[{serviceCode:"unknown",units:3}],
  p=>p.requested=[{serviceCode:"painting",units:3,priceCents:1}],
  p=>p.requested=[{serviceCode:"painting",units:3},
    {serviceCode:"painting",units:1}],
  p=>p.requested=[{serviceCode:"painting",units:0}],
  p=>p.requested=[{serviceCode:"painting",units:3,addonAccepted:true}],
  p=>p.deliveryAuthorized=true,
  p=>p.customer={email:"somewhere@example.invalid"},
  p=>p.evidence.sourceId=other,
  p=>p.evidence.internalDecisionSha256="d".repeat(64),
  p=>p.evidence.revision=6,
 ];
 for(const mutate of changes){
  const f=fixture(),p=payload();mutate(p);f.setProjection(p);
  await assert.rejects(f.api.preview(f.request()));
  assert.equal(f.sqlCalls,1);
 }
});

test("untrusted policy getters, hidden fields and custom serializers never execute",async()=>{
 for(const kind of ["hidden","getter","toJSON"]){
  const f=fixture(),p=payload();
  let invoked=0;
  if(kind==="hidden"){
   Object.defineProperty(p.policy.pricing.services.painting,"rateOverrideCents",
    {value:1,enumerable:false});
  } else if(kind==="getter"){
   Object.defineProperty(p.policy.pricing.services.painting,"rateCents",
    {enumerable:true,get(){invoked++;return 1;}});
  } else {
   Object.defineProperty(p.policy.pricing.services.painting,"toJSON",
    {value(){invoked++;return {};},enumerable:true});
  }
  f.setProjection(p);
  await assert.rejects(f.api.preview(f.request()),/own enumerable|forbidden|unsupported/);
  assert.equal(invoked,0);
 }
});

test("session changes and revocation deny private pricing after database read",async()=>{
 for(const mode of ["revoke","swap"]){
  const f=fixture(x=>x[mode]());
  await assert.rejects(f.api.preview(f.request()),/revoked|changed/);
  assert.equal(f.sqlCalls,1);
 }
});

test("mutation of caller selector during Auth await cannot change SQL target",async()=>{
 let completeAuth;
 const auth={async verifyActiveSession() {
  if(!completeAuth)await new Promise(resolve=>{completeAuth=resolve});
  return {userId:actor};
 }};
 const seen=[];
 const db={async query(sql,params) {
  seen.push(params);return {rows:[{projection:payload()}]};
 }};
 const api=createTrustedCorrectedEconomicsPreview(auth,db,"disposable-postgres-test-no-session-lock");
 const input={organizationId:org,sourceId:source,
  expectedDecisionSha256:decision,session:"trusted-private-session"};
 const promise=api.preview(input);
 input.organizationId=other;input.sourceId=other;input.expectedDecisionSha256="0".repeat(64);
 completeAuth();
 const out=await promise;
 assert.equal(out.evidence.organizationId,org);
 assert.deepEqual(seen,[[org,actor,source,decision]]);
});

test("legacy four-argument pricing factory cannot be used implicitly",()=>{
 const auth={async verifyActiveSession(){return {userId:actor};}};
 const db={async query(){throw Error("must not be called");}};
 assert.throws(
  ()=>createTrustedCorrectedEconomicsPreview(auth,db),
  /Unsafe legacy pricing preview disabled/);
 assert.throws(
  ()=>createTrustedCorrectedEconomicsPreview(auth,db,""),
  /Unsafe legacy pricing preview disabled/);
});

test("legacy disposable-test opt-in still fails closed in production",()=>{
 const auth={async verifyActiveSession(){return {userId:actor};}};
 const db={async query(){throw Error("must not be called");}};
 const was=process.env.NODE_ENV;
 try {
  process.env.NODE_ENV="production";
  assert.throws(()=>createTrustedCorrectedEconomicsPreview(
   auth,db,"disposable-postgres-test-no-session-lock"),
   /Unsafe legacy pricing preview disabled/);
 } finally {
  if(was===undefined)delete process.env.NODE_ENV;
  else process.env.NODE_ENV=was;
 }
});


test("private requested service array rejects getters, holes, symbols and decorated indexes before pricing",async()=>{
 let invoked=0;
 const corruptions=[
  value=>Object.defineProperty(value,"0",{enumerable:true,configurable:true,
   get(){invoked++;throw Error("unsafe reviewed price index getter");}}),
  value=>{delete value[0];},
  value=>Object.defineProperty(value,"send",{value:true}),
  value=>{value[Symbol("approved")]=true;},
  value=>Object.setPrototypeOf(value,Object.create(Array.prototype)),
  value=>Object.defineProperty(value,"0",{enumerable:false,value:value[0],
   configurable:true,writable:true}),
 ];
 for(const corrupt of corruptions){
  const f=fixture(),p=payload();
  corrupt(p.requested);f.setProjection(p);
  await assert.rejects(f.api.preview(f.request()),
   /Unsafe corrected economics projection/);
  assert.equal(f.sqlCalls,1);
  assert.equal(f.authCalls,1);
 }
 assert.equal(invoked,0);
});

test("private SQL row array rejects accessor-backed or decorated evidence before reading projection",async()=>{
 let getterCalls=0;
 const corruptions=[
  rows=>Object.defineProperty(rows,"0",{enumerable:true,configurable:true,
   get(){getterCalls++;throw Error("unsafe private SQL row getter");}}),
  rows=>{delete rows[0];},
  rows=>Object.defineProperty(rows,"send",{value:true}),
  rows=>{rows[Symbol("approved")]=true;},
  rows=>Object.setPrototypeOf(rows,Object.create(Array.prototype)),
 ];
 for(const corrupt of corruptions){
  let sqlCalls=0;
  const rows=[{projection:payload()}];corrupt(rows);
  const db={async query(){sqlCalls++;return {rows};}};
  const auth={async verifyActiveSession(){return {userId:actor};}};
  const api=createTrustedCorrectedEconomicsPreview(
   auth,db,"disposable-postgres-test-no-session-lock");
  await assert.rejects(api.preview({
   organizationId:org,sourceId:source,
   expectedDecisionSha256:decision,session:"trusted-private-session",
  }),/Approved internal corrected pricing evidence unavailable/);
  assert.equal(sqlCalls,1);
 }
 assert.equal(getterCalls,0);
});

test("corrected pricing accepts ordinary PostgreSQL SELECT metadata",async()=>{
 const auth={async verifyActiveSession(){return {userId:actor};}};
 const db={async query(){return {rows:[{projection:payload()}],
  rowCount:1,command:"SELECT",fields:[]};}};
 const api=createTrustedCorrectedEconomicsPreview(
  auth,db,"disposable-postgres-test-no-session-lock");
 const result=await api.preview({organizationId:org,sourceId:source,
  expectedDecisionSha256:decision,session:"trusted-private-session"});
 assert.equal(result.state,"preview-only");
 assert.equal(result.economics.quote.totalCents,69000);
});

test("corrected pricing rejects SQL envelope getters and mismatched PostgreSQL metadata",async()=>{
 let getterCalls=0;
 const normal=()=>({rows:[{projection:payload()}]});
 const forged=[
  ()=>Object.defineProperty(normal(),"rows",{enumerable:true,
   get(){getterCalls++;throw Error("unsafe SQL rows getter");}}),
  ()=>Object.defineProperty(normal(),"rows",{enumerable:false,
   value:[{projection:payload()}]}),
  ()=>({...normal(),rowCount:0,command:"SELECT"}),
  ()=>({...normal(),rowCount:"1",command:"SELECT"}),
  ()=>({...normal(),rowCount:1,command:"DELETE"}),
  ()=>Object.defineProperty(normal(),"rowCount",{enumerable:true,
   get(){getterCalls++;throw Error("unsafe SQL count getter");}}),
  ()=>Object.defineProperty(normal(),"command",{enumerable:true,
   get(){getterCalls++;throw Error("unsafe SQL command getter");}}),
 ];
 for(const build of forged){
  let calls=0;
  const auth={async verifyActiveSession(){return {userId:actor};}};
  const db={async query(){calls++;return build();}};
  const api=createTrustedCorrectedEconomicsPreview(
   auth,db,"disposable-postgres-test-no-session-lock");
  await assert.rejects(api.preview({organizationId:org,sourceId:source,
   expectedDecisionSha256:decision,session:"trusted-private-session"}),
   /Approved internal corrected pricing evidence unavailable/);
  assert.equal(calls,1);
 }
 assert.equal(getterCalls,0);
});

test("legacy corrected pricing requires a disposable CI marker",()=>{
 const auth={async verifyActiveSession(){return {userId:actor};}};
 const db={async query(){throw Error("unsafe legacy SQL invoked");}};
 const was=process.env.BIDMASON_CI_DISPOSABLE_POSTGRES;
 try {
  delete process.env.BIDMASON_CI_DISPOSABLE_POSTGRES;
  assert.throws(()=>createTrustedCorrectedEconomicsPreview(
   auth,db,"disposable-postgres-test-no-session-lock"),
   /Unsafe legacy pricing preview disabled/);
  process.env.BIDMASON_CI_DISPOSABLE_POSTGRES="true";
  assert.throws(()=>createTrustedCorrectedEconomicsPreview(
   auth,db,"disposable-postgres-test-no-session-lock"),
   /Unsafe legacy pricing preview disabled/);
 } finally {
  if(was===undefined)delete process.env.BIDMASON_CI_DISPOSABLE_POSTGRES;
  else process.env.BIDMASON_CI_DISPOSABLE_POSTGRES=was;
 }
});
