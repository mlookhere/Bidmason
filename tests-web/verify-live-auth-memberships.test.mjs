import test from "node:test";
import assert from "node:assert/strict";
import { verifyLiveAuthMemberships } from "../scripts/verify_live_auth_memberships.mjs";

const ids = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const config = {
  approved: "temporary-auth-users-only",
  serviceKey: "ci-test-private-service-role-only",
  publishableKey: "sb_publishable_ci_test_only",
  password: () => "generated-random-pw-test-value",
};
const json = (v, status=200) => new Response(JSON.stringify(v),{status});
const empty = status => new Response(null,{status});

function provider({ staleUser = false, failMembership = false,
  failCleanup = false, unexpectedTenant = false } = {}) {
  const users=new Map(),organizations=new Map(),memberships=[];
  let userIndex=0, orgIndex=0, membershipFailed=false, mutated=0, cleanupAttempts=0;
  if(staleUser) users.set(ids[0],{id:ids[0],email:"existing@example.com"});
  const http=async(raw,init={})=>{
    const url=new URL(String(raw));
    assert.equal(url.origin,"https://jgbogpunyzkoytrclqdl.supabase.co");
    assert.equal(init.redirect,"error");
    assert.equal(typeof init.signal?.aborted,"boolean");
    const method=init.method || "GET",p=url.pathname;
    const body=init.body?JSON.parse(init.body):null;
    const token=init.headers.authorization?.replace(/^Bearer /,"");
    const authUser=[...users.values()].find(x=>token==="token."+x.id);
    if(method!=="GET") mutated++;
    if(p==="/auth/v1/admin/users" && method==="GET")
      return json({users:[...users.values()].slice(0,1)});
    if(p==="/auth/v1/admin/users" && method==="POST"){
      const id=ids[userIndex++];
      users.set(id,{id,email:body.email,password:body.password});
      return json({id,email:body.email},201);
    }
    if(p.startsWith("/auth/v1/admin/users/") && method==="DELETE"){
      cleanupAttempts++;
      if(failCleanup)return json({message:"denied"},503);
      users.delete(p.split("/").at(-1));return empty(204);
    }
    if(p==="/auth/v1/token" && method==="POST"){
      const u=[...users.values()].find(x=>x.email===body.email&&x.password===body.password);
      return u ? json({access_token:"token."+u.id,user:{id:u.id}}):json({message:"invalid"},401);
    }
    if(p==="/rest/v1/bm_organizations"){
      if(method==="GET")return json([...organizations.values()].slice(0,1));
      if(method==="POST"){
        const value={id:body.id};organizations.set(body.id,value);
        orgIndex++;return json([value],201);
      }
      if(method==="DELETE"){organizations.delete(url.searchParams.get("id").slice(3));return empty(204);}
    }
    if(p==="/rest/v1/bm_evidence_receipts")return json([]);
    if(p==="/rest/v1/bm_memberships"){
      if(method==="POST"){
        if(failMembership && !membershipFailed){
          membershipFailed=true;
          return json({message:"provider error"},503);
        }
        memberships.push(body);return empty(201);
      }
      if(method==="DELETE"){
        const org=url.searchParams.get("organization_id")?.slice(3);
        const uid=url.searchParams.get("user_id")?.slice(3);
        for(let i=memberships.length-1;i>=0;i--){
          if(memberships[i].organization_id===org && (!uid||uid===memberships[i].user_id))
            memberships.splice(i,1);
        }
        return empty(204);
      }
      if(method==="GET"){
        if(!authUser&&url.searchParams.get("select")==="id")return json(memberships.slice(0,1));
        const foreign=url.searchParams.get("organization_id")?.slice(3);
        if(!authUser)return json([],401);
        const result=memberships.filter(x=>x.user_id===authUser.id &&
          (!foreign||x.organization_id===foreign));
        if(unexpectedTenant&&foreign)return json([{organization_id:foreign}]);
        return json(result);
      }
    }
    throw new Error("Unexpected mock endpoint: "+p+" "+method);
  };
  return {
    http,
    getState:()=>({users:users.size,organizations:organizations.size,
      memberships:memberships.length,mutated,cleanupAttempts}),
  };
}
const input=(fixture)=>({...config,http:fixture.http,id:(()=>{
  let n=0;return()=>ids[4+n++];
})()});

test("operator approval and private credentials are mandatory before any request",async()=>{
  const fixture=provider();
  await assert.rejects(verifyLiveAuthMemberships({...input(fixture),approved:"no"}),
    /Explicit approval/);
  await assert.rejects(verifyLiveAuthMemberships({...input(fixture),serviceKey:""}),
    /Explicit approval/);
  assert.equal(fixture.getState().mutated,0);
});

test("fails closed before provisioning on pre-existing Auth users",async()=>{
  const fixture=provider({staleUser:true});
  await assert.rejects(verifyLiveAuthMemberships(input(fixture)),/not empty/);
  assert.equal(fixture.getState().mutated,0);
});

test("creates genuine-session-shaped tenant fixtures, verifies isolation, and cleans all data",async()=>{
  const fixture=provider();
  const result=await verifyLiveAuthMemberships(input(fixture));
  assert.deepEqual(result,{genuineSignIns:4,scopedMemberships:4,
    foreignMembershipDenials:4,revokedMembershipsDenied:1,
    cleanedUsers:4,cleanedOrganizations:2});
  assert.deepEqual(fixture.getState(),{
    users:0,organizations:0,memberships:0,mutated:23,cleanupAttempts:4,
  });
});

test("failing membership provision still cleans created users and organizations",async()=>{
  const fixture=provider({failMembership:true});
  await assert.rejects(verifyLiveAuthMemberships(input(fixture)),/503/);
  assert.equal(fixture.getState().users,0);
  assert.equal(fixture.getState().organizations,0);
  assert.equal(fixture.getState().memberships,0);
});

test("cross-tenant visibility is never called a passing acceptance",async()=>{
  const fixture=provider({unexpectedTenant:true});
  await assert.rejects(verifyLiveAuthMemberships(input(fixture)),/Cross-tenant membership RLS failed/);
  assert.equal(fixture.getState().users,0);
  assert.equal(fixture.getState().memberships,0);
});

test("cleanup failures never become green results",async()=>{
  const fixture=provider({failCleanup:true});
  await assert.rejects(verifyLiveAuthMemberships(input(fixture)),/cleanup incomplete/);
  assert.equal(fixture.getState().cleanupAttempts,4);
  assert.equal(fixture.getState().users,4);
});
