import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ingestVerifiedEvidence } from "../lib/evidence.ts";
import { createServerManagedStoragePort } from "../lib/server-managed-storage-port.ts";

const USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT="10000000-0000-4000-8000-000000000001";
const FOREIGN="10000000-0000-4000-8000-000000000002";
const ID="50000000-0000-4000-8000-000000000001";
const BYTES=Buffer.from("%PDF-1.7\n% synthetic server evidence\n");
const TOKEN="header.payload.signature";
const PUB="sb_publishable_synthetic_ci";
const SEC="sb_secret_synthetic_ci";
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});

function fixture(options={}){
  let checked=0;const requests=[],issued=[];
  const port=createServerManagedStoragePort({
    accessToken:TOKEN,publishableKey:PUB,secretKey:SEC,
    signal:options.signal,issueTrustedReceipt:async receipt=>issued.push(receipt),
    http:async(raw,init)=>{
      const url=new URL(String(raw));requests.push(url.pathname);
      assert.equal(url.origin,"https://jgbogpunyzkoytrclqdl.supabase.co");
      assert.equal(init.cache,"no-store");assert.equal(init.redirect,"error");
      if(url.pathname.startsWith("/auth/") || url.pathname.startsWith("/rest/")){
        assert.equal(init.headers.apikey,PUB);
        assert.equal(init.headers.Authorization,"Bearer "+TOKEN);
        if(url.pathname==="/auth/v1/user")return json({id:USER});
        checked++;
        return json(options.revoke&&checked===2?[]:
          [{organization_id:options.foreign?FOREIGN:TENANT}]);
      }
      if(url.pathname.startsWith("/storage/")){
        assert.equal(init.headers.apikey,SEC);
        assert.equal(init.headers.Authorization,undefined);
        assert.equal(init.headers.authorization,undefined);
        assert.equal(url.search,"");
        if(init.method==="POST"){
          assert.equal(init.headers["x-upsert"],"false");
          assert.equal(init.headers["Content-Type"],"application/pdf");
          assert.equal((await init.body.arrayBuffer()).byteLength,BYTES.length);
          return json({Key:"stored"},options.denyUpload?403:200);
        }
        assert.equal(init.method,"GET");
        return new Response(options.mutate?Buffer.from("%PDF-X"):BYTES,{status:200});
      }
      throw Error("Unexpected endpoint");
    }
  });
  return {port,requests,issued};
}
test("scoped Auth plus privileged server-only Storage followed by independent receipt",async()=>{
  const {port,requests,issued}=fixture();
  const receipt=await ingestVerifiedEvidence(USER,TENANT,"application/pdf",BYTES,port,()=>ID);
  assert.equal(receipt.content_sha256,createHash("sha256").update(BYTES).digest("hex"));
  assert.deepEqual(requests.map(x=>x.split("/")[1]),["auth","rest","storage","storage","auth","rest"]);
  assert.equal(issued.length,1);
});
test("foreign tenant, revocation, failed Storage and corrupted readback cannot issue receipts",async()=>{
  for(const mode of [{foreign:true},{revoke:true},{denyUpload:true},{mutate:true}]){
    const {port,requests,issued}=fixture(mode);
    await assert.rejects(ingestVerifiedEvidence(USER,TENANT,"application/pdf",BYTES,port,()=>ID));
    assert.equal(issued.length,0);
    if(mode.foreign)assert.equal(requests.some(x=>x.startsWith("/storage/")),false);
  }
});
test("config and forged cross-tenant paths or bytes rejected before network",async()=>{
  for(const bad of [
    {secretKey:undefined},{secretKey:PUB},{publishableKey:SEC},{accessToken:"bad\njwt"}
  ])assert.throws(()=>createServerManagedStoragePort({
    accessToken:TOKEN,publishableKey:PUB,secretKey:SEC,
    issueTrustedReceipt:async()=>{},...bad
  }));
  const {port,requests}=fixture();
  const receipt={
    organization_id:TENANT,object_path:TENANT+"/"+ID+".pdf",
    byte_length:BYTES.length,content_type:"application/pdf",
    content_sha256:createHash("sha256").update(BYTES).digest("hex"),
  };
  for(const changed of [
    {...receipt,object_path:FOREIGN+"/"+ID+".pdf"},
    {...receipt,object_path:TENANT+"/../escape.pdf"},
    {...receipt,content_sha256:"a".repeat(64)},
    {...receipt,byte_length:BYTES.length+1}
  ])await assert.rejects(port.uploadPrivate(USER,changed,BYTES));
  assert.deepEqual(requests,[]);
});
test("admin fetch refuses redirects and pre-aborted requests",async()=>{
  const controller=new AbortController(),paths=[];
  const port=createServerManagedStoragePort({
    accessToken:TOKEN,publishableKey:PUB,secretKey:SEC,
    signal:controller.signal,issueTrustedReceipt:async()=>assert.fail("No receipt"),
    http:async(url,init)=>{
      paths.push(new URL(String(url)).pathname);
      assert.equal(init.redirect,"error");
      return new Response(null,{status:307,headers:{location:"https://evil.invalid/collect"}});
    },
  });
  const receipt={
    organization_id:TENANT,object_path:TENANT+"/"+ID+".pdf",
    byte_length:BYTES.length,content_type:"application/pdf",
    content_sha256:createHash("sha256").update(BYTES).digest("hex"),
  };
  await assert.rejects(port.uploadPrivate(USER,receipt,BYTES),/rejected/);
  assert.equal(paths.length,1);
  controller.abort();
  await assert.rejects(port.uploadPrivate(USER,receipt,BYTES),/unavailable/);
  assert.equal(paths.length,1);
});


test("privileged Storage read does not restart provider timeout after response headers",async()=>{
  const originalTimeout=AbortSignal.timeout;
  const deadline=new AbortController();
  let resolveReading, observedSignal;
  const reading=new Promise(resolve=>{resolveReading=resolve;});
  const receipt={
    organization_id:TENANT,object_path:TENANT+"/"+ID+".pdf",
    byte_length:BYTES.length,content_type:"application/pdf",
    content_sha256:createHash("sha256").update(BYTES).digest("hex"),
  };
  try{
    AbortSignal.timeout=()=>deadline.signal;
    const port=createServerManagedStoragePort({
      accessToken:TOKEN,publishableKey:PUB,secretKey:SEC,
      issueTrustedReceipt:async()=>assert.fail("No receipt"),
      http:async(_url,init)=>{
        observedSignal=init.signal;
        return new Response(new ReadableStream({
          start(stream){stream.enqueue(BYTES.subarray(0,2));},
          pull(){resolveReading();return new Promise(()=>{});},
        }),{status:200});
      },
    });
    const pending=port.readBackPrivate(USER,receipt);
    await reading;
    deadline.abort();
    await assert.rejects(pending,/cancelled/);
    assert.equal(observedSignal,deadline.signal);
  }finally{
    AbortSignal.timeout=originalTimeout;
  }
});
