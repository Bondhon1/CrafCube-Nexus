/** Model library, versioning and files (design doc §13-§17). */

import type { Timestamp, UUID } from './entities.js';

export const GENERATION_METHODS = [
  'ai', 'python', 'manual', 'remix', 'purchased', 'customer_supplied',
] as const;

export type GenerationMethod = (typeof GENERATION_METHODS)[number];

export const GENERATION_METHOD_LABELS: Record<GenerationMethod, string> = {
  ai: 'AI generated',
  python: 'Python',
  manual: 'Manual',
  remix: 'Remix',
  purchased: 'Purchased',
  customer_supplied: 'Customer supplied',
};

export const MODEL_LICENSES = ['commercial', 'personal', 'unknown', 'restricted'] as const;

export type ModelLicense = (typeof MODEL_LICENSES)[number];

export const MODEL_LICENSE_LABELS: Record<ModelLicense, string> = {
  commercial: 'Commercial',
  personal: 'Personal',
  unknown: 'Unknown',
  restricted: 'Restricted',
};

export interface Model {
  id: UUID;
  organization_id: UUID;
  /** C0001. Shared with custom designs: one code names one thing. */
  product_code: string;
  name: string;
  category: string | null;
  description: string | null;
  tags: string[];
  generation_method: GenerationMethod;
  generation_tool: string | null;
  prompt: string | null;
  source_reference: string | null;
  license: ModelLicense;
  rec_layer_height_mm: number | null;
  rec_infill_percent: number | null;
  rec_wall_count: number | null;
  rec_material: string | null;
  archived: boolean;
  created_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ModelVersion {
  id: UUID;
  organization_id: UUID;
  model_id: UUID;
  version: number;
  notes: string | null;
  generation_method: GenerationMethod | null;
  generation_tool: string | null;
  prompt: string | null;
  /** Null until the phase 2 analyzer has run over the version. */
  width_mm: number | null;
  depth_mm: number | null;
  height_mm: number | null;
  volume_cm3: number | null;
  triangle_count: number | null;
  is_manifold: boolean | null;
  created_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type ModelFileKind =
  | 'source' | 'mesh' | 'project' | 'gcode' | 'thumbnail' | 'render' | 'other';

export interface ModelFile {
  id: UUID;
  organization_id: UUID;
  version_id: UUID;
  kind: ModelFileKind;
  filename: string;
  extension: string | null;
  storage_key: string;
  byte_size: number;
  content_type: string | null;
  /** SHA-256 of the contents, used for duplicate detection. */
  sha256: string;
  created_by: UUID | null;
  created_at: Timestamp;
}

/** Row shape returned by the `find_duplicate_file` RPC. */
export interface DuplicateFile {
  file_id: UUID;
  filename: string;
  storage_key: string;
  byte_size: number;
  model_id: UUID;
  model_name: string;
  version: number;
  uploaded_at: Timestamp;
}

/** 1-4 letters then 3-6 digits, as the database stores it. */
const PRODUCT_CODE = /^[A-Z]{1,4}[0-9]{3,6}$/;

/** What a typed code is stored as: trimmed and upper case, or null if blank. */
export function normalizeProductCode(input: string | null | undefined): string | null {
  const code = (input ?? '').trim().toUpperCase();
  return code === '' ? null : code;
}

export function isProductCode(input: string | null | undefined): boolean {
  const code = normalizeProductCode(input);
  return code !== null && PRODUCT_CODE.test(code);
}

export type CustomDesignSource = 'manual' | 'flexi-name-studio';

/**
 * A one-off design sold under one code - "flexi name keychain" - whose
 * customer builds (each name, each colourway) are grouped under it.
 */
export interface CustomDesign {
  id: UUID;
  organization_id: UUID;
  product_code: string;
  name: string;
  description: string | null;
  source: CustomDesignSource;
  /** The sender's own name for the design, e.g. the studio's "daisy-name". */
  design_key: string | null;
  archived: boolean;
  created_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** One row of `product_catalog`: every code, library model or custom design. */
export interface CatalogEntry {
  organization_id: UUID;
  product_code: string;
  kind: 'model' | 'custom';
  model_id: UUID | null;
  custom_design_id: UUID | null;
  name: string;
  category: string | null;
  archived: boolean;
}

/** Finds an entry by code however it was typed. */
export function findByCode<T extends { product_code: string }>(
  entries: readonly T[], input: string | null | undefined,
): T | undefined {
  const code = normalizeProductCode(input);
  return code === null ? undefined : entries.find((e) => e.product_code === code);
}
