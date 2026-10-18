import { createLocalClamAvScanner } from "./local-clamav-evidence-scanner.ts";
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
  const scan = createLocalClamAvScanner({ port: config.clamavPort });
  return Object.freeze({
    publishableKey: config.publishableKey,
    secretKey: config.secretKey,
    http: config.http,
    takePermit,
    scan,
  });
}
