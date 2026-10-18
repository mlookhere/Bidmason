import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { processEvidenceUpload } from "../lib/evidence-upload-boundary.ts";

const ORG = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "10000000-0000-4000-8000-000000000002";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "Bearer header.payload.signature";
const PUBLIC_KEY = "sb_publishable_ci_only";
const SECRET_KEY = "sb_secret_ci_server_only";
const PDF = Buffer.from("%PDF-1.7\n% sample synthetic evidence\n");
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

function request(bytes = PDF, overrides = {}) {
  const headers = {
    authorization: TOKEN,
    "x-bidmason-organization": ORG,
    "content-type": "application/pdf",
    "content-length": String(bytes.length),
    ...overrides,
  };
  for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
  return new Request("https://bidmason.invalid/api/evidence", {
    method: "POST", headers, body: bytes,
  });
}

function fixture(mode = {}) {
  const events = [];
  const deps = {
    publishableKey: PUBLIC_KEY,
    secretKey: SECRET_KEY,
    async http(url, init) {
      events.push("http:" + new URL(String(url)).pathname);
      assert.equal(init.headers.apikey, PUBLIC_KEY);
      assert.equal(init.headers.authorization, TOKEN);
      if (new URL(String(url)).pathname === "/auth/v1/user") {
        return json({}, mode.badToken ? 401 : 200);
      }
      return json([{ organization_id: mode.otherTenant ? FOREIGN : ORG,
        member_role: "contractor" }]);
    },
    async takePermit(uid, org) {
      events.push("quota");
      assert.equal(uid, USER);
      assert.equal(org, ORG);
      if (mode.quotaThrows) throw Error("sensitive quota details");
      return !mode.quotaDenied;
    },
    async scan(bytes, contentType) {
      events.push("scan");
      assert.deepEqual(Buffer.from(bytes), PDF);
      assert.equal(contentType, "application/pdf");
      if (mode.scanThrows) throw Error("private scanner credentials");
      return mode.unsafe ? "unsafe" : "clean";
    },
    async ingest(input, config) {
      events.push("ingest");
      assert.deepEqual(Buffer.from(input.bytes), PDF);
      assert.equal(input.authorization, TOKEN);
      assert.equal(input.organizationId, ORG);
      assert.equal(config.secretKey, SECRET_KEY);
      assert.equal(config.publishableKey, PUBLIC_KEY);
      if (mode.ingestFails) throw Error("private receipt write error");
      return {
        organization_id: ORG,
        object_path: ORG + "/50000000-0000-4000-8000-000000000001.pdf",
        content_sha256: createHash("sha256").update(input.bytes).digest("hex"),
        byte_length: input.bytes.length,
        content_type: input.contentType,
      };
    },
  };
  // Auth response MUST contain an actual user ID for successful cases.
  const original = deps.http;
  deps.http = async (url, init) => {
    const result = await original(url, init);
    if (new URL(String(url)).pathname === "/auth/v1/user" && !mode.badToken) {
      return json({ id: USER });
    }
    return result;
  };
  return { deps, events };
}

test("verified member uploads only after quota, file validation and explicit clean scan", async () => {
  const { deps, events } = fixture();
  const result = await processEvidenceUpload(request(), deps);
  assert.equal(result.status, 201);
  assert.equal(result.receipt.organization_id, ORG);
  assert.equal(result.receipt.byte_length, PDF.length);
  assert.deepEqual(events, [
    "http:/auth/v1/user", "http:/rest/v1/bm_memberships",
    "quota", "scan", "ingest",
  ]);
});

test("missing scanner, durable quota or keys blocks upload without external calls", async () => {
  for (const missing of ["scan", "takePermit", "publishableKey", "secretKey"]) {
    const { deps, events } = fixture();
    delete deps[missing];
    const req = request();
    assert.equal((await processEvidenceUpload(req, deps)).status, 503);
    assert.equal(req.bodyUsed, false);
    assert.deepEqual(events, []);
  }
});

test("malformed organization, MIME and length are rejected before auth/network", async () => {
  const cases = [
    [{ "x-bidmason-organization": "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }, 400],
    [{ "content-type": "text/html" }, 415],
    [{ "content-type": "application/pdf; charset=utf-8" }, 415],
    [{ "content-length": null }, 411],
    [{ "content-length": "not-a-number" }, 400],
    [{ "content-length": "0" }, 400],
    [{ "content-length": String(15 * 1024 * 1024 + 1) }, 413],
  ];
  for (const [header, status] of cases) {
    const { deps, events } = fixture();
    const req = request(PDF, header);
    assert.equal((await processEvidenceUpload(req, deps)).status, status);
    assert.equal(req.bodyUsed, false);
    assert.deepEqual(events, []);
  }
});

test("invalid JWT, foreign organization and quota rejection never read body or scan", async () => {
  for (const [mode, expected] of [
    [{ badToken: true }, 401],
    [{ otherTenant: true }, 404],
    [{ quotaDenied: true }, 429],
    [{ quotaThrows: true }, 503],
  ]) {
    const { deps, events } = fixture(mode);
    const req = request();
    assert.equal((await processEvidenceUpload(req, deps)).status, expected);
    assert.equal(req.bodyUsed, false);
    assert.equal(events.includes("scan"), false);
    assert.equal(events.includes("ingest"), false);
  }
});

test("declared length mismatch and invalid PDF magic never invoke scanner or Storage", async () => {
  const a = fixture();
  assert.equal((await processEvidenceUpload(request(PDF, {
    "content-length": String(PDF.length - 1),
  }), a.deps)).status, 400);
  assert.equal(a.events.includes("scan"), false);
  const bad = Buffer.from("INVALID " + "x".repeat(PDF.length - 8));
  const b = fixture();
  assert.equal((await processEvidenceUpload(request(bad), b.deps)).status, 422);
  assert.equal(b.events.includes("scan"), false);
  assert.equal(b.events.includes("ingest"), false);
});

test("unsafe or unavailable malware scanner always prevents private upload", async () => {
  for (const [mode, status] of [[{ unsafe: true }, 422], [{ scanThrows: true }, 503]]) {
    const { deps, events } = fixture(mode);
    assert.equal((await processEvidenceUpload(request(), deps)).status, status);
    assert.equal(events.includes("ingest"), false);
  }
});

test("failed trusted ingestion is never acknowledged as success", async () => {
  const { deps } = fixture({ ingestFails: true });
  const result = await processEvidenceUpload(request(), deps);
  assert.deepEqual(result, { status: 502, error: "Verified evidence ingestion failed" });
});

test("chunked request over a falsely small advertised length cancels without scanning", async () => {
  const { deps, events } = fixture();
  const req = new Request("https://bidmason.invalid/api/evidence", {
    method: "POST",
    headers: { authorization: TOKEN, "x-bidmason-organization": ORG,
      "content-type": "application/pdf", "content-length": String(PDF.length - 1) },
    body: new ReadableStream({
      start(controller) { controller.enqueue(PDF); controller.close(); },
    }), duplex: "half",
  });
  assert.equal((await processEvidenceUpload(req, deps)).status, 400);
  assert.equal(events.includes("scan"), false);
  assert.equal(events.includes("ingest"), false);
});


test("aborted authorized client request returns 408 without scanner or receipt insertion", async () => {
  const { deps, events } = fixture();
  const abort = new AbortController();
  const reserve = deps.takePermit;
  deps.takePermit = async (...args) => {
    const granted = await reserve(...args);
    abort.abort();
    return granted;
  };
  const req = new Request("https://bidmason.invalid/api/evidence", {
    method: "POST",
    headers: {
      authorization: TOKEN,
      "x-bidmason-organization": ORG,
      "content-type": "application/pdf",
      "content-length": String(PDF.length),
    },
    body: new ReadableStream({
      pull() { return new Promise(() => {}); },
    }),
    duplex: "half",
    signal: abort.signal,
  });
  const outcome = await processEvidenceUpload(req, deps);
  assert.equal(outcome.status, 408);
  assert.deepEqual(events, [
    "http:/auth/v1/user", "http:/rest/v1/bm_memberships", "quota",
  ]);
});

test("body that streams declared bytes but never closes must not continue after disconnect", async () => {
  const { deps, events } = fixture();
  const abort = new AbortController();
  const reserve = deps.takePermit;
  deps.takePermit = async (...args) => {
    const granted = await reserve(...args);
    setTimeout(() => abort.abort(), 25);
    return granted;
  };
  const req = new Request("https://bidmason.invalid/api/evidence", {
    method: "POST",
    headers: {
      authorization: TOKEN,
      "x-bidmason-organization": ORG,
      "content-type": "application/pdf",
      "content-length": String(PDF.length),
    },
    body: new ReadableStream({
      start(controller) { controller.enqueue(PDF); },
      pull() { return new Promise(() => {}); },
    }),
    duplex: "half",
    signal: abort.signal,
  });
  const outcome = await processEvidenceUpload(req, deps);
  assert.equal(outcome.status, 408);
  assert.equal(events.includes("scan"), false);
  assert.equal(events.includes("ingest"), false);
});

test("client disconnect during successful scan never invokes trusted ingestion", async () => {
  const { deps, events } = fixture();
  const signal = new AbortController();
  const req = new Request("https://bidmason.invalid/api/evidence", {
    method: "POST",
    headers: {
      authorization: TOKEN,
      "x-bidmason-organization": ORG,
      "content-type": "application/pdf",
      "content-length": String(PDF.length),
    },
    body: PDF,
    signal: signal.signal,
  });
  const originalScan = deps.scan;
  deps.scan = async (...args) => {
    const verdict = await originalScan(...args);
    signal.abort(); // Disconnect while scanner was processing.
    return verdict; // Even a genuine clean verdict cannot authorize Storage.
  };
  const outcome = await processEvidenceUpload(req, deps);
  assert.equal(outcome.status, 408);
  assert.equal(events.includes("scan"), true);
  assert.equal(events.includes("ingest"), false);
});

test("an already-aborted request with full bytes does not issue a receipt", async () => {
  const { deps, events } = fixture();
  const controller = new AbortController();
  const req = request();
  // A real Request exposes a separate signal; construct with the controller.
  const abortable = new Request(req, { signal: controller.signal });
  controller.abort();
  const outcome = await processEvidenceUpload(abortable, deps);
  assert.equal(outcome.status, 408);
  assert.equal(events.includes("ingest"), false);
});
