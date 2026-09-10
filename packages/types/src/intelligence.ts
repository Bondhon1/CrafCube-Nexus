/**
 * Phase 6 intelligence (§11-§12, §20, §32-§34, §66, §69-§72, §84, §91).
 *
 * Everything here is arithmetic and advice, never a decision. §85 is explicit
 * that the first version must not attempt autonomous pricing or predictive-
 * failure ML, so these functions produce numbers an operator can check and
 * overrule, and return null wherever the data cannot support a claim.
 */

import type { Timestamp, UUID } from './entities.js';

// ---------------------------------------------------------------------------
// Stock forecasting and reorder advice (§11, §12, §66)
// ---------------------------------------------------------------------------

/** One row of `filament_stock_forecast`. Stock levels use `stockLevel` from
 *  inventory, so low stock means the same thing on every screen. */
export interface StockForecast {
  product_id: UUID;
  organization_id: UUID;
  name: string;
  color_hex: string | null;
  supplier: string | null;
  warn_grams: number | null;
  critical_grams: number | null;
  lead_time_days: number | null;
  safety_stock_g: number | null;
  reorder_qty_g: number | null;
  on_hand_g: number;
  reserved_g: number;
  available_g: number;
  used_30d_g: number | null;
  daily_usage_g: number | null;
  days_remaining: number | null;
}

export interface ReorderAdvice {
  /** True when stock will not survive the supplier's lead time. */
  reorder: boolean;
  /** Grams to buy, rounded up to a whole spool, or null when nothing is due. */
  quantityGrams: number | null;
  /** Days left before the order must be placed, floored at zero. */
  orderWithinDays: number | null;
  reason: string;
}

/**
 * §12: turn stock, usage and lead time into an actual instruction.
 *
 * The rule is simple and stated rather than tuned: stock must cover the
 * supplier's lead time plus the safety stock the shop chose to hold. If it
 * does not, order enough to get back above that line, rounded up to whole
 * spools because that is how filament is sold.
 */
export function reorderAdvice(
  row: Pick<StockForecast,
    'available_g' | 'daily_usage_g' | 'lead_time_days' | 'safety_stock_g' | 'reorder_qty_g'>,
  spoolGrams = 1000,
): ReorderAdvice {
  const usage = row.daily_usage_g;
  const available = row.available_g;

  if (usage === null || usage <= 0) {
    return {
      reorder: false,
      quantityGrams: null,
      orderWithinDays: null,
      // No usage in the window is not the same as no demand — it is no
      // evidence, and a forecast built on none of it would be invented.
      reason: 'No recorded usage in the last 30 days, so there is nothing to forecast from.',
    };
  }

  const leadDays = row.lead_time_days ?? 0;
  const safety = row.safety_stock_g ?? 0;
  const needed = usage * leadDays + safety;

  if (available > needed) {
    const slack = (available - needed) / usage;
    return {
      reorder: false,
      quantityGrams: null,
      orderWithinDays: Math.floor(slack),
      reason: leadDays > 0
        ? `Covers the ${leadDays}-day lead time with ${Math.floor(slack)} days to spare.`
        : `About ${Math.floor(available / usage)} days of stock left.`,
    };
  }

  // Buy back up to the cover line, plus a month of usage so the next order is
  // not due again immediately.
  const target = needed + usage * 30;
  const shortfall = Math.max(target - available, 0);
  const spool = row.reorder_qty_g ?? spoolGrams;
  const quantity = Math.max(Math.ceil(shortfall / spool) * spool, spool);
  const daysOfCover = available / usage;

  return {
    reorder: true,
    quantityGrams: quantity,
    orderWithinDays: Math.max(Math.floor(daysOfCover - leadDays), 0),
    reason: leadDays > 0
      ? `${daysOfCover.toFixed(1)} days of stock against a ${leadDays}-day lead time.`
      : `${daysOfCover.toFixed(1)} days of stock left.`,
  };
}

// ---------------------------------------------------------------------------
// Printer analytics, utilisation and ROI (§32, §70, §72)
// ---------------------------------------------------------------------------

/** One row of `printer_analytics`. */
export interface PrinterAnalytics {
  printer_id: UUID;
  organization_id: UUID;
  name: string;
  status: string;
  purchase_cost: number | null;
  purchased_at: string | null;
  finished_jobs: number;
  successful_jobs: number;
  failed_jobs: number;
  success_rate: number | null;
  print_seconds: number;
  filament_grams: number;
  maintenance_cost: number;
  downtime_hours: number;
  last_maintenance_on: string | null;
  next_due_on: string | null;
}

/**
 * §70: share of available hours the machine actually printed.
 *
 * Availability counts from the purchase date, not from the first job — a
 * printer idle for its first month was still capital sitting on a bench, and
 * hiding that flatters the number.
 */
export function utilizationPercent(
  printSeconds: number,
  purchasedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!purchasedAt) return null;
  const start = new Date(purchasedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const availableHours = (now.getTime() - start) / 3_600_000;
  if (availableHours <= 0) return null;
  return Number(Math.min((printSeconds / 3600 / availableHours) * 100, 100).toFixed(2));
}

/**
 * §72: how much of the machine has paid for itself.
 *
 * Returns null without a purchase cost. Reporting "∞% ROI" for a printer
 * whose cost was never entered is worse than reporting nothing.
 */
export function machineRoi(
  profitAttributable: number,
  purchaseCost: number | null,
): { percent: number; recovered: number; remaining: number } | null {
  if (!purchaseCost || purchaseCost <= 0) return null;
  const recovered = Math.min(profitAttributable, purchaseCost);
  return {
    percent: Number(((profitAttributable / purchaseCost) * 100).toFixed(1)),
    recovered: Number(recovered.toFixed(2)),
    remaining: Number(Math.max(purchaseCost - profitAttributable, 0).toFixed(2)),
  };
}

/** §71: prints needed before a machine has covered its own cost. */
export function breakEvenPrints(
  investment: number,
  contributionPerPrint: number,
): number | null {
  if (investment <= 0) return 0;
  // A print that contributes nothing never breaks even, however many you run.
  if (contributionPerPrint <= 0) return null;
  return Math.ceil(investment / contributionPerPrint);
}

// ---------------------------------------------------------------------------
// KPIs (§69)
// ---------------------------------------------------------------------------

/** One row of `business_kpis`. */
export interface BusinessKpis {
  organization_id: UUID;
  month: string;
  revenue: number | null;
  gross_profit: number | null;
  net_profit: number | null;
  gross_margin: number | null;
  print_seconds: number;
  filament_grams: number;
  finished_jobs: number;
  failure_rate: number | null;
  orders: number;
  average_order_value: number | null;
  profit_per_machine_hour: number | null;
  profit_per_gram: number | null;
}

/** §69's two headline efficiency metrics. Null when the denominator is zero. */
export function perUnit(profit: number | null, denominator: number): number | null {
  if (profit === null || denominator <= 0) return null;
  return Number((profit / denominator).toFixed(4));
}

// ---------------------------------------------------------------------------
// Failure and waste (§33, §34, §53)
// ---------------------------------------------------------------------------

export interface FailureAnalytics {
  organization_id: UUID;
  reason: string;
  failures: number;
  wasted_grams: number;
  share_of_failures: number | null;
}

export interface ModelReliability {
  model_id: UUID;
  organization_id: UUID;
  name: string;
  finished_jobs: number;
  failed_jobs: number;
  failure_rate: number | null;
}

export interface WasteAnalytics {
  organization_id: UUID;
  month: string;
  product_grams: number;
  waste_grams: number;
  sample_grams: number;
  drying_grams: number;
  total_grams: number;
  waste_value: number;
}

/** §53: the share of filament consumed outside a finished product. */
export function wasteSharePercent(row: Pick<WasteAnalytics,
  'product_grams' | 'total_grams'>): number | null {
  if (row.total_grams <= 0) return null;
  return Number((((row.total_grams - row.product_grams) / row.total_grams) * 100).toFixed(1));
}

export type RiskBand = 'low' | 'medium' | 'high' | 'unknown';

export interface RiskAssessment {
  band: RiskBand;
  percent: number | null;
  reasons: string[];
}

/**
 * §34, deliberately not the ML model that section imagines.
 *
 * §85 rules out predictive-failure ML in the first version, so this is a
 * transparent heuristic over three things the shop already measures: how often
 * this model has failed, how often this printer fails, and how long the print
 * runs. Every contribution is named in `reasons`, and §34 requires the result
 * to stay advisory — nothing here blocks the operator.
 *
 * Below `minimumSamples` completed jobs the band is 'unknown': a failure rate
 * from two prints is noise wearing a percentage sign.
 */
export function estimateRisk(input: {
  modelFailureRate: number | null;
  modelSamples: number;
  printerFailureRate: number | null;
  printerSamples: number;
  printSeconds: number;
  minimumSamples?: number;
}): RiskAssessment {
  const minimum = input.minimumSamples ?? 5;
  const reasons: string[] = [];

  const modelUsable = input.modelSamples >= minimum && input.modelFailureRate !== null;
  const printerUsable = input.printerSamples >= minimum && input.printerFailureRate !== null;
  const hours = input.printSeconds / 3600;

  if (!modelUsable && !printerUsable) {
    return {
      band: 'unknown',
      percent: null,
      reasons: [`Fewer than ${minimum} finished jobs to judge from.`],
    };
  }

  // Base rate: the model's own history if we have it, otherwise the printer's.
  let percent: number;
  if (modelUsable) {
    percent = input.modelFailureRate as number;
    reasons.push(
      `This model has failed ${(input.modelFailureRate as number).toFixed(1)}% of ` +
      `${input.modelSamples} prints.`,
    );
    if (printerUsable) {
      // Blend, weighted towards the model: the part is the better predictor,
      // but a troubled machine still moves the number.
      percent = percent * 0.7 + (input.printerFailureRate as number) * 0.3;
      reasons.push(
        `This printer fails ${(input.printerFailureRate as number).toFixed(1)}% of the time.`,
      );
    }
  } else {
    percent = input.printerFailureRate as number;
    reasons.push(
      `No history for this model; using the printer's ` +
      `${(input.printerFailureRate as number).toFixed(1)}% failure rate.`,
    );
  }

  // Long prints have more chances to go wrong and more to lose when they do.
  if (hours >= 8) {
    percent *= 1.25;
    reasons.push(`${hours.toFixed(1)}h print — long runs have more to go wrong.`);
  } else if (hours >= 4) {
    percent *= 1.1;
    reasons.push(`${hours.toFixed(1)}h print.`);
  }

  percent = Math.min(Number(percent.toFixed(1)), 95);
  const band: RiskBand = percent >= 15 ? 'high' : percent >= 7 ? 'medium' : 'low';
  return { band, percent, reasons };
}

// ---------------------------------------------------------------------------
// Batch strategy (§20)
// ---------------------------------------------------------------------------

export interface BatchStrategy {
  /** Objects placed on one plate. */
  perPlate: number;
  plates: number;
  /** Copies actually produced; may exceed the target when it fills a plate. */
  produced: number;
  totalSeconds: number;
  totalGrams: number;
  risk: 'Low' | 'Medium' | 'Higher';
  note: string;
}

/**
 * §20: compare "one at a time" against fuller plates.
 *
 * Material barely changes with batching; time does, because each plate pays
 * the heat-up and first-layer overhead once rather than per object. That
 * saving is what `setupSeconds` models. Risk rises the other way: a plate of
 * ten that fails loses ten, so the doc's own table marks fuller plates
 * riskier, and this returns the trade-off rather than picking a winner.
 */
export function batchStrategies(
  quantity: number,
  unitSeconds: number,
  unitGrams: number,
  options: { setupSeconds?: number; maxPerPlate?: number } = {},
): BatchStrategy[] {
  if (quantity <= 0 || unitSeconds <= 0) return [];

  const setup = options.setupSeconds ?? 600;
  const maxPerPlate = Math.max(options.maxPerPlate ?? 10, 1);

  const candidates = [...new Set([1, 2, 4, Math.min(10, maxPerPlate), maxPerPlate]
    .filter((n) => n >= 1 && n <= maxPerPlate && n <= quantity))]
    .sort((a, b) => a - b);

  return candidates.map((perPlate) => {
    const plates = Math.ceil(quantity / perPlate);
    const produced = plates * perPlate;
    return {
      perPlate,
      plates,
      produced,
      totalSeconds: Math.round(plates * (setup + perPlate * unitSeconds)),
      totalGrams: Number((produced * unitGrams).toFixed(2)),
      risk: perPlate === 1 ? 'Low' : perPlate <= 4 ? 'Medium' : 'Higher',
      note: perPlate === 1
        ? 'A failure costs one copy.'
        : `A failure costs up to ${perPlate} copies.`,
    };
  });
}

// ---------------------------------------------------------------------------
// Maintenance and consumables (§54, §55)
// ---------------------------------------------------------------------------

export const MAINTENANCE_KINDS = [
  'routine', 'repair', 'upgrade', 'calibration', 'cleaning', 'part_replacement',
] as const;

export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  routine: 'Routine',
  repair: 'Repair',
  upgrade: 'Upgrade',
  calibration: 'Calibration',
  cleaning: 'Cleaning',
  part_replacement: 'Part replacement',
};

export interface MaintenanceRecord {
  id: UUID;
  organization_id: UUID;
  printer_id: UUID;
  kind: MaintenanceKind;
  performed_on: string;
  downtime_hours: number;
  cost: number;
  description: string | null;
  next_due_on: string | null;
  performed_by: UUID | null;
  created_at: Timestamp;
}

export interface Consumable {
  id: UUID;
  organization_id: UUID;
  name: string;
  unit: string;
  on_hand: number;
  reorder_point: number | null;
  unit_cost: number;
  supplier: string | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ConsumableTransaction {
  id: UUID;
  organization_id: UUID;
  consumable_id: UUID;
  quantity: number;
  unit_cost: number | null;
  reason: string | null;
  actor_id: UUID | null;
  created_at: Timestamp;
}

// ---------------------------------------------------------------------------
// Calibration (§84)
// ---------------------------------------------------------------------------

/** One row of `calibration_samples`. */
export interface CalibrationSample {
  organization_id: UUID;
  printer_id: UUID;
  printer_name: string;
  material_id: UUID | null;
  material_name: string | null;
  samples: number;
  material_error_percent: number | null;
  time_error_percent: number | null;
}
