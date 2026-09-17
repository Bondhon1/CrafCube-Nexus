/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** 'supabase' (default) or 'b2'. */
  readonly VITE_STORAGE_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface NexusWindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChanged: (handler: (maximized: boolean) => void) => () => void;
}

interface NexusStorage {
  put(url: string, headers: Record<string, string>, body: ArrayBuffer): Promise<{ etag: string | null }>;
  get(url: string): Promise<ArrayBuffer>;
  remove(url: string): Promise<boolean>;
}

interface GeometryAnalysis {
  status: string;
  level: string;
  geometry: {
    dimensions: { width_mm: number; depth_mm: number; height_mm: number };
    volume_cm3: number;
    surface_area_cm2: number;
    triangle_count: number;
    vertex_count: number;
    is_watertight: boolean;
    is_winding_consistent: boolean;
    volume_is_reliable: boolean;
    overhang_area_ratio: number;
    warnings: string[];
    notes: string[];
  };
  bed_fit: {
    fits: boolean;
    fits_after_rotation: boolean;
    required_rotation_deg: number | null;
    message: string;
  };
}

interface SliceResponse {
  status: 'success' | 'failed';
  level: string;
  slice: {
    ok: boolean;
    slicer_name: string | null;
    duration_seconds: number;
    error: string | null;
    /** Plates the parts needed, and how many parts were laid out (§20). */
    plate_count?: number;
    part_count?: number;
    warnings?: string[];
    gcode: {
      slicer_filament_grams: number | null;
      slicer_filament_grams_per_tool: number[];
      calculated_filament_grams: number | null;
      slicer_print_time_seconds: number | null;
      layer_count: number;
      per_tool_filament_mm: Record<string, number>;
      density_g_cm3: number | null;
      filament_diameter_mm: number;
      tool_changes: number;
      /** What ends up in the part, and everything the job consumes. */
      product_grams: number | null;
      total_grams: number | null;
      waste: import('@crafcube/types').WasteBreakdown;
      per_tool: import('@crafcube/types').ToolBreakdown[];
    } | null;
  };
  confidence?: { level: string; reason: string };
}

interface EngineStatus {
  state: 'stopped' | 'starting' | 'ready' | 'unavailable';
  baseUrl: string;
  error: string | null;
  capabilities: {
    slicing: boolean;
    slicers: { name: string; executable: string; source: string }[];
    has_own_slicer?: boolean;
    analysis_levels: Record<string, string>;
  } | null;
}

interface NexusEngine {
  status(): Promise<EngineStatus>;
  start(): Promise<string>;
  analyze(
    filename: string,
    bytes: ArrayBuffer,
    fields: Record<string, string | number>,
  ): Promise<GeometryAnalysis>;
  parseGcode(
    filename: string,
    bytes: ArrayBuffer,
    fields: Record<string, string | number>,
  ): Promise<unknown>;
  /** STL bytes for any supported mesh format. */
  meshPreview(filename: string, bytes: ArrayBuffer): Promise<ArrayBuffer>;
  slice(
    filename: string,
    bytes: ArrayBuffer,
    fields: Record<string, string | number>,
  ): Promise<SliceResponse>;
}

type SlicerSetup =
  | { phase: 'checking' }
  | { phase: 'installed'; name: string }
  | { phase: 'ready'; name: string }
  | { phase: 'downloading'; received: number; total: number }
  | { phase: 'verifying' }
  | { phase: 'extracting' }
  | { phase: 'failed'; error: string }
  | { phase: 'unsupported'; reason: string };

interface NexusSlicer {
  status(): Promise<SlicerSetup>;
  retry(): Promise<SlicerSetup>;
  onState(handler: (state: SlicerSetup) => void): () => void;
}

interface NexusFiles {
  /** Resolves to the chosen path, or null when the user cancels. */
  saveText(defaultName: string, text: string): Promise<string | null>;
}

interface NexusBridge {
  platform: string;
  versions: { electron: string; node: string; chrome: string };
  ping: () => Promise<unknown>;
  storage: NexusStorage;
  engine: NexusEngine;
  files: NexusFiles;
  slicer: NexusSlicer;
  window: NexusWindowControls;
}

interface Window {
  /** Absent when the renderer runs in a plain browser tab. */
  nexus?: NexusBridge;
}
