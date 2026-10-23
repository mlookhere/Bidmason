import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,randomBytes} from "node:crypto";
import {createBuyerViewGrant,verifyBuyerViewGrant} from "../lib/buyer-view-grant.ts";

const now=1_791_000_000;
const identity={
  organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  revision:3,recipientSha256:"a".repeat(64),contentSha256:"b".repeat(64),
};
const key=randomBytes(32);
const verify=(token,expected=identity,secret=key,clock=now,revoked=[])=>
  verifyBuyerViewGrant(token,expected,secret,clock,revoked);
const forgeClaims=claims=>{
  const payload=Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac=createHmac("sha256",key).update("bidmason:buyer-view:v1:")
    .update(payload).digest("base64url");
  return "bmview1."+payload+"."+mac;
};

test("short-lived grant proves signed read-only claims, never permission to send",()=>{
  const token=createBuyerViewGrant(identity,key,now,120);
  const outcome=verify(token);
  assert.equal(outcome.state,"signed-claims-only");
  assert.equal(outcome.expiresAt,now+120);
  assert.match(outcome.grantId,/^[a-f0-9]{32}$/);
  for(const field of ["approved","authorized","send","url","recipientEmail"])
    assert.equal(Object.hasOwn(outcome,field),false);
  assert.equal(verify(token,identity,key,now+119).state,"signed-claims-only");
});

test("tenant, proposal, revision, recipient and content scopes never carry over",()=>{
  const token=createBuyerViewGrant(identity,key,now);
  for(const changed of [
    {organizationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
    {proposalId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
    {revision:4},{recipientSha256:"c".repeat(64)},{contentSha256:"c".repeat(64)},
  ])assert.equal(verify(token,{...identity,...changed}).state,"blocked");
});

test("expiration, future issue time and caller-provided revocation block",()=>{
  const token=createBuyerViewGrant(identity,key,now,30);
  const outcome=verify(token);
  assert.equal(verify(token,identity,key,now-1).state,"blocked");
  assert.equal(verify(token,identity,key,now+30).state,"blocked");
  assert.equal(verify(token,identity,key,now,[outcome.grantId]).state,"blocked");
});

test("signature tampering, malformed encoding and unrelated keys are rejected",()=>{
  const token=createBuyerViewGrant(identity,key,now);
  const [v,p,s]=token.split(".");
  for(const altered of [
    token.slice(0,-1)+(token.endsWith("A")?"B":"A"),
    v+"."+p+"+."+s,v+"."+p+"."+s+"=",
    v+"."+Buffer.from("{}").toString("base64url")+"."+s,
    token.replace(/^bmview1/,"bmview2"),"","x".repeat(1000),
  ])assert.equal(verify(altered).state,"blocked");
  assert.equal(verify(token,identity,randomBytes(32)).state,"blocked");
});

test("extra privileges, invalid audience, long validity and broken IDs fail even if signed",()=>{
  const token=createBuyerViewGrant(identity,key,now);
  const claims=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8"));
  for(const changed of [
    {...claims,canSend:true},{...claims,audience:"buyer-write-proposal"},
    {...claims,expiresAt:claims.issuedAt+901},{...claims,grantId:"bad"},
    {...claims,issuedAt:"1"},{...claims,recipientSha256:"invalid"},
  ])assert.equal(verify(forgeClaims(changed)).state,"blocked");
});

test("malformed identities, weak keys, invalid TTL and revoked-list contents fail closed",()=>{
  for(const ttl of [0,901,-1,1.5,Number.NaN])
    assert.throws(()=>createBuyerViewGrant(identity,key,now,ttl),/Invalid/);
  assert.throws(()=>createBuyerViewGrant(identity,randomBytes(16),now),/Invalid/);
  assert.throws(()=>createBuyerViewGrant({...identity,revision:0},key,now),/Invalid/);
  assert.throws(()=>createBuyerViewGrant({...identity,recipientEmail:"buyer@example.test"},key,now),/Invalid/);
  assert.throws(()=>verifyBuyerViewGrant("x",identity,key,now,["bad"]),/Invalid/);
  assert.throws(()=>verifyBuyerViewGrant("x",identity,key,now,new Array(1)),/Invalid/);
});

test("getter-backed identity fields are never read",()=>{
  let reads=0;
  const hostile={...identity};
  Object.defineProperty(hostile,"proposalId",{enumerable:true,get(){
    reads++;throw Error("getter executed");
  }});
  assert.throws(()=>createBuyerViewGrant(hostile,key,now),/Invalid/);
  assert.throws(()=>verifyBuyerViewGrant("x",hostile,key,now),/Invalid/);
  assert.equal(reads,0);
});

test("independent grant IDs allow individual future revocation",()=>{
  const first=verify(createBuyerViewGrant(identity,key,now));
  const second=verify(createBuyerViewGrant(identity,key,now));
  assert.equal(first.state,"signed-claims-only");
  assert.equal(second.state,"signed-claims-only");
  assert.notEqual(first.grantId,second.grantId);
});
