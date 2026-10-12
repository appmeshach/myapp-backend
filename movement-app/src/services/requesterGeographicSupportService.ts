import { supabase } from '../lib/supabase';

export type GeographicSupport = 'geometric_corridor_support' | 'overlap_observed' | 'inconclusive' | 'pending' | 'unavailable';
export interface RequesterGeographicSupport { geographicSupport: GeographicSupport; retryAfterSeconds?: number }
export interface RequesterGeographicInput { movementNeedId: string; availabilityId: string }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function parseRequesterGeographicSupport(value: unknown): RequesterGeographicSupport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('geographic_support_unavailable');
  const v = value as Record<string, unknown>, keys = Object.keys(v).sort().join('|');
  if (!['geographicSupport', 'geographicSupport|retryAfterSeconds'].includes(keys)
    || typeof v.geographicSupport !== 'string' || !['geometric_corridor_support', 'overlap_observed', 'inconclusive', 'pending', 'unavailable'].includes(v.geographicSupport)
    || keys.includes('|') && (v.geographicSupport !== 'pending' || typeof v.retryAfterSeconds !== 'number' || !Number.isInteger(v.retryAfterSeconds) || v.retryAfterSeconds < 1 || v.retryAfterSeconds > 30)) throw Error('geographic_support_unavailable');
  return value as RequesterGeographicSupport;
}
export async function prepareRequesterGeographicSupport(input: RequesterGeographicInput, signal?: AbortSignal): Promise<RequesterGeographicSupport> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join('|') !== 'availabilityId|movementNeedId'
    || typeof input.movementNeedId !== 'string' || !UUID.test(input.movementNeedId) || typeof input.availabilityId !== 'string' || !UUID.test(input.availabilityId)) throw Error('invalid_geographic_support_request');
  const publicInput = { movementNeedId: input.movementNeedId, availabilityId: input.availabilityId };
  const controller = new AbortController(), cancel = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 35000);
  try {
    controller.signal.throwIfAborted();
    const { data, error } = await supabase.auth.getSession();
    controller.signal.throwIfAborted();
    if (error || !data.session?.access_token) throw Error('authentication_required');
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw Error('geographic_support_unavailable');
    const result = await fetch(`${url.replace(/\/$/, '')}/functions/v1/prepare-requester-geographic-support`, {
      method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(publicInput), signal: controller.signal, redirect: 'error', cache: 'no-store',
    });
    controller.signal.throwIfAborted();
    if (result.status === 401) throw Error('authentication_required');
    if (result.status !== 200 || result.redirected || !result.body) throw Error('geographic_support_unavailable');
    const reader = result.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); controller.signal.throwIfAborted(); if (chunk.done) break;
        length += chunk.value.byteLength; if (length > 1024) throw Error('geographic_support_unavailable'); chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return parseRequesterGeographicSupport(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (controller.signal.aborted) throw Error('geographic_support_aborted');
    if (error instanceof Error && error.message === 'authentication_required') throw error;
    throw Error('geographic_support_unavailable');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
