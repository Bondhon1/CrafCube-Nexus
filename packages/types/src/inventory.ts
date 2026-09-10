/** Filament inventory and printer registry (design doc §6-§12, §36, §50-§51). */

import type { Timestamp, UUID } from './entities.js';

export interface Material {
  id: UUID;
  organization_id: UUID;
  name: string;
  /** g/cm³ — converts sliced volume into grams. */
  density: number;
  nozzle_temp_min: number | null;
  nozzle_temp_max: number | null;
  bed_temp_min: number | null;
  bed_temp_max: number | null;
  requires_drying: boolean;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface FilamentBrand {
  id: UUID;
  organization_id: UUID;
  name: string;
  website: string | null;
}

export interface FilamentProduct {
  id: UUID;
  organization_id: UUID;
  brand_id: UUID | null;
  material_id: UUID;
  name: string;
  color_name: string | null;
  color_hex: string | null;
  diameter_mm: number;
  density_override: number | null;
  spool_weight_g: number;
  warn_grams: number | null;
  critical_grams: number | null;
  supplier: string | null;
  discontinued: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type SpoolStatus = 'sealed' | 'in_use' | 'empty' | 'retired';

export const SPOOL_STATUS_LABELS: Record<SpoolStatus, string> = {
  sealed: 'Sealed',
  in_use: 'In use',
  empty: 'Empty',
  retired: 'Retired',
};

export interface FilamentSpool {
  id: UUID;
  organization_id: UUID;
  product_id: UUID;
  code: string;
  status: SpoolStatus;
  initial_grams: number;
  /** Cached from the ledger; the transactions are the source of truth. */
  remaining_grams: number;
  reserved_grams: number;
  product_cost: number;
  shipping_cost: number;
  tax_cost: number;
  other_cost: number;
  landed_cost: number;
  cost_per_gram: number;
  supplier: string | null;
  lot_code: string | null;
  purchased_at: string | null;
  opened_at: Timestamp | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export const INVENTORY_TXN_TYPES = [
  'PURCHASE',
  'CONSUMPTION',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'WASTE',
  'RETURN',
  'ADJUSTMENT',
  'TRANSFER',
  'SAMPLE',
  'DRYING_LOSS',
] as const;

export type InventoryTxnType = (typeof INVENTORY_TXN_TYPES)[number];

export const TXN_LABELS: Record<InventoryTxnType, string> = {
  PURCHASE: 'Purchase',
  CONSUMPTION: 'Consumption',
  RESERVATION: 'Reservation',
  RESERVATION_RELEASE: 'Reservation released',
  WASTE: 'Waste',
  RETURN: 'Return',
  ADJUSTMENT: 'Adjustment',
  TRANSFER: 'Transfer',
  SAMPLE: 'Sample',
  DRYING_LOSS: 'Drying loss',
};

/**
 * Direction the database enforces via the `filament_txn_sign` constraint.
 * 'either' covers ADJUSTMENT and TRANSFER; 'reserve' types move reserved_grams
 * rather than remaining_grams and are always recorded positive.
 */
export const TXN_DIRECTION: Record<InventoryTxnType, 'add' | 'remove' | 'either' | 'reserve'> = {
  PURCHASE: 'add',
  RETURN: 'add',
  CONSUMPTION: 'remove',
  WASTE: 'remove',
  SAMPLE: 'remove',
  DRYING_LOSS: 'remove',
  RESERVATION: 'reserve',
  RESERVATION_RELEASE: 'reserve',
  ADJUSTMENT: 'either',
  TRANSFER: 'either',
};

export interface FilamentTransaction {
  id: UUID;
  organization_id: UUID;
  spool_id: UUID;
  type: InventoryTxnType;
  /** Signed: positive adds material, negative removes it. */
  grams: number;
  cost_per_gram: number | null;
  value: number | null;
  reason: string | null;
  reference: string | null;
  actor_id: UUID | null;
  created_at: Timestamp;
}

/** One row of the `filament_stock` rollup view. */
export interface FilamentStock {
  product_id: UUID;
  organization_id: UUID;
  name: string;
  color_name: string | null;
  color_hex: string | null;
  diameter_mm: number;
  warn_grams: number | null;
  critical_grams: number | null;
  discontinued: boolean;
  material_name: string;
  density: number;
  brand_name: string | null;
  active_spools: number;
  remaining_grams: number;
  reserved_grams: number;
  stock_value: number;
  weighted_cost_per_gram: number | null;
}

export type StockLevel = 'critical' | 'warning' | 'ok' | 'unknown';

/**
 * Where a balance sits against its own thresholds (§11).
 *
 * Thresholds are optional, and a product without any reports 'unknown' rather
 * than 'ok': nobody has said what "enough" means for it, and calling that
 * healthy is a claim the data does not support.
 */
export function stockLevel(row: {
  remaining_grams: number | string;
  warn_grams: number | string | null;
  critical_grams: number | string | null;
}): StockLevel {
  const remaining = Number(row.remaining_grams);
  if (row.critical_grams != null && remaining <= Number(row.critical_grams)) return 'critical';
  if (row.warn_grams != null && remaining <= Number(row.warn_grams)) return 'warning';
  if (row.warn_grams == null && row.critical_grams == null) return 'unknown';
  return 'ok';
}

export type PrinterStatus = 'idle' | 'printing' | 'paused' | 'maintenance' | 'offline' | 'retired';

export const PRINTER_STATUS_LABELS: Record<PrinterStatus, string> = {
  idle: 'Idle',
  printing: 'Printing',
  paused: 'Paused',
  maintenance: 'Maintenance',
  offline: 'Offline',
  retired: 'Retired',
};

export interface Printer {
  id: UUID;
  organization_id: UUID;
  name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  status: PrinterStatus;
  build_x_mm: number | null;
  build_y_mm: number | null;
  build_z_mm: number | null;
  max_nozzle_temp_c: number | null;
  max_bed_temp_c: number | null;
  extruder_count: number;
  color_slots: number;
  supported_materials: string[];
  power_watts: number | null;
  hourly_machine_cost: number;
  purchase_cost: number | null;
  purchased_at: string | null;
  location: string | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PrinterProfile {
  id: UUID;
  organization_id: UUID;
  printer_id: UUID;
  name: string;
  nozzle_mm: number;
  layer_height_mm: number;
  infill_percent: number;
  wall_count: number;
  print_speed_mms: number | null;
  supports: boolean;
  is_default: boolean;
  slicer_settings: Record<string, unknown>;
  created_at: Timestamp;
  updated_at: Timestamp;
}
