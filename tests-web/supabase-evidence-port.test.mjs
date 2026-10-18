import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ingestVerifiedEvidence } from "../lib/evidence.ts";
import { createSupabaseEvidencePort } from "../lib/supabase-evidence-port.ts";

const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenant = "10000000-0000-4000-8000-000000000001";
const fileId = "50000000-0000-4000-8000-000000000001";
const document = Buffer.from("%PDF-1.7\nsynthetic-but-not-client-approved\n");
const key = "sb_publishable_example_ci_not_secret";
const token = "header.payload.signature";
const json = (value, status=200) => new Response(JSON.stringify(value), { status });
function harness(config = {}) {
  const calls = [];
  const issued = [];
  let authCount = 0;
  const port = createSupabaseEvidencePort({
    accessToken: token,
    publishableKey: key,
    issueTrustedReceipt: async receipt => { issued.push(receipt); },
    http: async (url, options) => {
      const path = new URL(String(url));
      calls.push({ path, options });
      assert.equal(path.hostname, "jgbogpunyzkoytrclqdl.supabase.co");
      assert.equal(options.headers.apikey, key);
      assert.equal(options.headers.Authorization, "Bearer " + token);
      assert.equal(options.cache, "no-store");
      if (path.pathname === "/auth/v1/user") {
        authCount++;
        return json({ id: config.mismatchAuth ? tenant : user });
      }
      if (path.pathname === "/rest/v1/bm_memberships") {
        assert.equal(path.searchParams.get("user_id"), "eq." + user);
        assert.equal(path.searchParams.get("organization_id"), "eq." + tenant);
        return json(config.revokeAtSecondCheck && authCount > 1 ? [] : [
          { organization_id: tenant },
        ]);
      }
      if (path.pathname.startsWith("/storage/v1/object/authenticated/")) {
        return new Response(config.changedBytes ?? document, { status: 200 });
      }
      if (path.pathname.startsWith("/storage/v1/object/bm-evidence/")) {
        assert.equal(options.method, "POST");
        assert.equal(options.headers["x-upsert"], "false");
        assert.equal(options.headers["Content-Type"], "application/pdf");
        assert.match(path.pathname, /bm-evidence\/10000000.*\.pdf$/);
        assert.equal((await options.body.arrayBuffer()).byteLength, document.length);
        return json({ Key: "stored" }, config.rejectUpload ? 403 : 200);
      }
      throw Error("Unexpected request " + path);
    },
  });
  return { port, calls, issued };
}
test("uses the real project's fixed endpoints and same user JWT for Auth, RLS, insert-only upload and private download", async () => {
  const { port, calls, issued } = harness();
  const receipt = await ingestVerifiedEvidence(user, tenant, "application/pdf",
    document, port, () => fileId);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(x => x.path.pathname.split("/")[1]), [
    "auth", "rest", "storage", "storage", "auth", "rest",
  ]);
  assert.equal(issued.length, 1);
  assert.equal(receipt.content_sha256, createHash("sha256").update(document).digest("hex"));
  assert.equal(issued[0].object_path, tenant + "/" + fileId + ".pdf");
});

test("does not upload or create receipts for a wrong Auth identity", async () => {
  const { port, calls, issued } = harness({ mismatchAuth: true });
  await assert.rejects(ingestVerifiedEvidence(user, tenant, "application/pdf",
    document, port, () => fileId), /Not authorized/);
  assert.equal(calls.length, 1);
  assert.equal(issued.length, 0);
});

test("rejected Storage upload cannot mint a trusted receipt", async () => {
  const { port, calls, issued } = harness({ rejectUpload: true });
  await assert.rejects(ingestVerifiedEvidence(user, tenant, "application/pdf",
    document, port, () => fileId), /upload rejected/);
  assert.equal(calls.length, 3);
  assert.equal(issued.length, 0);
});

test("different bytes returned by private Storage cannot mint a receipt", async () => {
  const { port, issued } = harness({ changedBytes: Buffer.from(document.map((value, index) => index === document.length - 1 ? value ^ 1 : value)) });
  await assert.rejects(ingestVerifiedEvidence(user, tenant, "application/pdf",
    document, port, () => fileId), /differ/);
  assert.equal(issued.length, 0);
});

test("revoked membership at second check cannot mint a receipt", async () => {
  const { port, issued } = harness({ revokeAtSecondCheck: true });
  await assert.rejects(ingestVerifiedEvidence(user, tenant, "application/pdf",
    document, port, () => fileId), /revoked/);
  assert.equal(issued.length, 0);
});

test("cannot configure service keys, missing bearer tokens, or arbitrary paths", async () => {
  for (const config of [
    { accessToken: "", publishableKey: key },
    { accessToken: token, publishableKey: "sb_secret_example" },
    { accessToken: "invalid\nheader", publishableKey: key },
  ]) assert.throws(() => createSupabaseEvidencePort({
    ...config, issueTrustedReceipt: async () => {},
  }), /configuration/);
  const { port } = harness();
  await assert.rejects(port.uploadPrivate(user, {
    organization_id: tenant,
    object_path: "../wrong/file.pdf",
    content_type: "application/pdf",
    content_sha256: "a".repeat(64),
    byte_length: document.length,
  }, document), /tenant-scoped/);
});


test("rejects advertised oversize before consuming any response bytes", async () => {
  let pulls = 0;
  const port = createSupabaseEvidencePort({
    accessToken: token,
    publishableKey: key,
    issueTrustedReceipt: async () => assert.fail("No receipt should be issued"),
    http: async () => new Response(new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(Uint8Array.of(37, 80, 68, 70, 45)); controller.close(); },
    }), { status: 200, headers: { "content-length": "999999999" } }),
  });
  await assert.rejects(port.readBackPrivate(user, {
    organization_id: tenant, object_path: tenant + "/" + fileId + ".pdf",
    byte_length: document.length, content_type: "application/pdf",
    content_sha256: "a".repeat(64),
  }), /exceeds expected size/);
  // A Web Stream implementation can prefetch one chunk; it must not consume
  // or allocate an arbitrarily large body before checking the advertised size.
  assert.ok(pulls <= 1);
});

test("rejects oversized streamed data without trusting missing or false content-length", async () => {
  for (const mode of ["absent", "underreported"]) {
    let cancelled = false;
    let chunks = 0;
    const port = createSupabaseEvidencePort({
      accessToken: token,
      publishableKey: key,
      issueTrustedReceipt: async () => assert.fail("No receipt should be issued"),
      http: async () => new Response(new ReadableStream({
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(64));
        },
        cancel() { cancelled = true; },
      }), {
        status: 200,
        headers: mode === "underreported" ? { "content-length": "5" } : {},
      }),
    });
    await assert.rejects(port.readBackPrivate(user, {
      organization_id: tenant, object_path: tenant + "/" + fileId + ".pdf",
      byte_length: 30, content_type: "application/pdf",
      content_sha256: "a".repeat(64),
    }), /exceeds expected size/);
    assert.equal(cancelled, true);
    assert.ok(chunks <= 3, "must stop streaming at first oversized chunk");
  }
});

test("rejects truncated private Storage responses rather than trusting a valid-looking header", async () => {
  const port = createSupabaseEvidencePort({
    accessToken: token,
    publishableKey: key,
    issueTrustedReceipt: async () => assert.fail("No receipt should be issued"),
    http: async () => new Response(document.subarray(0, 8), {
      status: 200, headers: { "content-length": String(document.length) },
    }),
  });
  await assert.rejects(port.readBackPrivate(user, {
    organization_id: tenant, object_path: tenant + "/" + fileId + ".pdf",
    byte_length: document.length, content_type: "application/pdf",
    content_sha256: "a".repeat(64),
  }), /size mismatch/);
});
