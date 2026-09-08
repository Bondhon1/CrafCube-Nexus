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
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

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

app.whenReady().then(async () => {
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = env();
  const ref = new URL(url).hostname.split('.')[0];
  const email = process.env.NEXUS_EMAIL;
  const password = process.env.NEXUS_PASSWORD;

  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    show: false,
    backgroundColor: '#000f16',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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
    const image = await win.webContents.capturePage();
    const name = (route.replace(/^\//, '').replace(/\//g, '-') || 'dashboard') + '.png';
    fs.writeFileSync(path.join(outDir, name), image.toPNG());
    console.log('captured', name);
  }

  app.exit(0);
});
