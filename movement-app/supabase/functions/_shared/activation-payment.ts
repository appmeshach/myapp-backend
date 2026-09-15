import { readBounded } from './face-orchestration.ts';

export interface ActivationPaymentBackend {
  authenticate(jwt: string, signal: AbortSignal): Promise<string | null>;
  resolveOfferingAlignment(need: string, viewer: string, signal: AbortSignal): Promise<unknown>;
  rpc(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
export interface ActivationPaymentProvider {
  readonly name: string;
  // Local configuration check only; must not contact a provider.
  isAvailable(): boolean;
  // Must durably bind the payment ID to one provider/account and reuse it as the
  // idempotency key across retries/processes. Reject mismatched existing bindings.
  // Never create a second charge for the same payment ID. No result grants activation.
  initiate(payment: { paymentId: string; amountMinor: number; currency: string }, signal: AbortSignal): Promise<void>;
  // Future provider authentication over raw bytes, not user JWT or client booleans.
  // A durable context-binding/settlement contract is required before callback wiring.
  verifyCallback(bytes: Uint8Array, headers: Headers, signal: AbortSignal): Promise<unknown | null>;
}
export const unavailablePaymentProvider: ActivationPaymentProvider = Object.freeze({
  name: 'unavailable', isAvailable: () => false,
  async initiate() { throw new Error('Payment unavailable'); },
  async verifyCallback() { return null; },
});
const headers = {
  'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Origin',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
const reply = (code: number, state: string) => new Response(JSON.stringify({ state }), { status: code, headers });
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function one(v: unknown): Record<string, unknown> | null {
  return Array.isArray(v) && v.length === 1 && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0]) ? v[0] : null;
}
export function createActivationPaymentHandler(db: ActivationPaymentBackend, provider: ActivationPaymentProvider = unavailablePaymentProvider) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST' || new URL(req.url).search) return reply(400, 'activation_not_ready');
    const jwt = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!jwt) return reply(401, 'authentication_required');
    const signal = AbortSignal.timeout(20_000);
    let need: string;
    try {
      if (req.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new Error();
      const input = JSON.parse(new TextDecoder().decode(await readBounded(req.body, 1024, signal)));
      if (!input || Object.keys(input).length !== 1 || !id(input.movementNeedId)) throw new Error();
      need = input.movementNeedId;
    } catch { return reply(400, 'activation_not_ready'); }
    let viewer: string | null;
    try { viewer = await db.authenticate(jwt, signal); } catch { viewer = null; }
    if (!id(viewer)) return reply(401, 'authentication_required');
    try {
      const alignment = one(await db.resolveOfferingAlignment(need, viewer, signal));
      // 0007 establishes the offering member as payer. Primary/invited travellers
      // and unrelated members do not gain payment initiation through this endpoint.
      if (!alignment || !id(alignment.id) || alignment.offering_member_id !== viewer) return reply(404, 'activation_not_ready');
      if (alignment.status === 'activated' && typeof alignment.activated_at === 'string'
        && Number.isFinite(Date.parse(alignment.activated_at))) return reply(200, 'activated');
      if (alignment.status !== 'awaiting_activation_payment') return reply(409, 'activation_not_ready');
      // No invented price or placeholder provider ledger entries. As in the prior
      // initiateActivationPayment helper, unavailable infrastructure stops here.
      if (!provider.isAvailable()) return reply(503, 'payment_provider_unavailable');
      const amount = alignment.activation_fee_minor;
      const currency = alignment.activation_currency;
      if (!Number.isSafeInteger(amount) || Number(amount) < 0 || typeof currency !== 'string'
        || !/^[A-Z]{3}$/.test(currency) || !/^[a-zA-Z0-9_-]{1,100}$/.test(provider.name)) return reply(503, 'payment_provider_unavailable');
      const payment = one(await db.rpc('create_alignment_activation_payment', {
        p_alignment_id: alignment.id, p_amount_minor: amount, p_currency: currency, p_provider: provider.name,
      }, signal));
      // PostgREST success is received after commit. Use the returned authoritative
      // amount/currency/payment ID, including when the DB reuses an existing row.
      if (!payment || !id(payment.payment_id) || payment.alignment_id !== alignment.id || payment.payment_status !== 'pending'
        || !Number.isSafeInteger(payment.amount_minor) || Number(payment.amount_minor) < 0
        || typeof payment.currency !== 'string' || !/^[A-Z]{3}$/.test(payment.currency)) return reply(409, 'activation_not_ready');
      signal.throwIfAborted();
      try {
        await provider.initiate({ paymentId: payment.payment_id, amountMinor: Number(payment.amount_minor), currency: payment.currency }, signal);
      } catch { return reply(503, 'payment_provider_unavailable'); }
      // Provider success is NOT payment success or movement activation.
      return reply(200, 'payment_pending');
    } catch { return reply(409, 'activation_not_ready'); }
  };
}
