import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://jgbogpunyzkoytrclqdl.supabase.co";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const TABLES = ["bm_organizations", "bm_memberships", "bm_evidence_receipts"];

// Only internal operator use: no app route, no public Edge Function, no CI secret.
export async function verifyLiveAuthMemberships({
  approved, serviceKey, publishableKey, http = fetch,
  id = randomUUID, password = () => randomBytes(32).toString("base64url"),
} = {}) {
  if (approved !== "temporary-auth-users-only"
    || typeof serviceKey !== "string" || serviceKey.length < 24
    || typeof publishableKey !== "string"
    || !publishableKey.startsWith("sb_publishable_")
    || serviceKey === publishableKey) {
    throw new Error("Explicit approval and private Auth Admin credentials are required");
  }
  const created = { users: [], organizations: [] };
  let originalFailure;
  const request = async (path, { method = "GET", body, bearer = serviceKey,
    key = serviceKey, prefer } = {}) => {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid provider path");
    const response = await http(ORIGIN + path, {
      method, redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: {
        apikey: key, authorization: "Bearer " + bearer,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(prefer ? { prefer } : {}), accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (![200, 201, 204].includes(response.status)) {
      try { void response.body?.cancel().catch(() => {}); } catch { /* best effort */ }
      throw new Error("Supabase acceptance request failed (" + response.status + ")");
    }
    if (response.status === 204 || prefer === "return=minimal") return null;
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > 65536)) {
      throw new Error("Unbounded provider response");
    }
    const data = await response.text();
    if (data.length > 65536) throw new Error("Unbounded provider response");
    try { return JSON.parse(data); } catch { throw new Error("Invalid provider JSON"); }
  };
  const table = (name, suffix = "") => request("/rest/v1/" + name + "?select=id&limit=1" + suffix);
  const userRows = bearer => request("/rest/v1/bm_memberships?select=organization_id,user_id,member_role",
    { bearer, key: publishableKey });
  const assertEmpty = async () => {
    const all = await Promise.all(TABLES.map(name => table(name)));
    const users = await request("/auth/v1/admin/users?page=1&per_page=1");
    if (all.some(rows => !Array.isArray(rows) || rows.length !== 0)
      || !users || !Array.isArray(users.users) || users.users.length !== 0) {
      throw new Error("Dedicated test project is not empty; no users were provisioned");
    }
  };
  const cleanup = async () => {
    const errors = [];
    // Memberships are deleted before organizations; never touch a tenant outside this run.
    for (const org of [...created.organizations].reverse()) {
      try {
        await request("/rest/v1/bm_memberships?organization_id=eq." + org,
          { method: "DELETE", prefer: "return=minimal" });
      } catch { errors.push("memberships"); }
    }
    for (const org of [...created.organizations].reverse()) {
      try {
        await request("/rest/v1/bm_organizations?id=eq." + org,
          { method: "DELETE", prefer: "return=minimal" });
      } catch { errors.push("organizations"); }
    }
    for (const user of [...created.users].reverse()) {
      try {
        await request("/auth/v1/admin/users/" + user.id, { method: "DELETE" });
      } catch { errors.push("Auth users"); }
    }
    return errors;
  };
  let verified = false;
  try {
    await assertEmpty(); // no fixture creation if provider or project preflight fails
    const prefix = "bidmason-acceptance-" + id();
    const identities = [
      { group: 0, role: "owner" },
      { group: 0, role: "contractor" },
      { group: 1, role: "owner" },
      { group: 1, role: "contractor" },
    ];
    for (let i = 0; i < identities.length; i++) {
      const email = prefix + "-" + i + "@example.com"; // IANA-reserved; Admin confirms without mail
      const secret = password();
      const result = await request("/auth/v1/admin/users", {
        method: "POST", body: { email, password: secret, email_confirm: true },
      });
      if (!result || !UUID.test(result.id)) throw new Error("Unverified Auth Admin identity");
      const identity = { ...identities[i], id: result.id, email, secret };
      created.users.push(identity);
    }
    for (let i = 0; i < 2; i++) {
      const org = id();
      if (!UUID.test(org)) throw new Error("Invalid synthetic organization");
      const result = await request("/rest/v1/bm_organizations", {
        method: "POST",
        prefer: "return=representation",
        body: { id: org, slug: "bm-acceptance-" + org, name: "Synthetic acceptance " + (i + 1) },
      });
      if (!Array.isArray(result) || result.length !== 1 || result[0].id !== org) {
        throw new Error("Synthetic organization creation not verified");
      }
      created.organizations.push(org);
    }
    for (const user of created.users) {
      await request("/rest/v1/bm_memberships", {
        method: "POST", prefer: "return=minimal",
        body: { organization_id: created.organizations[user.group],
          user_id: user.id, member_role: user.role },
      });
    }
    for (const user of created.users) {
      const session = await request("/auth/v1/token?grant_type=password", {
        method: "POST", body: { email: user.email, password: user.secret },
        bearer: publishableKey, key: publishableKey,
      });
      if (typeof session?.access_token !== "string" || session.access_token.length < 20
        || session.user?.id !== user.id) {
        throw new Error("Genuine Supabase Auth login failed");
      }
      user.token = session.access_token;
      const rows = await userRows(user.token);
      if (!Array.isArray(rows) || rows.length !== 1
        || rows[0].organization_id !== created.organizations[user.group]
        || rows[0].user_id !== user.id || rows[0].member_role !== user.role) {
        throw new Error("Live tenant membership RLS failed");
      }
      const other = created.organizations[1 - user.group];
      const foreign = await request("/rest/v1/bm_memberships?select=organization_id&organization_id=eq." + other,
        { bearer: user.token, key: publishableKey });
      if (!Array.isArray(foreign) || foreign.length !== 0) {
        throw new Error("Cross-tenant membership RLS failed");
      }
    }
    const contractor = created.users[1];
    await request("/rest/v1/bm_memberships?organization_id=eq." +
      created.organizations[0] + "&user_id=eq." + contractor.id,
    { method: "DELETE", prefer: "return=minimal" });
    const revoked = await userRows(contractor.token);
    if (!Array.isArray(revoked) || revoked.length !== 0) {
      throw new Error("Membership revocation failed for active session");
    }
    verified = true;
  } catch (err) {
    originalFailure = err;
  } finally {
    const cleanupFailures = await cleanup();
    if (cleanupFailures.length !== 0) {
      throw new Error("Synthetic cleanup incomplete; inspect dedicated project before retry");
    }
    if (created.users.length) await assertEmpty();
  }
  if (originalFailure) throw originalFailure;
  if (!verified) throw new Error("Genuine Auth membership acceptance not established");
  return { genuineSignIns: 4, scopedMemberships: 4, foreignMembershipDenials: 4,
    revokedMembershipsDenied: 1, cleanedUsers: 4, cleanedOrganizations: 2 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.env.CI) {
    process.stderr.write("FAIL: no privileged acceptance testing in CI\n");
    process.exitCode = 1;
  } else {
    try {
      const result = await verifyLiveAuthMemberships({
        approved: process.env.BIDMASON_LIVE_AUTH_APPROVED,
        serviceKey: process.env.BIDMASON_LIVE_SERVICE_ROLE_KEY,
        publishableKey: process.env.BIDMASON_TEST_PUBLISHABLE_KEY,
      });
      process.stdout.write("PASS: genuine Supabase Auth and tenant membership isolation " +
        JSON.stringify(result) + "\n");
    } catch {
      process.stderr.write("FAIL: genuine live Auth membership acceptance incomplete; review private operator logs and cleanup\n");
      process.exitCode = 1;
    }
  }
}
