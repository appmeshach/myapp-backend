import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createLocationBackend,
} from '../functions/_shared/location-runtime.ts';

const member =
  '11111111-1111-4111-8111-111111111111';

const selectionRequest =
  '22222222-2222-4222-8222-222222222222';

const source =
  '33333333-3333-4333-8333-333333333333';

const producer =
  '44444444-4444-4444-8444-444444444444';

const location =
  '55555555-5555-4555-8555-555555555555';

const evidence =
  '66666666-6666-4666-8666-666666666666';

function signal() {
  return new AbortController().signal;
}

test('authenticate uses incoming JWT only for auth user endpoint', async () => {
  const calls = [];

  const db =
    createLocationBackend(
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

  assert.equal(calls.length, 1);

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
});

test('member lookup uses service credential and exact member filter', async () => {
  let call;

  const db =
    createLocationBackend(
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
});

test('sb_secret service credential is never sent as Bearer Authorization', async () => {
  let call;

  const db =
    createLocationBackend(
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
});

test('record verified selection maps exactly to 0028 RPC', async () => {
  let call;

  const db =
    createLocationBackend(
      'https://project.invalid',
      'server-secret',
      async (url, init) => {
        call = { url, init };

        return Response.json([
          {
            location_reference_id:
              location,
            declared_label:
              'Ologolo, Lekki, Lagos',
          },
        ]);
      },
    );

  const result =
    await db.recordVerifiedSelection(
      {
        verifiedMemberId: member,
        selectionRequestId:
          selectionRequest,
        declaredLabel:
          'Ologolo, Lekki, Lagos',
        providerNamespace:
          'test-provider',
        providerPlaceReference:
          'opaque-ref',
        proofVersion:
          'selection_proof_v1',
        proofIssuedAt:
          '2026-09-17T12:00:00.000Z',
        proofExpiresAt:
          '2026-09-17T12:02:00.000Z',
      },
      signal(),
    );

  assert.deepEqual(
    result,
    {
      locationReferenceId:
        location,
      declaredLabel:
        'Ologolo, Lekki, Lagos',
    },
  );

  assert.equal(
    new URL(call.url).pathname,
    '/rest/v1/rpc/record_verified_selected_location_for_server',
  );

  assert.deepEqual(
    JSON.parse(call.init.body),
    {
      p_verified_member_id:
        member,
      p_selection_request_id:
        selectionRequest,
      p_declared_label:
        'Ologolo, Lekki, Lagos',
      p_provider_namespace:
        'test-provider',
      p_provider_place_reference:
        'opaque-ref',
      p_proof_version:
        'selection_proof_v1',
      p_proof_issued_at:
        '2026-09-17T12:00:00.000Z',
      p_proof_expires_at:
        '2026-09-17T12:02:00.000Z',
    },
  );
});

test('recovery maps exactly to 0028 recovery RPC', async () => {
  let call;

  const db =
    createLocationBackend(
      'https://project.invalid',
      'server-secret',
      async (url, init) => {
        call = { url, init };

        return Response.json([
          {
            location_reference_id:
              location,
            declared_label:
              'Ologolo, Lekki, Lagos',
          },
        ]);
      },
    );

  await db.recoverVerifiedSelection(
    member,
    selectionRequest,
    signal(),
  );

  assert.equal(
    new URL(call.url).pathname,
    '/rest/v1/rpc/get_verified_selected_location_for_server',
  );

  assert.deepEqual(
    JSON.parse(call.init.body),
    {
      p_verified_member_id:
        member,
      p_selection_request_id:
        selectionRequest,
    },
  );
});

test('resolution context maps exact three identifiers', async () => {
  let call;

  const db =
    createLocationBackend(
      'https://project.invalid',
      'server-secret',
      async (url, init) => {
        call = { url, init };

        return Response.json([
          {
            provider_namespace:
              'test-provider',
            provider_place_reference:
              'opaque-ref',
            source_created_at:
              '2026-09-17T12:00:00+00:00',
            source_expires_at: null,
            evidence_id: null,
            resolved_location_reference_id:
              null,
            version: null,
            expires_at: null,
            has_trusted_state_evidence:
              false,
          },
        ]);
      },
    );

  const result =
    await db.getResolutionContext(
      member,
      source,
      producer,
      signal(),
    );

  assert.equal(
    result.providerNamespace,
    'test-provider',
  );

  assert.equal(
    result.sourceCreatedAt,
    '2026-09-17T12:00:00.000Z',
  );

  assert.equal(
    new URL(call.url).pathname,
    '/rest/v1/rpc/get_selected_location_resolution_context_with_state_for_server',
  );

  assert.deepEqual(
    JSON.parse(call.init.body),
    {
      p_verified_member_id:
        member,
      p_source_location_reference_id:
        source,
      p_producer_request_id:
        producer,
    },
  );
});

test('attested resolution maps all 0028 arguments exactly', async () => {
  let call;

  const db =
    createLocationBackend(
      'https://project.invalid',
      'server-secret',
      async (url, init) => {
        call = { url, init };

        return Response.json([
          {
            evidence_id:
              evidence,
            resolved_location_reference_id:
              location,
            version: 1,
            expires_at: null,
          },
        ]);
      },
    );

  const result =
    await db.recordAttestedResolution(
      {
        verifiedMemberId:
          member,
        sourceLocationReferenceId:
          source,
        producerRequestId:
          producer,
        providerNamespace:
          'test-provider',
        providerProduct:
          'test-geocoder',
        providerVersion:
          'v1',
        providerPlaceReference:
          'opaque-ref',
        resolutionVersion:
          'normalization-v1',
        discoveryAreaLabel:
          'Ologolo, Lagos',
        latitude: 6.45,
        longitude: 3.47,
        resolvedAt:
          '2026-09-17T12:00:00.000Z',
        expiresAt: null,
      },
      signal(),
    );

  assert.deepEqual(
    result,
    {
      evidenceId: evidence,
      resolvedLocationReferenceId:
        location,
      version: 1,
      expiresAt: null,
    },
  );

  assert.equal(
    new URL(call.url).pathname,
    '/rest/v1/rpc/record_attested_location_resolution_for_server',
  );

  assert.deepEqual(
    JSON.parse(call.init.body),
    {
      p_verified_member_id:
        member,
      p_source_location_reference_id:
        source,
      p_producer_request_id:
        producer,
      p_provider_namespace:
        'test-provider',
      p_provider_product:
        'test-geocoder',
      p_provider_version:
        'v1',
      p_provider_place_reference:
        'opaque-ref',
      p_resolution_version:
        'normalization-v1',
      p_discovery_area_label:
        'Ologolo, Lagos',
      p_latitude: 6.45,
      p_longitude: 3.47,
      p_resolved_at:
        '2026-09-17T12:00:00.000Z',
      p_expires_at: null,
    },
  );
});

test('runtime rejects malformed Supabase roots', async () => {
  for (const url of [
    'ftp://project.invalid',
    'https://user:pass@project.invalid',
    'https://project.invalid/path',
    'https://project.invalid/?x=1',
    'https://project.invalid/#fragment',
    'http://evil.invalid',
  ]) {
    const db =
      createLocationBackend(
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
});

test('runtime rejects redirects and non-success responses', async () => {
  const redirectDb =
    createLocationBackend(
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
    createLocationBackend(
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
});

test('runtime bounds response bodies', async () => {
  const db =
    createLocationBackend(
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
});

test('invalid authentication result returns null', async () => {
  const db =
    createLocationBackend(
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
});

test('no incoming user JWT can become service Authorization', async () => {
  const calls = [];

  const db =
    createLocationBackend(
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
});

test('provider quota maps exactly to 0029 RPC', async () => {
  let call;

  const db =
    createLocationBackend(
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
    await db.consumeProviderQuota(
      member,
      'location_search',
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
    '/rest/v1/rpc/consume_location_provider_quota_for_server',
  );

  assert.deepEqual(
    JSON.parse(call.init.body),
    {
      p_verified_member_id:
        member,
      p_operation:
        'location_search',
    },
  );

  assert.equal(
    call.init.headers.Authorization,
    'Bearer server-secret',
  );
});

test('provider quota accepts resolution operation only through narrow operation values', async () => {
  const calls = [];

  const db =
    createLocationBackend(
      'https://project.invalid',
      'server-secret',
      async (url, init) => {
        calls.push({ url, init });

        return Response.json([
          {
            admitted: true,
            retry_after_seconds: 0,
          },
        ]);
      },
    );

  const result =
    await db.consumeProviderQuota(
      member,
      'location_resolution',
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
    calls.length,
    1,
  );

  assert.deepEqual(
    JSON.parse(calls[0].init.body),
    {
      p_verified_member_id:
        member,
      p_operation:
        'location_resolution',
    },
  );
});

test('provider quota rejects malformed member or operation before network request', async () => {
  let calls = 0;

  const db =
    createLocationBackend(
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
    db.consumeProviderQuota(
      'not-a-uuid',
      'location_search',
      signal(),
    ),
  );

  await assert.rejects(
    db.consumeProviderQuota(
      member,
      'invalid_operation',
      signal(),
    ),
  );

  assert.equal(
    calls,
    0,
  );
});

test('provider quota rejects malformed RPC response fail closed', async () => {
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
    [
      {
        admitted: true,
        retry_after_seconds: 0,
        extra: true,
      },
    ],
  ];

  for (const response of invalidResponses) {
    const db =
      createLocationBackend(
        'https://project.invalid',
        'server-secret',
        async () =>
          Response.json(response),
      );

    await assert.rejects(
      db.consumeProviderQuota(
        member,
        'location_search',
        signal(),
      ),
    );
  }
});

test('provider quota parses denied response with bounded retry', async () => {
  const db =
    createLocationBackend(
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
    await db.consumeProviderQuota(
      member,
      'location_search',
      signal(),
    ),
    {
      admitted: false,
      retryAfterSeconds: 37,
    },
  );
});

test('provider quota uses service authorization and never user JWT', async () => {
  let call;

  const db =
    createLocationBackend(
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

  await db.consumeProviderQuota(
    member,
    'location_search',
    signal(),
  );

  assert.equal(
    call.init.headers.Authorization,
    'Bearer server-secret',
  );

  assert.notEqual(
    call.init.headers.Authorization,
    'Bearer user-jwt',
  );
});