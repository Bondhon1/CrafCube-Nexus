import { describe, expect, it } from 'vitest';
import {
  batchStrategies, breakEvenPrints, estimateRisk, machineRoi, perUnit,
  reorderAdvice, utilizationPercent, wasteSharePercent,
} from '../src/intelligence.js';
import { stockLevel } from '../src/inventory.js';

describe('stockLevel', () => {
  it('reports unknown when no threshold was ever set', () => {
    // Nobody has said what "enough" means here, so calling it healthy would be
    // a claim the data does not support.
    expect(stockLevel({ remaining_grams: 5, warn_grams: null, critical_grams: null }))
      .toBe('unknown');
  });

  it('prefers critical over low when both are breached', () => {
    expect(stockLevel({ remaining_grams: 80, warn_grams: 300, critical_grams: 100 }))
      .toBe('critical');
  });

  it('is ok above the warning line', () => {
    expect(stockLevel({ remaining_grams: 900, warn_grams: 300, critical_grams: 100 }))
      .toBe('ok');
  });

  it('is ok when only one threshold is set and stock clears it', () => {
    expect(stockLevel({ remaining_grams: 900, warn_grams: 300, critical_grams: null }))
      .toBe('ok');
  });
});

describe('reorderAdvice', () => {
  const base = {
    available_g: 620, daily_usage_g: 257.14, lead_time_days: 5,
    safety_stock_g: 500, reorder_qty_g: 1000,
  };

  it('recommends ordering when stock cannot cover the lead time', () => {
    // The §12 worked example: 620 g against 1.8 kg a week and a 5-day lead.
    const advice = reorderAdvice(base);
    expect(advice.reorder).toBe(true);
    expect(advice.quantityGrams).not.toBeNull();
    // Whole spools only — filament is not sold by the gram.
    expect((advice.quantityGrams as number) % 1000).toBe(0);
    expect(advice.orderWithinDays).toBe(0);
  });

  it('refuses to forecast from no usage rather than reporting infinite cover', () => {
    const advice = reorderAdvice({ ...base, daily_usage_g: null });
    expect(advice.reorder).toBe(false);
    expect(advice.quantityGrams).toBeNull();
    expect(advice.orderWithinDays).toBeNull();
  });

  it('holds off when stock comfortably covers lead time plus safety stock', () => {
    const advice = reorderAdvice({ ...base, available_g: 6000 });
    expect(advice.reorder).toBe(false);
    expect(advice.orderWithinDays).toBeGreaterThan(0);
  });

  it('buys back to the cover line plus a month of usage', () => {
    // 1000 g of cover needed, 999 on hand, 3000 g a month: 4000 g target,
    // rounded up to whole spools.
    const advice = reorderAdvice({
      available_g: 999, daily_usage_g: 100, lead_time_days: 10,
      safety_stock_g: 0, reorder_qty_g: 1000,
    });
    expect(advice.quantityGrams).toBe(4000);
  });

  it('never orders less than one spool for a slow-moving colour', () => {
    // 300 g a month against a 1 kg spool: the shortfall rounds to nothing,
    // but you still cannot buy a fraction of a spool.
    const advice = reorderAdvice({
      available_g: 90, daily_usage_g: 10, lead_time_days: 10,
      safety_stock_g: 0, reorder_qty_g: 1000,
    });
    expect(advice.reorder).toBe(true);
    expect(advice.quantityGrams).toBe(1000);
  });
});

describe('utilizationPercent', () => {
  it('measures from the purchase date, not the first job', () => {
    const now = new Date('2026-01-11T00:00:00Z');
    // 10 days available, 24h printed.
    expect(utilizationPercent(24 * 3600, '2026-01-01', now)).toBe(10);
  });

  it('returns null without a purchase date', () => {
    expect(utilizationPercent(3600, null)).toBeNull();
  });

  it('never exceeds 100% when logged hours overrun the window', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    expect(utilizationPercent(1000 * 3600, '2026-01-01', now)).toBe(100);
  });
});

describe('machineRoi', () => {
  it('matches the §72 worked example', () => {
    const roi = machineRoi(37500, 50000);
    expect(roi).toEqual({ percent: 75, recovered: 37500, remaining: 12500 });
  });

  it('returns null when the purchase cost was never entered', () => {
    expect(machineRoi(37500, null)).toBeNull();
  });

  it('caps recovered at the investment once it is paid off', () => {
    expect(machineRoi(60000, 50000)?.remaining).toBe(0);
  });
});

describe('breakEvenPrints', () => {
  it('matches the §71 worked example', () => {
    expect(breakEvenPrints(50000, 400)).toBe(125);
  });

  it('returns null when each print contributes nothing', () => {
    expect(breakEvenPrints(50000, 0)).toBeNull();
    expect(breakEvenPrints(50000, -5)).toBeNull();
  });
});

describe('perUnit', () => {
  it('is null rather than infinite with a zero denominator', () => {
    expect(perUnit(1000, 0)).toBeNull();
  });

  it('divides profit by the denominator', () => {
    expect(perUnit(1000, 8)).toBe(125);
  });
});

describe('wasteSharePercent', () => {
  it('matches the §53 worked example', () => {
    // 5.8 kg total, 4.9 kg into product → 15.5% outside finished products.
    expect(wasteSharePercent({ product_grams: 4900, total_grams: 5800 })).toBe(15.5);
  });

  it('is null when nothing moved', () => {
    expect(wasteSharePercent({ product_grams: 0, total_grams: 0 })).toBeNull();
  });
});

describe('estimateRisk', () => {
  it('refuses to guess below the sample floor', () => {
    const risk = estimateRisk({
      modelFailureRate: 50, modelSamples: 2,
      printerFailureRate: 40, printerSamples: 1,
      printSeconds: 3600,
    });
    expect(risk.band).toBe('unknown');
    expect(risk.percent).toBeNull();
  });

  it('falls back to the printer when the model has no history', () => {
    const risk = estimateRisk({
      modelFailureRate: null, modelSamples: 0,
      printerFailureRate: 4, printerSamples: 50,
      printSeconds: 3600,
    });
    expect(risk.band).toBe('low');
    expect(risk.percent).toBe(4);
  });

  it('raises the estimate for long prints and says why', () => {
    const short = estimateRisk({
      modelFailureRate: 10, modelSamples: 20,
      printerFailureRate: null, printerSamples: 0,
      printSeconds: 3600,
    });
    const long = estimateRisk({
      modelFailureRate: 10, modelSamples: 20,
      printerFailureRate: null, printerSamples: 0,
      printSeconds: 9 * 3600,
    });
    expect(long.percent as number).toBeGreaterThan(short.percent as number);
    expect(long.reasons.join(' ')).toMatch(/long runs/);
  });

  it('weights the model over the printer when both are known', () => {
    const risk = estimateRisk({
      modelFailureRate: 20, modelSamples: 30,
      printerFailureRate: 0, printerSamples: 30,
      printSeconds: 60,
    });
    // 0.7 x 20 + 0.3 x 0 = 14, so the model dominates without the printer
    // being ignored.
    expect(risk.percent).toBe(14);
    expect(risk.band).toBe('medium');
  });

  it('never reports a certainty it cannot have', () => {
    const risk = estimateRisk({
      modelFailureRate: 100, modelSamples: 10,
      printerFailureRate: 100, printerSamples: 10,
      printSeconds: 20 * 3600,
    });
    expect(risk.percent as number).toBeLessThanOrEqual(95);
  });
});

describe('batchStrategies', () => {
  it('shows fuller plates finishing sooner for the same material', () => {
    const strategies = batchStrategies(20, 3600, 82.5, { setupSeconds: 600, maxPerPlate: 10 });
    const single = strategies.find((s) => s.perPlate === 1);
    const ten = strategies.find((s) => s.perPlate === 10);

    expect(single?.totalSeconds).toBeGreaterThan(ten?.totalSeconds as number);
    // Material is per object, so it does not fall with batching.
    expect(single?.totalGrams).toBe(ten?.totalGrams);
    expect(ten?.risk).toBe('Higher');
  });

  it('reports the overproduction when a plate does not divide evenly', () => {
    const [strategy] = batchStrategies(7, 3600, 10, { maxPerPlate: 4 })
      .filter((s) => s.perPlate === 4);
    expect(strategy.plates).toBe(2);
    expect(strategy.produced).toBe(8);
  });

  it('returns nothing to compare for a zero quantity', () => {
    expect(batchStrategies(0, 3600, 10)).toEqual([]);
  });

  it('never suggests a plate larger than the quantity asked for', () => {
    const strategies = batchStrategies(3, 3600, 10, { maxPerPlate: 10 });
    expect(Math.max(...strategies.map((s) => s.perPlate))).toBeLessThanOrEqual(3);
  });
});
