import { companyPolicySha256 } from "./company-policy-fingerprint.ts";
import { quoteFromPolicy, type CompanyPricePolicy, type QuoteLineInput,
  type QuoteResult } from "./company-pricing.ts";

/** A pure calculation input, NOT proof of tenant authorization or approval. */
export type VersionedEconomicsPolicy = {
  revision: number;
  pricing: CompanyPricePolicy;
  tax: { method: "none" | "exclusive-all-charged"; bps: number };
  excludedServiceCodes?: string[];
  unitDirectCostsCents?: Record<string, number>;
};

export type EconomicsPreview = {
  state: "preview-only";
  policyId: string;
  policyRevision: number;
  policySha256: string;
  quote: QuoteResult;
  taxCents: number;
  totalWithTaxCents: number;
  estimatedDirectCostsCents: number | null;
  estimatedGrossMarginBps: number | null;
};

function nonnegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(name + " must be a nonnegative safe integer");
  }
  return value;
}

function add(a: number, b: number, name: string): number {
  return nonnegative(a + b, name);
}

function multiply(a: number, b: number, name: string): number {
  return nonnegative(a * b, name);
}

function roundedRate(amount: number, bps: number): number {
  const cents = (BigInt(amount) * BigInt(bps) + 5000n) / 10000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Tax exceeds safe integer cents");
  }
  return Number(cents);
}

/**
 * Computes a never-sendable economics preview using a supplied company policy.
 * Policy lookup, tenant authorization, revision approval and tax-law choices
 * MUST be performed by a separate trusted backend before it is used publicly.
 */
export function previewCompanyEconomics(
  config: VersionedEconomicsPolicy, requested: QuoteLineInput[],
): EconomicsPreview {
  if (!config || !Number.isSafeInteger(config.revision) || config.revision < 1
    || !config.tax || !["none", "exclusive-all-charged"].includes(config.tax.method)
    || !Number.isSafeInteger(config.tax.bps)
    || config.tax.bps < 0 || config.tax.bps > 10000
    || (config.tax.method === "none" && config.tax.bps !== 0)) {
    throw new TypeError("An explicit valid versioned tax policy is required");
  }
  const excluded = config.excludedServiceCodes ?? [];
  if (!Array.isArray(excluded) || excluded.some(code => typeof code !== "string"
    || !Object.hasOwn(config.pricing?.services ?? {}, code))
    || new Set(excluded).size !== excluded.length) {
    throw new TypeError("Invalid company service exclusions");
  }
  if (!Array.isArray(requested) || requested.some(input => excluded.includes(input.serviceCode))) {
    throw new Error("Company-excluded service cannot be quoted");
  }
  const quote = quoteFromPolicy(config.pricing, requested);
  // Only whole-quote tax is supported in this early version. Never guess
  // taxable allocation across mixed-exempt items or minimum adjustments.
  const taxCents = config.tax.method === "exclusive-all-charged"
    ? roundedRate(quote.totalCents, config.tax.bps) : 0;
  const totalWithTaxCents = add(quote.totalCents, taxCents, "tax-inclusive total");
  let estimatedDirectCostsCents: number | null = null;
  let estimatedGrossMarginBps: number | null = null;
  if (config.unitDirectCostsCents !== undefined) {
    if (!config.unitDirectCostsCents || typeof config.unitDirectCostsCents !== "object"
      || Array.isArray(config.unitDirectCostsCents)) {
      throw new TypeError("Invalid company unit direct costs");
    }
    let costs = 0;
    for (const line of quote.lines) {
      if (!Object.hasOwn(config.unitDirectCostsCents, line.serviceCode)) {
        throw new Error("Missing direct cost for reviewed service");
      }
      const unit = nonnegative(config.unitDirectCostsCents[line.serviceCode],
        "unit direct cost");
      costs = add(costs, multiply(unit, line.units, "line direct costs"),
        "total direct costs");
    }
    estimatedDirectCostsCents = costs;
    if (quote.totalCents > 0) {
      // Signed gross margin can be negative. Tax is excluded from revenue.
      const numerator = (BigInt(quote.totalCents) - BigInt(costs)) * 10000n;
      const denominator = BigInt(quote.totalCents);
      const rounded = (numerator >= 0n ? numerator + denominator / 2n
        : numerator - denominator / 2n) / denominator;
      if (rounded > BigInt(Number.MAX_SAFE_INTEGER)
        || rounded < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new RangeError("Gross margin exceeds safe numeric range");
      }
      estimatedGrossMarginBps = Number(rounded);
    }
  }
  return {
    state: "preview-only",
    policyId: quote.policyId,
    policyRevision: config.revision,
    policySha256: companyPolicySha256(config),
    quote, taxCents, totalWithTaxCents,
    estimatedDirectCostsCents, estimatedGrossMarginBps,
  };
}
