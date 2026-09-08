import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { engineStatus, engineUpload, engineUploadBinary, startEngine, stopEngine } from './engine';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const PREFERRED_WIDTH = 1440;
const PREFERRED_HEIGHT = 900;

let window: BrowserWindow | null = null;

function createWindow() {
  // Never open larger than the display: the preferred size exceeds common
  // 1366x768 and 1536x864 laptop panels, which would push the layout offscreen.
  const { width: availWidth, height: availHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(PREFERRED_WIDTH, availWidth - 40);
  const height = Math.min(PREFERRED_HEIGHT, availHeight - 40);

  window = new BrowserWindow({
    width,
    height,
    center: true,
    minWidth: Math.min(1100, width),
    minHeight: Math.min(700, height),
    backgroundColor: '#000f16',
    show: false,
    // The app draws its own title bar and window buttons.
    frame: false,
    titleBarStyle: 'hidden',
    // macOS keeps its traffic lights; only Windows/Linux get our buttons.
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window?.show());

  // Keep the renderer's maximise button in sync with OS-level changes
  // (snap, double-click on the drag region, keyboard shortcuts).
  const emitMaximized = () =>
    window?.webContents.send('window:maximized-changed', window.isMaximized());
  window.on('maximize', emitMaximized);
  window.on('unmaximize', emitMaximized);

  // External links open in the user's browser, never inside the shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Window controls. Each resolves the caller's own window so the handlers stay
// correct if a second window is ever added.
function callerWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.handle('window:minimize', (event) => {
  callerWindow(event)?.minimize();
});

ipcMain.handle('window:toggle-maximize', (event) => {
  const win = callerWindow(event);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('window:close', (event) => {
  callerWindow(event)?.close();
});

ipcMain.handle('window:is-maximized', (event) => callerWindow(event)?.isMaximized() ?? false);

ipcMain.handle('nexus:ping', () => ({ ok: true, at: new Date().toISOString() }));

// Local engine (design doc §37-§40). Analysis runs out of process, so a crash
// in trimesh or a slicer cannot take the UI down with it.
ipcMain.handle('engine:status', () => engineStatus());
ipcMain.handle('engine:start', () => startEngine());
ipcMain.handle(
  'engine:analyze',
  (_event, filename: string, bytes: ArrayBuffer, fields: Record<string, string | number>) =>
    engineUpload('/analyze', filename, bytes, fields),
);
// Returns STL bytes for any supported mesh format, so the renderer needs only
// one parser.
ipcMain.handle(
  'engine:mesh-preview',
  (_event, filename: string, bytes: ArrayBuffer) =>
    engineUploadBinary('/mesh-preview', filename, bytes),
);

// A real slice is the primary costing source (§4 level B), so the job form
// calls this rather than asking an operator to guess grams.
ipcMain.handle(
  'engine:slice',
  (_event, filename: string, bytes: ArrayBuffer, fields: Record<string, string | number>) =>
    engineUpload('/slice', filename, bytes, fields),
);

ipcMain.handle(
  'engine:parse-gcode',
  (_event, filename: string, bytes: ArrayBuffer, fields: Record<string, string | number>) =>
    engineUpload('/parse-gcode', filename, bytes, fields),
);

/**
 * Object transfers run here rather than in the renderer.
 *
 * A presigned S3 request from the renderer is a cross-origin fetch, which would
 * need CORS rules on the bucket and still sends `Origin: null` from a file://
 * page. Node performs no CORS check, so routing transfers through the main
 * process removes that class of failure entirely.
 */
ipcMain.handle(
  'storage:put',
  async (_event, url: string, headers: Record<string, string>, body: ArrayBuffer) => {
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body,
    });
    if (!response.ok) {
      // S3 errors are XML; the first 300 characters carry the code and message.
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`upload failed (${response.status}): ${detail}`);
    }
    return { etag: response.headers.get('etag') };
  },
);

ipcMain.handle('storage:get', async (_event, url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`download failed (${response.status}): ${detail}`);
  }
  return await response.arrayBuffer();
});

ipcMain.handle('storage:delete', async (_event, url: string) => {
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`delete failed (${response.status}): ${detail}`);
  }
  return true;
});

app.whenReady().then(() => {
  createWindow();
  // Started in the background: the app must not wait on it, and it is allowed
  // to be unavailable.
  void startEngine();
});

app.on('before-quit', stopEngine);

app.on('window-all-closed', () => {
  stopEngine();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
