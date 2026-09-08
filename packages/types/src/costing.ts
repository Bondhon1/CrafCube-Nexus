/**
 * Costing and pricing engine (design doc §21-§27, §95, §96).
 *
 * Kept as pure functions with no I/O so the arithmetic can be tested directly
 * and produces identical numbers wherever it runs. §96 is emphatic that pricing
 * logic must stay visible and editable — so every step is named, and the
 * breakdown is returned rather than just a final figure.
 */

import type { Timestamp, UUID } from './entities.js';

export interface CostProfile {
  id: UUID;
  organization_id: UUID;
  name: string;
  description: string | null;
  electricity_rate_per_kwh: number;
  machine_rate_per_hour: number;
  labor_rate_per_hour: number;
  labor_minutes_per_job: number;
  packaging_cost: number;
  consumables_cost: number;
  delivery_cost: number;
  failure_rate_percent: number;
  platform_fee_percent: number;
  target_margin_percent: number;
  minimum_margin_percent: number;
  is_default: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export const PRICE_RULE_KINDS = [
  'quantity_discount',
  'multi_color_fee',
  'rush_fee',
  'margin_override',
  'minimum_price',
] as const;

export type PriceRuleKind = (typeof PRICE_RULE_KINDS)[number];

export const PRICE_RULE_LABELS: Record<PriceRuleKind, string> = {
  quantity_discount: 'Quantity discount',
  multi_color_fee: 'Multi-colour fee',
  rush_fee: 'Rush fee',
  margin_override: 'Margin override',
  minimum_price: 'Minimum price',
};

export interface PriceRule {
  id: UUID;
  organization_id: UUID;
  cost_profile_id: UUID | null;
  name: string;
  kind: PriceRuleKind;
  threshold: number | null;
  value: number;
  active: boolean;
  priority: number;
}

export type EstimateBasis = 'geometry' | 'slicer' | 'gcode' | 'manual';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRELIABLE';

export interface CostingInput {
  /** Per unit. */
  filamentGrams: number;
  /** Per unit. */
  printSeconds: number;
  /** Landed cost of the filament actually being consumed (§8). */
  costPerGram: number;
  /** Average draw while printing, not the printer's peak rating (§21). */
  powerWatts: number;
  quantity: number;
  colorCount?: number;
  rush?: boolean;
}

export interface CostBreakdown {
  materialCost: number;
  electricityCost: number;
  machineCost: number;
  laborCost: number;
  consumablesCost: number;
  packagingCost: number;
  deliveryCost: number;
  /** Subtotal before the failure allowance is applied. */
  directCost: number;
  failureReserve: number;
  trueCost: number;
}

export interface AppliedRule {
  name: string;
  kind: PriceRuleKind;
  detail: string;
}

export interface PricingResult {
  /** Per unit. */
  cost: CostBreakdown;
  /** Per unit, before rules. */
  recommendedPrice: number;
  /** Per unit floor from the minimum margin (§26). */
  minimumPrice: number;
  /** Per unit after rules. */
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  totalCost: number;
  grossProfit: number;
  marginPercent: number;
  appliedRules: AppliedRule[];
  warnings: string[];
}

function round(value: number, dp = 4): number {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * One minor currency unit. The final price is rounded to 2dp while costs carry
 * 4dp, so an at-cost quote can land a fraction of a cent under its own floor.
 * Without this tolerance every zero-margin job reports "below cost", which
 * would train operators to ignore the warning that matters.
 */
const PRICE_EPSILON = 0.01;

/**
 * Per-unit cost, following §95's order exactly.
 *
 * The failure reserve multiplies the direct cost rather than being added as a
 * flat amount: an 8% failure rate means roughly 8% more material and machine
 * time consumed overall, which scales with the job (§25).
 */
export function calculateCost(input: CostingInput, profile: CostProfile): CostBreakdown {
  const hours = Math.max(input.printSeconds, 0) / 3600;

  const materialCost = Math.max(input.filamentGrams, 0) * Math.max(input.costPerGram, 0);

  // §21: kW x hours x rate. Watts are converted once, here.
  const electricityCost =
    (Math.max(input.powerWatts, 0) / 1000) * hours * profile.electricity_rate_per_kwh;

  const machineCost = hours * profile.machine_rate_per_hour;

  // Labour is per job, not per print hour: an operator does not stand and
  // watch the printer (§23).
  const laborCost = (profile.labor_minutes_per_job / 60) * profile.labor_rate_per_hour;

  const directCost =
    materialCost +
    electricityCost +
    machineCost +
    laborCost +
    profile.consumables_cost +
    profile.packaging_cost +
    profile.delivery_cost;

  const failureReserve = directCost * (profile.failure_rate_percent / 100);

  return {
    materialCost: round(materialCost),
    electricityCost: round(electricityCost),
    machineCost: round(machineCost),
    laborCost: round(laborCost),
    consumablesCost: round(profile.consumables_cost),
    packagingCost: round(profile.packaging_cost),
    deliveryCost: round(profile.delivery_cost),
    directCost: round(directCost),
    failureReserve: round(failureReserve),
    trueCost: round(directCost + failureReserve),
  };
}

/**
 * Price from cost and margin.
 *
 * Margin is on the *selling price*, not a markup on cost, so the formula is
 * cost / (1 - margin). Treating 60% as a 1.6x markup would yield a 37.5%
 * margin — the single most common pricing error in this domain.
 *
 * A platform fee is also taken out of the selling price, so it divides rather
 * than adds; otherwise the fee itself is left unfunded.
 */
export function priceFromMargin(
  cost: number,
  marginPercent: number,
  platformFeePercent = 0,
): number {
  const margin = Math.min(Math.max(marginPercent, 0), 99.99) / 100;
  const fee = Math.min(Math.max(platformFeePercent, 0), 99.99) / 100;
  const divisor = 1 - margin - fee;
  if (divisor <= 0) return Number.POSITIVE_INFINITY;
  return round(cost / divisor, 4);
}

/** Rules run in priority order and each records what it did (§96). */
export function calculatePrice(
  input: CostingInput,
  profile: CostProfile,
  rules: PriceRule[] = [],
): PricingResult {
  const quantity = Math.max(Math.floor(input.quantity) || 1, 1);
  const cost = calculateCost(input, profile);
  const warnings: string[] = [];
  const applied: AppliedRule[] = [];

  const relevant = rules
    .filter((r) => r.active)
    .filter((r) => !r.cost_profile_id || r.cost_profile_id === profile.id)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  let margin = profile.target_margin_percent;
  for (const rule of relevant.filter((r) => r.kind === 'margin_override')) {
    if (rule.threshold === null || quantity >= rule.threshold) {
      margin = rule.value;
      applied.push({
        name: rule.name,
        kind: rule.kind,
        detail: `Target margin set to ${rule.value}%`,
      });
    }
  }

  const recommendedPrice = priceFromMargin(cost.trueCost, margin, profile.platform_fee_percent);
  const minimumPrice = priceFromMargin(
    cost.trueCost,
    profile.minimum_margin_percent,
    profile.platform_fee_percent,
  );

  let unitPrice = recommendedPrice;

  // Flat fees first, so a later percentage discount applies to the whole price.
  const extraColors = Math.max((input.colorCount ?? 1) - 1, 0);
  if (extraColors > 0) {
    for (const rule of relevant.filter((r) => r.kind === 'multi_color_fee')) {
      const fee = rule.value * extraColors;
      unitPrice += fee;
      applied.push({
        name: rule.name,
        kind: rule.kind,
        detail: `${extraColors} extra colour${extraColors > 1 ? 's' : ''} at ${rule.value} each`,
      });
    }
  }

  if (input.rush) {
    for (const rule of relevant.filter((r) => r.kind === 'rush_fee')) {
      const uplift = unitPrice * (rule.value / 100);
      unitPrice += uplift;
      applied.push({ name: rule.name, kind: rule.kind, detail: `+${rule.value}% rush` });
    }
  }

  for (const rule of relevant.filter((r) => r.kind === 'quantity_discount')) {
    if (rule.threshold !== null && quantity >= rule.threshold) {
      const discount = unitPrice * (rule.value / 100);
      unitPrice -= discount;
      applied.push({
        name: rule.name,
        kind: rule.kind,
        detail: `${rule.value}% off at ${rule.threshold}+ units`,
      });
    }
  }

  for (const rule of relevant.filter((r) => r.kind === 'minimum_price')) {
    if (unitPrice < rule.value) {
      applied.push({
        name: rule.name,
        kind: rule.kind,
        detail: `Raised to the ${rule.value} floor`,
      });
      unitPrice = rule.value;
    }
  }

  unitPrice = round(unitPrice, 2);

  // A discount that drops the price under the minimum margin is the failure
  // this engine exists to catch, so it is surfaced rather than silently fixed.
  if (unitPrice + PRICE_EPSILON < minimumPrice) {
    warnings.push(
      `Price is below the ${profile.minimum_margin_percent}% minimum margin ` +
      `(floor ${minimumPrice.toFixed(2)}).`,
    );
  }
  if (unitPrice + PRICE_EPSILON < cost.trueCost) {
    warnings.push('Price is below cost — this job would lose money.');
  }

  const totalPrice = round(unitPrice * quantity, 2);
  const totalCost = round(cost.trueCost * quantity, 2);
  const grossProfit = round(totalPrice - totalCost, 2);
  const marginPercent = totalPrice > 0 ? round((grossProfit / totalPrice) * 100, 2) : 0;

  return {
    cost,
    recommendedPrice: round(recommendedPrice, 2),
    minimumPrice: round(minimumPrice, 2),
    unitPrice,
    quantity,
    totalPrice,
    totalCost,
    grossProfit,
    marginPercent,
    appliedRules: applied,
    warnings,
  };
}

export interface Quote {
  id: UUID;
  organization_id: UUID;
  model_version_id: UUID | null;
  printer_id: UUID | null;
  cost_profile_id: UUID | null;
  label: string | null;
  quantity: number;
  basis: EstimateBasis;
  confidence: ConfidenceLevel;
  confidence_reason: string | null;
  filament_grams: number;
  print_seconds: number;
  cost_per_gram: number;
  power_watts: number;
  rates: Record<string, unknown>;
  material_cost: number;
  electricity_cost: number;
  machine_cost: number;
  labor_cost: number;
  consumables_cost: number;
  packaging_cost: number;
  delivery_cost: number;
  failure_reserve: number;
  true_cost: number;
  recommended_price: number;
  minimum_price: number;
  total_price: number;
  gross_profit: number;
  margin_percent: number;
  applied_rules: AppliedRule[];
  created_by: UUID | null;
  created_at: Timestamp;
}
