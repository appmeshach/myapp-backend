import { readBounded } from './face-orchestration.ts';
import type { Backend, ImageType } from './face-orchestration.ts';

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): unknown };
export function runtimeBackend(): Backend {
  let secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof keys.default === 'string' && keys.default) secret = keys.default;
  } catch { /* legacy fallback */ }
  return createBackend(Deno.env.get('SUPABASE_URL') ?? '', secret);
}
export function serve(handler: (req: Request) => Promise<Response>) { Deno.serve(handler); }
export function createBackend(url: string, secret: string, fetcher: typeof fetch = fetch): Backend {
  function root() {
    const u = new URL(url);
    if (!secret || u.username || u.password || u.pathname !== '/' || u.search || u.hash
      || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost','127.0.0.1','kong'].includes(u.hostname)))) throw new Error('Unavailable');
    return u.origin;
  }
  function credentials(): Record<string, string> {
    return { apikey: secret, ...(!secret.startsWith('sb_secret_') ? { Authorization: `Bearer ${secret}` } : {}) };
  }
  async function request(path: string, init: RequestInit, signal: AbortSignal) {
    const r = await fetcher(`${root()}${path}`, { ...init, signal, redirect: 'error', cache: 'no-store' });
    if (!r.ok || r.redirected) throw new Error('Unavailable');
    return r;
  }
  async function json(r: Response, signal: AbortSignal) {
    return JSON.parse(new TextDecoder().decode(await readBounded(r.body, 64 * 1024, signal)));
  }
  return {
    async authenticate(jwt, signal) {
      try {
        const r = await request('/auth/v1/user', { headers: { apikey: secret, Authorization: `Bearer ${jwt}` } }, signal);
        const user = await json(r, signal);
        return user?.role === 'authenticated' && typeof user.id === 'string' ? user.id : null;
      } catch { return null; }
    },
    async rpc(name, args, signal) {
      if (!/^[a-z_]+$/.test(name)) throw new Error('Unavailable');
      const r = await request(`/rest/v1/rpc/${name}`, { method: 'POST',
        headers: { ...credentials(), 'Content-Type': 'application/json' }, body: JSON.stringify(args) }, signal);
      return json(r, signal);
    },
    async upload(bucket: string, key: string, bytes: Uint8Array<ArrayBuffer>, type: ImageType, signal: AbortSignal) {
      if (!['profile-photo-submissions','verified-profile-photos'].includes(bucket)
        || !/^[a-f0-9-]+\/[a-f0-9-]+$/.test(key)) throw new Error('Unavailable');
      await request(`/storage/v1/object/${bucket}/${key}`, { method: 'POST', body: bytes,
        headers: { ...credentials(), 'Content-Type': type, 'x-upsert': 'false' } }, signal);
    },
  };
}
