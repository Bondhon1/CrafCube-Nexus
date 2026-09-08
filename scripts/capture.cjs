/**
 * Headless screenshot harness. Loads the built renderer in an offscreen window,
 * injects a real Supabase session into localStorage, walks the hash routes and
 * writes a PNG per route.
 *
 * Deliberately avoids OS-level input automation: SendKeys types into whatever
 * window happens to be focused, which is unsafe on a desktop in use.
 *
 * Usage: electron scripts/capture.cjs <outDir> <route> [route...]
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const [outDir, ...routes] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APP_DIR = path.join(__dirname, '..', 'apps', 'desktop');

function env() {
  const text = fs.readFileSync(path.join(APP_DIR, '.env'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const ENGINE_DIR = path.join(__dirname, '..', 'services', 'local-engine');
const ENGINE = 'http://127.0.0.1:8765';
let engineChild = null;

const enginePing = async () => {
  try { return (await fetch(ENGINE + '/status')).ok; } catch { return false; }
};

/** Screens that call the engine render as they really do only if it is up. */
async function startEngine() {
  if (await enginePing()) return true;
  const python = path.join(ENGINE_DIR, '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(python)) return false;
  engineChild = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1',
                               '--port', '8765', '--log-level', 'warning'],
                      { cwd: ENGINE_DIR, stdio: 'ignore', windowsHide: true });
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await enginePing()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const engineForm = (filename, bytes, fields = {}) => {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  return form;
};

ipcMain.handle('engine:mesh-preview', async (_e, filename, bytes) => {
  const res = await fetch(ENGINE + '/mesh-preview', { method: 'POST', body: engineForm(filename, bytes) });
  if (!res.ok) throw new Error(String(res.status));
  return await res.arrayBuffer();
});
ipcMain.handle('engine:analyze', async (_e, filename, bytes, fields) => {
  const res = await fetch(ENGINE + '/analyze', { method: 'POST', body: engineForm(filename, bytes, fields) });
  return await res.json();
});
ipcMain.handle('engine:slice', async (_e, filename, bytes, fields) => {
  const res = await fetch(ENGINE + '/slice', { method: 'POST', body: engineForm(filename, bytes, fields) });
  return await res.json();
});
ipcMain.handle('engine:status', async () => ({
  state: (await enginePing()) ? 'ready' : 'unavailable', baseUrl: ENGINE, error: null, capabilities: null,
}));
ipcMain.handle('engine:start', () => 'ready');

// Object transfers, mirroring electron/main.ts so signed URLs behave the same.
ipcMain.handle('storage:put', async (_e, url, headers, body) => {
  const res = await fetch(url, { method: 'PUT', headers, body });
  if (!res.ok) throw new Error(String(res.status));
  return { etag: res.headers.get('etag') };
});
ipcMain.handle('storage:get', async (_e, url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return await res.arrayBuffer();
});
ipcMain.handle('storage:delete', async (_e, url) => (await fetch(url, { method: 'DELETE' })).ok);

// The renderer's title bar probes these; the real handlers live in main.ts.
ipcMain.handle('window:is-maximized', () => false);
ipcMain.handle('window:minimize', () => {});
ipcMain.handle('window:toggle-maximize', () => false);
ipcMain.handle('window:close', () => {});

app.whenReady().then(async () => {
  await startEngine();
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = env();
  const ref = new URL(url).hostname.split('.')[0];
  const email = process.env.NEXUS_EMAIL;
  const password = process.env.NEXUS_PASSWORD;

  const win = new BrowserWindow({
    width: Number(process.env.NEXUS_WIDTH) || 1500,
    height: Number(process.env.NEXUS_HEIGHT) || 900,
    show: false,
    backgroundColor: '#000f16',
    webPreferences: {
      // Load the real preload so window.nexus exists and the page behaves
      // exactly as it does in the app, rather than in a degraded mode.
      preload: path.join(APP_DIR, 'dist-electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await win.loadFile(path.join(APP_DIR, 'dist', 'index.html'));

  // supabase-js reads the session from this key on boot, so signing in here and
  // reloading puts the app in an authenticated state without touching the UI.
  const signedIn = await win.webContents.executeJavaScript(`(async () => {
    const res = await fetch(${JSON.stringify(url)} + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: ${JSON.stringify(key)}, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }),
    });
    const session = await res.json();
    if (!session.access_token) return 'auth failed: ' + JSON.stringify(session);
    localStorage.setItem('sb-${ref}-auth-token', JSON.stringify(session));
    return 'ok';
  })()`);

  if (signedIn !== 'ok') {
    console.error(signedIn);
    app.exit(1);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  for (const route of routes) {
    await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + route)}`);
    await win.loadFile(path.join(APP_DIR, 'dist', 'index.html'), { hash: route });
    // Give the route's queries time to resolve before capturing.
    await new Promise((r) => setTimeout(r, 3500));

    // NEXUS_CLICK opens a dialog before capturing, so modals can be reviewed.
    if (process.env.NEXUS_CLICK) {
      await win.webContents.executeJavaScript(`(() => {
        const label = ${JSON.stringify(process.env.NEXUS_CLICK)};
        const el = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === label);
        if (el) el.click();
        return Boolean(el);
      })()`);
      // Converting and rendering a large mesh takes longer than a click.
      await new Promise((r) => setTimeout(r, Number(process.env.NEXUS_CLICK_WAIT) || 1500));
    }
    const image = await win.webContents.capturePage();
    const name = (route.replace(/^\//, '').replace(/\//g, '-') || 'dashboard') + '.png';
    fs.writeFileSync(path.join(outDir, name), image.toPNG());
    console.log('captured', name);
  }

  if (engineChild) engineChild.kill();
  app.exit(0);
});
