const BUCKET = 'verified-profile-photos';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ProxyConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Vary': 'Authorization, Origin',
  'X-Content-Type-Options': 'nosniff',
  // Explicit Bearer authorization; no cookie-based authentication/credentials.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function safeError(status: number): Response {
  return new Response(status === 401 ? 'Authentication required' : 'Photo unavailable', {
    status,
    headers: { ...RESPONSE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new Error('Missing body');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readLimited(response.body, 64 * 1024)));
}

// Do not accept URLs, traversal or encoded separators, even from trusted media
// metadata. Encode each segment so only this project's fixed bucket is fetched.
function objectKey(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024
    || /[\s\\%?#:\u0000-\u001f\u007f]/.test(path)) return null;
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
  return segments.map(encodeURIComponent).join('/');
}

function matchesImageType(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8
    && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  if (type === 'image/webp') return bytes.length >= 12
    && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
  return false;
}

// Uses standard Fetch APIs so authorization and byte handling can be tested
// offline. No service client ever receives the incoming user's global headers.
export function createPhotoHandler(config: ProxyConfig, fetcher: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
    if (request.method !== 'POST') return safeError(405);

    const bearer = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!bearer) return safeError(401);
    if (!config.supabaseUrl || !config.serviceRoleKey) return safeError(503);

    try {
      const base = new URL(config.supabaseUrl);
      if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password
        || base.search || base.hash || base.pathname !== '/') return safeError(503);
      // HTTP is for the local Supabase development stack; hosted URLs use HTTPS.
      if (base.protocol === 'http:' && !['localhost', '127.0.0.1', 'kong'].includes(base.hostname)) return safeError(503);
      const root = base.origin;
      const signal = AbortSignal.timeout(15_000);
      const upstreamOptions = { redirect: 'error' as const, cache: 'no-store' as const, signal };

      // GET /auth/v1/user is the Auth server verification used by getUser(jwt).
      // Never decode/trust client claims locally or accept a viewer ID in JSON.
      const auth = await fetcher(`${root}/auth/v1/user`, {
        ...upstreamOptions,
        headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${bearer}` },
      });
      if (!auth.ok || auth.redirected) return safeError(401);
      const user = await readJson(auth);
      if (!isRecord(user) || typeof user.id !== 'string' || !UUID_PATTERN.test(user.id)
        || user.role !== 'authenticated') return safeError(401);

      if (new URL(request.url).search || request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return safeError(404);
      }
      const payload: unknown = JSON.parse(new TextDecoder().decode(await readLimited(request.body, 1024)));
      if (!isRecord(payload) || Object.keys(payload).length !== 1
        || typeof payload.profilePhotoToken !== 'string' || !TOKEN_PATTERN.test(payload.profilePhotoToken)) return safeError(404);

      const serverHeaders: Record<string, string> = {
  apikey: config.serviceRoleKey,
};

// New Supabase secret keys are API keys rather than JWTs, so they must
// not be sent as Authorization Bearer values. Legacy service_role keys
// are JWTs and remain supported during the migration period.
if (!config.serviceRoleKey.startsWith('sb_secret_')) {
  serverHeaders.Authorization = `Bearer ${config.serviceRoleKey}`;
}
      const resolution = await fetcher(`${root}/rest/v1/rpc/resolve_post_activation_photo_for_server`, {
        ...upstreamOptions,
        method: 'POST',
        headers: { ...serverHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_photo_token: payload.profilePhotoToken, p_viewer_member_id: user.id }),
      });
      if (!resolution.ok || resolution.redirected) return safeError(404);
      const rows = await readJson(resolution);
      if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) return safeError(404);
      const key = objectKey(rows[0].storage_path);
      if (!key) return safeError(404);

      // Private authenticated download, never /public, /sign or a client redirect.
      const stored = await fetcher(`${root}/storage/v1/object/${BUCKET}/${key}`, {
        ...upstreamOptions, headers: serverHeaders,
      });
      if (!stored.ok || stored.redirected) return safeError(404);
      const type = stored.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
      if (!IMAGE_TYPES.has(type)) return safeError(404);
      const bytes = await readLimited(stored.body, MAX_IMAGE_BYTES);
      if (!matchesImageType(bytes, type)) return safeError(404);

      // Return only bounded raster bytes and fresh allowlisted headers. Never
      // forward upstream Location, Content-Disposition, ETag or error bodies.
      return new Response(bytes, { headers: { ...RESPONSE_HEADERS, 'Content-Type': type } });
    } catch {
      // No exception objects, URLs, identifiers, credentials or upstream bodies
      // are logged or returned. All unavailable-photo conditions look alike.
      return safeError(404);
    }
  };
}
