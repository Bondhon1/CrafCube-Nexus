/**
 * End-to-end Phase 2 check: spawns the local engine exactly as the app does,
 * analyses a real STL through the IPC bridge, and confirms the numbers match
 * the shape's known dimensions.
 *
 * Usage: electron scripts/verify-phase2.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'apps', 'desktop');
const ENGINE_DIR = path.join(ROOT, 'services', 'local-engine');
const PY = path.join(ENGINE_DIR, '.venv', 'Scripts', 'python.exe');
const BASE = 'http://127.0.0.1:8765';

let child = null;

async function probe() {
  try {
    const r = await fetch(BASE + '/status');
    return r.ok;
  } catch { return false; }
}

async function startEngine() {
  if (await probe()) return 'already running';
  child = spawn(PY, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1',
                     '--port', '8765', '--log-level', 'warning'],
                { cwd: ENGINE_DIR, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await probe()) return 'started';
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('engine did not start');
}

ipcMain.handle('engine:analyze', async (_e, filename, bytes, fields) => {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const res = await fetch(BASE + '/analyze', { method: 'POST', body: form });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.detail ?? res.status);
  return payload;
});
ipcMain.handle('engine:status', async () => ({
  state: (await probe()) ? 'ready' : 'unavailable', baseUrl: BASE, error: null,
  capabilities: (await probe()) ? await (await fetch(BASE + '/capabilities')).json() : null,
}));
ipcMain.handle('engine:start', () => 'ready');
for (const ch of ['window:is-maximized', 'window:minimize', 'window:toggle-maximize', 'window:close']) {
  ipcMain.handle(ch, () => false);
}

app.whenReady().then(async () => {
  const pass = (m) => console.log('  PASS  ' + m);
  const fail = (m) => { console.log('  FAIL  ' + m); process.exitCode = 1; };

  console.log('\n== engine ==');
  console.log('  ' + (await startEngine()));

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'dist-electron', 'preload.js'),
      contextIsolation: true, sandbox: true,
    },
  });
  await win.loadFile(path.join(APP_DIR, 'dist', 'index.html'));

  // Build a 40 x 50 x 60 mm box STL by hand so the expected answers are exact.
  const stl = buildBoxStl(40, 50, 60);
  fs.writeFileSync(path.join(ENGINE_DIR, 'sample-box.stl'), stl);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(stl.toString('base64'))}), c => c.charCodeAt(0));
    const status = await window.nexus.engine.status();
    const analysis = await window.nexus.engine.analyze('box.stl', bytes.buffer, {
      bed_x_mm: 260, bed_y_mm: 260, bed_z_mm: 260, density_g_cm3: 1.24, infill_percent: 15,
    });
    return { status, analysis };
  })()`);

  const { status, analysis } = result;
  console.log('\n== capabilities ==');
  console.log('  slicing:', status.capabilities?.slicing);
  console.log('  levels:', JSON.stringify(status.capabilities?.analysis_levels));

  console.log('\n== analysis through the IPC bridge ==');
  const d = analysis.geometry.dimensions;
  console.log(`  ${d.width_mm} x ${d.depth_mm} x ${d.height_mm} mm, ${analysis.geometry.volume_cm3} cm3`);
  console.log(`  ${analysis.bed_fit.message}`);
  console.log(`  estimate ${analysis.estimate.filament_grams} g (${analysis.estimate.confidence})`);

  d.width_mm === 40 && d.depth_mm === 50 && d.height_mm === 60
    ? pass('dimensions match the 40x50x60 mm source')
    : fail(`dimensions wrong: ${JSON.stringify(d)}`);
  Math.abs(analysis.geometry.volume_cm3 - 120) < 0.01
    ? pass('volume is 120 cm3 as expected')
    : fail(`volume wrong: ${analysis.geometry.volume_cm3}`);
  analysis.geometry.is_watertight ? pass('mesh reported watertight') : fail('mesh not watertight');
  analysis.bed_fit.fits ? pass('fits the Kobra X plate') : fail('bed fit wrong');
  analysis.estimate.confidence === 'LOW'
    ? pass('geometry estimate labelled LOW confidence')
    : fail(`confidence was ${analysis.estimate.confidence}`);

  if (child) child.kill();
  app.exit(process.exitCode ?? 0);
});

/** Minimal binary STL for an axis-aligned box, so expected values are exact. */
function buildBoxStl(x, y, z) {
  const v = [
    [0,0,0],[x,0,0],[x,y,0],[0,y,0],
    [0,0,z],[x,0,z],[x,y,z],[0,y,z],
  ];
  const quads = [
    [0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],
  ];
  const tris = [];
  for (const [a,b,c,d] of quads) { tris.push([v[a],v[b],v[c]]); tris.push([v[a],v[c],v[d]]); }

  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const t of tris) {
    off += 12; // normal left zero; trimesh recomputes from winding
    for (const p of t) {
      buf.writeFloatLE(p[0], off); buf.writeFloatLE(p[1], off + 4); buf.writeFloatLE(p[2], off + 8);
      off += 12;
    }
    off += 2;
  }
  return buf;
}
