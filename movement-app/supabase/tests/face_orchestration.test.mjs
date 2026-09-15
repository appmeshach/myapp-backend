import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSubmissionHandler, createVerificationHandler, createCallbackHandler,
  initiateActivationPayment, MAX_BYTES } from '../functions/_shared/face-orchestration.ts';
import { createBackend } from '../functions/_shared/face-runtime.ts';

const member = '11111111-1111-4111-8111-111111111111';
const media = '22222222-2222-4222-8222-222222222222';
const session = '33333333-3333-4333-8333-333333333333';
const need = '44444444-4444-4444-8444-444444444444';
const png = new Uint8Array([137,80,78,71,13,10,26,10,0]);
const expiry = '2099-01-01T00:00:00Z';
function fixture(overrides = {}) {
  const calls = [];
  const db = {
    async authenticate(jwt) { calls.push(['auth', jwt]); return jwt === 'user-jwt' ? member : null; },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'create_profile_photo_submission_for_server') return session;
      if (name === 'start_movement_face_verification_for_server') return [{ session_id: session, media_id: media, storage_path: 'private/face.png', expires_at: expiry }];
      if (name === 'complete_face_verification_callback_for_server') return 'succeeded';
      if (name === 'create_alignment_activation_payment') return [{ payment_id: session, payment_status: 'pending', amount_minor: 123, currency: 'NGN' }];
      return null;
    },
    async upload(...args) { calls.push(['upload', ...args]); },
    ...overrides,
  };
  return { db, calls };
}
function request(body = png, type = 'image/png', authorization = 'Bearer user-jwt') {
  return new Request('https://function.invalid/test', { method: 'POST', body,
    headers: { 'Content-Type': type, ...(authorization ? { Authorization: authorization } : {}) } });
}
function begin(body = { movementNeedId: need }, authorization) { return request(JSON.stringify(body), 'application/json', authorization); }
const processor = { async process(bytes, type) { return { bytes, type }; } }; // TEST ONLY, not a sanitizer.
function vendor() {
  return { name: 'test-only', async startVerification() {},
    async verifyCallback(bytes, headers) { return headers.get('x-test-signature') === 'valid' ? {} : null; },
    normalizeResult() { return { reference: 'server-reference', mediaId: media, livenessPassed: true, faceMatchPassed: true }; } };
}
function callback() { return new Request('https://function.invalid/callback', { method: 'POST', headers: { 'x-test-signature': 'valid' }, body: '{}' }); }
async function safe(r, status) {
  assert.equal(r.status, status);
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(r.headers.get('Location'), null);
  const text = await r.text();
  for (const secret of [member, media, session, 'private/face.png', 'server-reference', 'storage_path', 'service-secret']) assert(!text.includes(secret));
  return JSON.parse(text);
}
for (const [label, auth] of [['missing', ''], ['invalid', 'Bearer bad']]) {
  test(`submission ${label} Authorization denied`, async () => {
    const { db, calls } = fixture(); await safe(await createSubmissionHandler(db)(request(png, 'image/png', auth)), 401);
    assert(!calls.some(c => c[0] === 'upload'));
  });
}
for (const [label, bytes, type, code] of [
  ['oversize', new Uint8Array(MAX_BYTES + 1), 'image/png', 413],
  ['empty', new Uint8Array(), 'image/png', 400],
  ['unsupported', png, 'image/svg+xml', 415],
  ['mismatch', png, 'image/jpeg', 400],
]) test(`submission rejects ${label}`, async () => {
  const { db, calls } = fixture(); await safe(await createSubmissionHandler(db)(request(bytes,type)),code);
  assert.equal(calls.length, 1);
});
test('client member/path/results JSON is not accepted as a photo', async () => {
  const { db } = fixture(); await safe(await createSubmissionHandler(db)(begin({ memberId: member, verified: true })),415);
});
test('private upload derives member and generates keys, returns only pending with no processor', async () => {
  const { db, calls } = fixture(); const handler = createSubmissionHandler(db);
  assert.deepEqual(await safe(await handler(request()),202), { status: 'pending' });
  await handler(request());
  const creations = calls.filter(c => c[0] === 'create_profile_photo_submission_for_server');
  assert.equal(creations[0][1].p_member_id, member);
  assert.notEqual(creations[0][1].p_submission_storage_path, creations[1][1].p_submission_storage_path);
  assert(!creations[0][1].p_submission_storage_path.includes(member));
  assert(calls.filter(c => c[0] === 'upload').every(c => c[1] === 'profile-photo-submissions'));
  assert(!calls.some(c => c[0] === 'prepare_profile_photo_submission_for_server'));
});
test('successful processing uses new immutable destination and calls prepare last, never verifies', async () => {
  const { db, calls } = fixture(); assert.deepEqual(await safe(await createSubmissionHandler(db,processor)(request()),200), { status: 'ready' });
  const uploads = calls.filter(c => c[0] === 'upload');
  assert.equal(uploads[1][1], 'verified-profile-photos'); assert.notEqual(uploads[0][2], uploads[1][2]);
  assert.equal(calls.at(-1)[0], 'prepare_profile_photo_submission_for_server');
  assert(!calls.some(c => c[0].includes('complete_alignment')));
});
for (const kind of ['throw', 'invalid-output', 'upload-failure']) test(`processing ${kind} fails safely and cannot prepare`, async () => {
  const { db, calls } = fixture();
  if (kind === 'upload-failure') db.upload = async () => { throw new Error('private/face.png service-secret'); };
  const p = { async process() { if (kind === 'throw') throw new Error('private/face.png'); return { bytes: png, type: 'image/jpeg' }; } };
  const r = await createSubmissionHandler(db,p)(request());
  await safe(r,kind === 'invalid-output' ? 400 : 404);
  assert(calls.some(c => c[0] === 'fail_profile_photo_submission_for_server'));
  assert(!calls.some(c => c[0] === 'prepare_profile_photo_submission_for_server'));
});
for (const field of ['memberId','mediaId','livenessPassed','faceMatchPassed','verified','successful','providerReference']) test(`initiation rejects client ${field}`, async () => {
  const { db, calls } = fixture(); await safe(await createVerificationHandler(db,vendor())(begin({ movementNeedId: need, [field]: true })),400);
  assert(!calls.some(c => c[0] === 'start_movement_face_verification_for_server'));
});
for (const role of ['unrelated','declined','removed','unconfirmed','no prepared media','non-awaiting']) test(`initiation ${role} database denial is uniform`, async () => {
  const { db } = fixture({ async rpc() { throw new Error(`${role}: private/face.png`); } });
  await safe(await createVerificationHandler(db,vendor())(begin()),404);
});
for (const role of ['offering member','primary requester','confirmed traveller']) test(`initiation forwards DB-authorized ${role} without private output`, async () => {
  const { db, calls } = fixture(); const p = vendor();
  p.startVerification = async context => { assert.equal(context.mediaId, media); assert.equal(context.sessionId, session); assert.equal(context.storagePath,'private/face.png'); };
  assert.deepEqual(await safe(await createVerificationHandler(db,p)(begin()),202), { status: 'pending', expiresAt: expiry });
  const args = calls.find(c => c[0] === 'start_movement_face_verification_for_server')[1];
  assert.equal(args.p_member_id, member); assert.equal(args.p_movement_need_id, need);
  assert.match(args.p_provider_reference, /^[a-f0-9-]{36}$/);
});
test('no provider means fail closed before session creation or callback mutation', async () => {
  const { db, calls } = fixture(); await safe(await createVerificationHandler(db)(begin()),503);
  await safe(await createCallbackHandler(db)(callback()),503);
  assert(!calls.some(c => c[0] !== 'auth'));
});
test('ordinary user JWT is insufficient for callback', async () => {
  const { db, calls } = fixture(); await safe(await createCallbackHandler(db,vendor())(request('{}','application/json')),403);
  assert.equal(calls.length,0);
});
test('authenticated callback is normalized before reference-bound completion; no result leaks', async () => {
  const { db, calls } = fixture(); assert.deepEqual(await safe(await createCallbackHandler(db,vendor())(callback()),200), { received: true });
  const args = calls[0][1]; assert.equal(args.p_provider_reference,'server-reference'); assert.equal(args.p_matched_media_id,media);
});
for (const outcome of ['expired','superseded','conflict']) test(`callback ${outcome} cannot be acknowledged as success`, async () => {
  const { db } = fixture({ async rpc() { if (outcome === 'conflict') throw new Error('private conflict'); return outcome; } });
  await safe(await createCallbackHandler(db,vendor())(callback()),outcome === 'conflict' ? 404 : 409);
});
test('identical callback acknowledgment is repeatable; atomic idempotency belongs to SQL', async () => {
  const { db } = fixture(); const handler = createCallbackHandler(db,vendor());
  assert.deepEqual(await safe(await handler(callback()),200), await safe(await handler(callback()),200));
});
test('payment provider never called if authoritative creation fails', async () => {
  let contacted = false; const { db } = fixture({ async rpc() { throw new Error('not ready'); } });
  await assert.rejects(initiateActivationPayment(db,{ async initiate() { contacted = true; } },need,123,'NGN',AbortSignal.timeout(1000)));
  assert.equal(contacted,false);
});
test('payment provider called only after committed RPC response using returned id and amount', async () => {
  const { db, calls } = fixture(); await initiateActivationPayment(db,{ async initiate(payment) {
    assert.equal(calls.at(-1)[0],'create_alignment_activation_payment');
    assert.deepEqual(payment,{ paymentId: session, amountMinor: 123, currency: 'NGN' });
  } },need,999,'NGN',AbortSignal.timeout(1000));
});
test('transport separates verified user JWT from server credentials and disallows redirects/upserts', async () => {
  const requests = [];
  const db = createBackend('https://project.invalid','sb_secret_server',async (url,init) => {
    requests.push([url,init]); assert.equal(init.redirect,'error'); assert.equal(init.cache,'no-store');
    return new Response(JSON.stringify(url.endsWith('/user') ? { id: member, role: 'authenticated' } : null));
  });
  const signal = AbortSignal.timeout(1000); await db.authenticate('user-jwt',signal);
  await db.rpc('safe_rpc',{},signal); await db.upload('profile-photo-submissions',`${member}/${media}`,png,'image/png',signal);
  assert.equal(requests[0][1].headers.Authorization,'Bearer user-jwt');
  assert.equal(requests[1][1].headers.Authorization,undefined);
  assert.equal(requests[2][1].headers['x-upsert'],'false');
});
test('production entry points cannot select injected test adapters with environment flags', () => {
  for (const name of ['submit-profile-photo','start-face-verification','face-verification-callback']) {
    const source = fs.readFileSync(`supabase/functions/${name}/index.ts`,'utf8');
    assert.match(source,/runtimeBackend\(\), null/); assert.doesNotMatch(source,/import .*test|env\.get|always.success/i);
  }
});
test('0017 is transactional, service-only, and does not replace installed behavior', () => {
  const sql = fs.readFileSync('supabase/migrations/0017_face_verification_orchestration.sql','utf8');
  assert.match(sql.trim(),/^BEGIN;[\s\S]*COMMIT;$/); assert.doesNotMatch(sql,/CREATE OR REPLACE|TO authenticated/);
  assert.equal((sql.match(/FROM PUBLIC,anon,authenticated;/g)||[]).length,2);
  assert.equal((sql.match(/TO service_role;/g)||[]).length,2);
});
