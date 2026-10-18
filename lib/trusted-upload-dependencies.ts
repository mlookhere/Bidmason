import { createProductionClamAvScanner } from "./production-clamav-evidence-scanner.ts";
import { createSupabaseUploadPermit } from "./supabase-upload-quota.ts";
import type { EvidenceUploadDependencies } from "./evidence-upload-boundary.ts";

/**
 * Fixed trusted-server composition for the internal evidence upload boundary.
 * Caller must obtain all values from server-managed configuration, never an
 * HTTP request; no POST route or live upload service is enabled by this file.
 */
export function createTrustedEvidenceUploadDependencies(config: {
  publishableKey: string;
  secretKey: string;
  clamavPort: number;
  /** Absolute server-owned directory populated by official signed freshclam definitions. */
  clamavSignatureDirectory: string;
  http?: typeof fetch;
}): EvidenceUploadDependencies {
  if (!config.publishableKey?.startsWith("sb_publishable_")
    || !config.secretKey?.startsWith("sb_secret_")) {
    throw new TypeError("Trusted evidence keys are not configured");
  }
  // Both providers validate configuration and throw before returning anything.
  const takePermit = createSupabaseUploadPermit({
    secretKey: config.secretKey,
    http: config.http,
  });
  // A daemon clean reply alone is insufficient with stale or test-only signatures.
  const scan = createProductionClamAvScanner({
    port: config.clamavPort,
    signatureDirectory: config.clamavSignatureDirectory,
  });
  return Object.freeze({
    publishableKey: config.publishableKey,
    secretKey: config.secretKey,
    http: config.http,
    takePermit,
    scan,
  });
}
