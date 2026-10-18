import { lookupAccount, BIDMASON_SUPABASE_URL } from "./supabase-account.ts";
import { downloadMemberEvidence } from "./private-evidence-download.ts";
import { readBoundedProviderJson } from "./bounded-provider-json.ts";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PATH = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|png|jpg)$/;
const BEARER = /^Bearer [A-Za-z0-9._~+/-]+={0,2}$/;
const STORAGE_PREFIX = BIDMASON_SUPABASE_URL +
  "/storage/v1/object/authenticated/bm-evidence/";

// Negative proof must never promote a late 403 or [] into verified RLS.
async function rawStorageProofStatus(
  http: typeof fetch, key: string, authorization: string, path: string,
): Promise<number> {
  const signal = AbortSignal.timeout(12_000);
  const response = await http(STORAGE_PREFIX + path, {
    method: "GET",
    headers: { apikey: key, authorization },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (signal.aborted) throw new Error("Storage proof deadline expired");
  // Cancellation may be hostile or uncooperative: do not await it.
  try { void response.body?.cancel().catch(() => {}); } catch { /* fail closed */ }
  return response.status;
}

async function rawReceiptProofRows(
  http: typeof fetch, key: string, authorization: string,
  organizationId: string, objectPath: string,
): Promise<unknown> {
  const query = new URL("/rest/v1/bm_evidence_receipts", BIDMASON_SUPABASE_URL);
  query.searchParams.set("select", "object_path");
  query.searchParams.set("organization_id", "eq." + organizationId);
  query.searchParams.set("object_path", "eq." + objectPath);
  query.searchParams.set("limit", "2");
  // One immutable 10-second provider budget covers headers AND body.
  const signal = AbortSignal.timeout(10_000);
  const response = await http(query, {
    method: "GET",
    headers: { apikey: key, authorization, accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (signal.aborted || response.status !== 200) {
    throw new Error("Receipt proof provider unavailable");
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length)
    || !Number.isSafeInteger(Number(length)) || Number(length) > 8192)) {
    throw new Error("Invalid receipt proof body length");
  }
  const rows = await readBoundedProviderJson(response.body, 8192, 10_000, signal);
  if (signal.aborted) throw new Error("Receipt proof deadline expired");
  return rows;
}

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
    let storageStatus: number;
    try {
      storageStatus = await rawStorageProofStatus(
        http, config.publishableKey, other.authorization, target.existingReceiptPath,
      );
    } catch {
      throw new Error("Unable to verify live cross-tenant Storage access");
    }
    if (![401, 403, 404].includes(storageStatus)) {
      throw new Error("Cross-tenant private Storage access was not explicitly denied");
    }

    // Raw receipt metadata RLS is independent of application middleware.
    let records: unknown;
    try {
      records = await rawReceiptProofRows(
        http, config.publishableKey, other.authorization,
        target.organizationId, target.existingReceiptPath,
      );
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

export type SameTenantProofConfig = {
  publishableKey: string;
  /** Existing verified uploader and receipt; never create fixtures here. */
  uploader: EvidenceProofSession;
  /** A distinct, currently signed-in NON-UPLOADER contractor in same tenant. */
  otherContractor: { authorization: string; organizationId: string };
  http?: typeof fetch;
};

export type SameTenantProofResult = {
  users: 2;
  verifiedUploaderDownloads: 1;
  blockedOtherContractorStorage: 1;
  hiddenOtherContractorReceipts: 1;
  blockedOtherContractorApplication: 1;
};

/**
 * READ ONLY: prove privacy between two independent users in ONE tenant.
 * Intended for an approved, genuine two-session API probe, not default CI.
 * An outage or malformed response can never count as an access denial.
 */
export async function verifySameTenantEvidencePrivacy(
  config: SameTenantProofConfig,
): Promise<SameTenantProofResult> {
  const uploader = config?.uploader;
  const other = config?.otherContractor;
  if (!config?.publishableKey?.startsWith("sb_publishable_") ||
      !uploader || !other || !UUID.test(uploader.organizationId) ||
      other.organizationId !== uploader.organizationId ||
      !PATH.test(uploader.existingReceiptPath) ||
      uploader.existingReceiptPath.split("/")[0] !== uploader.organizationId ||
      !BEARER.test(uploader.authorization) || uploader.authorization.length > 8192 ||
      !BEARER.test(other.authorization) || other.authorization.length > 8192 ||
      uploader.authorization === other.authorization) {
    throw new TypeError("Independent same-tenant user sessions and receipt required");
  }
  const http = config.http ?? fetch;
  const first = await lookupAccount(uploader.authorization, config.publishableKey, http);
  if (first.status !== 200) throw new Error("Uploader session unavailable");
  const second = await lookupAccount(other.authorization, config.publishableKey, http);
  if (second.status !== 200) throw new Error("Other-contractor session unavailable");
  if (first.data.id === second.data.id ||
      !first.data.memberships.some(m => m.organizationId === uploader.organizationId) ||
      !second.data.memberships.some(m =>
        m.organizationId === uploader.organizationId && m.role === "contractor") ||
      second.data.memberships.some(m =>
        m.organizationId === uploader.organizationId && m.role !== "contractor")) {
    throw new Error("Distinct uploader and contractor role validation failed");
  }

  const own = await downloadMemberEvidence({
    authorization: uploader.authorization,
    organizationId: uploader.organizationId,
    objectPath: uploader.existingReceiptPath,
  }, { publishableKey: config.publishableKey, http });
  if (own.status !== 200 || own.bytes.byteLength === 0) {
    throw new Error("Uploader signed-in receipt and hash-verified Storage roundtrip failed");
  }

  // Raw Storage denial must be proven independently from the application.
  let storageStatus: number;
  try {
    storageStatus = await rawStorageProofStatus(
      http, config.publishableKey, other.authorization, uploader.existingReceiptPath,
    );
  } catch {
    throw new Error("Cannot prove same-tenant Storage denial");
  }
  if (![401, 403, 404].includes(storageStatus)) {
    throw new Error("Other contractor could access private Storage or provider failed");
  }

  let metadata: unknown;
  try {
    metadata = await rawReceiptProofRows(
      http, config.publishableKey, other.authorization,
      uploader.organizationId, uploader.existingReceiptPath,
    );
  } catch {
    throw new Error("Cannot prove same-tenant receipt metadata denial");
  }
  if (!Array.isArray(metadata) || metadata.length !== 0) {
    throw new Error("Other contractor could read private receipt metadata");
  }

  const app = await downloadMemberEvidence({
    authorization: other.authorization,
    organizationId: uploader.organizationId,
    objectPath: uploader.existingReceiptPath,
  }, { publishableKey: config.publishableKey, http });
  if (app.status !== 404) {
    throw new Error("Other contractor could use application evidence read");
  }
  return {
    users: 2,
    verifiedUploaderDownloads: 1,
    blockedOtherContractorStorage: 1,
    hiddenOtherContractorReceipts: 1,
    blockedOtherContractorApplication: 1,
  };
}
