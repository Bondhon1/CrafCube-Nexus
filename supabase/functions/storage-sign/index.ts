/**
 * Presigned URL broker for Backblaze B2 (S3-compatible).
 *
 * The B2 application key is account-wide: anything holding it can read or
 * delete every object. It therefore lives only in this function's secrets,
 * never in the desktop bundle, where Vite would inline it into every install.
 *
 * Authorization is database-driven, as design doc §77 requires. The caller's
 * own JWT is used for the membership check, so RLS decides — this function
 * never elevates to the service role.
 *
 * Deploy:
 *   supabase functions deploy storage-sign --project-ref <ref>
 * Secrets:
 *   supabase secrets set B2_REGION=... B2_BUCKET=... B2_KEY_ID=... B2_APPLICATION_KEY=...
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

type Operation = 'put' | 'get' | 'delete';

interface SignRequest {
  op: Operation;
  key: string;
  contentType?: string;
  expiresIn?: number;
}

const MAX_EXPIRY_SECONDS = 3600;
const DEFAULT_EXPIRY_SECONDS = 300;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keys are `<organization_id>/models/...`. Rejecting traversal and absolute
 * paths here means a caller cannot escape their organization's prefix by
 * smuggling `..` past the membership check.
 */
function organizationFromKey(key: string): string | null {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) return null;
  const first = key.split('/')[0];
  return UUID_RE.test(first) ? first : null;
}

/**
 * B2 shows the endpoint as `s3.us-east-005.backblazeb2.com` while the signer
 * needs the bare region, so accept either and pull the region out. Trailing
 * whitespace from a pasted value would otherwise corrupt every signature.
 */
function normalizeRegion(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const match = raw.match(/[a-z]{2,}-[a-z]+-\d{3,4}/i);
  return match ? match[0].toLowerCase() : raw;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'missing Authorization header' }, 401);

  let body: SignRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const { op, key, contentType } = body;
  if (op !== 'put' && op !== 'get' && op !== 'delete') {
    return json({ error: 'op must be put, get or delete' }, 400);
  }

  const organizationId = organizationFromKey(key);
  if (!organizationId) {
    return json({ error: 'key must start with an organization id' }, 400);
  }

  // The caller's JWT is passed straight through, so every query below runs
  // under that user's RLS rather than with elevated rights.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );

  const { data: user, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.user) return json({ error: 'not authenticated' }, 401);

  // Reads need membership; writes and deletes need the same role the
  // model_files insert policy demands.
  const rpc = op === 'get'
    ? supabase.rpc('is_org_member', { org: organizationId })
    : supabase.rpc('has_role_at_least', { org: organizationId, minimum: 'production_manager' });

  const { data: allowed, error: rpcError } = await rpc;
  if (rpcError) return json({ error: rpcError.message }, 500);
  if (allowed !== true) return json({ error: 'not permitted for this organization' }, 403);

  const region = normalizeRegion(Deno.env.get('B2_REGION'));
  const bucket = Deno.env.get('B2_BUCKET')?.trim();
  const accessKeyId = Deno.env.get('B2_KEY_ID')?.trim();
  const secretAccessKey = Deno.env.get('B2_APPLICATION_KEY')?.trim();
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    return json({ error: 'storage backend is not configured' }, 500);
  }

  const expiresIn = Math.min(
    Math.max(Number(body.expiresIn) || DEFAULT_EXPIRY_SECONDS, 30),
    MAX_EXPIRY_SECONDS,
  );

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const target = new URL(
    `https://s3.${region}.backblazeb2.com/${bucket}/${encodedKey}`,
  );
  // aws4fetch reads the expiry from this parameter when signing the query.
  target.searchParams.set('X-Amz-Expires', String(expiresIn));

  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });
  const method = op === 'put' ? 'PUT' : op === 'delete' ? 'DELETE' : 'GET';

  const signed = await aws.sign(target.toString(), {
    method,
    headers: op === 'put' && contentType ? { 'Content-Type': contentType } : undefined,
    aws: { signQuery: true, allHeaders: false },
  });

  return json({
    url: signed.url,
    method,
    // Returned so the client can fail fast instead of discovering a 403 later.
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    // Signed headers must be replayed verbatim or the signature will not match.
    headers: op === 'put' && contentType ? { 'Content-Type': contentType } : {},
  });
});
