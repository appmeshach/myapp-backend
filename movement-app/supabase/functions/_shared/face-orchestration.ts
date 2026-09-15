// Server-only orchestration. Production entry points supply no processor/vendor
// until audited adapters exist. Test adapters are injected only from tests.
export const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export interface Backend {
  authenticate(jwt: string, signal: AbortSignal): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  upload(bucket: string, key: string, bytes: Uint8Array<ArrayBuffer>, type: ImageType, signal: AbortSignal): Promise<void>;
}
export interface ImageProcessor {
  // Must fully decode, limit dimensions/frames, strip metadata and re-encode.
  // Returning the original unchecked bytes is NOT a conforming implementation.
  process(bytes: Uint8Array<ArrayBuffer>, type: ImageType, signal: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: ImageType }>;
}
export interface ProviderAdapter {
  readonly name: string;
  startVerification(context: { reference: string; sessionId: string; mediaId: string; storagePath: string; expiresAt: string }, signal: AbortSignal): Promise<void>;
  // Verify signature/authenticity AND replay timestamp over the original bytes.
  // Return null on failure; ordinary Supabase bearer auth is never sufficient.
  verifyCallback(bytes: Uint8Array<ArrayBuffer>, headers: Headers, signal: AbortSignal): Promise<unknown | null>;
  // Only called with verifyCallback's authenticated output. Bind echoed media
  // to the start context; do not infer a match from the client or HTTP status.
  normalizeResult(verifiedEvent: unknown): { reference: string; mediaId: string; livenessPassed: boolean; faceMatchPassed: boolean };
}
export interface PaymentAdapter {
  initiate(payment: { paymentId: string; amountMinor: number; currency: string }, signal: AbortSignal): Promise<void>;
}
const headers = {
  'Cache-Control': 'private, no-store', 'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff', 'Vary': 'Authorization, Origin',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers }); }
class Denied extends Error {
  readonly status: number;
  constructor(status: number) { super('Unavailable'); this.status = status; }
}
function failure(e: unknown) {
  const status = e instanceof Denied ? e.status : 404;
  return response(status, { error: status === 401 ? 'authentication_required' : 'request_unavailable' });
}
function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function id(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
function one(v: unknown): Record<string, unknown> {
  if (!Array.isArray(v) || v.length !== 1 || !record(v[0])) throw new Denied(404);
  return v[0];
}
export async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new Denied(400);
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Denied(413); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export function validImage(bytes: Uint8Array, type: string): type is ImageType {
  if (!bytes.length || bytes.length > MAX_BYTES) return false;
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  if (type === 'image/webp') return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
  return false;
}
function method(req: Request): Response | null {
  if (req.method === 'OPTIONS') return response(204, undefined);
  if (req.method !== 'POST') throw new Denied(405);
  if (new URL(req.url).search) throw new Denied(400);
  return null;
}
async function member(req: Request, db: Backend, signal: AbortSignal) {
  const jwt = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!jwt) throw new Denied(401);
  const who = await db.authenticate(jwt, signal);
  if (!id(who)) throw new Denied(401);
  return who;
}
export function createSubmissionHandler(db: Backend, processor: ImageProcessor | null = null) {
  return async (req: Request): Promise<Response> => {
    let submission: string | undefined;
    try {
      const early = method(req); if (early) return early;
      const signal = AbortSignal.timeout(20_000);
      const who = await member(req, db, signal);
      const type = req.headers.get('Content-Type')?.toLowerCase() ?? '';
      if (!['image/jpeg','image/png','image/webp'].includes(type)) throw new Denied(415);
      if (Number(req.headers.get('Content-Length')) > MAX_BYTES) throw new Denied(413);
      const bytes = await readBounded(req.body, MAX_BYTES, signal);
      if (!validImage(bytes, type)) throw new Denied(400);
      const key = `${crypto.randomUUID()}/${crypto.randomUUID()}`;
      const created = await db.rpc('create_profile_photo_submission_for_server', {
        p_member_id: who, p_submission_storage_path: key,
        p_submitted_mime_type: type, p_submitted_size_bytes: bytes.length,
      }, signal);
      if (!id(created)) throw new Denied(404);
      submission = created;
      await db.upload('profile-photo-submissions', key, bytes, type, signal);
      if (!processor) return response(202, { status: 'pending' });
      const sanitized = await processor.process(bytes, type, signal);
      signal.throwIfAborted();
      if (!validImage(sanitized.bytes, sanitized.type)) throw new Denied(400);
      const processedKey = `${crypto.randomUUID()}/${crypto.randomUUID()}`;
      await db.upload('verified-profile-photos', processedKey, sanitized.bytes, sanitized.type, signal);
      await db.rpc('prepare_profile_photo_submission_for_server', {
        p_submission_id: submission, p_processed_storage_path: processedKey,
      }, signal);
      return response(200, { status: 'ready' });
    } catch (e) {
      if (submission) {
        // Independent bounded cleanup attempt even if the processing deadline
        // expired. On ambiguous network outcomes leave data for reconciliation.
        try { await db.rpc('fail_profile_photo_submission_for_server', { p_submission_id: submission }, AbortSignal.timeout(5000)); } catch { /* no sensitive logs */ }
      }
      return failure(e);
    }
  };
}
export function createVerificationHandler(db: Backend, provider: ProviderAdapter | null = null) {
  return async (req: Request): Promise<Response> => {
    try {
      const early = method(req); if (early) return early;
      const signal = AbortSignal.timeout(20_000);
      const who = await member(req, db, signal);
      if (req.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new Denied(400);
      const body: unknown = JSON.parse(new TextDecoder().decode(await readBounded(req.body, 1024, signal)));
      if (!record(body) || Object.keys(body).length !== 1 || !id(body.movementNeedId)) throw new Denied(400);
      if (!provider) throw new Denied(503);
      const reference = crypto.randomUUID();
      const bound = one(await db.rpc('start_movement_face_verification_for_server', {
        p_movement_need_id: body.movementNeedId, p_member_id: who,
        p_provider: provider.name, p_provider_reference: reference,
      }, signal));
      if (!id(bound.session_id) || !id(bound.media_id) || typeof bound.storage_path !== 'string'
        || typeof bound.expires_at !== 'string' || !Number.isFinite(Date.parse(bound.expires_at))) throw new Denied(404);
      await provider.startVerification({ reference, sessionId: bound.session_id, mediaId: bound.media_id,
        storagePath: bound.storage_path, expiresAt: bound.expires_at }, signal);
      signal.throwIfAborted();
      // SDK challenges are intentionally deferred until a vendor-specific safe
      // client contract is reviewed. Never spread provider responses into JSON.
      return response(202, { status: 'pending', expiresAt: bound.expires_at });
    } catch (e) { return failure(e); }
  };
}
export function createCallbackHandler(db: Backend, provider: ProviderAdapter | null = null) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== 'POST' || new URL(req.url).search) throw new Denied(405);
      if (!provider) throw new Denied(503);
      const signal = AbortSignal.timeout(20_000);
      const raw = await readBounded(req.body, 64 * 1024, signal);
      const verified = await provider.verifyCallback(raw, req.headers, signal);
      if (verified == null) throw new Denied(403);
      const result = provider.normalizeResult(verified);
      if (!result || !id(result.mediaId) || typeof result.reference !== 'string' || result.reference.length > 255
        || !result.reference.length || typeof result.livenessPassed !== 'boolean' || typeof result.faceMatchPassed !== 'boolean') throw new Denied(403);
      const status = await db.rpc('complete_face_verification_callback_for_server', {
        p_provider: provider.name, p_provider_reference: result.reference, p_matched_media_id: result.mediaId,
        p_liveness_passed: result.livenessPassed, p_face_match_passed: result.faceMatchPassed,
      }, signal);
      if (!['succeeded','failed'].includes(String(status))) throw new Denied(409);
      return response(200, { received: true });
    } catch (e) { return failure(e); }
  };
}
// No public payment endpoint. Inputs/fees are trusted server configuration.
// RPC HTTP success means its transaction committed. Never call the provider on
// failure, nor use advisory/client readiness as a substitute for the DB gate.
export async function initiateActivationPayment(db: Backend, provider: PaymentAdapter | null,
  alignmentId: string, amountMinor: number, currency: string, signal: AbortSignal): Promise<void> {
  if (!provider) throw new Denied(503);
  const row = one(await db.rpc('create_alignment_activation_payment', {
    p_alignment_id: alignmentId, p_amount_minor: amountMinor, p_currency: currency,
  }, signal));
  if (!id(row.payment_id) || !Number.isSafeInteger(row.amount_minor) || Number(row.amount_minor) < 0
    || typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency) || row.payment_status !== 'pending') throw new Denied(404);
  await provider.initiate({ paymentId: row.payment_id, amountMinor: Number(row.amount_minor), currency: row.currency }, signal);
}
