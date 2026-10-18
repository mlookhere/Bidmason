import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseUploadPermit } from "../lib/supabase-upload-quota.ts";

const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const org = "10000000-0000-4000-8000-000000000001";
const secretKey = "sb_secret_ci_server_only";
const json = (v, status = 200) => new Response(JSON.stringify(v), {status});

test("atomic quota uses only fixed BidMason RPC, secret key and trusted IDs", async () => {
  const calls = [];
  const permit = createSupabaseUploadPermit({
    secretKey,
    http: async (url, init) => {
      calls.push({ url: String(url), init });
      return json(true);
    },
  });
  assert.equal(await permit(user, org), true);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://jgbogpunyzkoytrclqdl.supabase.co/rest/v1/rpc/bm_reserve_upload_quota");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.apikey, secretKey);
  assert.equal(init.headers.Authorization, undefined);
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  assert.deepEqual(JSON.parse(init.body), { p_user_id: user, p_organization_id: org });
});

test("explicit denied quota returns false, never a fail-open truthy value", async () => {
  const permit = createSupabaseUploadPermit({ secretKey, http: async () => json(false) });
  assert.equal(await permit(user, org), false);
});

test("missing server secret and invalid actor/tenant refuse network access", async () => {
  assert.throws(() => createSupabaseUploadPermit({ secretKey: "sb_publishable_not_allowed" }), /not configured/);
  let count = 0;
  const permit = createSupabaseUploadPermit({ secretKey, http: async () => { count++; return json(true); } });
  await assert.rejects(permit("invalid", org), /Invalid/);
  await assert.rejects(permit(user, "invalid"), /Invalid/);
  assert.equal(count, 0);
});

test("upstream denial, failure, network error and invalid RPC data all fail closed", async () => {
  const cases = [
    async () => json({ granted: true }),
    async () => json("true"),
    async () => json({}, 403),
    async () => json({}, 429),
    async () => { throw new Error("secret service response"); },
  ];
  for (const http of cases) {
    const permit = createSupabaseUploadPermit({ secretKey, http });
    await assert.rejects(permit(user, org), /quota unavailable/);
  }
});

test("caller abort propagates into in-flight quota HTTP without refund or retry", async () => {
  const controller = new AbortController();
  let requestSignal;
  let n = 0;
  const permit = createSupabaseUploadPermit({
    secretKey,
    http: async (_url, init) => {
      n++;
      requestSignal = init.signal;
      assert.equal(init.redirect, "error");
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Error("quota RPC cancelled")), { once: true });
      });
    },
  });
  const running = permit(user, org, controller.signal);
  assert.ok(requestSignal instanceof AbortSignal);
  controller.abort();
  assert.equal(requestSignal.aborted, true);
  await assert.rejects(running, /Trusted upload quota unavailable/);
  assert.equal(n, 1, "ambiguous quota response must not be blindly replayed");
});

test("pre-aborted quota request fails before privileged HTTP", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const permit = createSupabaseUploadPermit({
    secretKey,
    http: async () => { calls++; return json(true); },
  });
  await assert.rejects(permit(user, org, controller.signal), /Trusted upload quota unavailable/);
  assert.equal(calls, 0);
});

test("quota response arriving after cancellation cannot be interpreted as success", async () => {
  const controller = new AbortController();
  const permit = createSupabaseUploadPermit({
    secretKey,
    http: async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      controller.abort();
      return json(true);
    },
  });
  await assert.rejects(permit(user, org, controller.signal), /Trusted upload quota unavailable/);
});


test("quota rejects oversized, malformed, truncated or nonboolean provider bodies without retry", async () => {
  const cases = [
    new Response("true" + " ".repeat(70), { status: 200 }),
    new Response("false" + " ".repeat(70), { status: 200 }),
    new Response("{broken", { status: 200 }),
    new Response("tru", { status: 200 }),
    new Response("{}", { status: 200 }),
    new Response("null", { status: 200 }),
    new Response("1", { status: 200 }),
    new Response("", { status: 200 }),
    new Response("true", { status: 200, headers: { "content-length": "100000000" } }),
    new Response("true", { status: 200, headers: { "content-length": "bad" } }),
  ];
  for (const response of cases) {
    let requests = 0;
    const permit = createSupabaseUploadPermit({
      secretKey,
      http: async () => { requests++; return response; },
    });
    await assert.rejects(permit(user, org), /Trusted upload quota unavailable/);
    assert.equal(requests, 1, "uncertain or malformed quota result may not be retried");
  }
});

test("quota read accepts valid JSON boolean with ordinary HTTP Content-Length", async () => {
  for (const [reply, expected] of [["true", true], ["false", false]]) {
    const permit = createSupabaseUploadPermit({
      secretKey,
      http: async (_url, init) => {
        assert.ok(init.signal instanceof AbortSignal);
        return new Response(reply, {
          status: 200, headers: { "content-length": String(Buffer.byteLength(reply)) },
        });
      },
    });
    assert.equal(await permit(user, org), expected);
  }
});

test("abort after quota headers while body stream stalls never grants a permit", async () => {
  const controller = new AbortController();
  let reachedPull;
  const entered = new Promise(resolve => { reachedPull = resolve; });
  const stalled = new ReadableStream({
    pull() { reachedPull(); return new Promise(() => {}); },
  });
  let requests = 0;
  const permit = createSupabaseUploadPermit({
    secretKey,
    http: async (_url, init) => {
      requests++;
      assert.ok(init.signal instanceof AbortSignal);
      return new Response(stalled, { status: 200 });
    },
  });
  const pending = permit(user, org, controller.signal);
  await entered;
  controller.abort();
  await assert.rejects(pending, /Trusted upload quota unavailable/);
  assert.equal(requests, 1, "remote quota may already be reserved; never replay");
});

test("abort after a valid quota response but before body completion cannot yield true", async () => {
  const controller = new AbortController();
  let reachedPull;
  const entered = new Promise(resolve => { reachedPull = resolve; });
  const stalled = new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode("true")); },
    pull() { reachedPull(); return new Promise(() => {}); },
  });
  let requests = 0;
  const permit = createSupabaseUploadPermit({
    secretKey,
    http: async () => { requests++; return new Response(stalled, { status: 200 }); },
  });
  const pending = permit(user, org, controller.signal);
  await entered;
  controller.abort();
  await assert.rejects(pending, /Trusted upload quota unavailable/);
  assert.equal(requests, 1);
});
