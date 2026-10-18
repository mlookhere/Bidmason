import { lookupAccount, BIDMASON_SUPABASE_URL } from "./supabase-account.ts";
import { downloadMemberEvidence } from "./private-evidence-download.ts";
import { readBoundedProviderJson } from "./bounded-provider-json.ts";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PATH = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|png|jpg)$/;
const BEARER = /^Bearer [A-Za-z0-9._~+/-]+={0,2}$/;
const STORAGE_PREFIX = BIDMASON_SUPABASE_URL +
  "/storage/v1/object/authenticated/bm-evidence/";

export type EvidenceProofSession = {
  authorization: string;
  organizationId: string;
  existingReceiptPath: string;
};

export type EvidenceProofConfig = {
  publishableKey: string;
  first: EvidenceProofSession;
  second: EvidenceProofSession;
  http?: typeof fetch;
};

type ProofResult = {
  users: 2;
  ownedVerifiedDownloads: 2;
  deniedCrossTenantStorageReads: 2;
  hiddenForeignReceipts: 2;
  deniedApplicationCrossTenantReads: 2;
};

/**
 * Live, read-only two-session validation. Needs two EXISTING authorized test
 * users and two EXISTING hash-verified receipts; NEVER creates/deletes accounts,
 * memberships, receipts or files. Do not mistake mocked tests for live proof.
 */
export async function verifyLiveEvidenceIsolation(
  config: EvidenceProofConfig,
): Promise<ProofResult> {
  if (!config || !config.publishableKey?.startsWith("sb_publishable_")) {
    throw new TypeError("Approved BidMason publishable key required");
  }
  const pairs = [config.first, config.second] as const;
  for (const pair of pairs) {
    if (!pair || !UUID.test(pair.organizationId)
      || !PATH.test(pair.existingReceiptPath)
      || PATH.exec(pair.existingReceiptPath)?.[1] !== pair.organizationId
      || !BEARER.test(pair.authorization) || pair.authorization.length > 8192) {
      throw new TypeError("Canonical tenant, receipt and bearer session required");
    }
  }
  if (config.first.organizationId === config.second.organizationId
    || config.first.authorization === config.second.authorization
    || config.first.existingReceiptPath === config.second.existingReceiptPath) {
    throw new TypeError("Two independent signed-in tenant fixtures required");
  }
  const http = config.http ?? fetch;
  const accounts = [];
  for (const pair of pairs) {
    const result = await lookupAccount(pair.authorization, config.publishableKey, http);
    if (result.status !== 200) throw new Error("Actual Supabase Auth session failed");
    accounts.push(result.data);
  }
  if (accounts[0].id === accounts[1].id
    || accounts.some((account, i) =>
      !account.memberships.some(m => m.organizationId === pairs[i].organizationId)
      || account.memberships.some(m => m.organizationId === pairs[1 - i].organizationId))) {
    throw new Error("Two separately authorized tenants and distinct identities required");
  }

  // For every existing receipt, prove its owner can retrieve hash-verified bytes
  // through the actual server code, rather than using a signed URL.
  for (const pair of pairs) {
    const own = await downloadMemberEvidence({
      authorization: pair.authorization,
      organizationId: pair.organizationId,
      objectPath: pair.existingReceiptPath,
    }, { publishableKey: config.publishableKey, http });
    if (own.status !== 200 || own.bytes.byteLength < 1) {
      throw new Error("Real own-tenant receipt and private Storage roundtrip failed");
    }
  }

  // Independent raw Storage RLS tests: bypass the application's membership
  // precheck and ask Storage directly with each OTHER user's genuine JWT.
  for (let i = 0; i < 2; i++) {
    const other = pairs[1 - i];
    const target = pairs[i];
    let response: Response;
    try {
      response = await http(STORAGE_PREFIX + target.existingReceiptPath, {
        method: "GET",
        headers: {
          apikey: config.publishableKey,
          authorization: other.authorization,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new Error("Unable to verify live cross-tenant Storage access");
    }
    // Never await a broken Storage provider's cancellation callback.
    try { void response.body?.cancel().catch(() => {}); } catch { /* fail closed */ }
    if (![401, 403, 404].includes(response.status)) {
      throw new Error("Cross-tenant private Storage access was not explicitly denied");
    }

    // Test actual PostgREST receipt RLS as the foreign JWT, independently
    // from the application middleware. An empty filtered result is required.
    const query = new URL("/rest/v1/bm_evidence_receipts", BIDMASON_SUPABASE_URL);
    query.searchParams.set("select", "object_path");
    query.searchParams.set("organization_id", "eq." + target.organizationId);
    query.searchParams.set("object_path", "eq." + target.existingReceiptPath);
    const result = await http(query, {
      method: "GET",
      headers: {
        apikey: config.publishableKey,
        authorization: other.authorization,
        accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!result.ok) throw new Error("Unable to verify cross-tenant receipt RLS");
    let records: unknown;
    try {
      const length = result.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length)
        || !Number.isSafeInteger(Number(length)) || Number(length) > 8192)) {
        throw new Error("Invalid foreign receipt response length");
      }
      records = await readBoundedProviderJson(result.body, 8192, 10_000);
    } catch {
      throw new Error("Unable to verify cross-tenant receipt RLS");
    }
    if (!Array.isArray(records) || records.length !== 0) {
      throw new Error("Cross-tenant receipt metadata was exposed");
    }

    // Application-level non-disclosure is a separate invariant from raw RLS.
    const filtered = await downloadMemberEvidence({
      authorization: other.authorization,
      organizationId: target.organizationId,
      objectPath: target.existingReceiptPath,
    }, { publishableKey: config.publishableKey, http });
    if (filtered.status !== 404) {
      throw new Error("Cross-tenant application-level evidence was exposed");
    }
  }
  return {
    users: 2,
    ownedVerifiedDownloads: 2,
    deniedCrossTenantStorageReads: 2,
    hiddenForeignReceipts: 2,
    deniedApplicationCrossTenantReads: 2,
  };
}
