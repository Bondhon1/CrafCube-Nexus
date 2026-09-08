import { supabase } from '@/lib/supabase';

/**
 * Object storage behind a narrow interface.
 *
 * Design doc §44 targets Cloudflare R2, which needs a payment method. Two
 * implementations exist and are chosen by VITE_STORAGE_BACKEND: Supabase
 * Storage (default) and Backblaze B2. Because B2 speaks the S3 API, adding R2
 * later means supplying different credentials to the same signing path.
 *
 * See docs/storage-backend.md.
 */
export interface ObjectStore {
  readonly name: string;
  /** Hard cap the backend enforces, in bytes. */
  readonly maxFileBytes: number;
  upload(key: string, file: Blob, contentType?: string): Promise<void>;
  /** Time-limited URL for a private object. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  download(key: string): Promise<Blob>;
  remove(keys: string[]): Promise<void>;
}

const BUCKET = 'models';

/** Matches the bucket's file_size_limit in the migration. */
const SUPABASE_MAX_BYTES = 50 * 1024 * 1024;

class SupabaseObjectStore implements ObjectStore {
  readonly name = 'Supabase Storage';
  readonly maxFileBytes = SUPABASE_MAX_BYTES;

  async upload(key: string, file: Blob, contentType?: string): Promise<void> {
    const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
      contentType: contentType || 'application/octet-stream',
      // Keys embed a content hash, so identical bytes yield the same key and
      // re-uploading is a no-op rather than a conflict.
      upsert: true,
    });
    if (error) throw new Error(error.message);
  }

  async signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(key, expiresInSeconds);
    if (error || !data) throw new Error(error?.message ?? 'could not sign URL');
    return data.signedUrl;
  }

  async download(key: string): Promise<Blob> {
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (error || !data) throw new Error(error?.message ?? 'download failed');
    return data;
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { error } = await supabase.storage.from(BUCKET).remove(keys);
    if (error) throw new Error(error.message);
  }
}

/**
 * Backblaze B2 over its S3-compatible API.
 *
 * The account key never reaches this process. Every request is signed by the
 * `storage-sign` edge function, which checks organization membership first, so
 * authorization stays database-driven as §77 requires.
 *
 * Transfers run in the Electron main process: a presigned request from the
 * renderer is cross-origin and would need bucket CORS rules, while Node applies
 * no CORS check at all.
 */
class B2ObjectStore implements ObjectStore {
  readonly name = 'Backblaze B2';
  /** S3 caps a single PUT at 5 GB; larger objects need multipart upload. */
  readonly maxFileBytes = 5 * 1024 * 1024 * 1024;

  private async sign(
    op: 'put' | 'get' | 'delete',
    key: string,
    options: { contentType?: string; expiresIn?: number } = {},
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const { data, error } = await supabase.functions.invoke('storage-sign', {
      body: { op, key, ...options },
    });
    if (error) throw new Error(`could not sign ${op}: ${error.message}`);
    if (!data?.url) throw new Error(data?.error ?? 'signing returned no URL');
    return { url: data.url, headers: data.headers ?? {} };
  }

  private get bridge(): NexusStorage {
    const bridge = window.nexus?.storage;
    if (!bridge) {
      throw new Error(
        'B2 transfers require the desktop app: the browser would be blocked by CORS.',
      );
    }
    return bridge;
  }

  async upload(key: string, file: Blob, contentType?: string): Promise<void> {
    const type = contentType || 'application/octet-stream';
    const { url, headers } = await this.sign('put', key, { contentType: type });
    await this.bridge.put(url, headers, await file.arrayBuffer());
  }

  async signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const { url } = await this.sign('get', key, { expiresIn: expiresInSeconds });
    return url;
  }

  async download(key: string): Promise<Blob> {
    const { url } = await this.sign('get', key);
    return new Blob([await this.bridge.get(url)]);
  }

  async remove(keys: string[]): Promise<void> {
    // B2's S3 API has no batch delete through a presigned URL, so one at a time.
    for (const key of keys) {
      const { url } = await this.sign('delete', key);
      await this.bridge.remove(url);
    }
  }
}

function selectStore(): ObjectStore {
  const backend = (import.meta.env.VITE_STORAGE_BACKEND ?? 'supabase').toLowerCase();
  return backend === 'b2' ? new B2ObjectStore() : new SupabaseObjectStore();
}

export const objectStore: ObjectStore = selectStore();

/**
 * SHA-256 of the file, for duplicate detection (§17). Reads the whole file into
 * memory, which is fine at the sizes the upload screen accepts.
 */
export async function sha256(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const MODEL_EXTENSIONS = ['.stl', '.3mf', '.obj', '.amf', '.ply', '.gcode'] as const;

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i).toLowerCase();
}

export function isSupportedModel(filename: string): boolean {
  return (MODEL_EXTENSIONS as readonly string[]).includes(extensionOf(filename));
}

/**
 * Object key layout from §77: the organization id leads, so the storage
 * policies can authorize on the path itself.
 *
 *   <organization_id>/models/<model_id>/v<version>/<sha256><ext>
 */
export function modelObjectKey(args: {
  organizationId: string;
  modelId: string;
  version: number;
  sha256: string;
  extension: string;
}): string {
  const { organizationId, modelId, version, sha256: hash, extension } = args;
  return `${organizationId}/models/${modelId}/v${version}/${hash}${extension}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
