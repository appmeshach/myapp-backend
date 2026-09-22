import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LOCATION_PROOF_AUDIENCE,
  LOCATION_PROOF_VERSION,
} from '../functions/_shared/location-contracts.ts';

import {
  createLocationRecoveryHandler,
  createLocationResolutionHandler,
  createLocationSearchHandler,
  createLocationSelectionHandler,
} from '../functions/_shared/location-orchestration.ts';

const member =
  '11111111-1111-4111-8111-111111111111';

const otherMember =
  '22222222-2222-4222-8222-222222222222';

const selectionRequestId =
  '33333333-3333-4333-8333-333333333333';

const source =
  '44444444-4444-4444-8444-444444444444';

const resolved =
  '55555555-5555-4555-8555-555555555555';

const evidence =
  '66666666-6666-4666-8666-666666666666';

const now =
  Date.parse('2026-09-17T12:00:00.000Z');

function request(body, auth = 'Bearer user-jwt') {
  return new Request(
    'https://edge.invalid/test',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth
          ? { Authorization: auth }
          : {}),
      },
      body: JSON.stringify(body),
    },
  );
}

function backend(overrides = {}) {
  const calls = [];

  const db = {
    async consumeProviderQuota(id, operation, signal) {
      signal.throwIfAborted();
      calls.push(['quota', id, operation]);
      return { admitted: true, retryAfterSeconds: 0 };
    },
    async authenticate(jwt) {
      calls.push(['auth', jwt]);
      return jwt === 'user-jwt'
        ? member
        : null;
    },

    async memberExists(id) {
      calls.push(['member', id]);
      return id === member;
    },

    async recordVerifiedSelection(input) {
      calls.push(['recordSelection', input]);
      return {
        locationReferenceId: source,
        declaredLabel:
          input.declaredLabel,
      };
    },

    async recoverVerifiedSelection(
      id,
      requestId,
    ) {
      calls.push([
        'recover',
        id,
        requestId,
      ]);

      return {
        locationReferenceId: source,
        declaredLabel:
          'Ologolo, Lekki, Lagos',
      };
    },

    async getResolutionContext(
      id,
      sourceId,
      operationId,
    ) {
      calls.push([
        'context',
        id,
        sourceId,
        operationId,
      ]);

      return {
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-reference',
        sourceCreatedAt:
          '2026-09-17T11:00:00.000Z',
        sourceExpiresAt: null,
        evidenceId: null,
        resolvedLocationReferenceId:
          null,
        version: null,
        expiresAt: null,
      };
    },

    async recordAttestedResolution(input) {
      calls.push(['recordResolution', input]);

      return {
        evidenceId: evidence,
        resolvedLocationReferenceId:
          resolved,
        version: 1,
        expiresAt: null,
      };
    },

    ...overrides,
  };

  return { db, calls };
}

function signer(overrides = {}) {
  const calls = [];

  const value = {
    isAvailable: () => true,

    async sign(claims) {
      calls.push(['sign', claims]);
      return 'signed-proof';
    },

    async verify(proof, expectedMember) {
      calls.push([
        'verify',
        proof,
        expectedMember,
      ]);

      return {
        audience:
          LOCATION_PROOF_AUDIENCE,
        version:
          LOCATION_PROOF_VERSION,
        memberId: member,
        selectionRequestId,
        declaredLabel:
          'Ologolo, Lekki, Lagos',
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-reference',
        issuedAt:
          new Date(now - 1000)
            .toISOString(),
        expiresAt:
          new Date(now + 60000)
            .toISOString(),
      };
    },

    ...overrides,
  };

  return { signer: value, calls };
}

function searchProvider(overrides = {}) {
  const calls = [];

  const provider = {
    name: 'test-provider',
    isAvailable: () => true,

    async search(input) {
      calls.push(input);

      return {
        suggestions: [
          {
            declaredLabel:
              'Ologolo, Lekki, Lagos',
            providerNamespace:
              'test-provider',
            providerPlaceReference:
              'opaque-reference',
            persistentSelectionAllowed:
              true,
          },
        ],
        attribution: [
          'Test provider',
        ],
      };
    },

    ...overrides,
  };

  return { provider, calls };
}

function resolver(overrides = {}) {
  const calls = [];

  const value = {
    providerNamespace:
      'test-provider',
    isAvailable: () => true,

    async resolve(input) {
      calls.push(input);

      return {
        providerNamespace:
          'test-provider',
        providerProduct:
          'test-geocoder',
        providerVersion: 'v1',
        providerPlaceReference:
          'opaque-reference',
        resolutionVersion:
          'normalization-v1',
        discoveryAreaLabel:
          'Ologolo, Lagos',
        latitude: 6.45,
        longitude: 3.47,
        resolvedAt:
          '2026-09-17T12:00:00.000Z',
        expiresAt: null,
        durableStorageAllowed: true,
      };
    },

    ...overrides,
  };

  return { resolver: value, calls };
}

test('search authenticates and forces Nigeria context', async () => {
  const { db } = backend();
  const p = searchProvider();
  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
      () => now,
    )(
      request({ query: 'Olo' }),
    );

  assert.equal(response.status, 200);

  assert.deepEqual(
    p.calls[0],
    {
      query: 'Olo',
      countryCode: 'NG',
      limit: 10,
    },
  );

  const body = await response.json();

  assert.equal(
    body.suggestions.length,
    1,
  );

  assert.equal(
    body.suggestions[0]
      .declaredLabel,
    'Ologolo, Lekki, Lagos',
  );

  assert.equal(
    body.suggestions[0]
      .selectionProof,
    'signed-proof',
  );

  assert.equal(
    'latitude'
      in body.suggestions[0],
    false,
  );

  assert.equal(
    'longitude'
      in body.suggestions[0],
    false,
  );
});

test('temporary-only search result receives no selection proof', async () => {
  const { db } = backend();

  const p = searchProvider({
    async search() {
      return {
        suggestions: [
          {
            declaredLabel: 'Temporary',
            providerNamespace:
              'test-provider',
            providerPlaceReference:
              'temporary-reference',
            persistentSelectionAllowed:
              false,
          },
        ],
        attribution: [],
      };
    },
  });

  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
      () => now,
    )(
      request({ query: 'Temp' }),
    );

  const body = await response.json();

  assert.deepEqual(
    body.suggestions,
    [],
  );

  assert.equal(
    s.calls.length,
    0,
  );
});

test('search unavailable fails before provider call', async () => {
  const { db } = backend();

  const p = searchProvider({
    isAvailable: () => false,
  });

  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request({ query: 'Olo' }),
    );

  assert.equal(response.status, 503);
  assert.equal(p.calls.length, 0);
});

test('search rejects unknown fields', async () => {
  const { db } = backend();
  const p = searchProvider();
  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request({
        query: 'Olo',
        latitude: 6.4,
      }),
    );

  assert.equal(response.status, 400);
  assert.equal(p.calls.length, 0);
});

test('search rejects invalid authentication before provider work', async () => {
  const { db } = backend();
  const p = searchProvider();
  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request(
        { query: 'Olo' },
        'Bearer wrong',
      ),
    );

  assert.equal(response.status, 401);
  assert.equal(p.calls.length, 0);
});

test('search rejects authenticated user without member record', async () => {
  const { db } = backend({
    async memberExists() {
      return false;
    },
  });

  const p = searchProvider();
  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request({ query: 'Olo' }),
    );

  assert.equal(response.status, 403);
  assert.equal(p.calls.length, 0);
});

test('selection uses only proof claims for database write', async () => {
  const { db, calls } = backend();
  const s = signer();

  const response =
    await createLocationSelectionHandler(
      db,
      s.signer,
    )(
      request({
        selectionProof: 'signed-proof',
      }),
    );

  assert.equal(response.status, 200);

  const write = calls.find(
    call =>
      call[0] === 'recordSelection',
  );

  assert.deepEqual(
    write[1],
    {
      verifiedMemberId: member,
      selectionRequestId,
      declaredLabel:
        'Ologolo, Lekki, Lagos',
      providerNamespace:
        'test-provider',
      providerPlaceReference:
        'opaque-reference',
      proofVersion:
        LOCATION_PROOF_VERSION,
      proofIssuedAt:
        new Date(now - 1000)
          .toISOString(),
      proofExpiresAt:
        new Date(now + 60000)
          .toISOString(),
    },
  );
});

test('selection rejects client trusted fields', async () => {
  const { db, calls } = backend();
  const s = signer();

  const response =
    await createLocationSelectionHandler(
      db,
      s.signer,
    )(
      request({
        selectionProof: 'signed-proof',
        latitude: 6.4,
      }),
    );

  assert.equal(response.status, 400);

  assert.equal(
    calls.some(
      call =>
        call[0]
        === 'recordSelection',
    ),
    false,
  );
});

test('invalid proof causes zero database writes', async () => {
  const { db, calls } = backend();

  const s = signer({
    async verify() {
      return null;
    },
  });

  const response =
    await createLocationSelectionHandler(
      db,
      s.signer,
    )(
      request({
        selectionProof: 'bad-proof',
      }),
    );

  assert.equal(response.status, 409);

  assert.equal(
    calls.some(
      call =>
        call[0]
        === 'recordSelection',
    ),
    false,
  );
});

test('selection write failure never falls through to recovery automatically', async () => {
  const { db, calls } = backend({
    async recordVerifiedSelection() {
      calls.push([
        'recordSelection',
      ]);
      throw new Error('database or transport failure');
    },
  });

  const s = signer();

  const response =
    await createLocationSelectionHandler(
      db,
      s.signer,
    )(
      request({
        selectionProof:
          'signed-proof',
      }),
    );

  assert.equal(response.status, 503);

  assert.deepEqual(
    await response.json(),
    {
      state: 'selection_unavailable',
    },
  );

  assert.equal(
    calls.some(
      call =>
        call[0] === 'recover',
    ),
    false,
  );
});

test('explicit recovery endpoint handles lost response or app restart', async () => {
  const { db, calls } = backend();

  const response =
    await createLocationRecoveryHandler(
      db,
    )(
      request({
        selectionRequestId,
      }),
    );

  assert.equal(response.status, 200);

  assert.equal(
    calls.some(
      call =>
        call[0] === 'recover',
    ),
    true,
  );

  assert.deepEqual(
    await response.json(),
    {
      locationReferenceId: source,
      declaredLabel:
        'Ologolo, Lekki, Lagos',
    },
  );
});

test('recovery requires only request id and member identity', async () => {
  const { db } = backend();

  const response =
    await createLocationRecoveryHandler(
      db,
    )(
      request({
        selectionRequestId,
      }),
    );

  assert.equal(response.status, 200);

  assert.deepEqual(
    await response.json(),
    {
      locationReferenceId: source,
      declaredLabel:
        'Ologolo, Lekki, Lagos',
    },
  );
});

test('missing recovery is generic 404', async () => {
  const { db } = backend({
    async recoverVerifiedSelection() {
      throw new Error(
        'foreign or missing',
      );
    },
  });

  const response =
    await createLocationRecoveryHandler(
      db,
    )(
      request({
        selectionRequestId,
      }),
    );

  assert.equal(response.status, 404);

  assert.deepEqual(
    await response.json(),
    {
      state:
        'selection_unavailable',
    },
  );
});

test('resolution uses stored provider identity only', async () => {
  const { db, calls } = backend();
  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 200);

  assert.deepEqual(
    r.calls[0],
    {
      providerNamespace:
        'test-provider',
      providerPlaceReference:
        'opaque-reference',
    },
  );

  const write = calls.find(
    call =>
      call[0]
      === 'recordResolution',
  );

  assert.equal(
    write[1].verifiedMemberId,
    member,
  );

  assert.equal(
    write[1]
      .sourceLocationReferenceId,
    source,
  );

  assert.equal(
    write[1].providerNamespace,
    'test-provider',
  );

  assert.equal(
    write[1]
      .providerPlaceReference,
    'opaque-reference',
  );

  assert.equal(
    write[1]
      .discoveryAreaLabel,
    'Ologolo, Lagos',
  );

  const body = await response.json();

  assert.equal(
    'latitude' in body,
    false,
  );

  assert.equal(
    'longitude' in body,
    false,
  );
});

test('existing committed resolution avoids provider call', async () => {
  const { db } = backend({
    async getResolutionContext() {
      return {
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-reference',
        sourceCreatedAt:
          '2026-09-17T11:00:00.000Z',
        sourceExpiresAt: null,
        evidenceId: evidence,
        resolvedLocationReferenceId:
          resolved,
        version: 1,
        expiresAt: null,
      };
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 200);
  assert.equal(r.calls.length, 0);
});

test('foreign or unattested source causes zero provider calls', async () => {
  const { db } = backend({
    async getResolutionContext() {
      throw new Error(
        'unavailable',
      );
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 404);
  assert.equal(r.calls.length, 0);
});

for (const [name, patch] of [
  [
    'NaN latitude',
    { latitude: Number.NaN },
  ],
  [
    'infinite longitude',
    { longitude: Infinity },
  ],
  [
    'latitude out of range',
    { latitude: 91 },
  ],
  [
    'longitude out of range',
    { longitude: 181 },
  ],
  [
    'storage prohibited',
    { durableStorageAllowed: false },
  ],
  [
    'provider identity mismatch',
    {
      providerPlaceReference:
        'other-reference',
    },
  ],
]) {
  test(`resolution rejects ${name}`, async () => {
    const { db, calls } = backend();

    const r = resolver({
      async resolve() {
        return {
          providerNamespace:
            'test-provider',
          providerProduct:
            'test-geocoder',
          providerVersion: 'v1',
          providerPlaceReference:
            'opaque-reference',
          resolutionVersion:
            'normalization-v1',
          latitude: 6.45,
          longitude: 3.47,
          resolvedAt:
            '2026-09-17T12:00:00.000Z',
          expiresAt: null,
          durableStorageAllowed:
            true,
          ...patch,
        };
      },
    });

    const response =
      await createLocationResolutionHandler(
        db,
        r.resolver,
      )(
        request({
          sourceLocationReferenceId:
            source,
        }),
      );

    assert.equal(response.status, 502);

    assert.equal(
      calls.some(
        call =>
          call[0]
          === 'recordResolution',
      ),
      false,
    );
  });
}

test('ambiguous resolution write recovers committed winner', async () => {
  let contextCalls = 0;

  const { db } = backend({
    async getResolutionContext() {
      contextCalls += 1;

      if (contextCalls === 1) {
        return {
          providerNamespace:
            'test-provider',
          providerPlaceReference:
            'opaque-reference',
          sourceCreatedAt:
            '2026-09-17T11:00:00.000Z',
          sourceExpiresAt: null,
          evidenceId: null,
          resolvedLocationReferenceId:
            null,
          version: null,
          expiresAt: null,
        };
      }

      return {
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-reference',
        sourceCreatedAt:
          '2026-09-17T11:00:00.000Z',
        sourceExpiresAt: null,
        evidenceId: evidence,
        resolvedLocationReferenceId:
          resolved,
        version: 1,
        expiresAt: null,
      };
    },

    async recordAttestedResolution() {
      throw new Error(
        'response lost after commit',
      );
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 200);

  assert.equal(
    contextCalls,
    2,
  );
});

test('resolution rejects client provider and coordinate fields', async () => {
  const { db, calls } = backend();
  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
        latitude: 6.4,
      }),
    );

  assert.equal(response.status, 400);

  assert.equal(
    r.calls.length,
    0,
  );

  assert.equal(
    calls.some(
      call =>
        call[0]
        === 'recordResolution',
    ),
    false,
  );
});

test('OPTIONS never authenticates or contacts providers', async () => {
  const { db, calls } = backend();
  const p = searchProvider();
  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      new Request(
        'https://edge.invalid/test',
        { method: 'OPTIONS' },
      ),
    );

  assert.equal(response.status, 204);
  assert.equal(calls.length, 0);
  assert.equal(p.calls.length, 0);
  assert.equal(s.calls.length, 0);
});

test('query strings are rejected', async () => {
  const { db, calls } = backend();

  const response =
    await createLocationRecoveryHandler(
      db,
    )(
      new Request(
        'https://edge.invalid/test?x=1',
        {
          method: 'POST',
          headers: {
            Authorization:
              'Bearer user-jwt',
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            selectionRequestId,
          }),
        },
      ),
    );

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});


test('expired trusted resolution context fails closed before provider call', async () => {
  const { db } = backend({
    async getResolutionContext() {
      return {
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-reference',
        sourceCreatedAt:
          '2000-01-01T00:00:00.000Z',
        sourceExpiresAt: null,
        evidenceId: evidence,
        resolvedLocationReferenceId:
          resolved,
        version: 1,
        expiresAt:
          '2000-01-02T00:00:00.000Z',
      };
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 503);

  assert.deepEqual(
    await response.json(),
    {
      state:
        'location_resolution_unavailable',
    },
  );

  assert.equal(r.calls.length, 0);
});

test('search quota denial returns 429 with Retry-After and skips provider', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota(
      id,
      operation,
      signal,
    ) {
      signal.throwIfAborted();
      quotaCalls += 1;

      assert.equal(id, member);
      assert.equal(
        operation,
        'location_search',
      );

      return {
        admitted: false,
        retryAfterSeconds: 37,
      };
    },
  });

  const p = searchProvider();
  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
      () => now,
    )(
      request({ query: 'Olo' }),
    );

  assert.equal(response.status, 429);

  assert.equal(
    response.headers.get('Retry-After'),
    '37',
  );

  assert.deepEqual(
    await response.json(),
    {
      state: 'location_rate_limited',
      retryAfterSeconds: 37,
    },
  );

  assert.equal(quotaCalls, 1);
  assert.equal(p.calls.length, 0);
  assert.equal(s.calls.length, 0);
});

test('invalid search request consumes zero provider quota', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota() {
      quotaCalls += 1;

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },
  });

  const p = searchProvider();
  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request({
        query: 'Olo',
        latitude: 6.4,
      }),
    );

  assert.equal(response.status, 400);
  assert.equal(quotaCalls, 0);
  assert.equal(p.calls.length, 0);
});

test('invalid search authentication consumes zero provider quota', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota() {
      quotaCalls += 1;

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },
  });

  const p = searchProvider();
  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request(
        { query: 'Olo' },
        'Bearer wrong',
      ),
    );

  assert.equal(response.status, 401);
  assert.equal(quotaCalls, 0);
  assert.equal(p.calls.length, 0);
});

test('unavailable search provider consumes zero provider quota', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota() {
      quotaCalls += 1;

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },
  });

  const p = searchProvider({
    isAvailable: () => false,
  });

  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request({ query: 'Olo' }),
    );

  assert.equal(response.status, 503);
  assert.equal(quotaCalls, 0);
  assert.equal(p.calls.length, 0);
});

test('unavailable selection signer consumes zero provider quota', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota() {
      quotaCalls += 1;

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },
  });

  const p = searchProvider();

  const s = signer({
    isAvailable: () => false,
  });

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request({ query: 'Olo' }),
    );

  assert.equal(response.status, 503);
  assert.equal(quotaCalls, 0);
  assert.equal(p.calls.length, 0);
});

test('admitted search consumes quota once even when provider fails', async () => {
  let quotaCalls = 0;
  let providerCalls = 0;

  const { db } = backend({
    async consumeProviderQuota(
      id,
      operation,
      signal,
    ) {
      signal.throwIfAborted();
      quotaCalls += 1;

      assert.equal(id, member);
      assert.equal(
        operation,
        'location_search',
      );

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },
  });

  const p = searchProvider({
    async search() {
      providerCalls += 1;
      throw new Error(
        'provider transport failed',
      );
    },
  });

  const s = signer();

  const response =
    await createLocationSearchHandler(
      db,
      p.provider,
      s.signer,
    )(
      request({ query: 'Olo' }),
    );

  assert.equal(response.status, 503);
  assert.equal(quotaCalls, 1);
  assert.equal(providerCalls, 1);
});

test('existing committed resolution consumes zero provider quota', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota() {
      quotaCalls += 1;

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },

    async getResolutionContext() {
      return {
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-reference',
        sourceCreatedAt:
          '2026-09-17T11:00:00.000Z',
        sourceExpiresAt: null,
        evidenceId: evidence,
        resolvedLocationReferenceId:
          resolved,
        version: 1,
        expiresAt: null,
      };
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 200);
  assert.equal(quotaCalls, 0);
  assert.equal(r.calls.length, 0);
});

test('foreign or unattested resolution source consumes zero provider quota', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota() {
      quotaCalls += 1;

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },

    async getResolutionContext() {
      throw new Error(
        'foreign or unavailable',
      );
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 404);
  assert.equal(quotaCalls, 0);
  assert.equal(r.calls.length, 0);
});

test('unavailable resolver consumes zero provider quota', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota() {
      quotaCalls += 1;

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },
  });

  const r = resolver({
    isAvailable: () => false,
  });

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 503);
  assert.equal(quotaCalls, 0);
  assert.equal(r.calls.length, 0);
});

test('resolution quota denial returns 429 and skips resolver', async () => {
  let quotaCalls = 0;

  const { db } = backend({
    async consumeProviderQuota(
      id,
      operation,
      signal,
    ) {
      signal.throwIfAborted();
      quotaCalls += 1;

      assert.equal(id, member);
      assert.equal(
        operation,
        'location_resolution',
      );

      return {
        admitted: false,
        retryAfterSeconds: 19,
      };
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 429);

  assert.equal(
    response.headers.get('Retry-After'),
    '19',
  );

  assert.deepEqual(
    await response.json(),
    {
      state: 'location_rate_limited',
      retryAfterSeconds: 19,
    },
  );

  assert.equal(quotaCalls, 1);
  assert.equal(r.calls.length, 0);
});

test('ambiguous resolution write recovery does not consume second quota or call provider twice', async () => {
  let quotaCalls = 0;
  let contextCalls = 0;

  const { db } = backend({
    async consumeProviderQuota(
      id,
      operation,
      signal,
    ) {
      signal.throwIfAborted();
      quotaCalls += 1;

      assert.equal(id, member);
      assert.equal(
        operation,
        'location_resolution',
      );

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },

    async getResolutionContext() {
      contextCalls += 1;

      if (contextCalls === 1) {
        return {
          providerNamespace:
            'test-provider',
          providerPlaceReference:
            'opaque-reference',
          sourceCreatedAt:
            '2026-09-17T11:00:00.000Z',
          sourceExpiresAt: null,
          evidenceId: null,
          resolvedLocationReferenceId:
            null,
          version: null,
          expiresAt: null,
        };
      }

      return {
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-reference',
        sourceCreatedAt:
          '2026-09-17T11:00:00.000Z',
        sourceExpiresAt: null,
        evidenceId: evidence,
        resolvedLocationReferenceId:
          resolved,
        version: 1,
        expiresAt: null,
      };
    },

    async recordAttestedResolution() {
      throw new Error(
        'response lost after commit',
      );
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 200);
  assert.equal(quotaCalls, 1);
  assert.equal(r.calls.length, 1);
  assert.equal(contextCalls, 2);
});

test('expired recovered resolution is rejected without second quota or provider call', async () => {
  let quotaCalls = 0;
  let contextCalls = 0;

  const { db } = backend({
    async consumeProviderQuota() {
      quotaCalls += 1;

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },

    async getResolutionContext() {
      contextCalls += 1;

      if (contextCalls === 1) {
        return {
          providerNamespace:
            'test-provider',
          providerPlaceReference:
            'opaque-reference',
          sourceCreatedAt:
            '2026-09-17T11:00:00.000Z',
          sourceExpiresAt: null,
          evidenceId: null,
          resolvedLocationReferenceId:
            null,
          version: null,
          expiresAt: null,
        };
      }

      return {
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-reference',
        sourceCreatedAt:
          '2026-09-17T11:00:00.000Z',
        sourceExpiresAt: null,
        evidenceId: evidence,
        resolvedLocationReferenceId:
          resolved,
        version: 1,
        expiresAt:
          '2000-01-02T00:00:00.000Z',
      };
    },

    async recordAttestedResolution() {
      throw new Error(
        'response lost after commit',
      );
    },
  });

  const r = resolver();

  const response =
    await createLocationResolutionHandler(
      db,
      r.resolver,
    )(
      request({
        sourceLocationReferenceId:
          source,
      }),
    );

  assert.equal(response.status, 503);

  assert.deepEqual(
    await response.json(),
    {
      state:
        'location_resolution_unavailable',
    },
  );

  assert.equal(quotaCalls, 1);
  assert.equal(r.calls.length, 1);
  assert.equal(contextCalls, 2);
});
