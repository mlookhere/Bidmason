import test from "node:test";
import assert from "node:assert/strict";
import { lookupAccount, BIDMASON_SUPABASE_URL } from "../lib/supabase-account.ts";
const TOKEN = "Bearer header.payload.signature";
const KEY = "sb_publishable_ci_only";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "10000000-0000-4000-8000-000000000001";
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

test("fails closed before network without configured public key or valid bearer", async () => {
  let calls = 0;
  const fake = async () => { calls++; throw Error("must not call"); };
  assert.equal((await lookupAccount(TOKEN, undefined, fake)).status, 503);
  assert.equal((await lookupAccount(TOKEN, "not_a_publishable_key", fake)).status, 503);
  assert.equal((await lookupAccount(TOKEN, "sb_secret_wrong_kind", fake)).status, 503);
  assert.equal((await lookupAccount(null, KEY, fake)).status, 401);
  assert.equal((await lookupAccount("Basic xyz", KEY, fake)).status, 401);
  assert.equal((await lookupAccount("Bearer evil\nanything", KEY, fake)).status, 401);
  assert.equal(calls, 0);
});

test("validates JWT with remote Auth endpoint then reads RLS memberships using SAME bearer", async () => {
  const calls = [];
  const http = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return json({ id: ID });
    return json([{ organization_id: ORG, member_role: "operator" }]);
  };
  const result = await lookupAccount(TOKEN, KEY, http);
  assert.deepEqual(result, {
    status: 200, data: {
      id: ID, memberships: [{ organizationId: ORG, role: "operator" }],
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, BIDMASON_SUPABASE_URL + "/auth/v1/user");
  assert.match(calls[1].url, /bm_memberships/);
  assert.match(calls[1].url, /user_id=eq/);
  for (const { options } of calls) {
    assert.equal(options.headers.authorization, TOKEN);
    assert.equal(options.headers.apikey, KEY);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
  }
});

test("invalid credentials never trigger tenant API call", async () => {
  let n = 0;
  const result = await lookupAccount(TOKEN, KEY, async () => { n++; return json({}, 401); });
  assert.equal(result.status, 401);
  assert.equal(n, 1);
});

test("provider errors, corrupt memberships, and network faults never become success", async () => {
  assert.equal((await lookupAccount(TOKEN, KEY, async () => json({}, 500))).status, 502);
  assert.equal((await lookupAccount(TOKEN, KEY, async () => { throw Error("secret"); })).status, 502);
  let count = 0;
  const bogus = async () => ++count === 1 ? json({ id: ID }) :
    json([{ organization_id: ORG, member_role: "admin" }]);
  assert.equal((await lookupAccount(TOKEN, KEY, bogus)).status, 502);
});

test("new accounts without memberships return an authenticated but empty tenant list", async () => {
  let n = 0;
  const result = await lookupAccount(TOKEN, KEY, async () => ++n === 1
    ? json({ id: ID }) : json([]));
  assert.deepEqual(result, { status: 200, data: { id: ID, memberships: [] } });
});

test("redirects from Auth or member RLS cannot trigger a second request with the JWT", async () => {
  for (const redirectAt of [1, 2]) {
    let calls = 0;
    const http = async (_url, options) => {
      calls++;
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.authorization, TOKEN);
      if (calls === redirectAt) {
        return new Response(null, {
          status: 302, headers: { location: "https://untrusted.invalid/capture" },
        });
      }
      if (calls === 1) return json({ id: ID });
      return json([{ organization_id: ORG, member_role: "owner" }]);
    };
    const response = await lookupAccount(TOKEN, KEY, http);
    assert.equal(response.status, 502);
    assert.equal(calls, redirectAt, "provider redirect must not be followed");
  }
  // Native fetch throws on redirect with this mode. That too fails closed.
  const blocked = await lookupAccount(TOKEN, KEY, async (_url, options) => {
    assert.equal(options.redirect, "error");
    throw new TypeError("Fetch redirect disallowed");
  });
  assert.equal(blocked.status, 502);
});
