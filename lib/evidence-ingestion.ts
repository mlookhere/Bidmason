import { randomUUID } from "node:crypto";
import {
  prepareEvidenceReceipt,
  type EvidenceContentType,
  type EvidenceReceipt,
} from "./evidence";

/**
 * Trusted-backend workflow core, not an HTTP endpoint.
 * All callbacks must run server-side with independently verified auth and
 * tenant membership. Never give issueReceipt to a browser/client role.
 */
export type EvidenceIngestionPort = {
  authorize: (userId: string, organizationId: string) => Promise<boolean>;
  uploadPrivate: (
    userId: string, receipt: EvidenceReceipt, bytes: Uint8Array,
  ) => Promise<void>;
  readBackPrivate: (
    userId: string, receipt: EvidenceReceipt,
  ) => Promise<Uint8Array>;
  issueTrustedReceipt: (receipt: EvidenceReceipt) => Promise<void>;
};

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/**
 * Refuse to issue a server-only receipt until authorized upload bytes match
 * a fresh download byte-for-byte at the expected private object path.
 *
 * NOTE: matching a hash is not document authenticity/anti-malware scanning.
 * A failed receipt write can leave an orphan object for trusted cleanup.
 */
export async function ingestVerifiedEvidence(
  userId: string,
  organizationId: string,
  contentType: EvidenceContentType,
  suppliedBytes: Uint8Array,
  port: EvidenceIngestionPort,
  createId: () => string = randomUUID,
): Promise<EvidenceReceipt> {
  if (!UUID.test(userId) || !UUID.test(organizationId)) {
    throw new TypeError("Invalid user or organization identifier");
  }
  // Make a snapshot of caller input to prevent mutation across async calls.
  if (!(suppliedBytes instanceof Uint8Array)) {
    throw new TypeError("Expected binary input");
  }
  const bytes = Uint8Array.from(suppliedBytes);
  const objectId = createId();
  const prepared = prepareEvidenceReceipt(
    organizationId, objectId, contentType, bytes,
  );
  if (await port.authorize(userId, organizationId) !== true) {
    throw new Error("Not authorized to ingest evidence");
  }
  await port.uploadPrivate(userId, prepared, bytes);
  const downloaded = await port.readBackPrivate(userId, prepared);
  if (!(downloaded instanceof Uint8Array)) {
    throw new Error("Private Storage readback failed");
  }
  const observed = prepareEvidenceReceipt(
    organizationId, objectId, contentType, downloaded,
  );
  if (
    observed.content_sha256 !== prepared.content_sha256
    || observed.byte_length !== prepared.byte_length
    || observed.object_path !== prepared.object_path
  ) {
    throw new Error("Uploaded evidence bytes differ from private Storage");
  }
  // Final authorization check prevents a membership revoked during upload
  // from being issued a privileged receipt.
  if (await port.authorize(userId, organizationId) !== true) {
    throw new Error("Evidence authorization was revoked");
  }
  await port.issueTrustedReceipt(prepared);
  return prepared;
}
