import { describe, expect, it } from 'vitest';
import { findByCode, isProductCode, normalizeProductCode } from '../src/models.js';

describe('product codes', () => {
  it('are stored trimmed and upper case', () => {
    expect(normalizeProductCode(' c0001 ')).toBe('C0001');
    expect(normalizeProductCode('   ')).toBeNull();
    expect(normalizeProductCode(undefined)).toBeNull();
  });

  it('match what the database accepts', () => {
    expect(isProductCode('C0001')).toBe(true);
    expect(isProductCode('fn123')).toBe(true);
    expect(isProductCode('C01')).toBe(false);
    expect(isProductCode('CODES0001')).toBe(false);
    expect(isProductCode('0001')).toBe(false);
  });

  it('are looked up however they were typed', () => {
    const entries = [{ product_code: 'C0001', name: 'Fish' }, { product_code: 'C0002', name: 'Name' }];
    expect(findByCode(entries, 'c0002')?.name).toBe('Name');
    expect(findByCode(entries, 'C0003')).toBeUndefined();
    expect(findByCode(entries, '')).toBeUndefined();
  });
});
