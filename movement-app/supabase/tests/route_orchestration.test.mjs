import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createRouteGenerationHandler,
} from '../functions/_shared/route-orchestration.ts';

const member =
  '11111111-1111-4111-8111-111111111111';

const intent =
  '22222222-2222-4222-8222-222222222222';

const origin =
  '33333333-3333-4333-8333-333333333333';

const destination =
  '44444444-4444-4444-8444-444444444444';

const evidence =
  '55555555-5555-4555-8555-555555555555';

const claimToken =
  '66666666-6666-4666-8666-666666666666';

function request(
  body,
  auth = 'Bearer user-jwt',
) {
  return new Request(
    'https://edge.invalid/test',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/json',

        ...(
          auth
            ? {
                Authorization:
                  auth,
              }
            : {}
        ),
      },
      body:
        JSON.stringify(body),
    },
  );
}

function claimed() {
  return {
    state: 'claimed',

    claimToken,

    context: {
      offeringMovementIntentId:
        intent,

      offeringMemberId:
        member,

      originLocationReferenceId:
        origin,

      origin: {
        latitude: 6.431,
        longitude: 3.482,
      },

      destinationLocationReferenceId:
        destination,

      destination: {
        latitude: 6.455,
        longitude: 3.421,
      },
    },
  };
}

function recorded() {
  return {
    routeEvidenceId:
      evidence,

    routeEvidenceVersion:
      1,

    routeEvidenceStatus:
      'current',

    routeEvidenceExpiresAt:
      null,
  };
}

function backend(overrides = {}) {
  const calls = [];

  const db = {
    async authenticate(jwt, signal) {
      signal.throwIfAborted();

      calls.push([
        'auth',
        jwt,
      ]);

      return jwt === 'user-jwt'
        ? member
        : null;
    },

    async memberExists(
      id,
      signal,
    ) {
      signal.throwIfAborted();

      calls.push([
        'member',
        id,
      ]);

      return id === member;
    },

    async consumeRouteProviderQuota(
      id,
      signal,
    ) {
      signal.throwIfAborted();

      calls.push([
        'quota',
        id,
      ]);

      return {
        admitted: true,
        retryAfterSeconds: 0,
      };
    },

    async claimRouteGeneration(
      offeringMovementIntentId,
      offeringMemberId,
      signal,
    ) {
      signal.throwIfAborted();

      calls.push([
        'claim',
        offeringMovementIntentId,
        offeringMemberId,
      ]);

      return claimed();
    },

    async getRouteGenerationContext() {
      throw new Error(
        'legacy route context must not be used',
      );
    },

    async recordClaimedRouteEvidence(
      input,
      signal,
    ) {
      signal.throwIfAborted();

      calls.push([
        'recordClaimed',
        input,
      ]);

      return recorded();
    },

    async recordRouteEvidence() {
      throw new Error(
        'legacy route writer must not be used',
      );
    },

    ...overrides,
  };

  return {
    db,
    calls,
  };
}

function provider(overrides = {}) {
  const calls = [];

  const value = {
    name:
      'test-directions-provider',

    providerNamespace:
      'test-directions',

    isAvailable:
      () => true,

    async route(
      input,
      signal,
    ) {
      signal.throwIfAborted();

      calls.push(input);

      return {
        providerNamespace:
          'test-directions',

        providerProduct:
          'test-routing',

        providerVersion:
          'v1',

        providerRouteReference:
          'route-reference-1',

        routeShape: {
          type: 'LineString',

          coordinates: [
            [
              3.482,
              6.431,
            ],
            [
              3.421,
              6.455,
            ],
          ],
        },

        routeDistanceMeters:
          8421,

        routeDurationSeconds:
          1197,

        generatedAt:
          '2026-09-19T12:00:00.000Z',

        expiresAt:
          null,
      };
    },

    ...overrides,
  };

  return {
    provider: value,
    calls,
  };
}

test(
  'claimed route uses trusted endpoints, quota, provider, and claim-bound writer',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      200,
    );

    assert.deepEqual(
      await response.json(),
      {
        state: 'ready',

        routeEvidenceId:
          evidence,

        routeEvidenceVersion:
          1,

        routeEvidenceStatus:
          'current',

        routeEvidenceExpiresAt:
          null,
      },
    );

    assert.deepEqual(
      p.calls,
      [
        {
          origin: {
            latitude: 6.431,
            longitude: 3.482,
          },

          destination: {
            latitude: 6.455,
            longitude: 3.421,
          },
        },
      ],
    );

    assert.deepEqual(
      calls.map(
        call => call[0],
      ),
      [
        'auth',
        'member',
        'claim',
        'quota',
        'recordClaimed',
      ],
    );

    const write =
      calls.find(
        call =>
          call[0]
          === 'recordClaimed',
      );

    assert.equal(
      write[1]
        .offeringMovementIntentId,
      intent,
    );

    assert.equal(
      write[1]
        .offeringMemberId,
      member,
    );

    assert.equal(
      write[1]
        .generationClaimToken,
      claimToken,
    );

    assert.equal(
      write[1]
        .providerNamespace,
      'test-directions',
    );

    assert.equal(
      write[1]
        .providerRouteReference,
      'route-reference-1',
    );
  },
);

test(
  'existing route avoids quota provider and writer',
  async () => {
    const {
      db,
      calls,
    } = backend({
      async claimRouteGeneration(
        offeringMovementIntentId,
        offeringMemberId,
        signal,
      ) {
        signal.throwIfAborted();

        calls.push([
          'claim',
          offeringMovementIntentId,
          offeringMemberId,
        ]);

        return {
          state: 'existing',

          routeEvidence:
            recorded(),
        };
      },
    });

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      p.calls.length,
      0,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'quota',
      ),
      false,
    );

    assert.equal(
      calls.some(
        call =>
          call[0]
          === 'recordClaimed',
      ),
      false,
    );
  },
);

test(
  'busy claim returns retry response and performs zero provider work',
  async () => {
    const {
      db,
      calls,
    } = backend({
      async claimRouteGeneration(
        offeringMovementIntentId,
        offeringMemberId,
        signal,
      ) {
        signal.throwIfAborted();

        calls.push([
          'claim',
          offeringMovementIntentId,
          offeringMemberId,
        ]);

        return {
          state: 'busy',

          retryAfterSeconds:
            12,
        };
      },
    });

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      409,
    );

    assert.equal(
      response.headers
        .get('Retry-After'),
      '12',
    );

    assert.deepEqual(
      await response.json(),
      {
        state:
          'route_generation_in_progress',

        retryAfterSeconds:
          12,
      },
    );

    assert.equal(
      p.calls.length,
      0,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'quota',
      ),
      false,
    );
  },
);

test(
  'missing or inaccessible route claim performs zero provider work',
  async () => {
    const {
      db,
    } = backend({
      async claimRouteGeneration() {
        throw new Error(
          'foreign or unavailable',
        );
      },
    });

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      404,
    );

    assert.deepEqual(
      await response.json(),
      {
        state:
          'route_generation_unavailable',
      },
    );

    assert.equal(
      p.calls.length,
      0,
    );
  },
);

test(
  'route quota denial returns 429 and skips provider',
  async () => {
    const {
      db,
      calls,
    } = backend({
      async consumeRouteProviderQuota(
        id,
        signal,
      ) {
        signal.throwIfAborted();

        calls.push([
          'quota',
          id,
        ]);

        return {
          admitted: false,

          retryAfterSeconds:
            37,
        };
      },
    });

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      429,
    );

    assert.equal(
      response.headers
        .get('Retry-After'),
      '37',
    );

    assert.deepEqual(
      await response.json(),
      {
        state:
          'route_rate_limited',

        retryAfterSeconds:
          37,
      },
    );

    assert.equal(
      p.calls.length,
      0,
    );

    assert.equal(
      calls.some(
        call =>
          call[0]
          === 'recordClaimed',
      ),
      false,
    );
  },
);

test(
  'client cannot supply route coordinates or provider identity',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,

          originLatitude:
            6.431,
        }),
      );

    assert.equal(
      response.status,
      400,
    );

    assert.equal(
      p.calls.length,
      0,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'claim',
      ),
      false,
    );
  },
);

test(
  'invalid offering intent is rejected before claim or provider work',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            'not-a-uuid',
        }),
      );

    assert.equal(
      response.status,
      400,
    );

    assert.equal(
      p.calls.length,
      0,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'claim',
      ),
      false,
    );
  },
);

for (
  const [
    name,
    patch,
  ]
  of [
    [
      'provider namespace mismatch',
      {
        providerNamespace:
          'other-provider',
      },
    ],

    [
      'invalid route distance',
      {
        routeDistanceMeters:
          0,
      },
    ],

    [
      'invalid route duration',
      {
        routeDurationSeconds:
          0,
      },
    ],

    [
      'invalid longitude',
      {
        routeShape: {
          type: 'LineString',

          coordinates: [
            [
              181,
              6.431,
            ],
            [
              3.421,
              6.455,
            ],
          ],
        },
      },
    ],

    [
      'invalid latitude',
      {
        routeShape: {
          type: 'LineString',

          coordinates: [
            [
              3.482,
              91,
            ],
            [
              3.421,
              6.455,
            ],
          ],
        },
      },
    ],
  ]
) {
  test(
    `route generation rejects ${name}`,
    async () => {
      const {
        db,
        calls,
      } = backend();

      const p =
        provider({
          async route(
            input,
            signal,
          ) {
            signal.throwIfAborted();

            p.calls.push(input);

            return {
              providerNamespace:
                'test-directions',

              providerProduct:
                'test-routing',

              providerVersion:
                'v1',

              providerRouteReference:
                'route-reference-1',

              routeShape: {
                type:
                  'LineString',

                coordinates: [
                  [
                    3.482,
                    6.431,
                  ],
                  [
                    3.421,
                    6.455,
                  ],
                ],
              },

              routeDistanceMeters:
                8421,

              routeDurationSeconds:
                1197,

              generatedAt:
                '2026-09-19T12:00:00.000Z',

              expiresAt:
                null,

              ...patch,
            };
          },
        });

      const response =
        await createRouteGenerationHandler(
          db,
          p.provider,
        )(
          request({
            offeringMovementIntentId:
              intent,
          }),
        );

      assert.equal(
        response.status,
        502,
      );

      assert.deepEqual(
        await response.json(),
        {
          state:
            'provider_response_invalid',
        },
      );

      assert.equal(
        calls.some(
          call =>
            call[0]
            === 'recordClaimed',
        ),
        false,
      );
    },
  );
}

test(
  'ambiguous route write recovers committed route without second provider call',
  async () => {
    let claimCalls = 0;

    const {
      db,
    } = backend({
      async claimRouteGeneration(
        offeringMovementIntentId,
        offeringMemberId,
        signal,
      ) {
        signal.throwIfAborted();

        claimCalls += 1;

        if (claimCalls === 1) {
          return claimed();
        }

        return {
          state: 'existing',

          routeEvidence:
            recorded(),
        };
      },

      async recordClaimedRouteEvidence() {
        throw new Error(
          'response lost after commit',
        );
      },
    });

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      claimCalls,
      2,
    );

    assert.equal(
      p.calls.length,
      1,
    );

    assert.deepEqual(
      await response.json(),
      {
        state: 'ready',

        routeEvidenceId:
          evidence,

        routeEvidenceVersion:
          1,

        routeEvidenceStatus:
          'current',

        routeEvidenceExpiresAt:
          null,
      },
    );
  },
);

test(
  'ambiguous write with active claim returns busy without second provider call',
  async () => {
    let claimCalls = 0;

    const {
      db,
    } = backend({
      async claimRouteGeneration(
        offeringMovementIntentId,
        offeringMemberId,
        signal,
      ) {
        signal.throwIfAborted();

        claimCalls += 1;

        if (claimCalls === 1) {
          return claimed();
        }

        return {
          state: 'busy',

          retryAfterSeconds:
            9,
        };
      },

      async recordClaimedRouteEvidence() {
        throw new Error(
          'write outcome unknown',
        );
      },
    });

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      409,
    );

    assert.equal(
      response.headers
        .get('Retry-After'),
      '9',
    );

    assert.equal(
      claimCalls,
      2,
    );

    assert.equal(
      p.calls.length,
      1,
    );
  },
);

test(
  'failed write never performs a second provider call',
  async () => {
    let claimCalls = 0;

    const {
      db,
    } = backend({
      async claimRouteGeneration(
        offeringMovementIntentId,
        offeringMemberId,
        signal,
      ) {
        signal.throwIfAborted();

        claimCalls += 1;

        return claimed();
      },

      async recordClaimedRouteEvidence() {
        throw new Error(
          'write failed',
        );
      },
    });

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request({
          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      409,
    );

    assert.equal(
      claimCalls,
      2,
    );

    assert.equal(
      p.calls.length,
      1,
    );
  },
);

test(
  'missing authentication is rejected before claim or provider work',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        request(
          {
            offeringMovementIntentId:
              intent,
          },
          null,
        ),
      );

    assert.equal(
      response.status,
      401,
    );

    assert.equal(
      calls.length,
      0,
    );

    assert.equal(
      p.calls.length,
      0,
    );
  },
);

test(
  'OPTIONS never authenticates claims quota or provider',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
      )(
        new Request(
          'https://edge.invalid/test',
          {
            method: 'OPTIONS',
          },
        ),
      );

    assert.equal(
      response.status,
      204,
    );

    assert.equal(
      calls.length,
      0,
    );

    assert.equal(
      p.calls.length,
      0,
    );
  },
);

test(
  'query strings are rejected before authentication or provider work',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const p =
      provider();

    const response =
      await createRouteGenerationHandler(
        db,
        p.provider,
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

            body:
              JSON.stringify({
                offeringMovementIntentId:
                  intent,
              }),
          },
        ),
      );

    assert.equal(
      response.status,
      400,
    );

    assert.equal(
      calls.length,
      0,
    );

    assert.equal(
      p.calls.length,
      0,
    );
  },
);