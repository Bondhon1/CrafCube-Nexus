import { contextBridge, ipcRenderer } from 'electron';

/**
 * The renderer's only bridge to the main process. Phase 2 adds the local
 * Python engine handles here; for now it carries platform info only.
 */
contextBridge.exposeInMainWorld('nexus', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  ping: () => ipcRenderer.invoke('nexus:ping'),
});
