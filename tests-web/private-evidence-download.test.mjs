import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { downloadMemberEvidence } from "../lib/private-evidence-download.ts";

const org = "10000000-0000-4000-8000-000000000001";
const foreignOrg = "10000000-0000-4000-8000-000000000002";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const objectId = "50000000-0000-4000-8000-000000000001";
const path = org + "/" + objectId + ".pdf";
const auth = "Bearer header.payload.signature";
const publishableKey = "sb_publishable_ci_public_only";
const bytes = Buffer.from("%PDF-1.7\n% test private file\n");
const sha = createHash("sha256").update(bytes).digest("hex");
const input = { authorization: auth, organizationId: org, objectPath: path };
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function fixture(mode = {}) {
  const calls = [];
  let membershipChecks = 0;
  const http = async (url, options) => {
    const parsed = new URL(String(url));
    calls.push({ parsed, options });
    assert.equal(parsed.hostname, "jgbogpunyzkoytrclqdl.supabase.co");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.apikey, publishableKey);
    assert.equal(options.headers.authorization ?? options.headers.Authorization, auth);
    if (parsed.pathname === "/auth/v1/user") {
      return json({ id });
    }
    if (parsed.pathname === "/rest/v1/bm_memberships") {
      membershipChecks++;
      return json(mode.denied || (mode.revoked && membershipChecks === 2) ? [] : [
        { organization_id: mode.foreignMember ? foreignOrg : org, member_role: "contractor" },
      ]);
    }
    if (parsed.pathname === "/rest/v1/bm_evidence_receipts") {
      assert.equal(parsed.searchParams.get("organization_id"), "eq." + org);
      assert.equal(parsed.searchParams.get("object_path"), "eq." + path);
      const receipt = {
        organization_id: org,
        object_path: path,
        byte_length: bytes.length,
        content_type: "application/pdf",
        content_sha256: mode.badDigest ? "invalid" : sha,
      };
      return json(mode.missing ? [] : [receipt]);
    }
    if (parsed.pathname === "/storage/v1/object/authenticated/bm-evidence/" + path) {
      const payload = mode.tamper
        ? Buffer.from(bytes.map((v, i) => i === bytes.length - 1 ? v ^ 1 : v))
        : mode.truncated ? bytes.subarray(0, bytes.length - 1) : bytes;
      return new Response(payload, { status: 200 });
    }
    throw new Error("Unexpected request path: " + parsed.pathname);
  };
  return { calls, http };
}

test("private download checks identity, tenant, receipt, bounded bytes, hash and fresh membership", async () => {
  const { calls, http } = fixture();
  const result = await downloadMemberEvidence(input, { publishableKey, http });
  assert.equal(result.status, 200);
  assert.equal(result.contentType, "application/pdf");
  assert.deepEqual(Buffer.from(result.bytes), bytes);
  assert.deepEqual(calls.map(c => c.parsed.pathname.split("/")[1]), [
    "auth", "rest", "rest", "storage", "auth", "rest",
  ]);
  assert.ok(!calls.some(c => c.options.headers.apikey.startsWith("sb_secret_")));
});

test("invalid organization/path and missing configuration fail before networking", async () => {
  const { http, calls } = fixture();
  for (const fields of [
    { organizationId: foreignOrg },
    { objectPath: "../" + path },
    { objectPath: org + "/missing.pdf" },
    { objectPath: null },
  ]) {
    const result = await downloadMemberEvidence({ ...input, ...fields },
      { publishableKey, http });
    assert.equal(result.status, 400);
  }
  assert.equal((await downloadMemberEvidence(input, { publishableKey: undefined, http })).status, 503);
  assert.equal(calls.length, 0);
});

test("failed auth and cross-tenant membership disclose no receipt or storage", async () => {
  const f = fixture({ foreignMember: true });
  const result = await downloadMemberEvidence(input, { publishableKey, http: f.http });
  assert.equal(result.status, 404);
  assert.deepEqual(f.calls.map(c => c.parsed.pathname.split("/")[1]), ["auth", "rest"]);
  const missingAuth = await downloadMemberEvidence({ ...input, authorization: null }, {
    publishableKey, http: f.http,
  });
  assert.equal(missingAuth.status, 401);
  assert.equal(f.calls.length, 2);
});

test("RLS-hidden receipts and malformed receipt metadata are refused", async () => {
  for (const [mode, status] of [[{ missing: true }, 404], [{ badDigest: true }, 502]]) {
    const { http, calls } = fixture(mode);
    assert.equal((await downloadMemberEvidence(input, { publishableKey, http })).status, status);
    assert.ok(!calls.some(c => c.parsed.pathname.startsWith("/storage/")));
  }
});

test("same-size tampering and truncated streams are rejected", async () => {
  for (const mode of [{ tamper: true }, { truncated: true }]) {
    const { http } = fixture(mode);
    const result = await downloadMemberEvidence(input, { publishableKey, http });
    assert.equal(result.status, 502);
  }
});

test("revocation while evidence is streaming prevents any download bytes from returning", async () => {
  const { http, calls } = fixture({ revoked: true });
  const result = await downloadMemberEvidence(input, { publishableKey, http });
  assert.equal(result.status, 401);
  assert.equal("bytes" in result, false);
  assert.equal(calls.filter(c => c.parsed.pathname === "/rest/v1/bm_memberships").length, 2);
});

test("HTTP evidence route is disabled by default and exposes no data", async () => {
  const { GET } = await import("../app/api/evidence/route.ts");
  const prior = process.env.BIDMASON_PRIVATE_DOWNLOAD_ENABLED;
  try {
    delete process.env.BIDMASON_PRIVATE_DOWNLOAD_ENABLED;
    const result = await GET(new Request(
      "http://localhost:3000/api/evidence?organizationId=" + org + "&objectPath=" + encodeURIComponent(path),
      { headers: { authorization: auth } },
    ));
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
    assert.equal("bytes" in (await result.json()), false);
  } finally {
    if (prior === undefined) delete process.env.BIDMASON_PRIVATE_DOWNLOAD_ENABLED;
    else process.env.BIDMASON_PRIVATE_DOWNLOAD_ENABLED = prior;
  }
});
