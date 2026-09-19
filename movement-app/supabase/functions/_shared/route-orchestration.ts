import { readBounded } from './face-orchestration.ts';

import {
    unavailableRouteProvider,
} from './route-contracts.ts';

import type {
    RecordedRouteEvidence,
    RouteBackend,
    RouteProvider,
    RouteProviderResult,
} from './route-contracts.ts';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const ROUTE_BODY_LIMIT = 2048;
const ROUTE_DEADLINE_MS = 20_000;
const RECOVERY_DEADLINE_MS = 3000;

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
  readonly retryAfterSeconds:
    number | null;

  constructor(
    status: number,
    state: string,
    retryAfterSeconds:
      number | null = null,
  ) {
    super(state);

    this.status = status;
    this.state = state;
    this.retryAfterSeconds =
      retryAfterSeconds;
  }
}

function response(
  status: number,
  body: unknown,
  retryAfterSeconds:
    number | null = null,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...headers,
        ...(
          retryAfterSeconds === null
            ? {}
            : {
                'Retry-After':
                  String(
                    retryAfterSeconds,
                  ),
              }
        ),
      },
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
        ...(
          error.retryAfterSeconds
            === null
            ? {}
            : {
                retryAfterSeconds:
                  error.retryAfterSeconds,
              }
        ),
      },
      error.retryAfterSeconds,
    );
  }

  return response(
    503,
    {
      state:
        'route_generation_unavailable',
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

function trimmed(
  value: unknown,
  max: number,
): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= max
    && /\S/u.test(value);
}

function validCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function validRouteResult(
  value: RouteProviderResult,
  provider: RouteProvider,
): boolean {
  if (
    !value
    || value.providerNamespace
      !== provider.providerNamespace
    || !trimmed(
      value.providerProduct,
      100,
    )
    || !trimmed(
      value.providerVersion,
      100,
    )
    || !trimmed(
      value.providerRouteReference,
      500,
    )
    || !record(value.routeShape)
    || value.routeShape.type
      !== 'LineString'
    || !Array.isArray(
      value.routeShape.coordinates,
    )
    || value.routeShape.coordinates
      .length < 2
    || !Number.isSafeInteger(
      value.routeDistanceMeters,
    )
    || value.routeDistanceMeters < 1
    || !Number.isSafeInteger(
      value.routeDurationSeconds,
    )
    || value.routeDurationSeconds < 1
    || !validIso(
      value.generatedAt,
    )
    || (
      value.expiresAt !== null
      && (
        !validIso(
          value.expiresAt,
        )
        || Date.parse(
          value.expiresAt,
        ) <= Date.parse(
          value.generatedAt,
        )
      )
    )
  ) {
    return false;
  }

  for (
    const point
    of value.routeShape.coordinates
  ) {
    if (
      !Array.isArray(point)
      || point.length !== 2
      || !validCoordinate(
        point[0],
        -180,
        180,
      )
      || !validCoordinate(
        point[1],
        -90,
        90,
      )
    ) {
      return false;
    }
  }

  return true;
}

function validEvidence(
  evidence: RecordedRouteEvidence,
): boolean {
  return !!evidence
    && UUID.test(
      evidence.routeEvidenceId,
    )
    && Number.isInteger(
      evidence.routeEvidenceVersion,
    )
    && evidence.routeEvidenceVersion
      >= 1
    && evidence.routeEvidenceStatus
      === 'current'
    && (
      evidence.routeEvidenceExpiresAt
        === null
      || validIso(
        evidence
          .routeEvidenceExpiresAt,
      )
    );
}

function ready(
  evidence: RecordedRouteEvidence,
): Response {
  if (!validEvidence(evidence)) {
    throw new Denied(
      503,
      'route_generation_unavailable',
    );
  }

  return response(
    200,
    {
      state: 'ready',

      routeEvidenceId:
        evidence.routeEvidenceId,

      routeEvidenceVersion:
        evidence.routeEvidenceVersion,

      routeEvidenceStatus:
        evidence.routeEvidenceStatus,

      routeEvidenceExpiresAt:
        evidence
          .routeEvidenceExpiresAt,
    },
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
    && length > ROUTE_BODY_LIMIT
  ) {
    throw new Denied(
      413,
      'request_too_large',
    );
  }

  return readBounded(
    request.body,
    ROUTE_BODY_LIMIT,
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

export function createRouteGenerationHandler(
  backend: RouteBackend,
  provider: RouteProvider =
    unavailableRouteProvider,
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

      const startedAt =
        performance.now();

      const signal =
        AbortSignal.any([
          request.signal,
          AbortSignal.timeout(
            ROUTE_DEADLINE_MS,
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
        || !exactKeys(
          body,
          [
            'offeringMovementIntentId',
          ],
        )
        || typeof body
          .offeringMovementIntentId
          !== 'string'
        || !UUID.test(
          body
            .offeringMovementIntentId,
        )
      ) {
        throw new Denied(
          400,
          'invalid_request',
        );
      }

      /*
       * 0033 is intentionally first.
       *
       * It serializes route generation for this
       * offering intent before provider quota or
       * Mapbox can be consumed.
       */
      const claim =
        await backend
          .claimRouteGeneration(
            body
              .offeringMovementIntentId,
            memberId,
            signal,
          )
          .catch(() => null);

      if (!claim) {
        throw new Denied(
          404,
          'route_generation_unavailable',
        );
      }

      if (
        claim.state === 'existing'
      ) {
        return ready(
          claim.routeEvidence,
        );
      }

      if (claim.state === 'busy') {
        throw new Denied(
          409,
          'route_generation_in_progress',
          claim.retryAfterSeconds,
        );
      }

      signal.throwIfAborted();

      if (
        provider.providerNamespace
          === 'unavailable'
        || !provider.isAvailable()
      ) {
        throw new Denied(
          503,
          'route_generation_unavailable',
        );
      }

      const quota =
        await backend
          .consumeRouteProviderQuota(
            memberId,
            signal,
          );

      if (
        !quota
        || typeof quota.admitted
          !== 'boolean'
        || !Number.isInteger(
          quota.retryAfterSeconds,
        )
        || (
          quota.admitted
            ? quota.retryAfterSeconds
                !== 0
            : quota.retryAfterSeconds
                < 1
              || quota.retryAfterSeconds
                > 86400
        )
      ) {
        throw new Error(
          'Unavailable',
        );
      }

      if (!quota.admitted) {
        throw new Denied(
          429,
          'route_rate_limited',
          quota.retryAfterSeconds,
        );
      }

      signal.throwIfAborted();

      const providerResult =
        await provider.route(
          {
            origin:
              claim.context.origin,

            destination:
              claim.context
                .destination,
          },
          signal,
        );

      if (
        !validRouteResult(
          providerResult,
          provider,
        )
      ) {
        throw new Denied(
          502,
          'provider_response_invalid',
        );
      }

      signal.throwIfAborted();

      /*
       * Keep enough of the one overall deadline
       * for one recovery claim lookup if the
       * database write outcome is ambiguous.
       */
      const writeBudget =
        Math.floor(
          ROUTE_DEADLINE_MS
          - (
            performance.now()
            - startedAt
          )
          - RECOVERY_DEADLINE_MS,
        );

      if (writeBudget <= 0) {
        throw new Error(
          'Unavailable',
        );
      }

      const writeSignal =
        AbortSignal.any([
          signal,
          AbortSignal.timeout(
            writeBudget,
          ),
        ]);

      let recorded:
        RecordedRouteEvidence | null;

      try {
        recorded =
          await backend
            .recordClaimedRouteEvidence(
              {
                offeringMovementIntentId:
                  body
                    .offeringMovementIntentId,

                offeringMemberId:
                  memberId,

                generationClaimToken:
                  claim.claimToken,

                providerNamespace:
                  providerResult
                    .providerNamespace,

                providerProduct:
                  providerResult
                    .providerProduct,

                providerVersion:
                  providerResult
                    .providerVersion,

                providerRouteReference:
                  providerResult
                    .providerRouteReference,

                routeShape:
                  providerResult
                    .routeShape,

                routeDistanceMeters:
                  providerResult
                    .routeDistanceMeters,

                routeDurationSeconds:
                  providerResult
                    .routeDurationSeconds,

                generatedAt:
                  providerResult
                    .generatedAt,

                expiresAt:
                  providerResult
                    .expiresAt,
              },
              writeSignal,
            );

        if (
          !recorded
          || !validEvidence(recorded)
        ) {
          throw new Error(
            'Unavailable',
          );
        }

        signal.throwIfAborted();
      } catch {
        signal.throwIfAborted();

        /*
         * Never call the routing provider again
         * here.
         *
         * A successful-but-lost 0033 write is
         * recovered by claiming again: the DB
         * returns the already-current route.
         */
        const recoverySignal =
          AbortSignal.any([
            signal,
            AbortSignal.timeout(
              RECOVERY_DEADLINE_MS,
            ),
          ]);

        const recovered =
          await backend
            .claimRouteGeneration(
              body
                .offeringMovementIntentId,
              memberId,
              recoverySignal,
            )
            .catch(() => null);

        if (
          recovered?.state
            === 'existing'
        ) {
          return ready(
            recovered.routeEvidence,
          );
        }

        if (
          recovered?.state
            === 'busy'
        ) {
          throw new Denied(
            409,
            'route_generation_in_progress',
            recovered
              .retryAfterSeconds,
          );
        }

        /*
         * If recovery says "claimed", the old
         * write did not produce a recoverable
         * current route. Do not perform another
         * provider call inside this request.
         */
        throw new Denied(
          409,
          'route_generation_unavailable',
        );
      }

      return ready(recorded);
    } catch (error) {
      return failure(error);
    }
  };
}