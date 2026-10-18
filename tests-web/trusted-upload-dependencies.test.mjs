import test from "node:test";
import assert from "node:assert/strict";
import { createTrustedEvidenceUploadDependencies } from "../lib/trusted-upload-dependencies.ts";

const publishableKey = "sb_publishable_ci_public";
const secretKey = "sb_secret_ci_server_only";

test("internal composition requires both trusted keys and a valid scanner daemon port", () => {
  const base = { publishableKey, secretKey, clamavPort: 3310 };
  for (const broken of [
    { ...base, publishableKey: "" },
    { ...base, publishableKey: "sb_secret_fake" },
    { ...base, secretKey: "" },
    { ...base, secretKey: "sb_publishable_fake" },
    { ...base, clamavPort: 0 },
    { ...base, clamavPort: 65536 },
  ]) assert.throws(() => createTrustedEvidenceUploadDependencies(broken), /not configured|port/);
});

test("composition always provides both security dependencies but no injectable bypass", async () => {
  const config = createTrustedEvidenceUploadDependencies({
    publishableKey, secretKey, clamavPort: 3310,
    http: async (url, init) => {
      assert.match(String(url), /\/rest\/v1\/rpc\/bm_reserve_upload_quota$/);
      assert.equal(init.headers.apikey, secretKey);
      return new Response("true", { status: 200, headers: {"content-type":"application/json"} });
    },
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.hasOwn(config, "ingest"), false);
  assert.equal(typeof config.scan, "function");
  assert.equal(typeof config.takePermit, "function");
  assert.equal(await config.takePermit(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "10000000-0000-4000-8000-000000000001",
  ), true);
  // No scanner daemon is started; the composed scanner must never assume clean.
  await assert.rejects(config.scan(
    Buffer.from("%PDF-1.7\nsynthetic\n"), "application/pdf",
  ), /antivirus/i);
});
