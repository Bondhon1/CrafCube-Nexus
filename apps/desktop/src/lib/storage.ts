import { supabase } from '@/lib/supabase';

/**
 * Object storage behind a narrow interface.
 *
 * Design doc §44 targets Cloudflare R2. Supabase Storage backs it for now
 * because it needs no separate account and reuses the RLS already in place;
 * moving to R2 means writing a second `ObjectStore` and issuing presigned URLs
 * from an edge function, with nothing above this file changing.
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

export const objectStore: ObjectStore = new SupabaseObjectStore();

/**
 * SHA-256 of the file, for duplicate detection (§17). Hashed in 8 MB slices so
 * a large model does not have to sit in memory twice.
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
