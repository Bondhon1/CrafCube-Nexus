/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
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

interface NexusBridge {
  platform: string;
  versions: { electron: string; node: string; chrome: string };
  ping: () => Promise<unknown>;
  window: NexusWindowControls;
}

interface Window {
  /** Absent when the renderer runs in a plain browser tab. */
  nexus?: NexusBridge;
}
