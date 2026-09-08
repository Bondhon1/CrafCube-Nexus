import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
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
const PORT = Number(process.env.NEXUS_ENGINE_PORT ?? 8765);

/**
 * Engine build this app expects, matching VERSION in services/local-engine.
 *
 * Reusing whatever already listens on the port is convenient in development,
 * but it silently pinned the app to an engine started before a code change —
 * a fixed slicer-discovery bug kept reporting "no slicer installed" because
 * the old process was still answering. Bump this whenever engine behaviour
 * the app depends on changes.
 */
const EXPECTED_VERSION = '0.2.0';

export const engineBaseUrl = `http://${HOST}:${PORT}`;

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

function pythonExecutable(root: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [path.join(root, '.venv', 'Scripts', 'python.exe')]
      : [path.join(root, '.venv', 'bin', 'python3'), path.join(root, '.venv', 'bin', 'python')];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface EngineIdentity {
  version: string;
  pid: number;
}

/** Reads /status, or null when nothing is answering. */
async function identify(timeoutMs = 1500): Promise<EngineIdentity | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${engineBaseUrl}/status`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: string; pid?: number };
    return { version: body.version ?? 'unknown', pid: Number(body.pid ?? 0) };
  } catch {
    return null;
  }
}

async function probe(timeoutMs = 1500): Promise<boolean> {
  return (await identify(timeoutMs)) !== null;
}

export async function startEngine(): Promise<EngineState> {
  if (state === 'ready' || state === 'starting') return state;

  // An engine already running — started by hand during development — is reused,
  // but only when it is the build this app expects. An outdated one is stopped
  // rather than adopted, because adopting it makes fixed bugs look unfixed.
  const existing = await identify();
  if (existing) {
    if (existing.version === EXPECTED_VERSION) {
      state = 'ready';
      return state;
    }

    lastError =
      `Replacing engine ${existing.version} (pid ${existing.pid}); ` +
      `this app expects ${EXPECTED_VERSION}.`;
    try {
      // Same machine, loopback only, and the pid comes from our own service.
      process.kill(existing.pid);
    } catch {
      state = 'unavailable';
      lastError =
        `An engine running version ${existing.version} holds port ${PORT} and could not be ` +
        `stopped. Close it and restart the app.`;
      return state;
    }
    // Give the port a moment to clear before binding it.
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  const root = engineRoot();
  const python = pythonExecutable(root);
  if (!python) {
    state = 'unavailable';
    lastError =
      `No Python environment at ${path.join(root, '.venv')}. ` +
      'Create it with: python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt';
    return state;
  }

  state = 'starting';
  lastError = null;

  child = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', HOST, '--port', String(PORT), '--log-level', 'warning'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
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
      capabilities = await (await fetch(`${engineBaseUrl}/capabilities`)).json();
    } catch {
      capabilities = null;
    }
  }

  return { state, baseUrl: engineBaseUrl, error: lastError, capabilities };
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
  const response = await fetch(`${engineBaseUrl}${route}`, {
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

  const response = await fetch(`${engineBaseUrl}${route}`, {
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
