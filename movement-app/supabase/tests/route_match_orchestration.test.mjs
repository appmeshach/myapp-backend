import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createRouteMatchHandler,
} from '../functions/_shared/route-match-orchestration.ts';

const member =
  '11111111-1111-4111-8111-111111111111';

const movementNeed =
  '22222222-2222-4222-8222-222222222222';

const intent =
  '33333333-3333-4333-8333-333333333333';

const availability =
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const requester =
  '44444444-4444-4444-8444-444444444444';

const offeringMember =
  '55555555-5555-4555-8555-555555555555';

const requesterOrigin =
  '66666666-6666-4666-8666-666666666666';

const requesterDestination =
  '77777777-7777-4777-8777-777777777777';

const routeEvidence =
  '88888888-8888-4888-8888-888888888888';

const routeMatchEvidence =
  '99999999-9999-4999-8999-999999999999';

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

function matchingContext(
  overrides = {},
) {
  return {
    movementNeedId:
      movementNeed,

    requestingMemberId:
      requester,

    requesterOriginLocationReferenceId:
      requesterOrigin,

    requesterOrigin: {
      latitude: 6.4400,
      longitude: 3.4500,
    },

    requesterDestinationLocationReferenceId:
      requesterDestination,

    requesterDestination: {
      latitude: 6.6018,
      longitude: 3.3515,
    },

    requesterEarliestDepartureAt:
      '2026-09-21T18:00:00.000Z',

    requesterLatestDepartureAt:
      null,

    offeringMovementIntentId:
      intent,

    offeringMemberId:
      offeringMember,

    offeringIntentVersion:
      1,

    offeringEarliestDepartureAt:
      '2026-09-21T18:15:00.000Z',

    offeringLatestDepartureAt:
      null,

    routeEvidenceId:
      routeEvidence,

    routeEvidenceVersion:
      2,

    routeShapeFormat:
      'geojson_linestring_v1',

    routeShape: {
      type: 'LineString',

      coordinates: [
        [3.4000, 6.4300],
        [3.5000, 6.4300],
      ],
    },

    routeDistanceMeters:
      12000,

    routeDurationSeconds:
      1800,

    routeGeneratedAt:
      '2026-09-21T17:45:00.000Z',

    routeExpiresAt:
      null,

    ...overrides,
  };
}

function recorded() {
  return {
    routeMatchEvidenceId:
      routeMatchEvidence,

    routeMatchEvidenceVersion:
      1,

    routeMatchEvidenceStatus:
      'current',

    routeMatchEvidenceExpiresAt:
      null,
  };
}

function backend(overrides = {}) {
  const calls = [];

  const db = {
    async authenticate(
      jwt,
      signal,
    ) {
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

    async getAuthorizedTrustedMatchingContext(
      verifiedMemberId,
      movementNeedId,
      offeringMovementIntentId,
      signal,
    ) {
      signal.throwIfAborted();

      calls.push([
        'context',
        verifiedMemberId,
        movementNeedId,
        offeringMovementIntentId,
      ]);

      return matchingContext();
    },

    async getRequesterAvailabilityMatchingContext(
      verifiedMemberId,
      movementNeedId,
      availabilityId,
      signal,
    ) {
      signal.throwIfAborted();

      calls.push([
        'availability-context',
        verifiedMemberId,
        movementNeedId,
        availabilityId,
      ]);

      return matchingContext();
    },

    async recordTrustedRouteMatchEvidence(
      input,
      signal,
    ) {
      signal.throwIfAborted();

      calls.push([
        'record',
        input,
      ]);

      return recorded();
    },

    ...overrides,
  };

  return {
    db,
    calls,
  };
}

test(
  'authorized route match calculates geometry and records trusted evidence',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,

          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      200,
    );

    const body =
      await response.json();

    assert.equal(
      body.state,
      'ready',
    );

    assert.equal(
      body.routeMatchEvidenceId,
      routeMatchEvidence,
    );

    assert.equal(
      body.routeMatchEvidenceVersion,
      1,
    );

    assert.equal(
      body.routeMatchEvidenceStatus,
      'current',
    );

    assert.equal(
      body.routeMatchEvidenceExpiresAt,
      null,
    );

    assert.equal(
      Number.isSafeInteger(
        body
          .straightLineDistanceFromRouteMeters,
      ),
      true,
    );

    assert.equal(
      body
        .straightLineDistanceFromRouteMeters
        >= 0,
      true,
    );

    assert.deepEqual(
      calls.map(
        call => call[0],
      ),
      [
        'auth',
        'member',
        'context',
        'record',
      ],
    );

    const contextCall =
      calls.find(
        call =>
          call[0] === 'context',
      );

    assert.deepEqual(
      contextCall,
      [
        'context',
        member,
        movementNeed,
        intent,
      ],
    );

    const write =
      calls.find(
        call =>
          call[0] === 'record',
      )[1];

    assert.equal(
      write.movementNeedId,
      movementNeed,
    );

    assert.equal(
      write.offeringMovementIntentId,
      intent,
    );

    assert.equal(
      write.expectedRouteEvidenceId,
      routeEvidence,
    );

    assert.equal(
      write.expectedRouteEvidenceVersion,
      2,
    );

    assert.equal(
      Number.isSafeInteger(
        write
          .requesterOriginDistanceToRouteMeters,
      ),
      true,
    );

    assert.equal(
      Number.isSafeInteger(
        write
          .requesterDestinationDistanceToRouteMeters,
      ),
      true,
    );

    assert.equal(
      write
        .calculatedRouteShapeLengthMeters
        > 0,
      true,
    );

    assert.equal(
      typeof write.calculatedAt,
      'string',
    );

    assert.equal(
      Number.isFinite(
        Date.parse(
          write.calculatedAt,
        ),
      ),
      true,
    );

    assert.equal(
      write.expiresAt,
      null,
    );
  },
);

test(
  'route match response keeps requester destination geometry private',
  async () => {
    const {
      db,
    } = backend();

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,

          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      200,
    );

    const body =
      await response.json();

    assert.equal(
      Object.hasOwn(
        body,
        'requesterDestination',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'requesterDestinationLatitude',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'requesterDestinationLongitude',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'requesterDestinationDistanceToRouteMeters',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'routeShape',
      ),
      false,
    );
  },
);

test(
  'unavailable or unauthorized matching context returns generic 404 and performs no write',
  async () => {
    const {
      db,
      calls,
    } = backend({
      async getAuthorizedTrustedMatchingContext(
        verifiedMemberId,
        movementNeedId,
        offeringMovementIntentId,
        signal,
      ) {
        signal.throwIfAborted();

        calls.push([
          'context',
          verifiedMemberId,
          movementNeedId,
          offeringMovementIntentId,
        ]);

        throw new Error(
          'unauthorized or unavailable',
        );
      },
    });

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,

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
          'route_match_unavailable',
      },
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'record',
      ),
      false,
    );
  },
);

test(
  'invalid route match request is rejected before private context lookup',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            'not-a-uuid',

          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      400,
    );

    assert.deepEqual(
      await response.json(),
      {
        state:
          'invalid_request',
      },
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'context',
      ),
      false,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'record',
      ),
      false,
    );
  },
);

test(
  'large requester distance is recorded as an objective fact and is not auto-rejected',
  async () => {
    const {
      db,
      calls,
    } = backend({
      async getAuthorizedTrustedMatchingContext(
        verifiedMemberId,
        movementNeedId,
        offeringMovementIntentId,
        signal,
      ) {
        signal.throwIfAborted();

        calls.push([
          'context',
          verifiedMemberId,
          movementNeedId,
          offeringMovementIntentId,
        ]);

        return matchingContext({
          requesterOrigin: {
            latitude: 10.0000,
            longitude: 8.0000,
          },
        });
      },
    });

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,

          offeringMovementIntentId:
            intent,
        }),
      );

    assert.equal(
      response.status,
      200,
    );

    const body =
      await response.json();

    assert.equal(
      body.state,
      'ready',
    );

    assert.equal(
      body
        .straightLineDistanceFromRouteMeters
        > 100000,
      true,
    );

    const write =
      calls.find(
        call =>
          call[0] === 'record',
      )[1];

    assert.equal(
      write
        .requesterOriginDistanceToRouteMeters
        > 100000,
      true,
    );
  },
);

test(
  'requester availability route match uses private availability context and records hidden intent',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,

          availabilityId:
            availability,
        }),
      );

    assert.equal(
      response.status,
      200,
    );

    const body =
      await response.json();

    assert.equal(
      body.state,
      'ready',
    );

    assert.deepEqual(
      calls.map(
        call => call[0],
      ),
      [
        'auth',
        'member',
        'availability-context',
        'record',
      ],
    );

    const contextCall =
      calls.find(
        call =>
          call[0]
            === 'availability-context',
      );

    assert.deepEqual(
      contextCall,
      [
        'availability-context',
        member,
        movementNeed,
        availability,
      ],
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'context',
      ),
      false,
    );

    const write =
      calls.find(
        call =>
          call[0] === 'record',
      )[1];

    /*
     * The client supplied only availabilityId.
     * The offering intent used by the writer came
     * from the trusted backend context.
     */
    assert.equal(
      write.offeringMovementIntentId,
      intent,
    );

    assert.equal(
      write.expectedRouteEvidenceId,
      routeEvidence,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'offeringMovementIntentId',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'availabilityId',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'routeShape',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'requesterDestination',
      ),
      false,
    );

    assert.equal(
      Object.hasOwn(
        body,
        'requesterDestinationDistanceToRouteMeters',
      ),
      false,
    );
  },
);


test(
  'route match rejects requests containing both intent and availability selectors',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,

          offeringMovementIntentId:
            intent,

          availabilityId:
            availability,
        }),
      );

    assert.equal(
      response.status,
      400,
    );

    assert.deepEqual(
      await response.json(),
      {
        state:
          'invalid_request',
      },
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'context'
          || call[0]
            === 'availability-context',
      ),
      false,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'record',
      ),
      false,
    );
  },
);


test(
  'route match rejects requests with no matching selector',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,
        }),
      );

    assert.equal(
      response.status,
      400,
    );

    assert.deepEqual(
      await response.json(),
      {
        state:
          'invalid_request',
      },
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'context'
          || call[0]
            === 'availability-context',
      ),
      false,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'record',
      ),
      false,
    );
  },
);


test(
  'invalid availability id is rejected before private context lookup',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,

          availabilityId:
            'not-a-uuid',
        }),
      );

    assert.equal(
      response.status,
      400,
    );

    assert.deepEqual(
      await response.json(),
      {
        state:
          'invalid_request',
      },
    );

    assert.equal(
      calls.some(
        call =>
          call[0]
            === 'availability-context',
      ),
      false,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'record',
      ),
      false,
    );
  },
);


test(
  'unavailable requester availability context returns generic 404 and performs no write',
  async () => {
    const {
      db,
      calls,
    } = backend({
      async getRequesterAvailabilityMatchingContext(
        verifiedMemberId,
        movementNeedId,
        availabilityId,
        signal,
      ) {
        signal.throwIfAborted();

        calls.push([
          'availability-context',
          verifiedMemberId,
          movementNeedId,
          availabilityId,
        ]);

        throw new Error(
          'unauthorized or unavailable',
        );
      },
    });

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request({
          movementNeedId:
            movementNeed,

          availabilityId:
            availability,
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
          'route_match_unavailable',
      },
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'record',
      ),
      false,
    );
  },
);

test(
  'route match requires authentication before matching context access',
  async () => {
    const {
      db,
      calls,
    } = backend();

    const response =
      await createRouteMatchHandler(
        db,
      )(
        request(
          {
            movementNeedId:
              movementNeed,

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

    assert.deepEqual(
      await response.json(),
      {
        state:
          'authentication_required',
      },
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'context',
      ),
      false,
    );

    assert.equal(
      calls.some(
        call =>
          call[0] === 'record',
      ),
      false,
    );
  },
);
