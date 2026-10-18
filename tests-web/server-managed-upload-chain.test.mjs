import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { processEvidenceUpload } from "../lib/evidence-upload-boundary.ts";

const ORG = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "10000000-0000-4000-8000-000000000002";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "Bearer header.payload.signature";
const PUB = "sb_publishable_ci_public";
const SEC = "sb_secret_ci_server_secret";
const DOCUMENT = Buffer.from("%PDF-1.7\n% synthetic scanned evidence\n");
const json = (data,status=200) => new Response(JSON.stringify(data),{status});

function session(mode={}) {
  const events = [], evidence = [];
  let membershipChecks = 0;
  const http = async(raw, init)=>{
    const url=new URL(String(raw));
    assert.equal(url.origin,"https://jgbogpunyzkoytrclqdl.supabase.co");
    assert.equal(init.redirect,"error");
    assert.equal(init.cache,"no-store");
    const path=url.pathname;
    if(path==="/auth/v1/user"){
      assert.equal(init.headers.apikey,PUB);
      assert.equal(init.headers.authorization??init.headers.Authorization,TOKEN);
      events.push("auth");
      return json({id:USER});
    }
    if(path==="/rest/v1/bm_memberships"){
      assert.equal(init.headers.apikey,PUB);
      assert.equal(init.headers.authorization??init.headers.Authorization,TOKEN);
      events.push("membership");
      membershipChecks++;
      if(mode.foreign || (mode.revoke && membershipChecks>=4)) return json([]);
      if(url.searchParams.get("select")==="organization_id,member_role")
        return json([{organization_id:ORG,member_role:"contractor"}]);
      return json([{organization_id:ORG}]);
    }
    if(path==="/rest/v1/bm_evidence_receipts"){
      assert.equal(init.headers.apikey,SEC);
      assert.equal(init.headers.Authorization,undefined);
      assert.equal(init.method,"POST");
      if(mode.rejectReceipt)return new Response("",{status:409});
      events.push("receipt");
      assert.equal(JSON.parse(init.body).uploaded_by, USER);
      assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(),
        ["organization_id","object_path","content_sha256","byte_length","content_type","uploaded_by"].sort());
      return new Response("",{status:201});
    }
    if(path.startsWith("/storage/v1/object/")){
      assert.equal(init.headers.apikey,SEC);
      assert.equal(init.headers.Authorization,undefined);
      assert.equal(init.headers.authorization,undefined);
      if(init.method==="POST"){
        assert.equal(init.headers["x-upsert"],"false");
        assert.equal(init.headers["Content-Type"],"application/pdf");
        assert.equal((await init.body.arrayBuffer()).byteLength,DOCUMENT.length);
        events.push("storage-write");
        return json({Key:"stored"},mode.rejectStorage?403:200);
      }
      assert.equal(init.method,"GET");
      events.push("storage-read");
      return new Response(mode.tamper?Buffer.from("%PDF-BAD"):DOCUMENT);
    }
    if(path==="/rest/v1/rpc/bm_reserve_upload_quota"){
      events.push("quota");
      assert.equal(init.headers.apikey,SEC);
      return json(true);
    }
    throw Error("Unexpected provider path "+path);
  };
  const deps={
    publishableKey:PUB,secretKey:SEC,http,
    async takePermit(user,org){
      assert.equal(user,USER);assert.equal(org,ORG);
      events.push("quota"); return !mode.deniedQuota;
    },
    async scan(bytes,type){
      events.push("scan");
      assert.equal(type,"application/pdf");
      assert.deepEqual(Buffer.from(bytes),DOCUMENT);
      if(mode.scannerDown)throw Error("scanner offline");
      return mode.infected?"unsafe":"clean";
    },
  };
  const request = new Request("https://invalid.local/upload",{
    method:"POST",headers:{
      authorization:TOKEN,"x-bidmason-organization":mode.foreign?FOREIGN:ORG,
      "content-type":"application/pdf","content-length":String(DOCUMENT.length),
    },body:DOCUMENT,
  });
  return {deps,request,events,evidence};
}
test("mandatory Auth -> quota -> clean scan -> server-secret Storage -> final reauth -> immutable receipt",async()=>{
  const {deps,request,events}=session();
  const result=await processEvidenceUpload(request,deps);
  assert.equal(result.status,201);
  assert.equal(result.receipt.organization_id,ORG);
  assert.equal(result.receipt.byte_length,DOCUMENT.length);
  assert.equal(result.receipt.content_sha256,
    createHash("sha256").update(DOCUMENT).digest("hex"));
  assert.deepEqual(events,[
    "auth","membership","quota","scan",
    "auth","membership","auth","membership",
    "storage-write","storage-read","auth","membership","receipt",
  ]);
});
test("denied quota, scanner failure or infected file never reaches privileged Storage",async()=>{
  for(const [options,status] of [
    [{deniedQuota:true},429],[{scannerDown:true},503],[{infected:true},422],
    [{foreign:true},404],
  ]){
    const {deps,request,events}=session(options);
    assert.equal((await processEvidenceUpload(request,deps)).status,status);
    assert.equal(events.includes("storage-write"),false);
    assert.equal(events.includes("storage-read"),false);
    assert.equal(events.includes("receipt"),false);
  }
});
test("privileged Storage failure and corrupt bytes never create trusted receipts",async()=>{
  for(const mode of [{rejectStorage:true},{tamper:true},{rejectReceipt:true}]){
    const {deps,request,events}=session(mode);
    assert.equal((await processEvidenceUpload(request,deps)).status,502);
    if(!mode.rejectReceipt)assert.equal(events.includes("receipt"),false);
  }
});
test("missing mandatory scan, quota or server keys blocks at request preflight",async()=>{
  for(const missing of ["scan","takePermit","secretKey","publishableKey"]){
    const {deps,request,events}=session();
    delete deps[missing];
    assert.equal((await processEvidenceUpload(request,deps)).status,503);
    assert.deepEqual(events,[]);
  }
});
