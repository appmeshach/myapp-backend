import type { ActivationPaymentState } from '../services/activationPaymentService';

export type PaymentViewState = ActivationPaymentState | 'idle' | 'preparing_activation' | 'authentication_required' | 'network_unavailable' | 'payment_unavailable';
export const paymentCopy: Record<PaymentViewState, string> = {
  idle: 'Prepare activation', preparing_activation: 'Preparing activation',
  activation_not_ready: 'Activation is not ready yet.',
  payment_provider_unavailable: 'Payment setup unavailable.',
  payment_pending: 'Payment in progress.', activated: 'Movement activated.',
  authentication_required: 'Sign in to continue.', network_unavailable: 'Connection unavailable. Try again.',
  payment_unavailable: 'Payment setup unavailable. Try again.',
};

// Screen owners must cancel on blur/background/account change and dispose on
// unmount. A new owner is required when movement or authenticated account changes.
export function createActivationPaymentController(
  movementNeedId: string,
  request: (need: string, signal: AbortSignal) => Promise<ActivationPaymentState>,
  changed: (state: PaymentViewState) => void,
) {
  let generation = 0;
  let current: AbortController | null = null;
  let disposed = false;
  return {
    async start() {
      if (disposed || current) return;
      if (typeof movementNeedId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(movementNeedId)) { changed('activation_not_ready'); return; }
      const attempt = ++generation;
      const abort = current = new AbortController();
      changed('preparing_activation');
      try {
        const state = await request(movementNeedId, abort.signal);
        // Runtime validation matters even though the service has a typed result.
        // Wire only requestActivationPayment here, never a provider or face check.
        if (state !== 'activated' && state !== 'payment_pending' && state !== 'activation_not_ready'
          && state !== 'payment_provider_unavailable') throw new Error('payment_unavailable');
        if (!disposed && attempt === generation && !abort.signal.aborted) changed(state);
      } catch (error) {
        if (!disposed && attempt === generation && !abort.signal.aborted) {
          const code = error instanceof Error ? error.message : '';
          changed(code === 'network_unavailable' || code === 'authentication_required' ? code : 'payment_unavailable');
        }
      } finally { if (attempt === generation) current = null; }
    },
    cancel() { generation++; current?.abort(); current = null; if (!disposed) changed('idle'); },
    dispose() { disposed = true; generation++; current?.abort(); current = null; },
  };
}
