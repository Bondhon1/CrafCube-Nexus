/**
 * Round-trips a file through the exact path the app uses:
 *   renderer -> storage-sign edge function -> IPC -> main-process fetch -> B2
 *
 * The HTTP-only test covers signing and B2 itself; this exists to prove the IPC
 * hop, where an ArrayBuffer has to survive structured cloning intact.
 *
 * Usage: electron scripts/verify-b2.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const APP_DIR = path.join(__dirname, '..', 'apps', 'desktop');

function env() {
  const out = {};
  for (const line of fs.readFileSync(path.join(APP_DIR, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Same contract as electron/main.ts.
ipcMain.handle('storage:put', async (_e, url, headers, body) => {
  const res = await fetch(url, { method: 'PUT', headers, body });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { etag: res.headers.get('etag'), sent: body.byteLength };
});
ipcMain.handle('storage:get', async (_e, url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return await res.arrayBuffer();
});
ipcMain.handle('storage:delete', async (_e, url) => {
  const res = await fetch(url, { method: 'DELETE' });
  return res.ok || res.status === 404;
});

// The renderer's title bar probes these; the real handlers live in main.ts.
ipcMain.handle('window:is-maximized', () => false);
ipcMain.handle('window:minimize', () => {});
ipcMain.handle('window:toggle-maximize', () => false);
ipcMain.handle('window:close', () => {});

app.whenReady().then(async () => {
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = env();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'dist-electron', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(APP_DIR, 'dist', 'index.html'));

  // A 3 MB payload, large enough that a truncated transfer would be obvious.
  const payload = crypto.randomBytes(3 * 1024 * 1024);
  const expected = crypto.createHash('sha256').update(payload).digest('hex');

  const result = await win.webContents.executeJavaScript(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(payload.toString('base64'))}), c => c.charCodeAt(0));

    const auth = await fetch(${JSON.stringify(url)} + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: ${JSON.stringify(key)}, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(process.env.NEXUS_EMAIL)},
                             password: ${JSON.stringify(process.env.NEXUS_PASSWORD)} }),
    }).then((r) => r.json());

    const orgs = await fetch(${JSON.stringify(url)} + '/rest/v1/organizations?select=id', {
      headers: { apikey: ${JSON.stringify(key)}, Authorization: 'Bearer ' + auth.access_token },
    }).then((r) => r.json());

    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const key = orgs[0].id + '/models/' + crypto.randomUUID() + '/v1/' + digest + '.stl';

    const sign = async (op, extra = {}) => fetch(
      ${JSON.stringify(url)} + '/functions/v1/storage-sign',
      { method: 'POST',
        headers: { apikey: ${JSON.stringify(key)}, Authorization: 'Bearer ' + auth.access_token,
                   'Content-Type': 'application/json' },
        body: JSON.stringify({ op, key, ...extra }) }).then((r) => r.json());

    const put = await sign('put', { contentType: 'model/stl' });
    const uploaded = await window.nexus.storage.put(put.url, put.headers, bytes.buffer);

    const get = await sign('get');
    const back = await window.nexus.storage.get(get.url);
    const backDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', back))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');

    const del = await sign('delete');
    const removed = await window.nexus.storage.remove(del.url);

    return { sentBytes: uploaded.sent, receivedBytes: back.byteLength, digest, backDigest, removed };
  })()`);

  const pass = (m) => console.log('  PASS  ' + m);
  const fail = (m) => { console.log('  FAIL  ' + m); process.exitCode = 1; };

  console.log(`\n  payload ${payload.length} bytes, sha256 ${expected.slice(0, 16)}…`);
  result.digest === expected ? pass('renderer hashed the same bytes') : fail('hash mismatch in renderer');
  result.sentBytes === payload.length
    ? pass(`IPC delivered all ${result.sentBytes} bytes to the main process`)
    : fail(`IPC truncated: ${result.sentBytes} of ${payload.length}`);
  result.receivedBytes === payload.length
    ? pass(`download returned ${result.receivedBytes} bytes`)
    : fail(`download truncated: ${result.receivedBytes}`);
  result.backDigest === expected
    ? pass('round-tripped bytes are identical')
    : fail('round-trip corrupted the payload');
  result.removed ? pass('delete succeeded') : fail('delete failed');

  app.exit(process.exitCode ?? 0);
});
