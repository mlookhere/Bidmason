import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {projectSyntheticDealOutcome} from "../lib/synthetic-deal-outcome.ts";

const base={organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
 proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",revision:3,
 sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
 contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),recipient:"buyer@example.test"};
const intent={...base,idempotencyKey:deliveryIdempotencyKey(base)};
const at="2026-10-22T12:00:00.000Z";
const won={eventId:"11111111-1111-4111-8111-111111111111",
 organizationId:intent.organizationId,proposalId:intent.proposalId,
 revision:intent.revision,kind:"won",observedAt:"2026-10-21T09:00:00.000Z"};
const evaluate=(events=[],time=at)=>projectSyntheticDealOutcome(intent,events,time);

test("missing fictional decision is unverified, never open or contact-authorized",()=>{
 assert.deepEqual(evaluate(),{state:"deal-outcome-simulation-only",
  outcome:"unverified",closedAt:null,eventCount:0,contactAuthorized:false});
});
test("single final won or lost event blocks with strict revision-scoped result",()=>{
 for(const kind of ["won","lost"]){
  const result=evaluate([{...won,kind}]);
  assert.equal(result.outcome,kind);
  assert.equal(result.closedAt,won.observedAt);
  assert.equal(result.eventCount,1);
  assert.equal(result.contactAuthorized,false);
 }
});
test("exact duplicate replay is safe, but different terminal outcomes conflict",()=>{
 assert.deepEqual(evaluate([won,{...won}]),evaluate([won]));
 assert.throws(()=>evaluate([won,{...won,kind:"lost"}]),/Conflicting synthetic deal outcome replay/);
 const different={...won,eventId:"22222222-2222-4222-8222-222222222222"};
 assert.throws(()=>evaluate([won,different]),/Conflicting synthetic terminal/);
 assert.throws(()=>evaluate([different,won]),/Conflicting synthetic terminal/);
});
test("wrong tenant, proposal or revision and invented privileges fail closed",()=>{
 for(const change of [
  {organizationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
  {proposalId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
  {revision:4},{kind:"open"},{approved:true},{eventId:"invalid"},
 ]){
  assert.throws(()=>evaluate([{...won,...change}]),/Invalid or cross-tenant/);
 }
});
test("strict as-of, canonical UTC and future observations prevent backdating claims",()=>{
 for(const time of ["tomorrow","2026-10-22T12:00:00Z","2026-02-30T12:00:00.000Z"]){
  assert.throws(()=>evaluate([],time),/Invalid synthetic deal/);
 }
 assert.throws(()=>evaluate([won],"2026-10-20T08:00:00.000Z"),/Invalid or cross-tenant/);
 assert.throws(()=>evaluate([{...won,observedAt:"2026-02-30T09:00:00.000Z"}]),/Invalid or cross-tenant/);
});
test("sparse, decorated, hidden and accessor-backed event arrays cannot hide decisions",()=>{
 assert.throws(()=>evaluate(new Array(1)),/Invalid synthetic deal/);
 const decorated=[won];decorated.extra=true;
 assert.throws(()=>evaluate(decorated),/Invalid synthetic deal/);
 const hidden=[won];Object.defineProperty(hidden,"0",{enumerable:false});
 assert.throws(()=>evaluate(hidden),/Invalid synthetic deal/);
 let reads=0;const getter=[won];
 Object.defineProperty(getter,"0",{enumerable:true,get(){reads++;throw Error("unsafe")}});
 assert.throws(()=>evaluate(getter),/Invalid synthetic deal/);
 assert.equal(reads,0);
 const object={...won};
 Object.defineProperty(object,"kind",{enumerable:true,get(){reads++;throw Error("unsafe")}});
 assert.throws(()=>evaluate([object]),/Invalid or cross-tenant/);
 assert.equal(reads,0);
});
test("malformed target identity fails even for an empty outcome collection",()=>{
 assert.throws(()=>projectSyntheticDealOutcome({...intent,revision:4},[],at),
 /Invalid simulated delivery identity/);
});
