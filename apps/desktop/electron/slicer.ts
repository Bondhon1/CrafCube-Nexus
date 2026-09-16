import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import extract from 'extract-zip';
import { engineStatus, slicerInstallDir, startEngine } from './engine';

/**
 * Makes sure there is a slicer, without making anyone wait for one.
 *
 * Every weight and print time in the app now comes from slicing, so a machine
 * without a slicer cannot cost a job at all. But OrcaSlicer is 164 MB, and
 * plenty of users already have it or Anycubic Slicer Next installed. So:
 *
 *   1. ask the engine what it can find — it checks the registry, PATH and the
 *      usual folders, and a slicer the user installed always wins
 *   2. if they have one, use it and download nothing
 *   3. otherwise fetch the pinned OrcaSlicer build in the background, verify
 *      it, and unpack it where the engine will find it on its next request
 *
 * The app stays fully usable throughout; only slicing waits.
 */

/**
 * Pinned to the exact build the slicing pipeline was verified against: the
 * CLI arguments and profile flattening were tuned on it, and the hash is what
 * stops a tampered or truncated download from ever being executed.
 */
const ORCA = {
  version: '2.4.2',
  url: 'https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.4.2/'
     + 'OrcaSlicer_Windows_V2.4.2_x64_portable.zip',
  size: 171_367_668,
  sha256: 'feba3009dfb9d268779cca5758a1a5bc3b7d0722bf8fa48d5c57340de975d6be',
} as const;

/** Archive plus extracted copy, with headroom. Checked before downloading. */
const REQUIRED_FREE_BYTES = 700 * 1024 * 1024;
const MARKER = '.nexus-slicer.json';

export type SlicerSetup =
  | { phase: 'checking' }
  | { phase: 'installed'; name: string }
  | { phase: 'ready'; name: string }
  | { phase: 'downloading'; received: number; total: number }
  | { phase: 'verifying' }
  | { phase: 'extracting' }
  | { phase: 'failed'; error: string }
  | { phase: 'unsupported'; reason: string };

let state: SlicerSetup = { phase: 'checking' };
let running: Promise<void> | null = null;

export function slicerSetupState(): SlicerSetup {
  return state;
}

function publish(next: SlicerSetup): void {
  state = next;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('slicer:state', state);
  }
}

function slicerRoot(): string {
  return path.dirname(slicerInstallDir());
}

/** Starts the check-then-download once; later calls join the same run. */
export function ensureSlicer(): Promise<void> {
  if (!running) {
    running = setup().finally(() => { running = null; });
  }
  return running;
}

async function setup(): Promise<void> {
  publish({ phase: 'checking' });

  if (process.platform !== 'win32' || process.arch !== 'x64') {
    publish({
      phase: 'unsupported',
      reason: 'Automatic download covers 64-bit Windows. Install OrcaSlicer or '
            + 'Anycubic Slicer Next and it will be found.',
    });
    return;
  }

  // Discovery lives in the engine, so the installed-slicer check and the
  // slicer that actually gets used can never disagree.
  const engine = await startEngine();
  if (engine !== 'ready') {
    publish({ phase: 'failed', error: (await engineStatus()).error ?? 'The local engine is not running.' });
    return;
  }

  const found = await findSlicers();
  const own = found.find((s) => s.source === 'installed' || s.source === 'configured');
  if (own) {
    publish({ phase: 'installed', name: own.name });
    return;
  }
  // A development checkout carries its own copy in tools/orca.
  const bundled = found.find((s) => s.source === 'bundled');
  if (bundled) {
    publish({ phase: 'ready', name: bundled.name });
    return;
  }
  // A previous download counts only if it is the pinned version, intact. An
  // older one is replaced rather than trusted.
  const downloaded = found.find((s) => s.source === 'downloaded');
  if (downloaded && await markerMatches()) {
    publish({ phase: 'ready', name: downloaded.name });
    return;
  }

  try {
    await download();
    publish({ phase: 'ready', name: `OrcaSlicer ${ORCA.version}` });
  } catch (err) {
    publish({ phase: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
}

interface FoundSlicer { name: string; executable: string; source: string }

async function findSlicers(): Promise<FoundSlicer[]> {
  const status = await engineStatus();
  const caps = status.capabilities as { slicers?: FoundSlicer[] } | null;
  return caps?.slicers ?? [];
}

async function markerMatches(): Promise<boolean> {
  try {
    const marker = JSON.parse(await fs.readFile(path.join(slicerInstallDir(), MARKER), 'utf8'));
    return marker.version === ORCA.version && marker.sha256 === ORCA.sha256;
  } catch {
    return false;
  }
}

async function hashFile(file: string): Promise<{ hash: ReturnType<typeof createHash>; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  if (!existsSync(file)) return { hash, bytes };
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (chunk) => { hash.update(chunk); bytes += chunk.length; })
      .on('end', resolve)
      .on('error', reject);
  });
  return { hash, bytes };
}

async function download(): Promise<void> {
  const root = slicerRoot();
  await fs.mkdir(root, { recursive: true });

  const { bavail, bsize } = await fs.statfs(root);
  if (bavail * bsize < REQUIRED_FREE_BYTES) {
    throw new Error(
      `Not enough disk space to set up the slicer: it needs about 700 MB free on `
      + `the drive holding ${root}.`,
    );
  }

  const url = process.env.NEXUS_SLICER_URL || ORCA.url;
  const partial = path.join(root, `orca-${ORCA.version}.zip.part`);

  // Resume rather than restart: 164 MB is a lot to lose to a dropped
  // connection or the app being closed. The bytes already on disk are hashed
  // first, so the final check still covers the whole file.
  let { hash, bytes: have } = await hashFile(partial);
  if (have > ORCA.size) {
    await fs.rm(partial, { force: true });
    ({ hash, bytes: have } = await hashFile(partial));
  }

  if (have < ORCA.size) {
    const response = await fetch(url, {
      headers: have > 0 ? { Range: `bytes=${have}-` } : {},
      redirect: 'follow',
    });

    if (have > 0 && response.status !== 206) {
      // The server ignored the range; start clean so the hash stays honest.
      await fs.rm(partial, { force: true });
      hash = createHash('sha256');
      have = 0;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Slicer download failed: HTTP ${response.status}.`);
    }

    const out = createWriteStream(partial, { flags: have > 0 ? 'a' : 'w' });
    let received = have;
    let lastPublish = 0;
    const reader = response.body.getReader();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        // Respect backpressure: disk is often slower than the network here.
        if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));

        const now = Date.now();
        if (now - lastPublish > 250) {
          lastPublish = now;
          publish({ phase: 'downloading', received, total: ORCA.size });
        }
      }
    } finally {
      await new Promise<void>((resolve) => out.end(resolve));
    }
    publish({ phase: 'downloading', received, total: ORCA.size });
  }

  publish({ phase: 'verifying' });
  const { size } = await fs.stat(partial);
  const digest = hash.digest('hex');
  if (size !== ORCA.size || digest !== ORCA.sha256) {
    await fs.rm(partial, { force: true });
    throw new Error(
      'The downloaded slicer did not match its expected checksum, so it was '
      + 'discarded rather than run. Retry to download it again.',
    );
  }

  publish({ phase: 'extracting' });
  const target = slicerInstallDir();
  // Unpacked beside the target and renamed into place, so discovery can never
  // find a half-extracted slicer and try to run it.
  const staging = `${target}.staging-${process.pid}`;
  await fs.rm(staging, { recursive: true, force: true });
  await extract(partial, { dir: staging });
  await fs.writeFile(
    path.join(staging, MARKER),
    JSON.stringify({ version: ORCA.version, sha256: ORCA.sha256, installedAt: new Date() }),
  );
  await fs.rm(target, { recursive: true, force: true });
  await fs.rename(staging, target);
  await fs.rm(partial, { force: true });
}

/** Leftover staging folders from a run that was interrupted mid-extract. */
export async function cleanUpStaging(): Promise<void> {
  const root = slicerRoot();
  try {
    for (const entry of await fs.readdir(root)) {
      if (entry.includes('.staging-')) {
        await fs.rm(path.join(root, entry), { recursive: true, force: true });
      }
    }
  } catch {
    /* nothing there yet */
  }
}
