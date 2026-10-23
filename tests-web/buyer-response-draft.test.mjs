import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createBuyerViewGrant} from "../lib/buyer-view-grant.ts";
import {assessBuyerResponseDraft} from "../lib/buyer-response-draft.ts";

const identity = {
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  revision: 3, recipientSha256: "a".repeat(64), contentSha256: "b".repeat(64),
};
const secret = randomBytes(32);
const now = 1_791_000_000;
const viewToken = createBuyerViewGrant(identity, secret, now, 120);
const draft = { ...identity, kind: "question", note: "Please clarify the start date." };
const run = (input=draft, expected=identity, token=viewToken,
  time=now, revoked=[], responded=[]) =>
  assessBuyerResponseDraft(input,expected,token,secret,time,revoked,responded);

test("fictional question creates only nonbinding draft fingerprint, not a submitted response",()=>{
  const result = run();
  assert.equal(result.state,"draft-internal-only");
  assert.match(result.fingerprint,/^[a-f0-9]{64}$/);
  assert.match(result.grantId,/^[a-f0-9]{32}$/);
  assert.equal(result.kind,"question");
  for(const flag of ["submitted","approved","accepted","sent","responseId","url"]) {
    assert.equal(Object.hasOwn(result,flag),false);
  }
  assert.deepEqual(run(),result);
});

test("requests for changes and declines are draft-only; binding acceptance never supported",()=>{
  assert.equal(run({...draft,kind:"request_changes",note:"Please revise the scope."}).state,
    "draft-internal-only");
  assert.equal(run({...draft,kind:"decline",note:""}).state,"draft-internal-only");
  assert.throws(()=>run({...draft,kind:"accept"}),/Invalid nonbinding/);
  assert.throws(()=>run({...draft,kind:"approve_and_send"}),/Invalid nonbinding/);
  assert.throws(()=>run({...draft,kind:"question",note:""}),/Invalid nonbinding/);
});

test("tenant, proposal, revision, recipient and content changes cannot reuse old claims",()=>{
  const changes=[
    {organizationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
    {proposalId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
    {revision:4},{recipientSha256:"c".repeat(64)},{contentSha256:"c".repeat(64)},
  ];
  for(const change of changes){
    assert.equal(run({...draft,...change}).state,"blocked");
    assert.equal(run(draft,{...identity,...change}).state,"blocked");
  }
});

test("revoked, expired, not-yet-issued and tampered grants block",()=>{
  const grantId = run().grantId;
  assert.equal(run(draft,identity,viewToken,now,[grantId]).state,"blocked");
  assert.equal(run(draft,identity,viewToken,now-1).state,"blocked");
  assert.equal(run(draft,identity,viewToken,now+120).state,"blocked");
  assert.equal(run(draft,identity,viewToken.slice(0,-1)+"X").state,"blocked");
});

test("same grant in supplied response history blocks replay; distinct grant gets new fingerprint",()=>{
  const initial=run();
  assert.equal(run(draft,identity,viewToken,now,[],[initial.grantId]).state,"blocked");
  const otherToken=createBuyerViewGrant(identity,secret,now,120);
  const another=run(draft,identity,otherToken);
  assert.equal(another.state,"draft-internal-only");
  assert.notEqual(another.grantId,initial.grantId);
  assert.notEqual(another.fingerprint,initial.fingerprint);
});

test("malicious markup, controls, bidi overrides and unbounded notes are rejected",()=>{
  const badNotes=["<script>alert(1)</script>","bad\nnewline","a".repeat(501),
    "\u202ePAY","  padded","decomposed e\u0301", "\t"];
  for(const note of badNotes){
    assert.throws(()=>run({...draft,note}),/Invalid nonbinding/);
  }
  assert.equal(run({...draft,note:"Résumé and café: please clarify."}).state,
    "draft-internal-only");
});

test("invisible Unicode format and line separators cannot obscure internal review notes",()=>{
  const hidden=["\u00ad", "\u034f", "\u061c", "\u180e", "\u200b", "\u200c",
    "\u200d", "\u200e", "\u200f", "\u2028", "\u2029", "\u2060", "\ufeff"];
  for(const ch of hidden){
    assert.throws(()=>run({...draft,note:"Contract"+ch+"or approved"}),
      /Invalid nonbinding/,`U+${ch.codePointAt(0).toString(16)}`);
    assert.throws(()=>run({...draft,kind:"decline",note:ch}),/Invalid nonbinding/);
  }
  for(const note of ["请确认开始日期。", "시작 날짜를 확인해 주세요.",
    "هل يمكنك تأكيد تاريخ البدء؟", "¿Puede confirmar la fecha?"]){
    assert.equal(run({...draft,note}).state,"draft-internal-only");
  }
});

test("unlisted Unicode format controls cannot hide or reorder review content",()=>{
  // Unicode Cf includes U+2061..U+2065, obsolete bidi controls, and
  // supplementary tag code points not covered by the older interval list.
  for(const codePoint of [0x0600,0x2061,0x2063,0x2064,0x206a,0x206f,0xe007f]){
    const hidden=String.fromCodePoint(codePoint);
    assert.throws(()=>run({...draft,note:"Terms"+hidden+"accepted"}),
      /Invalid nonbinding/,codePoint.toString(16));
    assert.throws(()=>run({...draft,kind:"decline",note:hidden}),/Invalid nonbinding/);
  }
  // Printable international text and ordinary emoji retain their behavior.
  for(const note of ["الرجاء مراجعة العرض", "请核实价格", "검토 부탁드립니다", "Please review ❤️"]){
    assert.equal(run({...draft,note}).state,"draft-internal-only");
  }
});

test("unpaired UTF-16 surrogates cannot create visually inconsistent reviewer evidence",()=>{
  // Lone surrogates pass NFC but stringify as escapes and display as replacement
  // glyphs; reject them before computing the nonbinding note fingerprint.
  const malformed=["\ud800", "\udfff", "before\ud800after", "before\udc00after",
    "\ud83dX\ude80"];
  for (const note of malformed){
    assert.throws(()=>run({...draft,note}),/Invalid nonbinding/,JSON.stringify(note));
    assert.throws(()=>run({...draft,kind:"decline",note}),/Invalid nonbinding/);
  }
  // Valid paired Unicode is not equivalent to a malformed UTF-16 code unit.
  for (const note of ["Please review 🚀", "작업을 확인해 주세요 🎨",
    "请确认报价 🧾", "هل يمكن مراجعة العرض؟ ✅"]){
    assert.equal(run({...draft,note}).state,"draft-internal-only");
  }
});

test("extra privileges, invalid record arrays and accessor-backed properties fail closed",()=>{
  for(const addition of [{approved:true},{recipientEmail:"buyer@example.test"},
    {kind:"submit"},{note:21},{revision:0}]) {
    assert.throws(()=>run({...draft,...addition}),/Invalid nonbinding/);
  }
  assert.throws(()=>run(draft,identity,viewToken,now,[],["invalid"]),/Invalid nonbinding/);
  assert.throws(()=>run(draft,identity,viewToken,now,[],new Array(1)),/Invalid nonbinding/);
  let reads=0;
  const hostile={...draft};
  Object.defineProperty(hostile,"note",{enumerable:true,get(){reads++;throw Error("getter")}});
  assert.throws(()=>run(hostile),/Invalid nonbinding/);
  assert.equal(reads,0);
});

test("invalid verified context cannot be interpreted as submission authority",()=>{
  assert.throws(()=>run(draft,identity,viewToken,NaN),/Invalid/);
  assert.equal(run(draft,identity,"non-token").state,"blocked");
  assert.equal(run({...draft,note:"Please clarify the start date."}).state,"draft-internal-only");
});
