import { createHash } from "node:crypto";
import { lookupAccount, BIDMASON_SUPABASE_URL } from "./supabase-account.ts";
import { createSupabaseEvidencePort } from "./supabase-evidence-port.ts";
import type { EvidenceContentType, EvidenceReceipt } from "./evidence.ts";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PATH = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|png|jpg)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TYPES: Record<string, EvidenceContentType> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg",
};
const MAX_BYTES = 15 * 1024 * 1024;

type DownloadResult =
  | { status: 200; bytes: Uint8Array; contentType: EvidenceContentType }
  | { status: 400 | 401 | 404 | 502 | 503; error: string };

/**
 * Private, member-authenticated alternative to nonrevocable signed URLs.
 * Never accepts a client-controlled origin, bucket, receipt hash or service key.
 */
export async function downloadMemberEvidence(
  input: { authorization: string | null; organizationId: string | null; objectPath: string | null },
  config: { publishableKey: string | undefined; http?: typeof fetch },
): Promise<DownloadResult> {
  const { organizationId, objectPath } = input;
  const path = objectPath && PATH.exec(objectPath);
  if (!organizationId || !UUID.test(organizationId) || !path || path[1] !== organizationId) {
    return { status: 400, error: "Invalid evidence reference" };
  }
  const account = await lookupAccount(input.authorization, config.publishableKey, config.http);
  if (account.status !== 200) return { status: account.status, error: account.error };
  if (!account.data.memberships.some(m => m.organizationId === organizationId)) {
    return { status: 404, error: "Evidence not found" };
  }
  const token = input.authorization!.slice("Bearer ".length);
  const http = config.http ?? fetch;
  const query = new URL("/rest/v1/bm_evidence_receipts", BIDMASON_SUPABASE_URL);
  query.searchParams.set("select", "organization_id,object_path,content_sha256,byte_length,content_type");
  query.searchParams.set("organization_id", "eq." + organizationId);
  query.searchParams.set("object_path", "eq." + objectPath);
  query.searchParams.set("limit", "1");
  try {
    const result = await http(query, {
      headers: {
        apikey: config.publishableKey!,
        Authorization: input.authorization!,
        accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (result.status === 401 || result.status === 403) {
      return { status: 401, error: "Authentication failed" };
    }
    if (!result.ok) return { status: 502, error: "Evidence metadata unavailable" };
    const rows: unknown = await result.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { status: 404, error: "Evidence not found" };
    }
    if (rows.length !== 1) return { status: 502, error: "Invalid evidence metadata" };
    const receipt = rows[0] as Partial<EvidenceReceipt> | null;
    if (!receipt || receipt.organization_id !== organizationId
      || receipt.object_path !== objectPath
      || !SHA256.test(receipt.content_sha256 ?? "")
      || !Number.isSafeInteger(receipt.byte_length)
      || (receipt.byte_length ?? 0) < 1 || (receipt.byte_length ?? 0) > MAX_BYTES
      || receipt.content_type !== TYPES[path[2]]) {
      return { status: 502, error: "Invalid evidence metadata" };
    }
    // The existing port enforces the exact byte budget for private downloads.
    // This read-only operation cannot issue a privileged receipt.
    const port = createSupabaseEvidencePort({
      publishableKey: config.publishableKey!,
      accessToken: token,
      issueTrustedReceipt: async () => { throw new Error("Read-only evidence access"); },
      http,
    });
    const bytes = await port.readBackPrivate(account.data.id, receipt as EvidenceReceipt);
    if (createHash("sha256").update(bytes).digest("hex") !== receipt.content_sha256) {
      return { status: 502, error: "Private evidence integrity check failed" };
    }
    // Read membership again: revocation during the asynchronous download
    // must not result in the file being returned to the caller.
    const current = await lookupAccount(input.authorization, config.publishableKey, http);
    if (current.status !== 200 || current.data.id !== account.data.id
      || !current.data.memberships.some(m => m.organizationId === organizationId)) {
      return { status: 401, error: "Evidence authorization expired" };
    }
    return { status: 200, bytes, contentType: receipt.content_type! };
  } catch {
    return { status: 502, error: "Private evidence service unavailable" };
  }
}
