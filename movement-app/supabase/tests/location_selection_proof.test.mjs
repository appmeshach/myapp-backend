import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCATION_PROOF_AUDIENCE,
  LOCATION_PROOF_VERSION,
  unavailableSelectionProofSigner,
} from '../functions/_shared/location-contracts.ts';

import {
  createHmacSelectionProofSigner,
} from '../functions/_shared/location-selection-proof.ts';

const member = '11111111-1111-4111-8111-111111111111';
const otherMember = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';

const now = Date.parse('2026-09-17T12:00:00.000Z');

const secret = new TextEncoder().encode(
  'test-only-selection-proof-secret-32-bytes-minimum',
);

function claims(overrides = {}) {
  return {
    audience: LOCATION_PROOF_AUDIENCE,
    version: LOCATION_PROOF_VERSION,
    memberId: member,
    selectionRequestId: requestId,
    declaredLabel: 'Ologolo, Lekki, Lagos',
    providerNamespace: 'test-provider',
    providerPlaceReference: 'opaque-place-reference',
    issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

function signal() {
  return new AbortController().signal;
}

test('valid proof round-trips exact claims', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);
  const original = claims();

  const proof = await signer.sign(original, signal());
  const verified = await signer.verify(proof, member, signal());

  assert.deepEqual(verified, original);
  assert.match(proof, /^sp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('same claims produce deterministic signed envelope', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  const a = await signer.sign(claims(), signal());
  const b = await signer.sign(claims(), signal());

  assert.equal(a, b);
});

test('wrong member cannot use another member proof', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);
  const proof = await signer.sign(claims(), signal());

  assert.equal(
    await signer.verify(proof, otherMember, signal()),
    null,
  );
});

test('tampered payload is rejected', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);
  const proof = await signer.sign(claims(), signal());

  const parts = proof.split('.');
  parts[1] =
    `${parts[1].slice(0, -1)}${parts[1].endsWith('A') ? 'B' : 'A'}`;

  assert.equal(
    await signer.verify(parts.join('.'), member, signal()),
    null,
  );
});

test('tampered signature is rejected', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);
  const proof = await signer.sign(claims(), signal());

  const parts = proof.split('.');
  parts[2] =
    `${parts[2].slice(0, -1)}${parts[2].endsWith('A') ? 'B' : 'A'}`;

  assert.equal(
    await signer.verify(parts.join('.'), member, signal()),
    null,
  );
});

test('wrong fixed prefix cannot substitute an algorithm', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);
  const proof = await signer.sign(claims(), signal());

  assert.equal(
    await signer.verify(
      proof.replace(/^sp1\./, 'none.'),
      member,
      signal(),
    ),
    null,
  );
});

test('expired proof is rejected', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  const proof = await signer.sign(
    claims({
      issuedAt: new Date(now - 120_000).toISOString(),
      expiresAt: new Date(now - 1).toISOString(),
    }),
    signal(),
  ).catch(() => null);

  assert.equal(proof, null);
});

test('proof issued too far in future is rejected', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  await assert.rejects(
    signer.sign(
      claims({
        issuedAt: new Date(now + 31_000).toISOString(),
        expiresAt: new Date(now + 61_000).toISOString(),
      }),
      signal(),
    ),
  );
});

test('proof lifetime above five minutes is rejected', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  await assert.rejects(
    signer.sign(
      claims({
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 5 * 60_000 + 1).toISOString(),
      }),
      signal(),
    ),
  );
});

test('wrong audience cannot be signed', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  await assert.rejects(
    signer.sign(
      claims({ audience: 'wrong-audience' }),
      signal(),
    ),
  );
});

test('wrong proof version cannot be signed', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  await assert.rejects(
    signer.sign(
      claims({ version: 'selection_proof_v2' }),
      signal(),
    ),
  );
});

test('blank provider identity cannot be signed', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  await assert.rejects(
    signer.sign(
      claims({ providerPlaceReference: '   ' }),
      signal(),
    ),
  );
});

test('malformed token is rejected', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  for (const malformed of [
    '',
    'sp1',
    'sp1.bad',
    'sp1.bad.bad.extra',
    'sp2.bad.bad',
    'sp1.***.***',
  ]) {
    assert.equal(
      await signer.verify(malformed, member, signal()),
      null,
    );
  }
});

test('oversized proof is rejected before cryptographic verification', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);

  assert.equal(
    await signer.verify(`sp1.${'A'.repeat(5000)}.AAAA`, member, signal()),
    null,
  );
});

test('short secret makes signer unavailable', async () => {
  const signer = createHmacSelectionProofSigner(
    new TextEncoder().encode('too-short'),
    () => now,
  );

  assert.equal(signer.isAvailable(), false);

  await assert.rejects(
    signer.sign(claims(), signal()),
  );

  assert.equal(
    await signer.verify('anything', member, signal()),
    null,
  );
});

test('production unavailable signer fails closed', async () => {
  assert.equal(unavailableSelectionProofSigner.isAvailable(), false);

  await assert.rejects(
    unavailableSelectionProofSigner.sign(claims(), signal()),
  );

  assert.equal(
    await unavailableSelectionProofSigner.verify(
      'anything',
      member,
      signal(),
    ),
    null,
  );
});

test('aborted operation does not sign', async () => {
  const signer = createHmacSelectionProofSigner(secret, () => now);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    signer.sign(claims(), controller.signal),
    /abort/i,
  );
});
