import { describe, expect, it } from 'vitest';
import { isSha256, sliceSettingsKey, toolWasteForJob, wastePercent } from '../src/slicing.js';

const kobra = {
  vendor: 'Anycubic', printer: 'Kobra X', nozzle_mm: 0.4,
  layer_height_mm: 0.2, infill_percent: 15, material: 'PLA',
};

describe('sliceSettingsKey', () => {
  it('is stable and readable', () => {
    expect(sliceSettingsKey(kobra)).toBe('anycubic|kobra x|0.4|0.2|15|pla');
  });

  it('ignores formatting that does not change the slice', () => {
    // A key that differed on case or spacing would slice the same file twice.
    expect(sliceSettingsKey({ ...kobra, printer: '  kobra  X ', vendor: 'ANYCUBIC' }))
      .toBe(sliceSettingsKey(kobra));
    expect(sliceSettingsKey({ ...kobra, nozzle_mm: 0.40, layer_height_mm: 0.2000 }))
      .toBe(sliceSettingsKey(kobra));
  });

  it('changes with anything that does change the slice', () => {
    const base = sliceSettingsKey(kobra);
    expect(sliceSettingsKey({ ...kobra, layer_height_mm: 0.16 })).not.toBe(base);
    expect(sliceSettingsKey({ ...kobra, infill_percent: 20 })).not.toBe(base);
    expect(sliceSettingsKey({ ...kobra, printer: 'Kobra 3' })).not.toBe(base);
    expect(sliceSettingsKey({ ...kobra, material: 'PETG' })).not.toBe(base);
  });
});

describe('wastePercent', () => {
  it('is waste over everything consumed', () => {
    // The daisy keychain: 3.48 g purge of 9.08 g consumed.
    expect(wastePercent({ waste_grams: 3.483, total_grams: 9.082 })).toBe(38.4);
  });

  it('is null rather than zero when nothing is consumed', () => {
    expect(wastePercent({ waste_grams: 0, total_grams: 0 })).toBeNull();
  });
});

describe('toolWasteForJob', () => {
  const blue = { purge_g: 0.467, support_g: 0, skirt_brim_g: 0.1, prime_line_g: 0 };

  it('repeats every kind of waste for every copy', () => {
    expect(toolWasteForJob(blue, 3)).toEqual({
      purge_g: 1.401, support_g: 0, skirt_brim_g: 0.3, prime_line_g: 0,
    });
  });

  it('treats a nonsense quantity as one copy', () => {
    expect(toolWasteForJob(blue, 0).purge_g).toBe(0.467);
  });
});

describe('isSha256', () => {
  it('accepts only the form the database stores', () => {
    expect(isSha256('ab'.repeat(32))).toBe(true);
    expect(isSha256('AB'.repeat(32))).toBe(false);
    expect(isSha256('ab'.repeat(31))).toBe(false);
    expect(isSha256(null)).toBe(false);
  });
});
