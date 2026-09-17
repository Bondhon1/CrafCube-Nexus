import type { ConfidenceLevel, SliceSettings, StoredSlice } from '@crafcube/types';
import { sliceSettingsKey } from '@crafcube/types';
import { supabase } from '@/lib/supabase';

/**
 * Slices are done once and kept.
 *
 * A slice is looked up by the file's content and the settings that change its
 * answer. Only a missing slice, or an explicit re-slice, runs the slicer — so
 * a job shows the same numbers every time it is opened, and a one-off build
 * whose file was never kept still has its numbers.
 */

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Settings the job form slices with, from the chosen printer. */
export function jobSliceSettings(printer: { brand?: string | null; model?: string | null; name?: string } | undefined): SliceSettings {
  return {
    vendor: printer?.brand || 'Anycubic',
    printer: (printer?.model || printer?.name || 'Kobra X').replace(/^Anycubic\s+/i, ''),
    nozzle_mm: 0.4,
    layer_height_mm: 0.2,
    infill_percent: 15,
    material: 'PLA',
  };
}

export async function findStoredSlice(
  organizationId: string,
  fileSha256: string,
  settings: SliceSettings,
): Promise<StoredSlice | null> {
  const { data, error } = await supabase
    .from('slice_results')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('file_sha256', fileSha256)
    .eq('settings_key', sliceSettingsKey(settings))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StoredSlice | null) ?? null;
}

/**
 * Run the slicer on a file and store the result, replacing any earlier slice
 * of the same file and settings. The file itself is never uploaded anywhere.
 */
export async function sliceAndStore(args: {
  organizationId: string;
  buffer: ArrayBuffer;
  fileName: string;
  fileSha256: string;
  settings: SliceSettings;
  bed: { x: number; y: number; z: number };
}): Promise<StoredSlice> {
  const bridge = window.nexus?.engine;
  if (!bridge) throw new Error('Slicing needs the desktop app.');

  const response = await bridge.slice(args.fileName, args.buffer, {
    printer: args.settings.printer,
    vendor: args.settings.vendor,
    layer_height_mm: args.settings.layer_height_mm,
    infill_percent: args.settings.infill_percent,
    nozzle_mm: args.settings.nozzle_mm,
    material: args.settings.material,
    // Fallback only — the machine profile states the real build volume.
    bed_x_mm: args.bed.x,
    bed_y_mm: args.bed.y,
    bed_z_mm: args.bed.z,
  });

  const g = response.slice.gcode;
  if (response.status !== 'success' || !g) {
    throw new Error(response.slice.error ?? 'The slicer produced no result.');
  }

  const product = Number(g.product_grams ?? g.slicer_filament_grams ?? 0);
  const waste = Number(g.waste?.total_g ?? 0);
  const row = {
    organization_id: args.organizationId,
    file_sha256: args.fileSha256,
    settings_key: sliceSettingsKey(args.settings),
    settings: args.settings,
    file_name: args.fileName,
    slicer_name: response.slice.slicer_name,
    engine_version: null,
    product_grams: product,
    waste_grams: waste,
    // Written as the sum rather than the engine's own total, so the row's
    // check (total = product + waste) cannot trip over rounding.
    total_grams: Number((product + waste).toFixed(3)),
    print_seconds: g.slicer_print_time_seconds ?? 0,
    layer_count: g.layer_count,
    plate_count: response.slice.plate_count ?? 1,
    part_count: response.slice.part_count ?? 1,
    tool_changes: g.tool_changes ?? 0,
    waste: g.waste ?? {},
    per_tool: g.per_tool ?? [],
    confidence: (response.confidence?.level ?? 'MEDIUM') as ConfidenceLevel,
    confidence_reason: response.confidence?.reason ?? null,
    warnings: response.slice.warnings ?? [],
    sliced_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('slice_results')
    .upsert(row, { onConflict: 'organization_id,file_sha256,settings_key' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as StoredSlice;
}
