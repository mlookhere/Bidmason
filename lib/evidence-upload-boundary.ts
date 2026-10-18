import { randomUUID } from "node:crypto";
import { EvidenceBodyInterrupted, readExactEvidenceBytes } from "./bounded-evidence-stream.ts";
import { lookupAccount } from "./supabase-account.ts";
import { prepareEvidenceReceipt } from "./evidence.ts";
import type { EvidenceContentType, EvidenceReceipt } from "./evidence.ts";
import { ingestForSignedInMember } from "./trusted-evidence-service.ts";
import type { TrustedIngestionInput, TrustedIngestionConfig } from "./trusted-evidence-service.ts";

// This is an internal request processor, NOT an enabled public endpoint.
// Missing quota or malware scanning implementation MUST block every upload.
const LIMIT = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ALLOWED = new Set<EvidenceContentType>([
  "application/pdf", "image/png", "image/jpeg",
]);

export type EvidenceUploadDependencies = TrustedIngestionConfig & {
  /** Mandatory durable/distributed quota. Never substitute process-local counters. */
  takePermit?: (userId: string, organizationId: string) => Promise<boolean>;
  /** Mandatory trusted malware scanner. Only an explicit clean result proceeds. */
  scan?: (bytes: Uint8Array, contentType: EvidenceContentType, signal?: AbortSignal) => Promise<"clean" | "unsafe">;
  /** Test seam for the existing trusted internal ingestion service. */
  ingest?: (input: TrustedIngestionInput, config: TrustedIngestionConfig) => Promise<EvidenceReceipt>;
};

export type UploadOutcome =
  | { status: 201; receipt: EvidenceReceipt }
  | { status: 400 | 401 | 404 | 408 | 411 | 413 | 415 | 422 | 429 | 502 | 503; error: string };

function fail(status: Exclude<UploadOutcome["status"], 201>, error: string): UploadOutcome {
  return { status, error };
}


/**
 * Bounded internal bridge between a raw authenticated HTTP request and the
 * existing private Storage + verified-receipt service. No CORS, HTML, multipart,
 * user-supplied actor, object path, secret or trust in Content-Length alone.
 */
export async function processEvidenceUpload(
  request: Request,
  deps: EvidenceUploadDependencies,
): Promise<UploadOutcome> {
  if (!deps.publishableKey?.startsWith("sb_publishable_")
    || !deps.secretKey?.startsWith("sb_secret_")
    || typeof deps.takePermit !== "function" || typeof deps.scan !== "function") {
    return fail(503, "Evidence ingestion is not configured");
  }
  const organizationId = request.headers.get("x-bidmason-organization");
  if (!organizationId || !UUID.test(organizationId)) {
    return fail(400, "Invalid evidence organization");
  }
  const contentType = request.headers.get("content-type") as EvidenceContentType | null;
  if (!contentType || !ALLOWED.has(contentType)) {
    return fail(415, "Unsupported evidence type");
  }
  const advertised = request.headers.get("content-length");
  if (advertised === null) return fail(411, "Evidence length is required");
  if (!/^\d+$/.test(advertised) || !Number.isSafeInteger(Number(advertised))) {
    return fail(400, "Invalid evidence length");
  }
  const length = Number(advertised);
  if (length === 0) return fail(400, "Empty evidence document");
  if (length > LIMIT) return fail(413, "Evidence exceeds upload limit");

  const authorization = request.headers.get("authorization");
  const account = await lookupAccount(authorization, deps.publishableKey, deps.http);
  if (account.status !== 200) {
    return fail(account.status, account.error);
  }
  if (!account.data.memberships.some(member => member.organizationId === organizationId)) {
    return fail(404, "Evidence organization not found");
  }
  try {
    // Quota BEFORE reading the request body or invoking a scanner/provider.
    if ((await deps.takePermit(account.data.id, organizationId)) !== true) {
      return fail(429, "Evidence upload quota exceeded");
    }
  } catch {
    return fail(503, "Evidence quota unavailable");
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await readExactEvidenceBytes(request.body, length, request.signal);
  } catch (error) {
    if (error instanceof EvidenceBodyInterrupted) {
      return fail(408, "Evidence request timed out or was cancelled");
    }
    return fail(400, "Evidence request could not be read");
  }
  if (!bytes) return fail(400, "Evidence content length mismatch");
  if (request.signal.aborted) {
    return fail(408, "Evidence request timed out or was cancelled");
  }
  try {
    // Validate actual magic bytes using the existing centralized format policy.
    prepareEvidenceReceipt(organizationId, randomUUID(), contentType, bytes);
  } catch {
    return fail(422, "Evidence content type does not match file");
  }
  try {
    if ((await deps.scan(bytes, contentType, request.signal)) !== "clean") {
      return fail(422, "Evidence failed document safety review");
    }
  } catch {
    return fail(503, "Evidence safety scanner unavailable");
  }
  // A client can disconnect while malware scanning is in flight. An explicit
  // clean verdict is not permission to persist an abandoned upload.
  if (request.signal.aborted) {
    return fail(408, "Evidence request timed out or was cancelled");
  }
  // Ingest reauthenticates the real user and rechecks tenant authorization
  // again after private Storage readback, before any privileged receipt write.
  try {
    const receipt = await (deps.ingest ?? ingestForSignedInMember)(
      { authorization, organizationId, contentType, bytes },
      { publishableKey: deps.publishableKey, secretKey: deps.secretKey, http: deps.http },
    );
    return { status: 201, receipt };
  } catch {
    return fail(502, "Verified evidence ingestion failed");
  }
}
