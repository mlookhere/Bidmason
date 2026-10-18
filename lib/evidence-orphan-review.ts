/**
 * Read-only evidence reconciliation. This module NEVER removes Storage objects.
 * Inputs MUST be complete, privileged snapshots of the fixed private bucket
 * and the trusted receipt table, not RLS-filtered end-user query results.
 */
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PATH = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|png|jpg)$/;
const HOUR = 60 * 60 * 1000;
const MIN_AGE = 24 * HOUR;
const MAX_ENTRIES = 100_000;

export type StorageEvidenceSnapshot = {
  bucketId: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceReceiptSnapshot = {
  organizationId: string;
  path: string;
};

export type ReconciliationResult = {
  // Only a review list; it never authorizes deletion.
  candidates: { organizationId: string; path: string; ageHours: number }[];
  retained: number;
  reviewed: number;
};

export function planEvidenceReconciliation(input: {
  objects: readonly StorageEvidenceSnapshot[];
  receipts: readonly EvidenceReceiptSnapshot[];
  objectsComplete: boolean;
  receiptsComplete: boolean;
  now: Date;
}): ReconciliationResult {
  if (input.objectsComplete !== true || input.receiptsComplete !== true) {
    throw new Error("Complete privileged evidence inventories required");
  }
  if (!Array.isArray(input.objects) || !Array.isArray(input.receipts)
    || input.objects.length > MAX_ENTRIES || input.receipts.length > MAX_ENTRIES
    || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new TypeError("Invalid evidence reconciliation snapshot");
  }
  const receipts = new Set<string>();
  for (const receipt of input.receipts) {
    if (!receipt || !UUID.test(receipt.organizationId) || !PATH.test(receipt.path)
      || PATH.exec(receipt.path)?.[1] !== receipt.organizationId
      || receipts.has(receipt.path)) {
      throw new TypeError("Invalid, cross-tenant or duplicate receipt snapshot");
    }
    receipts.add(receipt.path);
  }
  const paths = new Set<string>();
  const candidates: ReconciliationResult["candidates"] = [];
  let retained = 0;
  for (const object of input.objects) {
    const parsed = object && PATH.exec(object.path);
    if (!object || object.bucketId !== "bm-evidence" || !parsed || paths.has(object.path)) {
      throw new TypeError("Invalid bucket, object path or duplicate Storage entry");
    }
    paths.add(object.path);
    const created = Date.parse(object.createdAt);
    const updated = Date.parse(object.updatedAt);
    if (!Number.isFinite(created) || !Number.isFinite(updated)
      || created > updated || updated > input.now.getTime()) {
      throw new TypeError("Invalid evidence Storage timestamps");
    }
    const ageMs = input.now.getTime() - updated;
    // A receipt, a recent upload, or recently modified Storage metadata
    // must never be classified as an orphan eligible for any action.
    if (receipts.has(object.path) || ageMs < MIN_AGE) {
      retained++;
      continue;
    }
    candidates.push({
      organizationId: parsed[1],
      path: object.path,
      ageHours: Math.floor(ageMs / HOUR),
    });
  }
  // Stable output for durable operator review; classification is advisory only.
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates, retained, reviewed: input.objects.length };
}
