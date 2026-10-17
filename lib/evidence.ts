import { createHash, randomUUID } from "node:crypto";

const MAX_BYTES = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const FILE_TYPES = {
  "application/pdf": { extension: "pdf", header: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  "image/png": { extension: "png", header: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  "image/jpeg": { extension: "jpg", header: [0xff, 0xd8, 0xff] },
} as const;

export type EvidenceContentType = keyof typeof FILE_TYPES;

export interface EvidenceReceipt {
  organization_id: string;
  object_path: string;
  content_sha256: string;
  byte_length: number;
  content_type: EvidenceContentType;
}

/**
 * Server-side candidate metadata only. Call AFTER verifying a private upload
 * and BEFORE a privileged insertion; this function grants no permissions.
 */
export function prepareEvidenceReceipt(
  organizationId: string,
  objectId: string,
  contentType: EvidenceContentType,
  bytes: Uint8Array,
): EvidenceReceipt {
  if (!UUID.test(organizationId) || !UUID.test(objectId)) {
    throw new TypeError("Evidence IDs must be canonical lowercase UUIDs");
  }
  const type = FILE_TYPES[contentType];
  if (!type) throw new TypeError("Unsupported evidence content type");
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new RangeError("Evidence must contain 1 to 15728640 bytes");
  }
  if (type.header.some((value, index) => bytes[index] !== value)) {
    throw new TypeError("File signature does not match declared content type");
  }
  const content_sha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  return {
    organization_id: organizationId,
    object_path: organizationId + "/" + objectId + "." + type.extension,
    content_sha256,
    byte_length: bytes.byteLength,
    content_type: contentType,
  };
}

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

// Reuse the same canonical-ID validation as receipt preparation.

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
