import { createBackend } from './face-runtime.ts';
import { readBounded } from './face-orchestration.ts';
import type { ActivationPaymentBackend } from './activation-payment.ts';

declare const Deno: { env: { get(name: string): string | undefined } };
export function runtimePaymentBackend(): ActivationPaymentBackend {
  let secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  try { const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof keys.default === 'string' && keys.default) secret = keys.default;
  } catch { /* Existing legacy fallback. */ }
  return createPaymentBackend(Deno.env.get('SUPABASE_URL') ?? '', secret);
}
export function createPaymentBackend(url: string, secret: string, fetcher: typeof fetch = fetch): ActivationPaymentBackend {
  const db = createBackend(url, secret, fetcher);
  return {
    authenticate: db.authenticate, rpc: db.rpc,
    async resolveOfferingAlignment(need, viewer, signal) {
      const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      if (!uuid.test(need) || !uuid.test(viewer)) throw new Error('Unavailable');
      const root = new URL(url);
      if (!secret || root.username || root.password || root.pathname !== '/' || root.search || root.hash
        || !(root.protocol === 'https:' || (root.protocol === 'http:' && ['localhost','127.0.0.1','kong'].includes(root.hostname)))) throw new Error('Unavailable');
      const query = new URLSearchParams({ select: 'id,offering_member_id,status,activation_fee_minor,activation_currency,activated_at',
        movement_need_id: `eq.${need}`, offering_member_id: `eq.${viewer}`,
        status: 'in.(awaiting_activation_payment,activated,in_progress,completed)', limit: '2' });
      const response = await fetcher(`${root.origin}/rest/v1/alignments?${query}`, {
        headers: { apikey: secret, ...(!secret.startsWith('sb_secret_') ? { Authorization: `Bearer ${secret}` } : {}) },
        signal, redirect: 'error', cache: 'no-store',
      });
      if (!response.ok || response.redirected) throw new Error('Unavailable');
      return JSON.parse(new TextDecoder().decode(await readBounded(response.body, 16 * 1024, signal)));
    },
  };
}
