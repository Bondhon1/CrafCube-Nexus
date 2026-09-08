import { contextBridge, ipcRenderer } from 'electron';

/**
 * The renderer's only bridge to the main process. Phase 2 adds the local
 * Python engine handles here; today it carries platform info and the window
 * controls the custom title bar needs.
 */
contextBridge.exposeInMainWorld('nexus', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  ping: () => ipcRenderer.invoke('nexus:ping'),

  /** Local analysis engine; may be unavailable, so callers must handle that. */
  engine: {
    status: () => ipcRenderer.invoke('engine:status'),
    start: () => ipcRenderer.invoke('engine:start'),
    analyze: (filename: string, bytes: ArrayBuffer, fields: Record<string, string | number>) =>
      ipcRenderer.invoke('engine:analyze', filename, bytes, fields),
    parseGcode: (filename: string, bytes: ArrayBuffer, fields: Record<string, string | number>) =>
      ipcRenderer.invoke('engine:parse-gcode', filename, bytes, fields),
    meshPreview: (filename: string, bytes: ArrayBuffer): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('engine:mesh-preview', filename, bytes),
    slice: (filename: string, bytes: ArrayBuffer, fields: Record<string, string | number>) =>
      ipcRenderer.invoke('engine:slice', filename, bytes, fields),
  },

  /** Object transfers, run in the main process so no CORS check applies. */
  storage: {
    put: (url: string, headers: Record<string, string>, body: ArrayBuffer) =>
      ipcRenderer.invoke('storage:put', url, headers, body),
    get: (url: string): Promise<ArrayBuffer> => ipcRenderer.invoke('storage:get', url),
    remove: (url: string) => ipcRenderer.invoke('storage:delete', url),
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    /** Fires when the OS maximises or restores the window. Returns an unsubscribe. */
    onMaximizedChanged: (handler: (maximized: boolean) => void) => {
      const listener = (_event: unknown, maximized: boolean) => handler(maximized);
      ipcRenderer.on('window:maximized-changed', listener);
      return () => ipcRenderer.removeListener('window:maximized-changed', listener);
    },
  },
});
