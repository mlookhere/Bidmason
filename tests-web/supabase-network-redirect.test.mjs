import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { lookupAccount, BIDMASON_SUPABASE_URL } from "../lib/supabase-account.ts";
import { createSupabaseEvidencePort } from "../lib/supabase-evidence-port.ts";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT = "10000000-0000-4000-8000-000000000001";
const FILE = TENANT + "/50000000-0000-4000-8000-000000000001.pdf";
const PDF = Buffer.from("%PDF-1.7\n% synthetic local redirect security test\n");
const TOKEN = "Bearer local.redirect.test";
const KEY = "sb_publishable_ci_only";
const receipt = {
  organization_id: TENANT,
  object_path: FILE,
  content_type: "application/pdf",
  content_sha256: createHash("sha256").update(PDF).digest("hex"),
  byte_length: PDF.length,
};

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  return {
    server,
    url: "http://127.0.0.1:" + addr.port,
  };
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()));
}

test("native Node fetch rejects real HTTP redirects before replaying bearer or API key", async () => {
  let firstHop = 0;
  let outsideRequests = 0;
  const outside = await listen((request, response) => {
    outsideRequests++;
    request.resume();
    response.writeHead(204);
    response.end();
  });
  let origin;
  try {
    origin = await listen((request, response) => {
      firstHop++;
      request.resume();
      response.writeHead(307, {
        location: outside.url + "/capture-credentials",
        "cache-control": "no-store",
      });
      response.end();
    });
    // Application code still has the immutable approved Supabase origin and
    // exact API endpoints. Only the injected transport maps the first hop to
    // a disposable loopback HTTP server; follow-up redirects are NOT remapped.
    const http = (url, options) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.origin, BIDMASON_SUPABASE_URL);
      assert.equal(options.redirect, "error");
      assert.ok(options.headers.authorization || options.headers.Authorization);
      assert.equal(options.headers.apikey, KEY);
      return fetch(origin.url + parsed.pathname + parsed.search, options);
    };

    const account = await lookupAccount(TOKEN, KEY, http);
    assert.equal(account.status, 502, "redirecting Auth endpoint must not authenticate");
    assert.equal(firstHop, 1);
    assert.equal(outsideRequests, 0);

    let issued = 0;
    const port = createSupabaseEvidencePort({
      publishableKey: KEY,
      accessToken: TOKEN.slice("Bearer ".length),
      issueTrustedReceipt: async () => { issued++; },
      http,
    });
    await assert.rejects(port.authorize(USER, TENANT), /Private evidence service unavailable/);
    await assert.rejects(port.uploadPrivate(USER, receipt, PDF), /Private evidence service unavailable/);
    await assert.rejects(port.readBackPrivate(USER, receipt), /Private evidence service unavailable/);

    assert.equal(firstHop, 4, "each call must stop after one redirecting provider response");
    assert.equal(outsideRequests, 0, "redirect destination must not receive any request");
    assert.equal(issued, 0, "never grant an immutable receipt after redirect");
  } finally {
    if (origin) await close(origin.server);
    await close(outside.server);
  }
});
