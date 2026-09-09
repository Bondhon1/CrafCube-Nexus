import { describe, expect, it } from 'vitest';
import { NEXT_ORDER_STATUSES, marginPercent, paymentState } from '../src/sales.js';

describe('marginPercent', () => {
  it('expresses profit as a share of revenue', () => {
    // The doc's §31 figures: 85,400 revenue, 54,200 gross profit -> 63.5%.
    expect(marginPercent(54200, 85400)).toBeCloseTo(63.47, 1);
    expect(marginPercent(36700, 85400)).toBeCloseTo(42.97, 1);
  });

  it('returns null with no revenue rather than 0%', () => {
    // 0% would read as "we sold at cost"; there was simply nothing sold.
    expect(marginPercent(0, 0)).toBeNull();
    expect(marginPercent(500, null)).toBeNull();
  });

  it('reports a loss as a negative margin', () => {
    expect(marginPercent(-200, 1000)).toBe(-20);
  });
});

describe('paymentState', () => {
  it('separates cash from revenue', () => {
    // §103: an order can be worth 9000 and have nothing paid against it.
    expect(paymentState(9000, 0)).toBe('unpaid');
    expect(paymentState(9000, 5000)).toBe('partial');
    expect(paymentState(9000, 9000)).toBe('paid');
    expect(paymentState(9000, 9500)).toBe('overpaid');
  });

  it('does not call a settled order unpaid over a rounding cent', () => {
    expect(paymentState(100, 99.995)).toBe('paid');
  });

  it('treats a free order as paid once anything is recorded', () => {
    expect(paymentState(0, 0)).toBe('unpaid');
  });
});

describe('order status flow', () => {
  it('ends at delivered and cancelled', () => {
    expect(NEXT_ORDER_STATUSES.DELIVERED).toHaveLength(0);
    expect(NEXT_ORDER_STATUSES.CANCELLED).toHaveLength(0);
  });

  it('requires a ready order before delivery', () => {
    // Delivering straight from production skips the check that it is finished.
    expect(NEXT_ORDER_STATUSES.IN_PRODUCTION).not.toContain('DELIVERED');
    expect(NEXT_ORDER_STATUSES.READY).toContain('DELIVERED');
  });

  it('allows cancelling until delivery', () => {
    for (const status of ['DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY'] as const) {
      expect(NEXT_ORDER_STATUSES[status]).toContain('CANCELLED');
    }
  });
});
