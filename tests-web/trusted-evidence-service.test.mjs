import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ingestForSignedInMember } from "../lib/trusted-evidence-service.ts";

const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const objectId = "50000000-0000-4000-8000-000000000001";
const publishableKey = "sb_publishable_ci_public_only";
const secretKey = "sb_secret_ci_server_only";
const document = Buffer.from("%PDF-1.7\n% controlled test file\n");
const input = { authorization: "Bearer header.payload.signature", organizationId: org,
  contentType: "application/pdf", bytes: document };
const json = (obj, status=200) => new Response(JSON.stringify(obj), { status });

function transport(mode={}) {
  const calls = [];
  let memberships = 0;
  const http = async (url, options) => {
    const parsed = new URL(String(url));
    calls.push({ parsed, options });
    assert.equal(parsed.hostname, "jgbogpunyzkoytrclqdl.supabase.co");
    assert.equal(options.cache, "no-store");
    if (parsed.pathname === "/auth/v1/user") {
      assert.equal(options.headers.authorization ?? options.headers.Authorization,
        input.authorization);
      return json({ id: mode.otherUser ? otherOrg : uid });
    }
    if (parsed.pathname === "/rest/v1/bm_memberships") {
      memberships++;
      assert.equal(options.headers.apikey, publishableKey);
      if (mode.missingMember || (mode.revoke && memberships === 3)) return json([]);
      if (parsed.searchParams.get("select") === "organization_id,member_role") {
        return json([{ organization_id: mode.otherOrg ? otherOrg : org, member_role: "contractor" }]);
      }
      return json([{ organization_id: org }]);
    }
    if (parsed.pathname.startsWith("/storage/v1/object/bm-evidence/")) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers["x-upsert"], "false");
      assert.equal(options.headers.apikey, publishableKey);
      assert.equal(options.headers.Authorization, input.authorization);
      assert.equal((await options.body.arrayBuffer()).byteLength, document.length);
      return json({ stored: true }, mode.rejectUpload ? 403 : 200);
    }
    if (parsed.pathname.startsWith("/storage/v1/object/authenticated/bm-evidence/")) {
      assert.equal(options.headers.apikey, publishableKey);
      assert.equal(options.headers.Authorization, input.authorization);
      return new Response(mode.tamper ? Buffer.from(document.map((value, index) => index === document.length - 1 ? value ^ 1 : value)) : document);
    }
    if (parsed.pathname === "/rest/v1/bm_evidence_receipts") {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.apikey, secretKey);
      assert.equal(options.headers.Authorization, undefined);
      assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(),
        ["organization_id","object_path","content_sha256","byte_length","content_type"].sort());
      return new Response("", { status: mode.rejectReceipt ? 409 : 201 });
    }
    throw Error("Unexpected host or endpoint " + parsed);
  };
  return { calls, http };
}
function cfg(http) { return { publishableKey, secretKey, http, createObjectId: () => objectId }; }
test("authenticated member gets immutable private upload and trusted receipt in exact order", async () => {
  const { calls, http } = transport();
  const result = await ingestForSignedInMember(input, cfg(http));
  assert.equal(result.organization_id, org);
  assert.equal(result.content_sha256, createHash("sha256").update(document).digest("hex"));
  assert.deepEqual(calls.map(x => x.parsed.pathname.split("/")[1]), [
    "auth","rest","auth","rest","storage","storage","auth","rest","rest",
  ]);
});
test("rejects absent key, bogus token or oversized bytes before HTTP", async () => {
  const { calls, http } = transport();
  for (const badCfg of [{ publishableKey, secretKey: undefined, http },
    { publishableKey: undefined, secretKey, http }]) {
    await assert.rejects(ingestForSignedInMember(input, badCfg), /not configured/);
  }
  await assert.rejects(ingestForSignedInMember({ ...input, authorization: null },
    cfg(http)), /Authenticated/);
  await assert.rejects(ingestForSignedInMember({ ...input, bytes: new Uint8Array(15*1024*1024+1) },
    cfg(http)), RangeError);
  assert.equal(calls.length, 0);
});
test("wrong Auth identity or unauthorized tenant is rejected without Storage access", async () => {
  for (const mode of [{ otherOrg: true }, { missingMember: true }]) {
    const { calls, http } = transport(mode);
    await assert.rejects(ingestForSignedInMember(input, cfg(http)), /Organization membership/);
    assert.deepEqual(calls.map(x => x.parsed.pathname.split("/")[1]), ["auth","rest"]);
  }
});
test("rejected upload, tampered download, revocation or database conflict never succeed", async () => {
  const cases = [
    [{rejectUpload: true}, /upload rejected/],
    [{tamper: true}, /differ/],
    [{revoke: true}, /revoked/],
    [{rejectReceipt: true}, /insertion rejected/],
  ];
  for (const [mode, pattern] of cases) {
    const { http, calls } = transport(mode);
    await assert.rejects(ingestForSignedInMember(input, cfg(http)), pattern);
    if (!mode.rejectReceipt) {
      assert.ok(!calls.some(x => x.parsed.pathname === "/rest/v1/bm_evidence_receipts"));
    }
  }
});
