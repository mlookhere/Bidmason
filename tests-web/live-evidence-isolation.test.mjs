import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyLiveEvidenceIsolation } from "../lib/live-evidence-isolation.ts";

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
    const user=init.headers.authorization===tokenA ? "A"
      : init.headers.authorization===tokenB ? "B" : "";
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
  assert.equal(requests.filter(x=>x.path==="/auth/v1/user").length,6);
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
    if(String(url).includes("/storage/") && init.headers.authorization===tokenB)
      return new Response("upstream error",{status:502});
    return http(url,init);
  };
  await assert.rejects(verifyLiveEvidenceIsolation({...base,http:broken}),
    /Storage access was not explicitly denied/);
});
