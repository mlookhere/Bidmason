/**
 * Draft company-configurable pricing prototype.
 *
 * No company rates or service names are built into this calculator. In the
 * production system, only the authenticated tenant's approved configuration
 * may be passed here. This pure function does not enforce database tenancy.
 */
export type Billing = "charged" | "included" | "pending";
export type MinimumRule = "none" | "per-line" | "quote";
export type CalculationOrder = "surcharge-then-discount" | "discount-then-surcharge";

export type ServicePriceRule = {
  label: string;
  unit: string;
  rateCents: number;
  billing: Billing;
  surchargeBps?: number;
  discountBps?: number;
  /** Optional work is never auto-included by extractor suggestions. */
  optionalAddon?: boolean;
};

export type CompanyPricePolicy = {
  policyId: string;
  currency: "USD";
  minimum: { rule: MinimumRule; cents: number };
  calculationOrder: CalculationOrder;
  services: Record<string, ServicePriceRule>;
};

export type QuoteLineInput = {
  serviceCode: string; units: number;
  /** Set only after a human explicitly accepts this optional line. */
  addonAccepted?: true;
};

export type QuotedLine = {
  serviceCode: string;
  label: string;
  unit: string;
  units: number;
  billing: "charged" | "included";
  unitPriceCents: number;
  totalCents: number;
};

export type QuoteResult = {
  policyId: string;
  currency: "USD";
  lines: QuotedLine[];
  subtotalCents: number;
  minimumAdjustmentCents: number;
  totalCents: number;
};

function cents(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(field + " must be a nonnegative safe integer");
  }
  return value;
}

function bps(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new RangeError(field + " must be between 0 and 10000 basis points");
  }
  return value;
}

function safeAdd(a: number, b: number, label: string): number {
  return cents(a + b, label);
}

function safeMultiply(a: number, b: number, label: string): number {
  return cents(a * b, label);
}

function percent(amount: number, basisPoints: number): number {
  // Use exact intermediates: amount * bps can exceed MAX_SAFE_INTEGER
  // even when the final rounded number of cents is representable.
  const scaled = (BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n;
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("percentage exceeds safe integer cents");
  }
  return Number(scaled);
}

function priceOne(rule: ServicePriceRule, order: CalculationOrder): number {
  const rate = cents(rule.rateCents, "rateCents");
  const surcharge = bps(rule.surchargeBps ?? 0, "surchargeBps");
  const discount = bps(rule.discountBps ?? 0, "discountBps");
  if (order === "surcharge-then-discount") {
    const beforeDiscount = safeAdd(rate, percent(rate, surcharge), "surcharged rate");
    return cents(beforeDiscount - percent(beforeDiscount, discount), "discounted rate");
  }
  const discounted = cents(rate - percent(rate, discount), "discounted rate");
  return safeAdd(discounted, percent(discounted, surcharge), "surcharged rate");
}

/** A caller-supplied quote line is plain, enumerable data without hidden keys. */
function canonicalQuoteLine(input: unknown): input is QuoteLineInput {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    return false;
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length < 2 || keys.length > 3
    || !Object.hasOwn(input, "serviceCode") || !Object.hasOwn(input, "units")
    || keys.some(key => typeof key !== "string"
      || !["serviceCode", "units", "addonAccepted"].includes(key))) {
    return false;
  }
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

/** Reject accessor indices and decorated arrays before iterating any quote lines.
 * Return detached, whitelisted source data so later arithmetic cannot observe
 * mutable caller-owned fields or execute custom serializers. */
export function snapshotQuoteInputs(requested: QuoteLineInput[]): QuoteLineInput[] {
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 50
    || Object.getPrototypeOf(requested) !== Array.prototype
    || Reflect.ownKeys(requested).length !== requested.length + 1) {
    throw new TypeError("One to 50 canonical services are required");
  }
  const snapshot: QuoteLineInput[] = [];
  for (let i = 0; i < requested.length; i++) {
    const element = Object.getOwnPropertyDescriptor(requested, String(i));
    if (element?.enumerable !== true || !Object.hasOwn(element, "value")
      || !canonicalQuoteLine(element.value)) {
      throw new TypeError("Quote line contains unsupported fields");
    }
    const row = element.value;
    snapshot.push({
      serviceCode: row.serviceCode, units: row.units,
      ...(Object.hasOwn(row, "addonAccepted")
        ? { addonAccepted: row.addonAccepted } : {}),
    });
  }
  return snapshot;
}

/**
 * Evaluates approved *inputs*, without guessing company-specific contracts.
 * Pricing-policy authorization and quote approval happen outside this engine.
 */
export function quoteFromPolicy(
  policy: CompanyPricePolicy,
  requested: QuoteLineInput[],
): QuoteResult {
  if (policy.currency !== "USD") throw new RangeError("Unsupported currency");
  if (!policy.policyId?.trim()) throw new TypeError("A policy identifier is required");
  if (!["none", "per-line", "quote"].includes(policy.minimum.rule)) {
    throw new TypeError("Invalid minimum rule");
  }
  if (!["surcharge-then-discount", "discount-then-surcharge"].includes(policy.calculationOrder)) {
    throw new TypeError("Invalid calculation order");
  }
  const floor = cents(policy.minimum.cents, "minimum.cents");
  if (policy.minimum.rule === "none" && floor !== 0) {
    throw new TypeError("A disabled minimum cannot have a charge");
  }
  const safeRequested = snapshotQuoteInputs(requested);
  const seen = new Set<string>();
  let subtotal = 0;
  let chargeableLines = 0;
  const lines = safeRequested.map(input => {
    // The calculator is also exported independently of the trusted review
    // workflow. Never silently tolerate caller-provided prices, approval,
    // recipient or send directives, even if the arithmetic ignores them.
    if (!canonicalQuoteLine(input)) {
      throw new TypeError("Quote line contains unsupported fields");
    }
    const { serviceCode, units, addonAccepted } = input;
    if (typeof serviceCode !== "string" || !Object.prototype.hasOwnProperty.call(policy.services, serviceCode)
        || seen.has(serviceCode)) {
      throw new TypeError("Unknown or duplicated service code");
    }
    seen.add(serviceCode);
    if (!Number.isSafeInteger(units) || units < 1) throw new RangeError("units must be a positive integer");
    const service = policy.services[serviceCode];
    if (!service || !service.label?.trim() || !service.unit?.trim()) {
      throw new TypeError("Service definition is incomplete");
    }
    if (service.optionalAddon !== undefined
      && typeof service.optionalAddon !== "boolean") {
      throw new TypeError("Invalid optional add-on policy");
    }
    if (service.optionalAddon && addonAccepted !== true) {
      throw new Error("Optional add-on requires explicit human acceptance");
    }
    if (!service.optionalAddon && Object.hasOwn(input, "addonAccepted")) {
      throw new TypeError("Cannot accept a non-optional service as an add-on");
    }
    // Rates must be valid even for included services. Avoid masking corrupt
    // configurations that might later become billable.
    const computed = priceOne(service, policy.calculationOrder);
    if (service.billing === "pending") {
      throw new Error("Unapproved service terms; no quote may be produced");
    }
    if (service.billing !== "included" && service.billing !== "charged") {
      throw new TypeError("Invalid billing policy");
    }
    if (service.billing === "charged") chargeableLines++;
    const unitPriceCents = service.billing === "included" ? 0 :
      policy.minimum.rule === "per-line" ? Math.max(computed, floor) : computed;
    const totalCents = safeMultiply(unitPriceCents, units, "line total");
    subtotal = safeAdd(subtotal, totalCents, "quote subtotal");
    return {
      serviceCode, label: service.label, unit: service.unit, units,
      billing: service.billing, unitPriceCents, totalCents,
    };
  });
  const minimumAdjustmentCents = policy.minimum.rule === "quote" && chargeableLines
    ? Math.max(0, floor - subtotal) : 0;
  return {
    policyId: policy.policyId,
    currency: "USD",
    lines, subtotalCents: subtotal, minimumAdjustmentCents,
    totalCents: safeAdd(subtotal, minimumAdjustmentCents, "quote total"),
  };
}
