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
