import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app } from 'electron';

/**
 * Supervises the Python local engine (design doc §37-§39).
 *
 * The engine is optional: the desktop app stays fully usable without it, and
 * every caller must handle it being unavailable. That matters because the
 * engine needs a Python environment that a packaged install may not have.
 */

const HOST = '127.0.0.1';

/**
 * Where the engine prefers to listen, and how far it will look if that is
 * taken.
 *
 * 8765 is not ours to claim: any other local dev server can already hold it,
 * and one did — a python http.server from an unrelated project, which answered
 * the health check with a 404 page. The old code read that as "nothing is
 * running", spawned uvicorn anyway, and surfaced a raw WinError 10048 on the
 * next slice. A port is an implementation detail, so the engine now finds one.
 */
const BASE_PORT = Number(process.env.NEXUS_ENGINE_PORT ?? 8765);
const PORT_ATTEMPTS = 12;

let port = BASE_PORT;

/**
 * Engine build this app expects, matching VERSION in services/local-engine.
 *
 * Reusing whatever already listens on the port is convenient in development,
 * but it silently pinned the app to an engine started before a code change —
 * a fixed slicer-discovery bug kept reporting "no slicer installed" because
 * the old process was still answering. Bump this whenever engine behaviour
 * the app depends on changes.
 */
const EXPECTED_VERSION = '0.5.0';

/** Only valid once startEngine has chosen a port. */
export function engineBaseUrl(): string {
  return `http://${HOST}:${port}`;
}

export type EngineState = 'stopped' | 'starting' | 'ready' | 'unavailable';

let child: ChildProcess | null = null;
let state: EngineState = 'stopped';
let lastError: string | null = null;

function engineRoot(): string {
  // Packaged builds ship the service beside the app resources; in development
  // it sits in the repository next to apps/.
  const packaged = path.join(process.resourcesPath ?? '', 'local-engine');
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return path.join(app.getAppPath(), '..', '..', 'services', 'local-engine');
}

interface Interpreter {
  path: string;
  /**
   * The embeddable Python shipped in the installer. It runs isolated (`-I`):
   * without that, the user's own per-user site-packages is still on the path,
   * and trimesh's optional imports would quietly pick up whatever scipy or
   * embree they once installed — behaving differently on every machine.
   */
  bundled: boolean;
}

function pythonExecutable(root: string): Interpreter | null {
  const candidates: Interpreter[] = process.platform === 'win32'
    ? [
        { path: path.join(root, 'python', 'python.exe'), bundled: true },
        { path: path.join(root, '.venv', 'Scripts', 'python.exe'), bundled: false },
      ]
    : [
        { path: path.join(root, '.venv', 'bin', 'python3'), bundled: false },
        { path: path.join(root, '.venv', 'bin', 'python'), bundled: false },
      ];

  return candidates.find((candidate) => existsSync(candidate.path)) ?? null;
}

/** Where the app keeps the OrcaSlicer it downloads, when the user has none. */
export function slicerInstallDir(): string {
  return path.join(app.getPath('userData'), 'slicer', 'orca');
}

interface EngineIdentity {
  version: string;
  pid: number;
}

/**
 * What is answering on a port.
 *
 * 'foreign' is the case that used to be missed: something replied, but it was
 * not this engine, so the port is unusable rather than empty.
 */
type Occupant =
  | { kind: 'none' }
  | { kind: 'foreign' }
  | { kind: 'engine'; identity: EngineIdentity };

async function inspect(candidate: number, timeoutMs = 1500): Promise<Occupant> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    response = await fetch(`http://${HOST}:${candidate}/status`, { signal: controller.signal });
    clearTimeout(timer);
  } catch {
    // Connection refused, or nothing answered in time.
    return { kind: 'none' };
  }

  if (!response.ok) return { kind: 'foreign' };
  try {
    const body = (await response.json()) as { version?: string; pid?: number };
    // Our /status always carries a version. Anything else is somebody else.
    if (!body.version) return { kind: 'foreign' };
    return { kind: 'engine', identity: { version: body.version, pid: Number(body.pid ?? 0) } };
  } catch {
    return { kind: 'foreign' };
  }
}

/** Reads /status on the chosen port, or null when nothing is answering. */
async function identify(timeoutMs = 1500): Promise<EngineIdentity | null> {
  const occupant = await inspect(port, timeoutMs);
  return occupant.kind === 'engine' ? occupant.identity : null;
}

async function probe(timeoutMs = 1500): Promise<boolean> {
  return (await identify(timeoutMs)) !== null;
}

/** True when nothing holds the port, tested by binding it rather than guessing. */
function isFree(candidate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(candidate, HOST);
  });
}

/**
 * Settle on a port: reuse a matching engine, replace an outdated one, and
 * otherwise take the first port nothing else is holding.
 *
 * An engine already running — started by hand during development — is reused,
 * but only when it is the build this app expects. An outdated one is stopped
 * rather than adopted, because adopting it makes fixed bugs look unfixed.
 */
async function choosePort(): Promise<{ port: number; adopted: boolean } | null> {
  let firstFree: number | null = null;

  for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
    const candidate = BASE_PORT + offset;
    const occupant = await inspect(candidate, 600);

    if (occupant.kind === 'engine') {
      if (occupant.identity.version === EXPECTED_VERSION) {
        return { port: candidate, adopted: true };
      }

      lastError =
        `Replacing engine ${occupant.identity.version} (pid ${occupant.identity.pid}); ` +
        `this app expects ${EXPECTED_VERSION}.`;
      try {
        // Same machine, loopback only, and the pid comes from our own service.
        process.kill(occupant.identity.pid);
      } catch {
        continue;   // Could not stop it; leave the port alone and look further.
      }
      // Give the port a moment to clear before binding it.
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (await isFree(candidate)) return { port: candidate, adopted: false };
      continue;
    }

    // 'foreign' means somebody else answered, so the port is taken even though
    // it is not our engine. Only an empty port is a candidate, and it is
    // confirmed by binding rather than by the absence of a reply.
    if (occupant.kind === 'none' && firstFree === null && await isFree(candidate)) {
      firstFree = candidate;
    }
  }

  return firstFree === null ? null : { port: firstFree, adopted: false };
}

export async function startEngine(): Promise<EngineState> {
  if (state === 'ready' || state === 'starting') return state;

  const chosen = await choosePort();
  if (chosen === null) {
    state = 'unavailable';
    lastError =
      `Ports ${BASE_PORT}-${BASE_PORT + PORT_ATTEMPTS - 1} are all in use by other programs. ` +
      `Free one, or set NEXUS_ENGINE_PORT to a port the engine can have.`;
    return state;
  }
  port = chosen.port;
  if (chosen.adopted) {
    state = 'ready';
    // Nothing went wrong on this path; leaving a stale note here would show up
    // as an error on the slicer screen.
    lastError = null;
    return state;
  }

  const root = engineRoot();
  const python = pythonExecutable(root);
  if (!python) {
    state = 'unavailable';
    lastError = app.isPackaged
      ? `The bundled engine is missing from ${root}. Reinstall the app.`
      : `No Python environment at ${path.join(root, '.venv')}. ` +
        'Create it with: python -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt';
    return state;
  }

  state = 'starting';
  lastError = null;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Tells discovery where a downloaded slicer lives. Read on every request,
    // so a download that finishes later is picked up without a restart.
    NEXUS_SLICER_DIR: slicerInstallDir(),
  };
  // Inherited from how Electron itself was launched; meaningless to Python.
  delete env.ELECTRON_RUN_AS_NODE;

  child = spawn(
    python.path,
    [...(python.bundled ? ['-I'] : []),
     '-m', 'uvicorn', 'app.main:app', '--host', HOST, '--port', String(port),
     '--log-level', 'warning'],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) lastError = text.slice(-500);
  });

  child.on('exit', (code) => {
    child = null;
    if (state !== 'stopped') {
      state = 'unavailable';
      lastError = lastError ?? `engine exited with code ${code}`;
    }
  });

  // Poll rather than parse stdout: uvicorn's banner format is not a contract.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await probe(1000)) {
      state = 'ready';
      return state;
    }
    if (!child) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  state = 'unavailable';
  lastError = lastError ?? 'engine did not become ready within 20s';
  return state;
}

export function stopEngine(): void {
  state = 'stopped';
  if (child) {
    child.kill();
    child = null;
  }
}

export async function engineStatus(): Promise<{
  state: EngineState;
  baseUrl: string;
  error: string | null;
  capabilities: unknown | null;
}> {
  if (state === 'ready' && !(await probe())) {
    state = 'unavailable';
    lastError = 'engine stopped responding';
  }

  let capabilities: unknown = null;
  if (state === 'ready') {
    try {
      capabilities = await (await fetch(`${engineBaseUrl()}/capabilities`)).json();
    } catch {
      capabilities = null;
    }
  }

  return { state, baseUrl: engineBaseUrl(), error: lastError, capabilities };
}

/**
 * Ensures the engine is running, starting it if this is the first call.
 * Every request path needs this, so it lives in one place.
 */
async function ensureReady(): Promise<void> {
  if (state === 'ready') return;
  const started = await startEngine();
  if (started !== 'ready') {
    throw new Error(lastError ?? 'local engine is not running');
  }
}

function buildForm(
  filename: string,
  bytes: ArrayBuffer,
  fields: Record<string, string | number>,
): FormData {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, String(value));
  }
  return form;
}

/** Posts a file and returns the raw response body, for binary endpoints. */
export async function engineUploadBinary(
  route: string,
  filename: string,
  bytes: ArrayBuffer,
  fields: Record<string, string | number> = {},
): Promise<ArrayBuffer> {
  await ensureReady();
  const response = await fetch(`${engineBaseUrl()}${route}`, {
    method: 'POST',
    body: buildForm(filename, bytes, fields),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`engine ${route} failed (${response.status}): ${detail}`);
  }
  return await response.arrayBuffer();
}

/** Posts a file to an engine endpoint as multipart/form-data. */
export async function engineUpload(
  route: string,
  filename: string,
  bytes: ArrayBuffer,
  fields: Record<string, string | number> = {},
): Promise<unknown> {
  await ensureReady();

  const response = await fetch(`${engineBaseUrl()}${route}`, {
    method: 'POST',
    body: buildForm(filename, bytes, fields),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (payload as { detail?: string } | null)?.detail ?? `engine returned ${response.status}`;
    throw new Error(detail);
  }
  return payload;
}
