import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectAmbiguousReceiptCommit } from "../lib/receipt-commit-reconciliation.ts";

const ORG="10000000-0000-4000-8000-000000000001";
const OTHER="10000000-0000-4000-8000-000000000002";
const USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET="sb_secret_ci_not_a_real_key";
const receipt={
  organization_id:ORG,
  object_path:ORG+"/50000000-0000-4000-8000-000000000001.pdf",
  content_sha256:createHash("sha256").update("synthetic").digest("hex"),
  byte_length:123,
  content_type:"application/pdf",
};
const row={...receipt,uploaded_by:USER};

function context(reply, config={}) {
  const requests=[];
  const options={
    secretKey:SECRET, organizationId:ORG, uploaderId:USER,
    http:async(raw,init)=>{
      requests.push({url:String(raw),init});
      return typeof reply==="function"?reply(raw,init):reply;
    }, ...config,
  };
  return {options,requests};
}

test("read-only exact tenant/path lookup confirms matching committed receipt",async()=>{
  const {options,requests}=context(new Response(JSON.stringify([row]),{status:200}));
  const result=await inspectAmbiguousReceiptCommit(receipt,options);
  assert.deepEqual(result,{status:"matching_committed",organizationId:ORG,objectPath:receipt.object_path});
  assert.equal(requests.length,1);
  const request=requests[0],url=new URL(request.url);
  assert.equal(url.origin,"https://jgbogpunyzkoytrclqdl.supabase.co");
  assert.equal(url.pathname,"/rest/v1/bm_evidence_receipts");
  assert.equal(url.searchParams.get("organization_id"),"eq."+ORG);
  assert.equal(url.searchParams.get("object_path"),"eq."+receipt.object_path);
  assert.equal(url.searchParams.get("limit"),"2");
  assert.deepEqual(Object.keys(request.init.headers).sort(),["Accept","apikey"]);
  assert.equal(request.init.headers.apikey,SECRET);
  assert.equal(request.init.redirect,"error");
  assert.equal(request.init.method,"GET");
  assert.equal(request.init.body,undefined);
});

test("missing receipt does not imply safe retry or committed success",async()=>{
  const {options,requests}=context(new Response("[]",{status:200}));
  const result=await inspectAmbiguousReceiptCommit(receipt,options);
  assert.equal(result.status,"not_observed");
  assert.equal(requests.length,1);
});

test("receipt hash, bytes, type or uploader conflict never matches",async()=>{
  for (const variant of [
    {...row,content_sha256:"0".repeat(64)},
    {...row,byte_length:124},
    {...row,content_type:"image/png"},
    {...row,uploaded_by:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
    {...row,organization_id:OTHER},
    {...row,object_path:OTHER+"/50000000-0000-4000-8000-000000000001.pdf"},
  ]) {
    const {options}=context(new Response(JSON.stringify([variant])));
    assert.equal((await inspectAmbiguousReceiptCommit(receipt,options)).status,"conflict");
  }
});

test("provider faults, redirects and malformed body remain unavailable, never auto-retry",async()=>{
  for (const response of [
    new Response(null,{status:307,headers:{location:"https://untrusted.invalid/keys"}}),
    new Response("error",{status:500}),
    new Response("not json"),
    new Response("{}"),
    new Response("["+" ".repeat(9000)+"]"),
    new Response(JSON.stringify([row,row])),
    new Response(JSON.stringify([{...row,byte_length:"123"}])),
    new Response(null,{status:200}),
    new Response("[]",{status:200,headers:{"content-length":"9000000"}}),
  ]) {
    const {options,requests}=context(response);
    const result=await inspectAmbiguousReceiptCommit(receipt,options);
    assert.equal(result.status,"unavailable");
    assert.equal(requests.length,1);
  }
  const failed=context(async()=>{throw Error("provider secret should not leak")});
  assert.equal((await inspectAmbiguousReceiptCommit(receipt,failed.options)).status,"unavailable");
  assert.equal(failed.requests.length,1);
});

test("spoofed scope, identity, object key and unsupported metadata are rejected before HTTP",async()=>{
  const cases=[
    [{...receipt,organization_id:OTHER},{}],
    [{...receipt,object_path:OTHER+"/50000000-0000-4000-8000-000000000001.pdf"},{}],
    [{...receipt,object_path:ORG+"/../evil.pdf"},{}],
    [{...receipt,content_sha256:"invalid"},{}],
    [{...receipt,byte_length:0},{}],
    [{...receipt,content_type:"text/html"},{}],
    [receipt,{uploaderId:"not-a-uuid"}],
    [receipt,{organizationId:OTHER}],
    [receipt,{secretKey:"sb_publishable_wrong_kind"}],
  ];
  for(const [metadata,config] of cases){
    const {options,requests}=context(new Response("[]"),config);
    await assert.rejects(inspectAmbiguousReceiptCommit(metadata,options),TypeError);
    assert.equal(requests.length,0);
  }
});

test("already aborted probe never opens the provider connection",async()=>{
  const controller=new AbortController();controller.abort();
  const {options,requests}=context(new Response(JSON.stringify([row])),{signal:controller.signal});
  assert.equal((await inspectAmbiguousReceiptCommit(receipt,options)).status,"unavailable");
  assert.equal(requests.length,0);
});

test("abort during provider lookup returns unavailable, never retries or exposes details",async()=>{
  const controller=new AbortController();
  let started;
  const begun=new Promise(resolve=>{started=resolve});
  const {options,requests}=context(async(_url,init)=>{
    assert.ok(init.signal instanceof AbortSignal);
    const pending=new Promise((_resolve,reject)=>{
      init.signal.addEventListener("abort",()=>reject(Error("secret provider connection ended")),{once:true});
    });
    started();
    return pending;
  },{signal:controller.signal});
  const pending=inspectAmbiguousReceiptCommit(receipt,options);
  await begun;
  controller.abort();
  assert.equal((await pending).status,"unavailable");
  assert.equal(requests.length,1);
});


test("advisory receipt lookup uses the same timeout signal for its HTTP and body stages",async()=>{
  const controller=new AbortController();
  let received;
  let entered;
  const opened=new Promise(resolve=>{entered=resolve});
  const {options,requests}=context(async(_url,init)=>{
    received=init.signal;
    const unreadable=new ReadableStream({
      pull(){entered();return new Promise(()=>{});},
    });
    return new Response(unreadable,{status:200});
  },{signal:controller.signal});
  const running=inspectAmbiguousReceiptCommit(receipt,options);
  await opened;
  assert.ok(received instanceof AbortSignal);
  controller.abort();
  assert.equal((await running).status,"unavailable");
  assert.equal(received.aborted,true);
  assert.equal(requests.length,1);
});
