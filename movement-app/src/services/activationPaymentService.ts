import { supabase } from '../lib/supabase';

export type ActivationPaymentState = 'activation_not_ready' | 'payment_provider_unavailable' | 'payment_pending' | 'activated';

// Only backend evidence establishes activation. No provider result enters here.
export async function requestActivationPayment(movementNeedId: string, signal?: AbortSignal): Promise<ActivationPaymentState> {
  if (typeof movementNeedId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(movementNeedId)) throw new Error('activation_not_ready');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, 30_000);
  try {
    abort.signal.throwIfAborted();
    const { data, error } = await supabase.auth.getSession();
    abort.signal.throwIfAborted();
    if (error || !data.session?.access_token) throw new Error('authentication_required');
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('payment_unavailable');
    const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/create-activation-payment`, {
      method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ movementNeedId }), signal: abort.signal, redirect: 'error', cache: 'no-store',
    });
    abort.signal.throwIfAborted();
    if (response.status === 401) throw new Error('authentication_required');
    if (response.redirected) throw new Error('payment_unavailable');
    const row = await response.json();
    abort.signal.throwIfAborted();
    if (!row || typeof row !== 'object' || Object.keys(row).length !== 1) throw new Error('payment_unavailable');
    if (response.status === 200 && (row.state === 'activated' || row.state === 'payment_pending')) return row.state;
    if (response.status === 503 && row.state === 'payment_provider_unavailable') return row.state;
    if ([400, 404, 409].includes(response.status) && row.state === 'activation_not_ready') return row.state;
    throw new Error('payment_unavailable');
  } catch (error) {
    if (error instanceof Error && ['authentication_required', 'payment_unavailable'].includes(error.message)) throw error;
    if (abort.signal.aborted || error instanceof TypeError) throw new Error('network_unavailable');
    throw new Error('payment_unavailable');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
