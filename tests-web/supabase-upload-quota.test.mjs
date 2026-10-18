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
