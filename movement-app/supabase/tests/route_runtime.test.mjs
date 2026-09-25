import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createRouteBackend,
} from '../functions/_shared/route-runtime.ts';

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

function signal() {
  return new AbortController().signal;
}

test(
  'authenticate uses incoming JWT only for auth user endpoint',
  async () => {
    const calls = [];

    const db =
      createRouteBackend(
        'https://project.invalid',
        'sb_secret_server',
        async (url, init) => {
          calls.push({ url, init });

          return Response.json({
            id: member,
            role: 'authenticated',
          });
        },
      );

    assert.equal(
      await db.authenticate(
        'user-jwt',
        signal(),
      ),
      member,
    );

    assert.equal(
      calls.length,
      1,
    );

    assert.equal(
      calls[0].url,
      'https://project.invalid/auth/v1/user',
    );

    assert.equal(
      calls[0].init.headers.Authorization,
      'Bearer user-jwt',
    );

    assert.equal(
      calls[0].init.headers.apikey,
      'sb_secret_server',
    );

    assert.equal(
      calls[0].init.redirect,
      'error',
    );

    assert.equal(
      calls[0].init.cache,
      'no-store',
    );
  },
);

test(
  'member lookup uses service credential and exact member filter',
  async () => {
    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            { id: member },
          ]);
        },
      );

    assert.equal(
      await db.memberExists(
        member,
        signal(),
      ),
      true,
    );

    const parsed =
      new URL(call.url);

    assert.equal(
      parsed.pathname,
      '/rest/v1/members',
    );

    assert.equal(
      parsed.searchParams.get('id'),
      `eq.${member}`,
    );

    assert.equal(
      parsed.searchParams.get('select'),
      'id',
    );

    assert.equal(
      parsed.searchParams.get('limit'),
      '2',
    );

    assert.equal(
      call.init.headers.Authorization,
      'Bearer server-secret',
    );
  },
);

test(
  'sb_secret service credential is never sent as Bearer Authorization',
  async () => {
    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'sb_secret_server',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            { id: member },
          ]);
        },
      );

    await db.memberExists(
      member,
      signal(),
    );

    assert.equal(
      call.init.headers.apikey,
      'sb_secret_server',
    );

    assert.equal(
      call.init.headers.Authorization,
      undefined,
    );
  },
);

test(
  'route generation context maps exactly to 0031 RPC',
  async () => {
    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              offering_movement_intent_id:
                intent,
              offering_member_id:
                member,
              origin_location_reference_id:
                origin,
              origin_latitude:
                6.431,
              origin_longitude:
                3.482,
              destination_location_reference_id:
                destination,
              destination_latitude:
                6.455,
              destination_longitude:
                3.421,
            },
          ]);
        },
      );

    const result =
      await db.getRouteGenerationContext(
        intent,
        member,
        signal(),
      );

    assert.deepEqual(
      result,
      {
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
    );

    assert.equal(
      new URL(call.url).pathname,
      '/rest/v1/rpc/get_offering_route_generation_context_for_server',
    );

    assert.deepEqual(
      JSON.parse(call.init.body),
      {
        p_offering_movement_intent_id:
          intent,
        p_offering_member_id:
          member,
      },
    );
  },
);

test(
  'route generation context rejects malformed identifiers before network request',
  async () => {
    let calls = 0;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () => {
          calls += 1;

          return Response.json([]);
        },
      );

    await assert.rejects(
      db.getRouteGenerationContext(
        'not-a-uuid',
        member,
        signal(),
      ),
    );

    await assert.rejects(
      db.getRouteGenerationContext(
        intent,
        'not-a-uuid',
        signal(),
      ),
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'route generation context rejects malformed trusted coordinates',
  async () => {
    const invalidRows = [
      {
        origin_latitude: '6.431',
      },
      {
        origin_latitude: NaN,
      },
      {
        origin_latitude: 91,
      },
      {
        origin_longitude: 181,
      },
      {
        destination_latitude: -91,
      },
      {
        destination_longitude: -181,
      },
    ];

    for (const override of invalidRows) {
      const db =
        createRouteBackend(
          'https://project.invalid',
          'server-secret',
          async () =>
            Response.json([
              {
                offering_movement_intent_id:
                  intent,
                offering_member_id:
                  member,
                origin_location_reference_id:
                  origin,
                origin_latitude:
                  6.431,
                origin_longitude:
                  3.482,
                destination_location_reference_id:
                  destination,
                destination_latitude:
                  6.455,
                destination_longitude:
                  3.421,
                ...override,
              },
            ]),
        );

      assert.equal(
        await db.getRouteGenerationContext(
          intent,
          member,
          signal(),
        ),
        null,
      );
    }
  },
);

test(
  'route generation context rejects mismatched authoritative identities',
  async () => {
    const other =
      '66666666-6666-4666-8666-666666666666';

    const invalidRows = [
      {
        offering_movement_intent_id:
          other,
      },
      {
        offering_member_id:
          other,
      },
      {
        origin_location_reference_id:
          destination,
      },
    ];

    for (const override of invalidRows) {
      const db =
        createRouteBackend(
          'https://project.invalid',
          'server-secret',
          async () =>
            Response.json([
              {
                offering_movement_intent_id:
                  intent,
                offering_member_id:
                  member,
                origin_location_reference_id:
                  origin,
                origin_latitude:
                  6.431,
                origin_longitude:
                  3.482,
                destination_location_reference_id:
                  destination,
                destination_latitude:
                  6.455,
                destination_longitude:
                  3.421,
                ...override,
              },
            ]),
        );

      assert.equal(
        await db.getRouteGenerationContext(
          intent,
          member,
          signal(),
        ),
        null,
      );
    }
  },
);

test(
  'route evidence maps exactly to 0025 RPC',
  async () => {
    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              route_evidence_id:
                evidence,
              route_evidence_version:
                3,
              route_evidence_status:
                'current',
              route_evidence_expires_at:
                null,
            },
          ]);
        },
      );

    const routeShape = {
      type: 'LineString',
      coordinates: [
        [3.482, 6.431],
        [3.421, 6.455],
      ],
    };

    const result =
      await db.recordRouteEvidence(
        {
          offeringMovementIntentId:
            intent,
          providerNamespace:
            'mapbox-directions-v5',
          providerProduct:
            'mapbox-directions',
          providerVersion:
            'v5-driving-geojson-full-v1',
          providerRouteReference:
            'provider-response:0',
          routeShape,
          routeDistanceMeters:
            8421,
          routeDurationSeconds:
            1197,
          generatedAt:
            '2026-09-19T03:00:00.000Z',
          expiresAt:
            null,
        },
        signal(),
      );

    assert.deepEqual(
      result,
      {
        routeEvidenceId:
          evidence,
        routeEvidenceVersion:
          3,
        routeEvidenceStatus:
          'current',
        routeEvidenceExpiresAt:
          null,
      },
    );

    assert.equal(
      new URL(call.url).pathname,
      '/rest/v1/rpc/record_offering_route_evidence_for_server',
    );

    assert.deepEqual(
      JSON.parse(call.init.body),
      {
        p_offering_movement_intent_id:
          intent,
        p_provider_namespace:
          'mapbox-directions-v5',
        p_provider_product:
          'mapbox-directions',
        p_provider_version:
          'v5-driving-geojson-full-v1',
        p_provider_route_reference:
          'provider-response:0',
        p_route_shape:
          routeShape,
        p_route_distance_meters:
          8421,
        p_route_duration_seconds:
          1197,
        p_generated_at:
          '2026-09-19T03:00:00.000Z',
        p_expires_at:
          null,
      },
    );
  },
);

test(
  'route evidence rejects malformed writer response',
  async () => {
    const invalidResponses = [
      [],
      [
        {
          route_evidence_id:
            evidence,
          route_evidence_version:
            0,
          route_evidence_status:
            'current',
          route_evidence_expires_at:
            null,
        },
      ],
      [
        {
          route_evidence_id:
            evidence,
          route_evidence_version:
            1,
          route_evidence_status:
            'superseded',
          route_evidence_expires_at:
            null,
        },
      ],
      [
        {
          route_evidence_id:
            'not-a-uuid',
          route_evidence_version:
            1,
          route_evidence_status:
            'current',
          route_evidence_expires_at:
            null,
        },
      ],
      [
        {
          route_evidence_id:
            evidence,
          route_evidence_version:
            1,
          route_evidence_status:
            'current',
          route_evidence_expires_at:
            'not-a-date',
        },
      ],
    ];

    for (
      const response
      of invalidResponses
    ) {
      const db =
        createRouteBackend(
          'https://project.invalid',
          'server-secret',
          async () =>
            Response.json(response),
        );

      assert.equal(
        await db.recordRouteEvidence(
          {
            offeringMovementIntentId:
              intent,
            providerNamespace:
              'test-provider',
            providerProduct:
              'test-product',
            providerVersion:
              'v1',
            providerRouteReference:
              'route-ref',
            routeShape: {
              type: 'LineString',
              coordinates: [
                [3.4, 6.4],
                [3.5, 6.5],
              ],
            },
            routeDistanceMeters:
              1000,
            routeDurationSeconds:
              300,
            generatedAt:
              '2026-09-19T03:00:00.000Z',
            expiresAt:
              null,
          },
          signal(),
        ),
        null,
      );
    }
  },
);

test(
  'route evidence rejects malformed intent before network request',
  async () => {
    let calls = 0;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () => {
          calls += 1;

          return Response.json([]);
        },
      );

    await assert.rejects(
      db.recordRouteEvidence(
        {
          offeringMovementIntentId:
            'not-a-uuid',
          providerNamespace:
            'test-provider',
          providerProduct:
            'test-product',
          providerVersion:
            'v1',
          providerRouteReference:
            'route-ref',
          routeShape: {
            type: 'LineString',
            coordinates: [
              [3.4, 6.4],
              [3.5, 6.5],
            ],
          },
          routeDistanceMeters:
            1000,
          routeDurationSeconds:
            300,
          generatedAt:
            '2026-09-19T03:00:00.000Z',
          expiresAt:
            null,
        },
        signal(),
      ),
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'route provider quota maps exactly to 0032 RPC',
  async () => {
    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              admitted: true,
              retry_after_seconds: 0,
            },
          ]);
        },
      );

    const result =
      await db.consumeRouteProviderQuota(
        member,
        signal(),
      );

    assert.deepEqual(
      result,
      {
        admitted: true,
        retryAfterSeconds: 0,
      },
    );

    assert.equal(
      new URL(call.url).pathname,
      '/rest/v1/rpc/consume_route_provider_quota_for_server',
    );

    assert.deepEqual(
      JSON.parse(call.init.body),
      {
        p_verified_member_id:
          member,
      },
    );

    assert.equal(
      call.init.headers.Authorization,
      'Bearer server-secret',
    );
  },
);

test(
  'route provider quota rejects malformed member before network request',
  async () => {
    let calls = 0;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () => {
          calls += 1;

          return Response.json([
            {
              admitted: true,
              retry_after_seconds: 0,
            },
          ]);
        },
      );

    await assert.rejects(
      db.consumeRouteProviderQuota(
        'not-a-uuid',
        signal(),
      ),
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'route provider quota rejects malformed RPC response fail closed',
  async () => {
    const invalidResponses = [
      [],
      [
        {
          admitted: true,
        },
      ],
      [
        {
          admitted: 'true',
          retry_after_seconds: 0,
        },
      ],
      [
        {
          admitted: true,
          retry_after_seconds: 1,
        },
      ],
      [
        {
          admitted: false,
          retry_after_seconds: 0,
        },
      ],
      [
        {
          admitted: false,
          retry_after_seconds: 86401,
        },
      ],
      [
        {
          admitted: false,
          retry_after_seconds: 1.5,
        },
      ],
    ];

    for (
      const response
      of invalidResponses
    ) {
      const db =
        createRouteBackend(
          'https://project.invalid',
          'server-secret',
          async () =>
            Response.json(response),
        );

      await assert.rejects(
        db.consumeRouteProviderQuota(
          member,
          signal(),
        ),
      );
    }
  },
);

test(
  'route provider quota parses denied response with bounded retry',
  async () => {
    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () =>
          Response.json([
            {
              admitted: false,
              retry_after_seconds: 37,
            },
          ]),
      );

    assert.deepEqual(
      await db.consumeRouteProviderQuota(
        member,
        signal(),
      ),
      {
        admitted: false,
        retryAfterSeconds: 37,
      },
    );
  },
);

test(
  'route provider quota uses sb_secret as apikey without service Bearer',
  async () => {
    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'sb_secret_server',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              admitted: true,
              retry_after_seconds: 0,
            },
          ]);
        },
      );

    await db.consumeRouteProviderQuota(
      member,
      signal(),
    );

    assert.equal(
      call.init.headers.apikey,
      'sb_secret_server',
    );

    assert.equal(
      call.init.headers.Authorization,
      undefined,
    );
  },
);

test(
  'route provider quota never uses incoming user JWT as service credential',
  async () => {
    const calls = [];

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          calls.push({ url, init });

          if (
            url.endsWith(
              '/auth/v1/user',
            )
          ) {
            return Response.json({
              id: member,
              role: 'authenticated',
            });
          }

          return Response.json([
            {
              admitted: true,
              retry_after_seconds: 0,
            },
          ]);
        },
      );

    await db.authenticate(
      'user-jwt-secret',
      signal(),
    );

    await db.consumeRouteProviderQuota(
      member,
      signal(),
    );

    assert.equal(
      calls.length,
      2,
    );

    assert.equal(
      calls[0].init.headers.Authorization,
      'Bearer user-jwt-secret',
    );

    assert.equal(
      calls[1].init.headers.Authorization,
      'Bearer server-secret',
    );

    assert.notEqual(
      calls[1].init.headers.Authorization,
      'Bearer user-jwt-secret',
    );
  },
);

test(
  'route generation claim maps existing state exactly to 0033 RPC',
  async () => {
    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              generation_state:
                'existing',
              generation_claim_token:
                null,
              retry_after_seconds:
                0,

              route_evidence_id:
                evidence,
              route_evidence_version:
                3,
              route_evidence_status:
                'current',
              route_evidence_expires_at:
                null,

              origin_location_reference_id:
                null,
              origin_latitude:
                null,
              origin_longitude:
                null,

              destination_location_reference_id:
                null,
              destination_latitude:
                null,
              destination_longitude:
                null,
            },
          ]);
        },
      );

    const result =
      await db.claimRouteGeneration(
        intent,
        member,
        signal(),
      );

    assert.deepEqual(
      result,
      {
        state: 'existing',

        routeEvidence: {
          routeEvidenceId:
            evidence,
          routeEvidenceVersion:
            3,
          routeEvidenceStatus:
            'current',
          routeEvidenceExpiresAt:
            null,
        },
      },
    );

    assert.equal(
      new URL(call.url).pathname,
      '/rest/v1/rpc/claim_offering_route_generation_for_server',
    );

    assert.deepEqual(
      JSON.parse(call.init.body),
      {
        p_offering_movement_intent_id:
          intent,
        p_offering_member_id:
          member,
      },
    );
  },
);

test(
  'route generation claim parses busy state with bounded retry',
  async () => {
    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () =>
          Response.json([
            {
              generation_state:
                'busy',
              generation_claim_token:
                null,
              retry_after_seconds:
                17,

              route_evidence_id:
                null,
              route_evidence_version:
                null,
              route_evidence_status:
                null,
              route_evidence_expires_at:
                null,

              origin_location_reference_id:
                null,
              origin_latitude:
                null,
              origin_longitude:
                null,

              destination_location_reference_id:
                null,
              destination_latitude:
                null,
              destination_longitude:
                null,
            },
          ]),
      );

    assert.deepEqual(
      await db.claimRouteGeneration(
        intent,
        member,
        signal(),
      ),
      {
        state: 'busy',
        retryAfterSeconds: 17,
      },
    );
  },
);

test(
  'route generation claim parses claimed state with trusted endpoints',
  async () => {
    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () =>
          Response.json([
            {
              generation_state:
                'claimed',
              generation_claim_token:
                claimToken,
              retry_after_seconds:
                0,

              route_evidence_id:
                null,
              route_evidence_version:
                null,
              route_evidence_status:
                null,
              route_evidence_expires_at:
                null,

              origin_location_reference_id:
                origin,
              origin_latitude:
                6.431,
              origin_longitude:
                3.482,

              destination_location_reference_id:
                destination,
              destination_latitude:
                6.455,
              destination_longitude:
                3.421,
            },
          ]),
      );

    assert.deepEqual(
      await db.claimRouteGeneration(
        intent,
        member,
        signal(),
      ),
      {
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
      },
    );
  },
);

test(
  'route generation claim rejects malformed identifiers before network request',
  async () => {
    let calls = 0;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () => {
          calls += 1;

          return Response.json([]);
        },
      );

    await assert.rejects(
      db.claimRouteGeneration(
        'not-a-uuid',
        member,
        signal(),
      ),
    );

    await assert.rejects(
      db.claimRouteGeneration(
        intent,
        'not-a-uuid',
        signal(),
      ),
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'route generation claim rejects malformed RPC states fail closed',
  async () => {
    const invalidResponses = [
      [],
      [
        {
          generation_state:
            'unknown',
        },
      ],
      [
        {
          generation_state:
            'busy',
          generation_claim_token:
            null,
          retry_after_seconds:
            0,

          route_evidence_id:
            null,
          route_evidence_version:
            null,
          route_evidence_status:
            null,
          route_evidence_expires_at:
            null,

          origin_location_reference_id:
            null,
          origin_latitude:
            null,
          origin_longitude:
            null,

          destination_location_reference_id:
            null,
          destination_latitude:
            null,
          destination_longitude:
            null,
        },
      ],
      [
        {
          generation_state:
            'claimed',
          generation_claim_token:
            'not-a-uuid',
          retry_after_seconds:
            0,

          route_evidence_id:
            null,
          route_evidence_version:
            null,
          route_evidence_status:
            null,
          route_evidence_expires_at:
            null,

          origin_location_reference_id:
            origin,
          origin_latitude:
            6.431,
          origin_longitude:
            3.482,

          destination_location_reference_id:
            destination,
          destination_latitude:
            6.455,
          destination_longitude:
            3.421,
        },
      ],
      [
        {
          generation_state:
            'existing',
          generation_claim_token:
            null,
          retry_after_seconds:
            0,

          route_evidence_id:
            evidence,
          route_evidence_version:
            0,
          route_evidence_status:
            'current',
          route_evidence_expires_at:
            null,

          origin_location_reference_id:
            null,
          origin_latitude:
            null,
          origin_longitude:
            null,

          destination_location_reference_id:
            null,
          destination_latitude:
            null,
          destination_longitude:
            null,
        },
      ],
    ];

    for (
      const response
      of invalidResponses
    ) {
      const db =
        createRouteBackend(
          'https://project.invalid',
          'server-secret',
          async () =>
            Response.json(response),
        );

      assert.equal(
        await db.claimRouteGeneration(
          intent,
          member,
          signal(),
        ),
        null,
      );
    }
  },
);

test(
  'claimed route evidence maps exactly to 0033 writer RPC',
  async () => {
    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              route_evidence_id:
                evidence,
              route_evidence_version:
                1,
              route_evidence_status:
                'current',
              route_evidence_expires_at:
                null,
            },
          ]);
        },
      );

    const routeShape = {
      type: 'LineString',
      coordinates: [
        [3.482, 6.431],
        [3.421, 6.455],
      ],
    };

    const result =
      await db.recordClaimedRouteEvidence(
        {
          offeringMovementIntentId:
            intent,
          offeringMemberId:
            member,
          generationClaimToken:
            claimToken,

          providerNamespace:
            'mapbox-directions-v5',
          providerProduct:
            'mapbox-directions',
          providerVersion:
            'v5-driving-geojson-full-v1',
          providerRouteReference:
            'provider-response:0',

          routeShape,

          routeDistanceMeters:
            8421,
          routeDurationSeconds:
            1197,

          generatedAt:
            '2026-09-19T03:00:00.000Z',
          expiresAt:
            null,
        },
        signal(),
      );

    assert.deepEqual(
      result,
      {
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

    assert.equal(
      new URL(call.url).pathname,
      '/rest/v1/rpc/record_claimed_offering_route_evidence_for_server',
    );

    assert.deepEqual(
      JSON.parse(call.init.body),
      {
        p_offering_movement_intent_id:
          intent,
        p_offering_member_id:
          member,
        p_generation_claim_token:
          claimToken,

        p_provider_namespace:
          'mapbox-directions-v5',
        p_provider_product:
          'mapbox-directions',
        p_provider_version:
          'v5-driving-geojson-full-v1',
        p_provider_route_reference:
          'provider-response:0',

        p_route_shape:
          routeShape,

        p_route_distance_meters:
          8421,
        p_route_duration_seconds:
          1197,

        p_generated_at:
          '2026-09-19T03:00:00.000Z',
        p_expires_at:
          null,
      },
    );
  },
);

test(
  'claimed route evidence rejects malformed claim identity before network request',
  async () => {
    let calls = 0;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () => {
          calls += 1;

          return Response.json([]);
        },
      );

    const baseInput = {
      offeringMovementIntentId:
        intent,
      offeringMemberId:
        member,
      generationClaimToken:
        claimToken,

      providerNamespace:
        'test-provider',
      providerProduct:
        'test-product',
      providerVersion:
        'v1',
      providerRouteReference:
        'route-ref',

      routeShape: {
        type: 'LineString',
        coordinates: [
          [3.4, 6.4],
          [3.5, 6.5],
        ],
      },

      routeDistanceMeters:
        1000,
      routeDurationSeconds:
        300,

      generatedAt:
        '2026-09-19T03:00:00.000Z',
      expiresAt:
        null,
    };

    await assert.rejects(
      db.recordClaimedRouteEvidence(
        {
          ...baseInput,
          offeringMovementIntentId:
            'not-a-uuid',
        },
        signal(),
      ),
    );

    await assert.rejects(
      db.recordClaimedRouteEvidence(
        {
          ...baseInput,
          offeringMemberId:
            'not-a-uuid',
        },
        signal(),
      ),
    );

    await assert.rejects(
      db.recordClaimedRouteEvidence(
        {
          ...baseInput,
          generationClaimToken:
            'not-a-uuid',
        },
        signal(),
      ),
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'claimed route evidence rejects malformed writer response',
  async () => {
    const invalidResponses = [
      [],
      [
        {
          route_evidence_id:
            evidence,
          route_evidence_version:
            0,
          route_evidence_status:
            'current',
          route_evidence_expires_at:
            null,
        },
      ],
      [
        {
          route_evidence_id:
            evidence,
          route_evidence_version:
            1,
          route_evidence_status:
            'superseded',
          route_evidence_expires_at:
            null,
        },
      ],
      [
        {
          route_evidence_id:
            'not-a-uuid',
          route_evidence_version:
            1,
          route_evidence_status:
            'current',
          route_evidence_expires_at:
            null,
        },
      ],
    ];

    for (
      const response
      of invalidResponses
    ) {
      const db =
        createRouteBackend(
          'https://project.invalid',
          'server-secret',
          async () =>
            Response.json(response),
        );

      assert.equal(
        await db.recordClaimedRouteEvidence(
          {
            offeringMovementIntentId:
              intent,
            offeringMemberId:
              member,
            generationClaimToken:
              claimToken,

            providerNamespace:
              'test-provider',
            providerProduct:
              'test-product',
            providerVersion:
              'v1',
            providerRouteReference:
              'route-ref',

            routeShape: {
              type: 'LineString',
              coordinates: [
                [3.4, 6.4],
                [3.5, 6.5],
              ],
            },

            routeDistanceMeters:
              1000,
            routeDurationSeconds:
              300,

            generatedAt:
              '2026-09-19T03:00:00.000Z',
            expiresAt:
              null,
          },
          signal(),
        ),
        null,
      );
    }
  },
);

test(
  'runtime rejects malformed Supabase roots',
  async () => {
    for (const url of [
      'ftp://project.invalid',
      'https://user:pass@project.invalid',
      'https://project.invalid/path',
      'https://project.invalid/?x=1',
      'https://project.invalid/#fragment',
      'http://evil.invalid',
    ]) {
      const db =
        createRouteBackend(
          url,
          'secret',
          async () =>
            Response.json([]),
        );

      await assert.rejects(
        db.memberExists(
          member,
          signal(),
        ),
      );
    }
  },
);

test(
  'runtime rejects redirects and non-success responses',
  async () => {
    const redirectDb =
      createRouteBackend(
        'https://project.invalid',
        'secret',
        async () =>
          new Response(
            null,
            {
              status: 302,
              headers: {
                Location:
                  'https://evil.invalid',
              },
            },
          ),
      );

    await assert.rejects(
      redirectDb.memberExists(
        member,
        signal(),
      ),
    );

    const failedDb =
      createRouteBackend(
        'https://project.invalid',
        'secret',
        async () =>
          new Response(
            'private database error',
            { status: 500 },
          ),
      );

    await assert.rejects(
      failedDb.memberExists(
        member,
        signal(),
      ),
    );
  },
);

test(
  'runtime bounds response bodies',
  async () => {
    const db =
      createRouteBackend(
        'https://project.invalid',
        'secret',
        async () =>
          new Response(
            'x'.repeat(
              70 * 1024,
            ),
            { status: 200 },
          ),
      );

    await assert.rejects(
      db.memberExists(
        member,
        signal(),
      ),
    );
  },
);

test(
  'invalid authentication result returns null',
  async () => {
    const db =
      createRouteBackend(
        'https://project.invalid',
        'secret',
        async () =>
          Response.json({
            id: member,
            role: 'anon',
          }),
      );

    assert.equal(
      await db.authenticate(
        'user-jwt',
        signal(),
      ),
      null,
    );
  },
);

test(
  'no incoming user JWT can become service Authorization',
  async () => {
    const calls = [];

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          calls.push({ url, init });

          if (
            url.endsWith(
              '/auth/v1/user',
            )
          ) {
            return Response.json({
              id: member,
              role: 'authenticated',
            });
          }

          return Response.json([
            { id: member },
          ]);
        },
      );

    await db.authenticate(
      'user-jwt-secret',
      signal(),
    );

    await db.memberExists(
      member,
      signal(),
    );

    assert.equal(
      calls[0].init.headers.Authorization,
      'Bearer user-jwt-secret',
    );

    assert.equal(
      calls[1].init.headers.Authorization,
      'Bearer server-secret',
    );

    assert.notEqual(
      calls[1].init.headers.Authorization,
      'Bearer user-jwt-secret',
    );
  },
);
test(
  'authorized trusted matching context maps exactly to 0039 RPC',
  async () => {
    const verifiedMemberId =
      '11111111-1111-4111-8111-111111111111';

    const movementNeedId =
      '22222222-2222-4222-8222-222222222222';

    const offeringMovementIntentId =
      '33333333-3333-4333-8333-333333333333';

    const requestingMemberId =
      '44444444-4444-4444-8444-444444444444';

    const offeringMemberId =
      '55555555-5555-4555-8555-555555555555';

    const requesterOriginId =
      '66666666-6666-4666-8666-666666666666';

    const requesterDestinationId =
      '77777777-7777-4777-8777-777777777777';

    const routeEvidenceId =
      '88888888-8888-4888-8888-888888888888';

    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              movement_need_id:
                movementNeedId,

              requesting_member_id:
                requestingMemberId,

              requester_origin_location_reference_id:
                requesterOriginId,

              requester_origin_latitude:
                6.4300,

              requester_origin_longitude:
                3.5200,

              requester_destination_location_reference_id:
                requesterDestinationId,

              requester_destination_latitude:
                6.6018,

              requester_destination_longitude:
                3.3515,

              requester_earliest_departure_at:
                '2026-09-21T18:00:00.000Z',

              requester_latest_departure_at:
                '2026-09-21T19:00:00.000Z',

              offering_movement_intent_id:
                offeringMovementIntentId,

              offering_member_id:
                offeringMemberId,

              offering_intent_version:
                1,

              offering_earliest_departure_at:
                '2026-09-21T18:15:00.000Z',

              offering_latest_departure_at:
                null,

              route_evidence_id:
                routeEvidenceId,

              route_evidence_version:
                2,

              route_shape_format:
                'geojson_linestring_v1',

              route_shape: {
                type: 'LineString',
                coordinates: [
                  [3.5200, 6.4300],
                  [3.4900, 6.4320],
                  [3.4430, 6.4310],
                ],
              },

              route_distance_meters:
                18000,

              route_duration_seconds:
                2400,

              route_generated_at:
                '2026-09-21T17:45:00.000Z',

              route_expires_at:
                '2026-09-21T20:45:00.000Z',
            },
          ]);
        },
      );

    const result =
      await db
        .getAuthorizedTrustedMatchingContext(
          verifiedMemberId,
          movementNeedId,
          offeringMovementIntentId,
          signal(),
        );

    assert.equal(
      call.url,
      'https://project.invalid/rest/v1/rpc/get_authorized_trusted_matching_context_for_server',
    );

    assert.equal(
      call.init.method,
      'POST',
    );

    assert.equal(
      call.init.headers.Authorization,
      'Bearer server-secret',
    );

    assert.deepEqual(
      JSON.parse(call.init.body),
      {
        p_verified_member_id:
          verifiedMemberId,

        p_movement_need_id:
          movementNeedId,

        p_offering_movement_intent_id:
          offeringMovementIntentId,
      },
    );

    assert.deepEqual(
      result,
      {
        movementNeedId,
        requestingMemberId,

        requesterOriginLocationReferenceId:
          requesterOriginId,

        requesterOrigin: {
          latitude: 6.4300,
          longitude: 3.5200,
        },

        requesterDestinationLocationReferenceId:
          requesterDestinationId,

        requesterDestination: {
          latitude: 6.6018,
          longitude: 3.3515,
        },

        requesterEarliestDepartureAt:
          '2026-09-21T18:00:00.000Z',

        requesterLatestDepartureAt:
          '2026-09-21T19:00:00.000Z',

        offeringMovementIntentId,
        offeringMemberId,

        offeringIntentVersion: 1,

        offeringEarliestDepartureAt:
          '2026-09-21T18:15:00.000Z',

        offeringLatestDepartureAt:
          null,

        routeEvidenceId,
        routeEvidenceVersion: 2,

        routeShapeFormat:
          'geojson_linestring_v1',

        routeShape: {
          type: 'LineString',
          coordinates: [
            [3.5200, 6.4300],
            [3.4900, 6.4320],
            [3.4430, 6.4310],
          ],
        },

        routeDistanceMeters: 18000,
        routeDurationSeconds: 2400,

        routeGeneratedAt:
          '2026-09-21T17:45:00.000Z',

        routeExpiresAt:
          '2026-09-21T20:45:00.000Z',
      },
    );
  },
);

test(
  'requester availability matching context maps exactly to 0046 RPC',
  async () => {
    const verifiedMemberId =
      '11111111-1111-4111-8111-111111111111';

    const movementNeedId =
      '22222222-2222-4222-8222-222222222222';

    const availabilityId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const offeringMovementIntentId =
      '33333333-3333-4333-8333-333333333333';

    const offeringMemberId =
      '55555555-5555-4555-8555-555555555555';

    const requesterOriginId =
      '66666666-6666-4666-8666-666666666666';

    const requesterDestinationId =
      '77777777-7777-4777-8777-777777777777';

    const routeEvidenceId =
      '88888888-8888-4888-8888-888888888888';

    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              movement_need_id:
                movementNeedId,

              requesting_member_id:
                verifiedMemberId,

              requester_origin_location_reference_id:
                requesterOriginId,

              requester_origin_latitude:
                6.4300,

              requester_origin_longitude:
                3.5200,

              requester_destination_location_reference_id:
                requesterDestinationId,

              requester_destination_latitude:
                6.6018,

              requester_destination_longitude:
                3.3515,

              requester_earliest_departure_at:
                '2026-09-21T18:00:00.000Z',

              requester_latest_departure_at:
                '2026-09-21T19:00:00.000Z',

              offering_movement_intent_id:
                offeringMovementIntentId,

              offering_member_id:
                offeringMemberId,

              offering_intent_version:
                1,

              offering_earliest_departure_at:
                '2026-09-21T18:15:00.000Z',

              offering_latest_departure_at:
                null,

              route_evidence_id:
                routeEvidenceId,

              route_evidence_version:
                2,

              route_shape_format:
                'geojson_linestring_v1',

              route_shape: {
                type: 'LineString',
                coordinates: [
                  [3.5200, 6.4300],
                  [3.4900, 6.4320],
                  [3.4430, 6.4310],
                ],
              },

              route_distance_meters:
                18000,

              route_duration_seconds:
                2400,

              route_generated_at:
                '2026-09-21T17:45:00.000Z',

              route_expires_at:
                '2026-09-21T20:45:00.000Z',
            },
          ]);
        },
      );

    const result =
      await db
        .getRequesterAvailabilityMatchingContext(
          verifiedMemberId,
          movementNeedId,
          availabilityId,
          signal(),
        );

    assert.equal(
      call.url,
      'https://project.invalid/rest/v1/rpc/get_requester_availability_matching_context_for_server',
    );

    assert.equal(
      call.init.method,
      'POST',
    );

    assert.equal(
      call.init.headers.Authorization,
      'Bearer server-secret',
    );

    assert.deepEqual(
      JSON.parse(call.init.body),
      {
        p_verified_member_id:
          verifiedMemberId,

        p_movement_need_id:
          movementNeedId,

        p_availability_id:
          availabilityId,
      },
    );

    assert.deepEqual(
      result,
      {
        movementNeedId,

        requestingMemberId:
          verifiedMemberId,

        requesterOriginLocationReferenceId:
          requesterOriginId,

        requesterOrigin: {
          latitude: 6.4300,
          longitude: 3.5200,
        },

        requesterDestinationLocationReferenceId:
          requesterDestinationId,

        requesterDestination: {
          latitude: 6.6018,
          longitude: 3.3515,
        },

        requesterEarliestDepartureAt:
          '2026-09-21T18:00:00.000Z',

        requesterLatestDepartureAt:
          '2026-09-21T19:00:00.000Z',

        offeringMovementIntentId,
        offeringMemberId,

        offeringIntentVersion: 1,

        offeringEarliestDepartureAt:
          '2026-09-21T18:15:00.000Z',

        offeringLatestDepartureAt:
          null,

        routeEvidenceId,
        routeEvidenceVersion: 2,

        routeShapeFormat:
          'geojson_linestring_v1',

        routeShape: {
          type: 'LineString',
          coordinates: [
            [3.5200, 6.4300],
            [3.4900, 6.4320],
            [3.4430, 6.4310],
          ],
        },

        routeDistanceMeters: 18000,
        routeDurationSeconds: 2400,

        routeGeneratedAt:
          '2026-09-21T17:45:00.000Z',

        routeExpiresAt:
          '2026-09-21T20:45:00.000Z',
      },
    );
  },
);

test(
  'requester availability matching context rejects malformed identifiers before network request',
  async () => {
    let calls = 0;

    const verifiedMemberId =
      '11111111-1111-4111-8111-111111111111';

    const movementNeedId =
      '22222222-2222-4222-8222-222222222222';

    const availabilityId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () => {
          calls += 1;

          return Response.json([]);
        },
      );

    await assert.rejects(
      db.getRequesterAvailabilityMatchingContext(
        'not-a-uuid',
        movementNeedId,
        availabilityId,
        signal(),
      ),
    );

    await assert.rejects(
      db.getRequesterAvailabilityMatchingContext(
        verifiedMemberId,
        'not-a-uuid',
        availabilityId,
        signal(),
      ),
    );

    await assert.rejects(
      db.getRequesterAvailabilityMatchingContext(
        verifiedMemberId,
        movementNeedId,
        'not-a-uuid',
        signal(),
      ),
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'requester availability matching context rejects mismatched requester identity',
  async () => {
    const verifiedMemberId =
      '11111111-1111-4111-8111-111111111111';

    const movementNeedId =
      '22222222-2222-4222-8222-222222222222';

    const availabilityId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const wrongRequesterMemberId =
      '44444444-4444-4444-8444-444444444444';

    const offeringMovementIntentId =
      '33333333-3333-4333-8333-333333333333';

    const offeringMemberId =
      '55555555-5555-4555-8555-555555555555';

    const requesterOriginId =
      '66666666-6666-4666-8666-666666666666';

    const requesterDestinationId =
      '77777777-7777-4777-8777-777777777777';

    const routeEvidenceId =
      '88888888-8888-4888-8888-888888888888';

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () =>
          Response.json([
            {
              movement_need_id:
                movementNeedId,

              requesting_member_id:
                wrongRequesterMemberId,

              requester_origin_location_reference_id:
                requesterOriginId,

              requester_origin_latitude:
                6.4300,

              requester_origin_longitude:
                3.5200,

              requester_destination_location_reference_id:
                requesterDestinationId,

              requester_destination_latitude:
                6.6018,

              requester_destination_longitude:
                3.3515,

              requester_earliest_departure_at:
                '2026-09-21T18:00:00.000Z',

              requester_latest_departure_at:
                null,

              offering_movement_intent_id:
                offeringMovementIntentId,

              offering_member_id:
                offeringMemberId,

              offering_intent_version:
                1,

              offering_earliest_departure_at:
                '2026-09-21T18:15:00.000Z',

              offering_latest_departure_at:
                null,

              route_evidence_id:
                routeEvidenceId,

              route_evidence_version:
                2,

              route_shape_format:
                'geojson_linestring_v1',

              route_shape: {
                type: 'LineString',
                coordinates: [
                  [3.5200, 6.4300],
                  [3.4900, 6.4320],
                  [3.4430, 6.4310],
                ],
              },

              route_distance_meters:
                18000,

              route_duration_seconds:
                2400,

              route_generated_at:
                '2026-09-21T17:45:00.000Z',

              route_expires_at:
                null,
            },
          ]),
      );

    assert.equal(
      await db
        .getRequesterAvailabilityMatchingContext(
          verifiedMemberId,
          movementNeedId,
          availabilityId,
          signal(),
        ),
      null,
    );
  },
);

test(
  'authorized trusted matching context rejects malformed identifiers before network request',
  async () => {
    let calls = 0;

    const verifiedMemberId =
      '11111111-1111-4111-8111-111111111111';

    const movementNeedId =
      '22222222-2222-4222-8222-222222222222';

    const offeringMovementIntentId =
      '33333333-3333-4333-8333-333333333333';

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () => {
          calls += 1;
          return Response.json([]);
        },
      );

    await assert.rejects(
      db.getAuthorizedTrustedMatchingContext(
        'not-a-uuid',
        movementNeedId,
        offeringMovementIntentId,
        signal(),
      ),
    );

    await assert.rejects(
      db.getAuthorizedTrustedMatchingContext(
        verifiedMemberId,
        'not-a-uuid',
        offeringMovementIntentId,
        signal(),
      ),
    );

    await assert.rejects(
      db.getAuthorizedTrustedMatchingContext(
        verifiedMemberId,
        movementNeedId,
        'not-a-uuid',
        signal(),
      ),
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'authorized trusted matching context rejects malformed private context response',
  async () => {
    const verifiedMemberId =
      '11111111-1111-4111-8111-111111111111';

    const movementNeedId =
      '22222222-2222-4222-8222-222222222222';

    const offeringMovementIntentId =
      '33333333-3333-4333-8333-333333333333';

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () =>
          Response.json([
            {
              movement_need_id:
                movementNeedId,

              requesting_member_id:
                '44444444-4444-4444-8444-444444444444',

              requester_origin_location_reference_id:
                '66666666-6666-4666-8666-666666666666',

              requester_origin_latitude:
                6.4300,

              requester_origin_longitude:
                3.5200,

              requester_destination_location_reference_id:
                '77777777-7777-4777-8777-777777777777',

              requester_destination_latitude:
                6.6018,

              requester_destination_longitude:
                3.3515,

              requester_earliest_departure_at:
                '2026-09-21T18:00:00.000Z',

              requester_latest_departure_at:
                null,

              offering_movement_intent_id:
                offeringMovementIntentId,

              offering_member_id:
                '55555555-5555-4555-8555-555555555555',

              offering_intent_version:
                1,

              offering_earliest_departure_at:
                '2026-09-21T18:15:00.000Z',

              offering_latest_departure_at:
                null,

              route_evidence_id:
                '88888888-8888-4888-8888-888888888888',

              route_evidence_version:
                1,

              route_shape_format:
                'geojson_linestring_v1',

              route_shape: {
                type: 'LineString',
                coordinates: [
                  [3.5200, 6.4300],
                ],
              },

              route_distance_meters:
                18000,

              route_duration_seconds:
                2400,

              route_generated_at:
                '2026-09-21T17:45:00.000Z',

              route_expires_at:
                null,
            },
          ]),
      );

    assert.equal(
      await db
        .getAuthorizedTrustedMatchingContext(
          verifiedMemberId,
          movementNeedId,
          offeringMovementIntentId,
          signal(),
        ),
      null,
    );
  },
);

test(
  'trusted route-match evidence maps exactly to 0038 writer RPC',
  async () => {
    const movementNeedId =
      '11111111-1111-4111-8111-111111111111';

    const offeringMovementIntentId =
      '22222222-2222-4222-8222-222222222222';

    const routeEvidenceId =
      '33333333-3333-4333-8333-333333333333';

    const routeMatchEvidenceId =
      '44444444-4444-4444-8444-444444444444';

    let call;

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async (url, init) => {
          call = { url, init };

          return Response.json([
            {
              route_match_evidence_id:
                routeMatchEvidenceId,

              route_match_evidence_version:
                3,

              route_match_evidence_status:
                'current',

              route_match_evidence_expires_at:
                '2026-09-21T20:30:00.000Z',
            },
          ]);
        },
      );

    const result =
      await db.recordTrustedRouteMatchEvidence(
        {
          movementNeedId,
          offeringMovementIntentId,

          expectedRouteEvidenceId:
            routeEvidenceId,

          expectedRouteEvidenceVersion:
            2,

          requesterOriginDistanceToRouteMeters:
            4250,

          requesterDestinationDistanceToRouteMeters:
            12800,

          calculatedRouteShapeLengthMeters:
            18000,

          requesterOriginPositionAlongRouteMeters:
            3100,

          requesterDestinationPositionAlongRouteMeters:
            14500,

          requesterOriginClosestRoute: {
            latitude: 6.431,
            longitude: 3.482,
          },

          requesterDestinationClosestRoute: {
            latitude: 6.455,
            longitude: 3.421,
          },

          calculatedAt:
            '2026-09-21T18:10:00.000Z',

          expiresAt:
            '2026-09-21T20:30:00.000Z',
        },
        signal(),
      );

    assert.equal(
      call.url,
      'https://project.invalid/rest/v1/rpc/record_trusted_route_match_evidence_for_server',
    );

    assert.equal(
      call.init.method,
      'POST',
    );

    assert.equal(
      call.init.headers.Authorization,
      'Bearer server-secret',
    );

    assert.deepEqual(
      JSON.parse(call.init.body),
      {
        p_movement_need_id:
          movementNeedId,

        p_offering_movement_intent_id:
          offeringMovementIntentId,

        p_expected_route_evidence_id:
          routeEvidenceId,

        p_expected_route_evidence_version:
          2,

        p_requester_origin_distance_to_route_meters:
          4250,

        p_requester_destination_distance_to_route_meters:
          12800,

        p_calculated_route_shape_length_meters:
          18000,

        p_requester_origin_position_along_route_meters:
          3100,

        p_requester_destination_position_along_route_meters:
          14500,

        p_requester_origin_closest_route_latitude:
          6.431,

        p_requester_origin_closest_route_longitude:
          3.482,

        p_requester_destination_closest_route_latitude:
          6.455,

        p_requester_destination_closest_route_longitude:
          3.421,

        p_calculated_at:
          '2026-09-21T18:10:00.000Z',

        p_expires_at:
          '2026-09-21T20:30:00.000Z',
      },
    );

    assert.deepEqual(
      result,
      {
        routeMatchEvidenceId,
        routeMatchEvidenceVersion: 3,
        routeMatchEvidenceStatus:
          'current',
        routeMatchEvidenceExpiresAt:
          '2026-09-21T20:30:00.000Z',
      },
    );
  },
);

test(
  'trusted route-match evidence rejects malformed input before network request',
  async () => {
    let calls = 0;

    const baseInput = {
      movementNeedId:
        '11111111-1111-4111-8111-111111111111',

      offeringMovementIntentId:
        '22222222-2222-4222-8222-222222222222',

      expectedRouteEvidenceId:
        '33333333-3333-4333-8333-333333333333',

      expectedRouteEvidenceVersion:
        2,

      requesterOriginDistanceToRouteMeters:
        4250,

      requesterDestinationDistanceToRouteMeters:
        12800,

      calculatedRouteShapeLengthMeters:
        18000,

      requesterOriginPositionAlongRouteMeters:
        3100,

      requesterDestinationPositionAlongRouteMeters:
        14500,

      requesterOriginClosestRoute: {
        latitude: 6.431,
        longitude: 3.482,
      },

      requesterDestinationClosestRoute: {
        latitude: 6.455,
        longitude: 3.421,
      },

      calculatedAt:
        '2026-09-21T18:10:00.000Z',

      expiresAt:
        null,
    };

    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () => {
          calls += 1;
          return Response.json([]);
        },
      );

    await assert.rejects(
      db.recordTrustedRouteMatchEvidence(
        {
          ...baseInput,
          movementNeedId:
            'not-a-uuid',
        },
        signal(),
      ),
    );

    await assert.rejects(
      db.recordTrustedRouteMatchEvidence(
        {
          ...baseInput,
          requesterOriginDistanceToRouteMeters:
            -1,
        },
        signal(),
      ),
    );

    await assert.rejects(
      db.recordTrustedRouteMatchEvidence(
        {
          ...baseInput,
          requesterDestinationPositionAlongRouteMeters:
            19000,
        },
        signal(),
      ),
    );

    await assert.rejects(
      db.recordTrustedRouteMatchEvidence(
        {
          ...baseInput,
          requesterOriginClosestRoute: {
            latitude: 91,
            longitude: 3.482,
          },
        },
        signal(),
      ),
    );

    assert.equal(
      calls,
      0,
    );
  },
);

test(
  'trusted route-match evidence rejects malformed writer response',
  async () => {
    const db =
      createRouteBackend(
        'https://project.invalid',
        'server-secret',
        async () =>
          Response.json([
            {
              route_match_evidence_id:
                '44444444-4444-4444-8444-444444444444',

              route_match_evidence_version:
                0,

              route_match_evidence_status:
                'current',

              route_match_evidence_expires_at:
                null,
            },
          ]),
      );

    assert.equal(
      await db.recordTrustedRouteMatchEvidence(
        {
          movementNeedId:
            '11111111-1111-4111-8111-111111111111',

          offeringMovementIntentId:
            '22222222-2222-4222-8222-222222222222',

          expectedRouteEvidenceId:
            '33333333-3333-4333-8333-333333333333',

          expectedRouteEvidenceVersion:
            2,

          requesterOriginDistanceToRouteMeters:
            4250,

          requesterDestinationDistanceToRouteMeters:
            12800,

          calculatedRouteShapeLengthMeters:
            18000,

          requesterOriginPositionAlongRouteMeters:
            3100,

          requesterDestinationPositionAlongRouteMeters:
            14500,

          requesterOriginClosestRoute: {
            latitude: 6.431,
            longitude: 3.482,
          },

          requesterDestinationClosestRoute: {
            latitude: 6.455,
            longitude: 3.421,
          },

          calculatedAt:
            '2026-09-21T18:10:00.000Z',

          expiresAt:
            null,
        },
        signal(),
      ),
      null,
    );
  },
);
