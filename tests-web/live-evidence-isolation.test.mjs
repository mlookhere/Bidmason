import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyLiveEvidenceIsolation, verifySameTenantEvidencePrivacy } from "../lib/live-evidence-isolation.ts";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const orgA = "10000000-0000-4000-8000-000000000001";
const orgB = "10000000-0000-4000-8000-000000000002";
const pathA = orgA + "/50000000-0000-4000-8000-000000000001.pdf";
const pathB = orgB + "/50000000-0000-4000-8000-000000000002.pdf";
const bytesA = Buffer.from("%PDF-1.7\nsynthetic tenant A\n");
const bytesB = Buffer.from("%PDF-1.7\nsynthetic tenant B\n");
const tokenA = "Bearer token-A.test.session";
const tokenB = "Bearer token-B.test.session";
const key = "sb_publishable_ci_only";
const base = {
  publishableKey: key,
  first: { authorization: tokenA, organizationId: orgA, existingReceiptPath: pathA },
  second: { authorization: tokenB, organizationId: orgB, existingReceiptPath: pathB },
};
const json = (data, status=200) => new Response(JSON.stringify(data), { status });
const receipt = (org, path, bytes) => ({
  organization_id: org, object_path: path,
  content_sha256: createHash("sha256").update(bytes).digest("hex"),
  byte_length: bytes.length, content_type: "application/pdf",
});

function fixture(options={}) {
  const requests=[];
  const http=async (rawUrl, init={}) => {
    const url=new URL(String(rawUrl));
    assert.equal(url.origin, "https://jgbogpunyzkoytrclqdl.supabase.co");
    assert.equal(init.headers.apikey, key);
    const bearer = init.headers.authorization ?? init.headers.Authorization;
    const user=bearer===tokenA ? "A"
      : bearer===tokenB ? "B" : "";
    requests.push({user,path:url.pathname,method:init.method??"GET"});
    if (!user) return json({message:"Unauthorized"},401);
    const org=user==="A"?orgA:orgB;
    const identity=user==="A"?userA:userB;
    if(url.pathname==="/auth/v1/user") return json({id:options.sameUser?userA:identity});
    if(url.pathname==="/rest/v1/bm_memberships"){
      const filter=url.searchParams.get("organization_id");
      const actual=options.sharedMember&&user==="B" ? orgA : org;
      if(filter && filter!=="eq."+actual) return json([]);
      return json([{organization_id:actual,member_role:"owner"}]);
    }
    if(url.pathname==="/rest/v1/bm_evidence_receipts"){
      const target=url.searchParams.get("organization_id");
      const records=user==="A"
        ? [receipt(orgA,pathA,bytesA)]
        : [receipt(orgB,pathB,bytesB)];
      if(options.leakReceipt && target==="eq."+orgA && user==="B") {
        return json([{object_path:pathA}]);
      }
      return json(records.filter(x=>"eq."+x.organization_id===target)
        .map(x=>url.searchParams.get("select")==="object_path"
          ? {object_path:x.object_path} : x));
    }
    if(url.pathname.startsWith("/storage/v1/object/authenticated/bm-evidence/")){
      const path=url.pathname.split("/bm-evidence/")[1];
      const foreign=path.startsWith(user==="A"?orgB:orgA);
      if (foreign && !options.leakStorage) return json({message:"not found"},404);
      const contents=path===pathA?bytesA:bytesB;
      return new Response(options.tamperOwn && !foreign ? Buffer.from("same") : contents,
        {status:200});
    }
    throw Error("Unexpected outbound network path: "+url.pathname);
  };
  return {http,requests};
}

test("isolated two-user mock reaches real app Auth/receipt/private Storage paths and denies cross-tenant", async()=>{
  const {http,requests}=fixture();
  const x=await verifyLiveEvidenceIsolation({...base,http});
  assert.deepEqual(x,{users:2,ownedVerifiedDownloads:2,
    deniedCrossTenantStorageReads:2,hiddenForeignReceipts:2,
    deniedApplicationCrossTenantReads:2});
  assert.equal(requests.filter(x=>x.path.includes("/storage/")).length,4);
  assert.equal(requests.filter(x=>x.path==="/auth/v1/user").length,10);
});

test("no real sessions, malformed receipt fixtures or shared tenants fail before network",async()=>{
  for(const patch of [
    {second:base.first},
    {second:{...base.second,authorization:tokenA}},
    {second:{...base.second,existingReceiptPath:pathA}},
    {first:{...base.first,organizationId:orgB}},
    {first:{...base.first,authorization:"Bearer invalid token"}},
    {publishableKey:"not-a-publishable-key"},
  ]){
    const {http,requests}=fixture();
    await assert.rejects(verifyLiveEvidenceIsolation({...base,...patch,http}));
    assert.equal(requests.length,0);
  }
});

test("distinct real identities and no cross-membership is required",async()=>{
  for(const options of [{sameUser:true},{sharedMember:true}]){
    const {http,requests}=fixture(options);
    await assert.rejects(verifyLiveEvidenceIsolation({...base,http}),/tenants|identities/);
    assert.equal(requests.some(x=>x.path.includes("/storage/")),false);
  }
});

test("live validator detects direct Storage RLS leak independently from application checks",async()=>{
  const {http}=fixture({leakStorage:true});
  await assert.rejects(verifyLiveEvidenceIsolation({...base,http}),/Storage access was not explicitly denied/);
});

test("foreign receipt metadata exposure fails even if raw Storage denies",async()=>{
  const {http}=fixture({leakReceipt:true});
  await assert.rejects(verifyLiveEvidenceIsolation({...base,http}),/receipt metadata was exposed/);
});

test("invalid own receipt integrity prevents success before foreign checks",async()=>{
  const {http,requests}=fixture({tamperOwn:true});
  await assert.rejects(verifyLiveEvidenceIsolation({...base,http}),/roundtrip failed/);
  assert.equal(requests.filter(x=>x.path.includes("/storage/")).length,1);
});

test("provider outages do not count as a denial",async()=>{
  const {http}=fixture();
  const broken=async (url,init)=>{
    if(String(url).includes("/storage/") && String(url).includes(pathA) &&
      (init.headers.authorization ?? init.headers.Authorization)===tokenB)
      return new Response("upstream error",{status:502});
    return http(url,init);
  };
  await assert.rejects(verifyLiveEvidenceIsolation({...base,http:broken}),
    /Storage access was not explicitly denied/);
});


test("live proof fails closed on giant, invalid or duplicate foreign receipt responses",async()=>{
  for(const payload of [
    "["+" ".repeat(9000)+"]",
    "{broken",
    JSON.stringify([{object_path:pathA},{object_path:pathA}]),
  ]){
    const {http}=fixture();
    const intercepted=async(raw,init)=>{
      const url=new URL(String(raw));
      const token=init.headers?.authorization??init.headers?.Authorization;
      if(url.pathname==="/rest/v1/bm_evidence_receipts" &&
        url.searchParams.get("select")==="object_path" &&
        token===tokenB && url.searchParams.get("organization_id")==="eq."+orgA)
        return new Response(payload,{status:200});
      return http(raw,init);
    };
    await assert.rejects(verifyLiveEvidenceIsolation({...base,http:intercepted}),
      /receipt RLS|receipt metadata was exposed/);
  }
});

test("malformed foreign receipt Content-Length is not counted as evidence of isolation",async()=>{
  const {http}=fixture();
  const intercepted=async(raw,init)=>{
    const url=new URL(String(raw));
    const token=init.headers?.authorization??init.headers?.Authorization;
    if(url.pathname==="/rest/v1/bm_evidence_receipts" &&
      url.searchParams.get("select")==="object_path" &&
      token===tokenB && url.searchParams.get("organization_id")==="eq."+orgA)
      return new Response("[]",{status:200,headers:{"content-length":"9000000"}});
    return http(raw,init);
  };
  await assert.rejects(verifyLiveEvidenceIsolation({...base,http:intercepted}),
    /Unable to verify cross-tenant receipt RLS/);
});

test("uncooperative denied Storage response cancellation cannot block cross-tenant proof",async()=>{
  const {http}=fixture();
  let invoked=0;
  const intercepted=async(raw,init)=>{
    const url=new URL(String(raw));
    if(url.pathname.startsWith("/storage/v1/object/authenticated/") &&
      (init.headers?.authorization??init.headers?.Authorization)===tokenB &&
      url.pathname.endsWith(pathA)){
      const res=new Response("denied",{status:403});
      // An asynchronous never-completing cancel MUST NOT become a proof timeout.
      Object.defineProperty(res.body,"cancel",{value:()=>{invoked++;return new Promise(()=>{});}});
      return res;
    }
    return http(raw,init);
  };
  const result=await verifyLiveEvidenceIsolation({...base,http:intercepted});
  assert.equal(result.hiddenForeignReceipts,2);
  assert.equal(invoked,1);
});


const otherToken="Bearer token-D.test.session";
const otherId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const sameTenant={
  publishableKey:key,
  uploader:base.first,
  otherContractor:{authorization:otherToken,organizationId:orgA},
};
function sameTenantFixture(options={}){
  const requests=[];
  const http=async(raw,init={})=>{
    const url=new URL(String(raw));
    assert.equal(url.origin,"https://jgbogpunyzkoytrclqdl.supabase.co");
    assert.equal(init.headers.apikey,key);
    assert.equal(init.redirect,"error");
    const bearer=init.headers.authorization??init.headers.Authorization;
    const person=bearer===tokenA?"uploader":bearer===otherToken?"other":"unknown";
    requests.push({path:url.pathname,person});
    if(person==="unknown") return json({error:"no auth"},401);
    if(url.pathname==="/auth/v1/user")return json({
      id:options.sameIdentity?userA:(person==="uploader"?userA:otherId),
    });
    if(url.pathname==="/rest/v1/bm_memberships"){
      return json(person==="uploader"?
        [{organization_id:orgA,member_role:"owner"}]:
        (options.otherAbsent?[]:[{organization_id:orgA,
          member_role:options.otherReviewer?"operator":"contractor"}]));
    }
    if(url.pathname==="/rest/v1/bm_evidence_receipts"){
      const target=url.searchParams.get("object_path");
      const records=target==="eq."+pathA && (person==="uploader"||options.leakReceipt)
        ? [receipt(orgA,pathA,bytesA)] : [];
      return json(url.searchParams.get("select")==="object_path"
        ? records.map(v=>({object_path:v.object_path})):records);
    }
    if(url.pathname.startsWith("/storage/v1/object/authenticated/bm-evidence/")){
      if(person==="other"){
        if(options.storageFailed)return json({message:"outage"},503);
        if(!options.leakStorage)return json({message:"not found"},404);
      }
      return new Response(bytesA,{status:200});
    }
    throw Error("Unexpected provider path "+url.pathname);
  };
  return {http,requests};
}

test("live same-tenant fixture proof permits uploader but denies the other contractor on 3 independent paths",async()=>{
  const {http,requests}=sameTenantFixture();
  const result=await verifySameTenantEvidencePrivacy({...sameTenant,http});
  assert.deepEqual(result,{
    users:2,verifiedUploaderDownloads:1,blockedOtherContractorStorage:1,
    hiddenOtherContractorReceipts:1,blockedOtherContractorApplication:1,
  });
  assert.equal(requests.filter(x=>x.path.startsWith("/storage/")).length,2);
});

test("same-tenant proof rejects cross-organization or reused sessions before any network",async()=>{
  for(const patch of [
    {otherContractor:{...sameTenant.otherContractor,organizationId:orgB}},
    {otherContractor:{...sameTenant.otherContractor,authorization:tokenA}},
    {uploader:{...sameTenant.uploader,existingReceiptPath:pathB}},
    {publishableKey:"sb_secret_not_a_public_key"},
  ]){
    const {http,requests}=sameTenantFixture();
    await assert.rejects(verifySameTenantEvidencePrivacy({...sameTenant,...patch,http}),TypeError);
    assert.equal(requests.length,0);
  }
});

test("same-tenant proof rejects duplicate identity, missing membership and operator masquerading as contractor",async()=>{
  for(const mode of [{sameIdentity:true},{otherAbsent:true},{otherReviewer:true}]){
    const {http,requests}=sameTenantFixture(mode);
    await assert.rejects(verifySameTenantEvidencePrivacy({...sameTenant,http}),
      /Distinct uploader and contractor role validation failed/);
    assert.equal(requests.some(x=>x.path.includes("/storage/")),false);
  }
});

test("same-tenant proof detects Storage and receipt leaks, treating 5xx as unknown rather than denial",async()=>{
  for(const mode of [
    {leakStorage:true,regex:/Other contractor could access private Storage/},
    {leakReceipt:true,regex:/Other contractor could read private receipt metadata/},
    {storageFailed:true,regex:/Other contractor could access private Storage or provider failed/},
  ]){
    const {http}=sameTenantFixture(mode);
    await assert.rejects(verifySameTenantEvidencePrivacy({...sameTenant,http}),mode.regex);
  }
});

test("same-tenant proof never treats malformed or excessive private receipt metadata as a denial",async()=>{
  const {http}=sameTenantFixture();
  for(const response of [
    new Response("{invalid",{status:200}),
    new Response("["+" ".repeat(9000)+"]",{status:200}),
    new Response("[]",{status:200,headers:{"content-length":"900000"}}),
  ]){
    const intercepted=async(url,init)=>{
      const parsed=new URL(String(url));
      const bearer=init.headers?.authorization??init.headers?.Authorization;
      if(parsed.pathname==="/rest/v1/bm_evidence_receipts" &&
        parsed.searchParams.get("select")==="object_path" &&
        bearer===otherToken)return response.clone();
      return http(url,init);
    };
    await assert.rejects(verifySameTenantEvidencePrivacy({...sameTenant,http:intercepted}),
      /Cannot prove same-tenant receipt metadata denial/);
  }
});


test("expired direct-denial and receipt replies cannot satisfy live proof",async()=>{
  const original=AbortSignal.timeout;
  try {
    for(const sameTenantProof of [false,true]){
      for(const target of ["storage","receipt"]){
        let deadline,count=0;
        AbortSignal.timeout=ms=>{
          if(ms===12_000||ms===10_000){
            deadline=new AbortController();
            return deadline.signal;
          }
          return original(ms);
        };
        const {http}=sameTenantProof?sameTenantFixture():fixture();
        const attacker=sameTenantProof?otherToken:tokenB;
        const intercepted=async(raw,init)=>{
          const url=new URL(String(raw));
          const bearer=init.headers?.authorization??init.headers?.Authorization;
          const storage=url.pathname.startsWith("/storage/v1/object/authenticated/") &&
            url.pathname.endsWith(pathA) && bearer===attacker;
          const receipt=url.pathname==="/rest/v1/bm_evidence_receipts" &&
            url.searchParams.get("select")==="object_path" &&
            url.searchParams.get("object_path")==="eq."+pathA && bearer===attacker;
          if((target==="storage"&&storage)||(target==="receipt"&&receipt)){
            count++;
            assert.equal(init.signal,deadline.signal);
            deadline.abort();
            return target==="storage"
              ? new Response("denied",{status:403})
              : new Response("[]",{status:200});
          }
          return http(raw,init);
        };
        const proof=sameTenantProof
          ? verifySameTenantEvidencePrivacy({...sameTenant,http:intercepted})
          : verifyLiveEvidenceIsolation({...base,http:intercepted});
        await assert.rejects(proof,target==="storage"
          ? /Storage access|Storage denial/
          : /receipt RLS|receipt metadata denial/);
        assert.equal(count,1);
      }
    }
  } finally {
    AbortSignal.timeout=original;
  }
});

test("stalled foreign receipt body shares the HTTP provider deadline",async()=>{
  const original=AbortSignal.timeout;
  try {
    for(const sameTenantProof of [false,true]){
      let deadline,bodyStarted=false;
      AbortSignal.timeout=ms=>{
        if(ms===10_000){
          deadline=new AbortController();
          return deadline.signal;
        }
        return original(ms);
      };
      const {http}=sameTenantProof?sameTenantFixture():fixture();
      const attacker=sameTenantProof?otherToken:tokenB;
      const intercepted=async(raw,init)=>{
        const url=new URL(String(raw));
        const bearer=init.headers?.authorization??init.headers?.Authorization;
        if(url.pathname==="/rest/v1/bm_evidence_receipts" &&
          url.searchParams.get("select")==="object_path" &&
          url.searchParams.get("object_path")==="eq."+pathA && bearer===attacker){
          const current=deadline;
          assert.equal(init.signal,current.signal);
          return new Response(new ReadableStream({
            start(stream){stream.enqueue(new TextEncoder().encode("["));},
            pull(){
              bodyStarted=true;
              current.abort();
              return new Promise(()=>{});
            },
          }),{status:200});
        }
        return http(raw,init);
      };
      const proof=sameTenantProof
        ? verifySameTenantEvidencePrivacy({...sameTenant,http:intercepted})
        : verifyLiveEvidenceIsolation({...base,http:intercepted});
      await assert.rejects(proof,/receipt RLS|receipt metadata denial/);
      assert.equal(bodyStarted,true);
    }
  } finally {
    AbortSignal.timeout=original;
  }
});


test("cross-tenant proof refuses success if a session expires after denial probes",async()=>{
  const {http,requests}=fixture();
  let secondAuthCalls=0;
  const expiring=async(url,init)=>{
    const bearer=init.headers?.authorization??init.headers?.Authorization;
    if(new URL(String(url)).pathname==="/auth/v1/user" && bearer===tokenB){
      secondAuthCalls++;
      if(secondAuthCalls===5) return json({message:"expired"},401);
    }
    return http(url,init);
  };
  await assert.rejects(verifyLiveEvidenceIsolation({...base,http:expiring}),
    /Tenant proof session or membership changed/);
  assert.equal(secondAuthCalls,5);
  assert.equal(requests.some(x=>x.path.includes("/storage/")),true);
});

test("cross-tenant proof refuses membership changes after negative checks",async()=>{
  const {http}=fixture();
  let secondMembershipCalls=0;
  const changing=async(url,init)=>{
    const parsed=new URL(String(url));
    const bearer=init.headers?.authorization??init.headers?.Authorization;
    if(parsed.pathname==="/rest/v1/bm_memberships" && bearer===tokenB){
      secondMembershipCalls++;
      if(secondMembershipCalls===5) return json([]);
    }
    return http(url,init);
  };
  await assert.rejects(verifyLiveEvidenceIsolation({...base,http:changing}),
    /Tenant proof session or membership changed/);
  assert.equal(secondMembershipCalls,5);
});

test("same-tenant proof refuses success after contractor revocation or role elevation",async()=>{
  for(const mode of ["revoked","elevated"]){
    const {http}=sameTenantFixture();
    let otherMembershipCalls=0;
    const changing=async(url,init)=>{
      const parsed=new URL(String(url));
      const bearer=init.headers?.authorization??init.headers?.Authorization;
      if(parsed.pathname==="/rest/v1/bm_memberships" && bearer===otherToken){
        otherMembershipCalls++;
        if(otherMembershipCalls===3) return json(mode==="revoked"?[]:
          [{organization_id:orgA,member_role:"operator"}]);
      }
      return http(url,init);
    };
    await assert.rejects(verifySameTenantEvidencePrivacy({...sameTenant,http:changing}),
      /Same-tenant proof sessions or memberships changed/);
    assert.equal(otherMembershipCalls,3);
  }
});
