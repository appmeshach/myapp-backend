import { readBounded } from './face-orchestration.ts';

import type {
  RecordedRouteMatchEvidence,
  RouteBackend,
} from './route-contracts.ts';

import {
  calculateTrustedRouteMatchGeometry,
} from './route-match-geometry.ts';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const ROUTE_MATCH_BODY_LIMIT = 2048;
const ROUTE_MATCH_DEADLINE_MS = 10_000;

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Vary': 'Authorization, Origin',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
};

class Denied extends Error {
  readonly status: number;
  readonly state: string;

  constructor(
    status: number,
    state: string,
  ) {
    super(state);

    this.status = status;
    this.state = state;
  }
}

function response(
  status: number,
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers,
    },
  );
}

function failure(
  error: unknown,
): Response {
  if (error instanceof Denied) {
    return response(
      error.status,
      {
        state: error.state,
      },
    );
  }

  return response(
    503,
    {
      state:
        'route_match_unavailable',
    },
  );
}

function record(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual =
    Object.keys(value).sort();

  const expected =
    [...keys].sort();

  return actual.length
      === expected.length
    && actual.every(
      (item, index) =>
        item === expected[index],
    );
}

function validIso(
  value: unknown,
): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const time =
    Date.parse(value);

  return Number.isFinite(time)
    && new Date(time).toISOString()
      === value;
}

function validEvidence(
  evidence: RecordedRouteMatchEvidence,
): boolean {
  return !!evidence
    && UUID.test(
      evidence.routeMatchEvidenceId,
    )
    && Number.isInteger(
      evidence.routeMatchEvidenceVersion,
    )
    && evidence.routeMatchEvidenceVersion
      >= 1
    && evidence.routeMatchEvidenceStatus
      === 'current'
    && (
      evidence.routeMatchEvidenceExpiresAt
        === null
      || validIso(
        evidence
          .routeMatchEvidenceExpiresAt,
      )
    );
}

async function jsonBody(
  request: Request,
  signal: AbortSignal,
): Promise<unknown> {
  if (
    request.headers
      .get('Content-Type')
      ?.split(';')[0]
      ?.toLowerCase()
      !== 'application/json'
  ) {
    throw new Denied(
      415,
      'unsupported_content_type',
    );
  }

  const length =
    Number(
      request.headers
        .get('Content-Length'),
    );

  if (
    Number.isFinite(length)
    && length > ROUTE_MATCH_BODY_LIMIT
  ) {
    throw new Denied(
      413,
      'request_too_large',
    );
  }

  return readBounded(
    request.body,
    ROUTE_MATCH_BODY_LIMIT,
    signal,
  )
    .then(
      bytes =>
        JSON.parse(
          new TextDecoder()
            .decode(bytes),
        ),
    )
    .catch(error => {
      if (
        error instanceof Denied
        || error?.name ===
          'AbortError'
        || error?.name ===
          'TimeoutError'
      ) {
        throw error;
      }

      throw new Denied(
        400,
        'invalid_request',
      );
    });
}

function early(
  request: Request,
): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(
      null,
      {
        status: 204,
        headers,
      },
    );
  }

  if (
    request.method !== 'POST'
    || new URL(request.url).search
  ) {
    throw new Denied(
      400,
      'invalid_request',
    );
  }

  return null;
}

async function member(
  request: Request,
  backend: RouteBackend,
  signal: AbortSignal,
): Promise<string> {
  const jwt =
    request.headers
      .get('Authorization')
      ?.match(
        /^Bearer (\S+)$/i,
      )?.[1];

  if (!jwt) {
    throw new Denied(
      401,
      'authentication_required',
    );
  }

  const memberId =
    await backend.authenticate(
      jwt,
      signal,
    );

  if (
    !memberId
    || !UUID.test(memberId)
  ) {
    throw new Denied(
      401,
      'authentication_required',
    );
  }

  if (
    !await backend.memberExists(
      memberId,
      signal,
    )
  ) {
    throw new Denied(
      403,
      'membership_required',
    );
  }

  return memberId;
}

export function createRouteMatchHandler(
  backend: RouteBackend,
) {
  return async (
    request: Request,
  ): Promise<Response> => {
    try {
      const first =
        early(request);

      if (first) {
        return first;
      }

      const signal =
        AbortSignal.any([
          request.signal,
          AbortSignal.timeout(
            ROUTE_MATCH_DEADLINE_MS,
          ),
        ]);

      signal.throwIfAborted();

      const memberId =
        await member(
          request,
          backend,
          signal,
        );

      const body =
        await jsonBody(
          request,
          signal,
        );

      if (
        !record(body)
        || typeof body.movementNeedId
          !== 'string'
        || !UUID.test(
          body.movementNeedId,
        )
      ) {
        throw new Denied(
          400,
          'invalid_request',
        );
      }

      const intentRequest =
        exactKeys(
          body,
          [
            'movementNeedId',
            'offeringMovementIntentId',
          ],
        )
        && typeof body
          .offeringMovementIntentId
          === 'string'
        && UUID.test(
          body
            .offeringMovementIntentId,
        );

      const availabilityRequest =
        exactKeys(
          body,
          [
            'movementNeedId',
            'availabilityId',
          ],
        )
        && typeof body.availabilityId
          === 'string'
        && UUID.test(
          body.availabilityId,
        );

      if (
        intentRequest === availabilityRequest
      ) {
        /*
         * Exactly one selector must be present.
         *
         * Old path:
         * movementNeedId + offeringMovementIntentId
         *
         * Requester availability path:
         * movementNeedId + availabilityId
         */
        throw new Denied(
          400,
          'invalid_request',
        );
      }

      /*
       * The old intent-based path keeps 0039 as its
       * authorization boundary.
       *
       * The requester availability path uses 0046,
       * which privately resolves the availability's
       * hidden offering intent and trusted route.
       *
       * Neither path exposes private requester
       * coordinates or route geometry to the client.
       */
      const context =
        await (
          intentRequest
            ? backend
                .getAuthorizedTrustedMatchingContext(
                  memberId,
                  body.movementNeedId,
                  body.offeringMovementIntentId as string,
                  signal,
                )
            : backend
                .getRequesterAvailabilityMatchingContext(
                  memberId,
                  body.movementNeedId,
                  body.availabilityId as string,
                  signal,
                )
        )
          .catch(() => null);

      if (!context) {
        /*
         * Do not distinguish unauthorized, missing,
         * stale, or otherwise ineligible matching
         * state to the caller.
         */
        throw new Denied(
          404,
          'route_match_unavailable',
        );
      }

      signal.throwIfAborted();

      const geometry =
        calculateTrustedRouteMatchGeometry(
          {
            requesterOrigin:
              context.requesterOrigin,

            requesterDestination:
              context.requesterDestination,

            routeShape:
              context.routeShape,
          },
        );

      signal.throwIfAborted();

      const calculatedAt =
        new Date().toISOString();

      const recorded =
        await backend
          .recordTrustedRouteMatchEvidence(
            {
              movementNeedId:
                context.movementNeedId,

              offeringMovementIntentId:
                context
                  .offeringMovementIntentId,

              expectedRouteEvidenceId:
                context.routeEvidenceId,

              expectedRouteEvidenceVersion:
                context.routeEvidenceVersion,

              requesterOriginDistanceToRouteMeters:
                geometry.requesterOrigin
                  .distanceToRouteMeters,

              requesterDestinationDistanceToRouteMeters:
                geometry.requesterDestination
                  .distanceToRouteMeters,

              calculatedRouteShapeLengthMeters:
                geometry
                  .calculatedRouteShapeLengthMeters,

              requesterOriginPositionAlongRouteMeters:
                geometry.requesterOrigin
                  .positionAlongRouteMeters,

              requesterDestinationPositionAlongRouteMeters:
                geometry.requesterDestination
                  .positionAlongRouteMeters,

              requesterOriginClosestRoute:
                geometry.requesterOrigin
                  .closestRoutePoint,

              requesterDestinationClosestRoute:
                geometry.requesterDestination
                  .closestRoutePoint,

              calculatedAt,

              /*
               * Let 0038 derive the effective expiry
               * from its trusted dependencies.
               */
              expiresAt: null,
            },
            signal,
          )
          .catch(() => null);

      if (
        !recorded
        || !validEvidence(recorded)
      ) {
        throw new Denied(
          503,
          'route_match_unavailable',
        );
      }

      /*
       * Privacy boundary:
       *
       * The requester destination and its route
       * distance are deliberately not returned.
       * The destination geometry remains private
       * evidence for later shared-segment logic.
       */
      return response(
        200,
        {
          state: 'ready',

          routeMatchEvidenceId:
            recorded
              .routeMatchEvidenceId,

          routeMatchEvidenceVersion:
            recorded
              .routeMatchEvidenceVersion,

          routeMatchEvidenceStatus:
            recorded
              .routeMatchEvidenceStatus,

          routeMatchEvidenceExpiresAt:
            recorded
              .routeMatchEvidenceExpiresAt,

          straightLineDistanceFromRouteMeters:
            geometry.requesterOrigin
              .distanceToRouteMeters,
        },
      );
    } catch (error) {
      return failure(error);
    }
  };
}
