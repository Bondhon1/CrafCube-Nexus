/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  nexus?: {
    platform: string;
    versions: { electron: string; node: string; chrome: string };
    ping: () => Promise<unknown>;
  };
}
