/** Exact integer-minor-unit calculations for the synthetic Harbor Coast pricing fixtures. */
export type UnitPriceInput = {
  currency: "USD";
  baseCents: number;
  quantity: number;
  minimumCents: number;
  discountBps?: number;
  surchargeBps?: number;
  directCostCents?: number;
};

export type UnitPriceResult = {
  currency: "USD";
  quantity: number;
  baseCents: number;
  surchargeCents: number;
  subtotalCents: number;
  discountCents: number;
  afterDiscountCents: number;
  minimumAdjustmentCents: number;
  pricePerUnitCents: number;
  totalCents: number;
  grossMarginBps: number | null;
};

function money(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(field + " must be a nonnegative safe integer of cents");
  }
}

function basisPoints(value: number, field: string, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(field + " must be valid integer basis points");
  }
}

function share(cents: number, bps: number): number {
  const product = cents * bps;
  if (!Number.isSafeInteger(product + 5000)) {
    throw new RangeError("Price exceeds exact minor-unit arithmetic range");
  }
  return Math.floor((product + 5000) / 10000);
}

/** Surcharges apply to base, then discounts, then the service minimum per unit. */
export function priceUnit(input: UnitPriceInput): UnitPriceResult {
  if (input.currency !== "USD") throw new RangeError("Unsupported currency");
  money(input.baseCents, "baseCents");
  money(input.minimumCents, "minimumCents");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError("quantity must be a positive integer");
  }
  const discount = input.discountBps ?? 0;
  const surcharge = input.surchargeBps ?? 0;
  basisPoints(discount, "discountBps", 10000);
  basisPoints(surcharge, "surchargeBps", 10000);

  const surchargeCents = share(input.baseCents, surcharge);
  const subtotalCents = input.baseCents + surchargeCents;
  money(subtotalCents, "subtotalCents");
  const discountCents = share(subtotalCents, discount);
  const afterDiscountCents = subtotalCents - discountCents;
  const minimumAdjustmentCents = Math.max(0, input.minimumCents - afterDiscountCents);
  const pricePerUnitCents = afterDiscountCents + minimumAdjustmentCents;
  const totalCents = pricePerUnitCents * input.quantity;
  money(totalCents, "totalCents");

  const directCost = input.directCostCents;
  if (directCost !== undefined) money(directCost, "directCostCents");
  const grossMarginBps = directCost === undefined || pricePerUnitCents === 0
    ? null : Math.round((pricePerUnitCents - directCost) * 10000 / pricePerUnitCents);
  return {
    currency: "USD", quantity: input.quantity, baseCents: input.baseCents,
    surchargeCents, subtotalCents, discountCents, afterDiscountCents,
    minimumAdjustmentCents, pricePerUnitCents, totalCents, grossMarginBps,
  };
}

/** Inclusion and per-visit billing cannot be simultaneously asserted. */
export function validateQuarterlyTouchUp(included: boolean, billedCents: number): number {
  money(billedCents, "billedCents");
  if (included && billedCents > 0) {
    throw new Error("Quarterly touch-up cannot be both included and additionally billed");
  }
  return billedCents;
}
