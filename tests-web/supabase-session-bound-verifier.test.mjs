import test from "node:test";
import assert from "node:assert/strict";
import {createSessionBoundSupabaseVerifier}
 from "../lib/supabase-session-bound-verifier.ts";

const user="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const second="abababab-abab-4bab-8bab-abababababab";
const sid="11111111-1111-4111-8111-111111111111";
const otherSid="22222222-2222-4222-8222-222222222222";
const now=()=>Math.floor(Date.now()/1000);
const jwt=(claims={})=>{
 const h=Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url");
 const p=Buffer.from(JSON.stringify({
  sub:user,session_id:sid,iat:now()-120,exp:now()+600,...claims
 })).toString("base64url");
 return h+"."+p+"."+"x".repeat(64);
};
function setup(options={}){
 const state={user:user,existing:true,authCalls:0,dbCalls:0};
 const auth={async verifyActiveSession(token){
  state.authCalls++;
  if(options.rejectAuth)throw Error("Auth denied");
  assert.equal(typeof token,"string");
  return {userId:state.user};
 }};
 const db={async query(sql,params){
  state.dbCalls++;
  assert.equal(sql,
    "select bm_intake_private.auth_session_is_active($1::uuid,$2::uuid) as active");
  assert.equal(params[0],state.user);
  assert.equal(typeof params[1],"string");
  if(options.throwDB)throw Error("private SQL details");
  return {rows:[{active:state.existing && params[1]===sid}]};
 }};
 return {state,auth,db,verifier:createSessionBoundSupabaseVerifier(auth,db)};
}
test("valid verified JWT requires a matching live auth.sessions row every invocation",async()=>{
 const x=setup();
 assert.deepEqual(await x.verifier.verifyActiveSession(jwt()),{userId:user});
 assert.deepEqual(await x.verifier.verifyActiveSession(jwt()),{userId:user});
 assert.equal(x.state.authCalls,2);
 assert.equal(x.state.dbCalls,2);
 x.state.existing=false;
 await assert.rejects(x.verifier.verifyActiveSession(jwt()),/Current verified/);
 assert.equal(x.state.dbCalls,3);
});

test("malformed and forged unverified tokens never reach the database",async()=>{
 const bad=[{},null,undefined,"not-a-token","a.b.c",
   jwt({session_id:"fake"}),jwt({sub:second}),
   jwt({exp:now()-1}),jwt({iat:now()+1000}),
   jwt({iat:"0"}),jwt({exp:"9000000000"}),
   jwt({session_id:null}),
   "x".repeat(17000)];
 for(const token of bad){
  const x=setup();
  await assert.rejects(x.verifier.verifyActiveSession(token));
  assert.equal(x.state.dbCalls,0);
 }
});

test("Auth response mismatch, rejection and DB errors fail closed",async()=>{
 const x=setup();
 x.state.user=second;
 await assert.rejects(x.verifier.verifyActiveSession(jwt()),/Current verified/);
 assert.equal(x.state.dbCalls,0);
 for(const opt of [{rejectAuth:true},{throwDB:true}]){
  const y=setup(opt);
  await assert.rejects(y.verifier.verifyActiveSession(jwt()),/Auth denied|Current verified/);
 }
});

test("fresh verified token cannot reuse a revoked or foreign user session",async()=>{
 const x=setup();
 const token=jwt();
 assert.deepEqual(await x.verifier.verifyActiveSession(token),{userId:user});
 x.state.existing=false;
 await assert.rejects(x.verifier.verifyActiveSession(token),/Current verified/);
 const swapped=setup();
 await assert.rejects(swapped.verifier.verifyActiveSession(jwt({session_id:otherSid})));
 assert.equal(swapped.state.dbCalls,1);
});

test("no authorization from token claims before the Auth server verifies JWT",async()=>{
 const x=setup({rejectAuth:true});
 await assert.rejects(x.verifier.verifyActiveSession(jwt()),/Auth denied/);
 assert.equal(x.state.authCalls,1);
 assert.equal(x.state.dbCalls,0);
});


test("session binding captures the original Auth-verified identity before database awaits",async()=>{
 const x=setup(),identity={userId:user};
 x.auth.verifyActiveSession=async()=>{x.state.authCalls++;return identity;};
 x.db.query=async(sql,params)=>{
  x.state.dbCalls++;
  assert.match(sql,/auth_session_is_active/);
  assert.deepEqual(params,[user,sid]);
  identity.userId=second;
  return {rows:[{active:true}]};
 };
 assert.deepEqual(await createSessionBoundSupabaseVerifier(x.auth,x.db)
   .verifySessionBinding(jwt()),{userId:user,sessionId:sid});
 assert.equal(x.state.authCalls,1);
 assert.equal(x.state.dbCalls,1);
});

test("forged, accessor-backed or decorated Auth identities deny before private session SQL",async()=>{
 let getterCalls=0;
 const identities=[
  ()=>{const v={userId:user};Object.defineProperty(v,"send",{value:true});return v;},
  ()=>{const v={userId:user};v[Symbol("approved")]=true;return v;},
  ()=>Object.assign(Object.create({approved:true}),{userId:user}),
  ()=>Object.defineProperty({},"userId",{enumerable:true,
    get(){getterCalls++;throw Error("unsafe Auth identity getter");}}),
  ()=>Object.defineProperty({userId:user},"userId",{enumerable:false,
    value:user}),
  ()=>({userId:user,role:"service_role"}),
 ];
 for(const build of identities){
  const x=setup();
  x.auth.verifyActiveSession=async()=>{x.state.authCalls++;return build();};
  await assert.rejects(
    createSessionBoundSupabaseVerifier(x.auth,x.db).verifyActiveSession(jwt()),
    /Current verified Supabase Auth session required/);
  assert.equal(x.state.authCalls,1);
  assert.equal(x.state.dbCalls,0);
 }
 assert.equal(getterCalls,0);
});

test("private session receipt rejects SQL row-envelope, index and active getters",async()=>{
 let getterCalls=0;
 const corruptions=[
  response=>Object.defineProperty(response,"rows",{enumerable:true,
    get(){getterCalls++;throw Error("unsafe SQL rows getter");}}),
  response=>Object.defineProperty(response.rows,"0",{enumerable:true,
    get(){getterCalls++;throw Error("unsafe SQL index getter");}}),
  response=>{delete response.rows[0];},
  response=>Object.defineProperty(response.rows,"0",{enumerable:false,
    configurable:true,value:response.rows[0]}),
  response=>Object.defineProperty(response.rows,"send",{value:true}),
  response=>{response.rows[Symbol("approved")]=true;},
  response=>Object.setPrototypeOf(response.rows,Object.create(Array.prototype)),
  response=>Object.defineProperty(response.rows[0],"active",{enumerable:true,
    get(){getterCalls++;throw Error("unsafe active getter");}}),
  response=>Object.defineProperty(response.rows[0],"active",{enumerable:false,
    value:true}),
  response=>Object.defineProperty(response.rows[0],"send",{value:true}),
  response=>{response.rows[0][Symbol("approved")]=true;},
  response=>Object.setPrototypeOf(response.rows[0],{active:true}),
 ];
 for(const corrupt of corruptions){
  const x=setup();
  x.db.query=async()=>{
   x.state.dbCalls++;
   const response={rows:[{active:true}]};
   corrupt(response);
   return response;
  };
  await assert.rejects(x.verifier.verifySessionBinding(jwt()),
    /Current verified Supabase Auth session required/);
  assert.equal(x.state.authCalls,1);
  assert.equal(x.state.dbCalls,1);
 }
 assert.equal(getterCalls,0);
});

test("private session check supports ordinary PostgreSQL metadata but never missing or contradictory receipts",async()=>{
 const x=setup();
 x.db.query=async(sql,params)=>{
  x.state.dbCalls++;
  assert.deepEqual(params,[user,sid]);
  return {rows:[{active:true}],rowCount:1,command:"SELECT",fields:[]};
 };
 assert.deepEqual(await x.verifier.verifySessionBinding(jwt()),
  {userId:user,sessionId:sid});
 const invalid=[{rows:[]},{rows:[{active:false}]},
  {rows:[{active:"true"}]},{rows:[{active:true},{active:true}]},
  {rows:null},{},null];
 for(const receipt of invalid){
  const y=setup();
  y.db.query=async()=>{y.state.dbCalls++;return receipt;};
  await assert.rejects(y.verifier.verifyActiveSession(jwt()),
    /Current verified Supabase Auth session required/);
  assert.equal(y.state.dbCalls,1);
 }
});
