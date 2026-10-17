import { createHash } from "node:crypto";

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
