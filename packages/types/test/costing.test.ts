import { describe, expect, it } from 'vitest';
import {
  calculateCost,
  calculatePrice,
  priceFromMargin,
  type CostProfile,
  type CostingInput,
  type PriceRule,
} from '../src/costing.js';

/** A profile with round numbers so expected values can be computed by hand. */
const profile: CostProfile = {
  id: 'profile-1',
  organization_id: 'org-1',
  name: 'Test',
  description: null,
  electricity_rate_per_kwh: 12,
  machine_rate_per_hour: 20,
  labor_rate_per_hour: 120,
  labor_minutes_per_job: 10,
  packaging_cost: 15,
  consumables_cost: 5,
  delivery_cost: 0,
  failure_rate_percent: 8,
  platform_fee_percent: 0,
  target_margin_percent: 60,
  minimum_margin_percent: 25,
  is_default: true,
  created_at: '',
  updated_at: '',
};

const input: CostingInput = {
  filamentGrams: 100,
  printSeconds: 4 * 3600,
  costPerGram: 1.35,
  powerWatts: 220,
  quantity: 1,
};

function rule(overrides: Partial<PriceRule>): PriceRule {
  return {
    id: 'r',
    organization_id: 'org-1',
    cost_profile_id: null,
    name: 'Rule',
    kind: 'quantity_discount',
    threshold: null,
    value: 0,
    active: true,
    priority: 100,
    ...overrides,
  };
}

describe('calculateCost', () => {
  const cost = calculateCost(input, profile);

  it('prices material from landed cost per gram', () => {
    // 100 g at 1.35 = 135, the doc's §8 worked example.
    expect(cost.materialCost).toBe(135);
  });

  it('prices electricity from average draw, per §21', () => {
    // 0.22 kW x 4 h = 0.88 kWh; 0.88 x 12 = 10.56 — the doc's own figure.
    expect(cost.electricityCost).toBeCloseTo(10.56, 4);
  });

  it('charges machine time by the hour', () => {
    expect(cost.machineCost).toBe(80); // 4 h x 20
  });

  it('charges labour per job, not per print hour', () => {
    // A 4-hour print does not need 4 hours of an operator's attention.
    expect(cost.laborCost).toBe(20); // 10 min at 120/h
  });

  it('sums direct cost before the failure allowance', () => {
    // 135 + 10.56 + 80 + 20 + 5 + 15 + 0
    expect(cost.directCost).toBeCloseTo(265.56, 2);
  });

  it('scales the failure reserve with the job, per §25', () => {
    expect(cost.failureReserve).toBeCloseTo(265.56 * 0.08, 2);
    expect(cost.trueCost).toBeCloseTo(265.56 * 1.08, 2);
  });

  it('never returns negative costs from bad input', () => {
    const bad = calculateCost(
      { ...input, filamentGrams: -50, printSeconds: -100, powerWatts: -5 },
      profile,
    );
    expect(bad.materialCost).toBe(0);
    expect(bad.electricityCost).toBe(0);
    expect(bad.machineCost).toBe(0);
  });
});

describe('priceFromMargin', () => {
  it('treats margin as a share of price, not a markup on cost', () => {
    // The classic error: 60% margin is NOT cost x 1.6 (that is a 37.5% margin).
    expect(priceFromMargin(100, 60)).toBe(250);
    expect(priceFromMargin(100, 60)).not.toBe(160);
  });

  it('verifies the margin it produces', () => {
    const price = priceFromMargin(265.56 * 1.08, 60);
    const margin = ((price - 265.56 * 1.08) / price) * 100;
    expect(margin).toBeCloseTo(60, 6);
  });

  it('funds a platform fee out of the price rather than leaving it unpaid', () => {
    // 50% margin + 10% fee means cost is 40% of price.
    expect(priceFromMargin(100, 50, 10)).toBe(250);
  });

  it('returns Infinity when margin and fee consume the whole price', () => {
    expect(priceFromMargin(100, 60, 40)).toBe(Number.POSITIVE_INFINITY);
  });

  it('handles a zero-margin at-cost profile', () => {
    expect(priceFromMargin(100, 0)).toBe(100);
  });
});

describe('calculatePrice', () => {
  it('reports the margin it actually achieved', () => {
    const result = calculatePrice(input, profile);
    expect(result.marginPercent).toBeCloseTo(60, 1);
    expect(result.grossProfit).toBeCloseTo(result.totalPrice - result.totalCost, 2);
  });

  it('multiplies cost and price by quantity', () => {
    const one = calculatePrice(input, profile);
    const ten = calculatePrice({ ...input, quantity: 10 }, profile);

    // Totals are rounded once, from the 4dp cost, rather than from the rounded
    // unit figure — so a few cents of difference across ten units is correct
    // and slightly more accurate than unit x quantity.
    expect(ten.totalCost).toBeCloseTo(one.totalCost * 10, 0);
    expect(ten.totalPrice).toBeCloseTo(one.totalPrice * 10, 0);
  });

  it('applies a quantity discount only at its threshold', () => {
    const rules = [rule({ kind: 'quantity_discount', threshold: 10, value: 8, name: 'Bulk' })];
    const nine = calculatePrice({ ...input, quantity: 9 }, profile, rules);
    const ten = calculatePrice({ ...input, quantity: 10 }, profile, rules);

    expect(nine.appliedRules).toHaveLength(0);
    expect(ten.appliedRules[0].name).toBe('Bulk');
    expect(ten.unitPrice).toBeCloseTo(nine.unitPrice * 0.92, 1);
  });

  it('charges per additional colour, not per colour', () => {
    const rules = [rule({ kind: 'multi_color_fee', value: 25, name: 'Colour' })];
    const single = calculatePrice({ ...input, colorCount: 1 }, profile, rules);
    const quad = calculatePrice({ ...input, colorCount: 4 }, profile, rules);

    expect(single.appliedRules).toHaveLength(0);
    expect(quad.unitPrice - single.unitPrice).toBeCloseTo(75, 1); // 3 extra x 25
  });

  it('warns when a discount breaks the minimum margin', () => {
    const rules = [
      rule({ kind: 'quantity_discount', threshold: 2, value: 70, name: 'Too generous' }),
    ];
    const result = calculatePrice({ ...input, quantity: 5 }, profile, rules);
    expect(result.warnings.join(' ')).toMatch(/minimum margin/i);
  });

  it('warns when the price falls below cost', () => {
    // An at-cost profile sets both margins to zero — the database CHECK
    // requires minimum <= target, so 0/25 is not a state that can exist.
    const atCost = { ...profile, target_margin_percent: 0, minimum_margin_percent: 0 };
    const cheap = calculatePrice(input, atCost, []);
    expect(cheap.warnings).toHaveLength(0);
    expect(cheap.unitPrice).toBeCloseTo(cheap.cost.trueCost, 1);

    const loss = calculatePrice(input, profile, [
      rule({ kind: 'quantity_discount', threshold: 1, value: 95, name: 'Fire sale' }),
    ]);
    expect(loss.warnings.join(' ')).toMatch(/below cost/i);
  });

  it('raises a price to the configured floor', () => {
    const rules = [rule({ kind: 'minimum_price', value: 100000, name: 'Floor' })];
    const result = calculatePrice(input, profile, rules);
    expect(result.unitPrice).toBe(100000);
  });

  it('lets a margin override replace the profile target', () => {
    const rules = [rule({ kind: 'margin_override', value: 25, name: 'Wholesale' })];
    const result = calculatePrice(input, profile, rules);
    expect(result.marginPercent).toBeCloseTo(25, 1);
  });

  it('ignores rules bound to a different profile', () => {
    const rules = [
      rule({ kind: 'quantity_discount', threshold: 1, value: 50, cost_profile_id: 'other' }),
    ];
    expect(calculatePrice(input, profile, rules).appliedRules).toHaveLength(0);
  });

  it('ignores inactive rules', () => {
    const rules = [rule({ kind: 'quantity_discount', threshold: 1, value: 50, active: false })];
    expect(calculatePrice(input, profile, rules).appliedRules).toHaveLength(0);
  });

  it('applies flat fees before percentage discounts', () => {
    // Order matters: a discount should reduce the whole price including fees.
    const rules = [
      rule({ id: 'a', kind: 'multi_color_fee', value: 100, name: 'Colour', priority: 10 }),
      rule({ id: 'b', kind: 'quantity_discount', threshold: 1, value: 50, name: 'Half', priority: 20 }),
    ];
    const base = calculatePrice({ ...input, colorCount: 2 }, profile);
    const result = calculatePrice({ ...input, colorCount: 2 }, profile, rules);
    expect(result.unitPrice).toBeCloseTo((base.unitPrice + 100) * 0.5, 1);
  });

  it('treats quantity 0 as a single unit rather than dividing by zero', () => {
    const result = calculatePrice({ ...input, quantity: 0 }, profile);
    expect(result.quantity).toBe(1);
    expect(Number.isFinite(result.totalPrice)).toBe(true);
  });
});
