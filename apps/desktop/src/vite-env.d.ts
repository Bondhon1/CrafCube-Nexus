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

interface NexusBridge {
  platform: string;
  versions: { electron: string; node: string; chrome: string };
  ping: () => Promise<unknown>;
  storage: NexusStorage;
  window: NexusWindowControls;
}

interface Window {
  /** Absent when the renderer runs in a plain browser tab. */
  nexus?: NexusBridge;
}
