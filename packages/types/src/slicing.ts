/**
 * Stored slices, waste, and one-off custom builds.
 *
 * A slice is done once per file and settings and kept in `slice_results`, so
 * reopening a job shows the same numbers without running the slicer again.
 * Waste — purge, support, brim, priming — is part of every slice: it is
 * filament the job consumes without it ending up in the part.
 */

import type { Timestamp, UUID } from './entities.js';
import type { ConfidenceLevel } from './costing.js';

export const WASTE_KINDS = ['purge', 'support', 'skirt_brim', 'prime_line'] as const;
export type WasteKind = (typeof WASTE_KINDS)[number];

export const WASTE_KIND_LABELS: Record<WasteKind | 'failure', string> = {
  purge: 'Colour-change purge',
  support: 'Support',
  skirt_brim: 'Skirt & brim',
  prime_line: 'Prime line',
  failure: 'Failed prints',
};

export interface WasteBreakdown {
  support_g: number;
  skirt_brim_g: number;
  prime_line_g: number;
  purge_g: number;
  total_g: number;
  /** Where the purge figure came from. */
  purge_basis: 'flush volumes' | 'prime tower' | 'none' | 'unknown';
  tool_changes: number;
}

/** One filament's share of a slice. */
export interface ToolBreakdown {
  tool: number;
  product_g: number;
  support_g: number;
  skirt_brim_g: number;
  prime_line_g: number;
  purge_g: number;
  waste_g: number;
  total_g: number;
}

/** The settings that change a slice's answer. */
export interface SliceSettings {
  vendor: string;
  printer: string;
  nozzle_mm: number;
  layer_height_mm: number;
  infill_percent: number;
  material: string;
}

/** One row of `slice_results`. */
export interface StoredSlice {
  id: UUID;
  organization_id: UUID;
  file_sha256: string;
  settings_key: string;
  settings: SliceSettings | Record<string, never>;
  file_name: string | null;
  slicer_name: string | null;
  engine_version: string | null;
  product_grams: number;
  waste_grams: number;
  total_grams: number;
  print_seconds: number;
  layer_count: number | null;
  plate_count: number | null;
  part_count: number | null;
  tool_changes: number;
  waste: Partial<WasteBreakdown>;
  per_tool: ToolBreakdown[];
  confidence: ConfidenceLevel;
  confidence_reason: string | null;
  warnings: string[];
  sliced_by: UUID | null;
  sliced_at: Timestamp;
}

export type CustomBuildSource = 'manual' | 'flexi-name-studio';
export type CustomBuildStatus = 'new' | 'queued' | 'printed' | 'archived';

export const CUSTOM_BUILD_SOURCE_LABELS: Record<CustomBuildSource, string> = {
  manual: 'Added here',
  'flexi-name-studio': 'Flexi Name Studio',
};

/** One row of `custom_builds`: a one-off design whose model file is not kept. */
export interface CustomBuild {
  id: UUID;
  organization_id: UUID;
  /** The custom design - and so the product code - this build is one of. */
  design_id: UUID;
  source: CustomBuildSource;
  external_id: string | null;
  title: string;
  file_name: string | null;
  file_sha256: string | null;
  colours: { name?: string; hex: string }[];
  params: Record<string, unknown>;
  status: CustomBuildStatus;
  notes: string | null;
  order_id: UUID | null;
  created_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** A number with no trailing zeros, so 0.40 and 0.4 make the same key. */
function tidy(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * The lookup key for a stored slice.
 *
 * Case and stray spaces are ignored — "Kobra X" and "kobra x " are the same
 * printer — because a key that differed on formatting alone would quietly
 * slice the same file twice and keep two answers.
 */
export function sliceSettingsKey(settings: SliceSettings): string {
  const text = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  return [
    text(settings.vendor),
    text(settings.printer),
    tidy(settings.nozzle_mm),
    tidy(settings.layer_height_mm),
    tidy(settings.infill_percent),
    text(settings.material),
  ].join('|');
}

/** Waste as a share of everything the job consumes; null when nothing is used. */
export function wastePercent(slice: Pick<StoredSlice, 'waste_grams' | 'total_grams'>): number | null {
  const total = Number(slice.total_grams);
  if (!(total > 0)) return null;
  return Number(((Number(slice.waste_grams) / total) * 100).toFixed(1));
}

/**
 * One spool's waste for a job of `quantity` copies, as stored on the job.
 *
 * Every copy is its own print here, so each one purges, primes and supports
 * again: the waste scales with the count just as the product does.
 */
export function toolWasteForJob(
  tool: Partial<Record<`${WasteKind}_g`, number>>,
  quantity: number,
): Record<`${WasteKind}_g`, number> {
  const copies = Math.max(1, Math.floor(quantity));
  const out = {} as Record<`${WasteKind}_g`, number>;
  for (const kind of WASTE_KINDS) {
    const key = `${kind}_g` as const;
    out[key] = Number(((Number(tool[key]) || 0) * copies).toFixed(3));
  }
  return out;
}

/** A 64-character lower-case SHA-256, the only form the database accepts. */
export function isSha256(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
