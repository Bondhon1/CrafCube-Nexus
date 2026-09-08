/**
 * Renders the upload screen with a real STL loaded, exercising the 3D preview,
 * the thumbnail renderer and the geometry analysis together.
 *
 * Usage: electron scripts/verify-preview.cjs <outDir>
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'apps', 'desktop');
const ENGINE_DIR = path.join(ROOT, 'services', 'local-engine');
const BASE = 'http://127.0.0.1:8765';
const outDir = process.argv[2] || ROOT;

let child = null;
const probe = async () => { try { return (await fetch(BASE + '/status')).ok; } catch { return false; } };

function env() {
  const out = {};
  for (const line of fs.readFileSync(path.join(APP_DIR, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

ipcMain.handle('engine:analyze', async (_e, filename, bytes, fields) => {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const res = await fetch(BASE + '/analyze', { method: 'POST', body: form });
  const p = await res.json();
  if (!res.ok) throw new Error(p.detail ?? res.status);
  return p;
});
ipcMain.handle('engine:status', async () => ({
  state: (await probe()) ? 'ready' : 'unavailable', baseUrl: BASE, error: null, capabilities: null,
}));
for (const ch of ['engine:start', 'window:is-maximized', 'window:minimize',
                  'window:toggle-maximize', 'window:close']) ipcMain.handle(ch, () => false);

app.whenReady().then(async () => {
  if (!(await probe())) {
    child = spawn(path.join(ENGINE_DIR, '.venv', 'Scripts', 'python.exe'),
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8765', '--log-level', 'warning'],
      { cwd: ENGINE_DIR, stdio: 'ignore', windowsHide: true });
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !(await probe())) await new Promise((r) => setTimeout(r, 400));
  }

  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = env();
  const ref = new URL(url).hostname.split('.')[0];

  const win = new BrowserWindow({
    width: 1500, height: 1000, show: false, backgroundColor: '#000f16',
    webPreferences: {
      preload: path.join(APP_DIR, 'dist-electron', 'preload.js'),
      contextIsolation: true, sandbox: true,
    },
  });
  await win.loadFile(path.join(APP_DIR, 'dist', 'index.html'));

  await win.webContents.executeJavaScript(`(async () => {
    const s = await fetch(${JSON.stringify(url)} + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: ${JSON.stringify(key)}, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(process.env.NEXUS_EMAIL)},
                             password: ${JSON.stringify(process.env.NEXUS_PASSWORD)} }),
    }).then(r => r.json());
    localStorage.setItem('sb-${ref}-auth-token', JSON.stringify(s));
    return 'ok';
  })()`);

  await win.loadFile(path.join(APP_DIR, 'dist', 'index.html'), { hash: '/models/upload' });
  await new Promise((r) => setTimeout(r, 3500));

  // A pyramid: interesting silhouette, and it has genuine overhangs.
  const stl = buildPyramidStl(60, 60, 80);

  const loaded = await win.webContents.executeJavaScript(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(stl.toString('base64'))}), c => c.charCodeAt(0));
    const file = new File([bytes], 'pyramid.stl', { type: 'model/stl' });
    const input = document.querySelector('input[type=file]');
    if (!input) return 'no file input';
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'dispatched';
  })()`);
  console.log('  file input:', loaded);

  await new Promise((r) => setTimeout(r, 6000));

  const state = await win.webContents.executeJavaScript(`(() => {
    const metric = (label) => {
      const node = [...document.querySelectorAll('p')]
        .find((p) => p.textContent.trim().toLowerCase() === label);
      return node && node.nextElementSibling
        ? node.nextElementSibling.textContent.trim()
        : null;
    };
    const canvas = document.querySelector('canvas');
    return {
      hasCanvas: Boolean(canvas),
      canvasSize: canvas ? canvas.width + 'x' + canvas.height : null,
      hasPanel: /geometry analysis/i.test(document.body.innerText),
      dimensions: metric('dimensions'),
      volume: metric('volume'),
      triangles: metric('triangles'),
      bedFit: /fits the build plate/i.test(document.body.innerText),
    };
  })()`);

  const pass = (m) => console.log('  PASS  ' + m);
  const fail = (m) => { console.log('  FAIL  ' + m); process.exitCode = 1; };
  console.log('\n== upload screen with a model loaded ==');
  state.hasCanvas ? pass(`3D preview rendered (canvas ${state.canvasSize})`) : fail('no preview canvas');
  state.hasPanel ? pass('analysis panel shown') : fail('analysis panel missing');

  const digits = (text) => (text || '').replace(/[^\d.]/g, ' ').trim().split(/\s+/);
  const dims = digits(state.dimensions).map(Number);
  JSON.stringify(dims) === JSON.stringify([60, 60, 80])
    ? pass(`dimensions ${dims.join(' x ')} mm match the source`)
    : fail(`dimensions were ${JSON.stringify(state.dimensions)}`);

  // A pyramid is exactly one third of its bounding box: 60*60*80/3 = 96 cm3.
  Number(digits(state.volume)[0]) === 96
    ? pass('volume 96 cm3 matches the pyramid formula')
    : fail(`volume was ${JSON.stringify(state.volume)}, expected 96`);

  Number(digits(state.triangles)[0]) === 6
    ? pass('6 triangles counted')
    : fail(`triangles were ${JSON.stringify(state.triangles)}`);

  state.bedFit ? pass('bed fit reported') : fail('no bed fit message');


  fs.mkdirSync(outDir, { recursive: true });
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'upload-with-preview.png'), image.toPNG());
  console.log('  captured upload-with-preview.png');

  if (child) child.kill();
  app.exit(process.exitCode ?? 0);
});

function buildPyramidStl(w, d, h) {
  const a = [0,0,0], b = [w,0,0], c = [w,d,0], e = [0,d,0], apex = [w/2,d/2,h];
  const tris = [[a,e,c],[a,c,b],[a,b,apex],[b,c,apex],[c,e,apex],[e,a,apex]];
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const t of tris) {
    off += 12;
    for (const p of t) {
      buf.writeFloatLE(p[0], off); buf.writeFloatLE(p[1], off+4); buf.writeFloatLE(p[2], off+8);
      off += 12;
    }
    off += 2;
  }
  return buf;
}
