import { readBounded } from './face-orchestration.ts';

import type {
  RecordedRouteEvidence,
  RecordedRouteMatchEvidence,
  RouteBackend,
  RouteGenerationClaim,
  RouteGenerationContext,
  RouteProviderQuotaResult,
  TrustedMatchingContext,
} from './route-contracts.ts';

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const RPC_ROUTE_CONTEXT =
  'get_offering_route_generation_context_for_server';

const RPC_ROUTE_CLAIM =
  'claim_offering_route_generation_for_server';

const RPC_ROUTE_QUOTA =
  'consume_route_provider_quota_for_server';

const RPC_RECORD_ROUTE =
  'record_offering_route_evidence_for_server';

const RPC_RECORD_CLAIMED_ROUTE =
  'record_claimed_offering_route_evidence_for_server';

const RPC_AUTHORIZED_MATCHING_CONTEXT =
  'get_authorized_trusted_matching_context_for_server';

const RPC_REQUESTER_AVAILABILITY_MATCHING_CONTEXT =
  'get_requester_availability_matching_context_for_server';

const RPC_RECORD_ROUTE_MATCH =
  'record_trusted_route_match_evidence_for_server';

const ALLOWED_RPCS = new Set([
  RPC_ROUTE_CONTEXT,
  RPC_ROUTE_CLAIM,
  RPC_ROUTE_QUOTA,
  RPC_RECORD_ROUTE,
  RPC_RECORD_CLAIMED_ROUTE,
  RPC_AUTHORIZED_MATCHING_CONTEXT,
  RPC_REQUESTER_AVAILABILITY_MATCHING_CONTEXT,
  RPC_RECORD_ROUTE_MATCH,
]);

function serverSecret(): string {
  let secret =
    Deno.env.get(
      'SUPABASE_SERVICE_ROLE_KEY',
    ) ?? '';

  try {
    const keys = JSON.parse(
      Deno.env.get(
        'SUPABASE_SECRET_KEYS',
      ) ?? '{}',
    ) as Record<string, unknown>;

    if (
      typeof keys.default === 'string'
      && keys.default.length > 0
    ) {
      secret = keys.default;
    }
  } catch {
    // Preserve the repository's existing legacy fallback.
  }

  return secret;
}

function rootUrl(
  value: string,
): string {
  const url = new URL(value);

  const allowedHttp =
    url.protocol === 'http:'
    && [
      'localhost',
      '127.0.0.1',
      'kong',
    ].includes(url.hostname);

  if (
    url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !(
      url.protocol === 'https:'
      || allowedHttp
    )
  ) {
    throw new Error('Unavailable');
  }

  return url.origin;
}

function serviceHeaders(
  secret: string,
): Record<string, string> {
  if (!secret) {
    throw new Error('Unavailable');
  }

  return {
    apikey: secret,
    ...(
      secret.startsWith('sb_secret_')
        ? {}
        : {
            Authorization:
              `Bearer ${secret}`,
          }
    ),
  };
}

function exactlyOneRow(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !Array.isArray(value)
    || value.length !== 1
    || !value[0]
    || typeof value[0] !== 'object'
    || Array.isArray(value[0])
  ) {
    return null;
  }

  return value[0] as Record<
    string,
    unknown
  >;
}

function nullableIso(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;

  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return undefined;
  }

  const time = Date.parse(value);

  if (!Number.isFinite(time)) {
    return undefined;
  }

  return new Date(time).toISOString();
}

function finiteCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    return null;
  }

  return value;
}

function positiveSafeInteger(
  value: unknown,
): number | null {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1
  ) {
    return null;
  }

  return value;
}

function nonNegativeSafeInteger(
  value: unknown,
): number | null {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    return null;
  }

  return value;
}

function trustedLineString(
  value: unknown,
): {
  type: 'LineString';
  coordinates: number[][];
} | null {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    return null;
  }

  const shape =
    value as Record<string, unknown>;

  if (
    shape.type !== 'LineString'
    || !Array.isArray(
      shape.coordinates,
    )
    || shape.coordinates.length < 2
  ) {
    return null;
  }

  const coordinates: number[][] = [];

  for (
    const coordinate
    of shape.coordinates
  ) {
    if (
      !Array.isArray(coordinate)
      || coordinate.length !== 2
    ) {
      return null;
    }

    const longitude =
      finiteCoordinate(
        coordinate[0],
        -180,
        180,
      );

    const latitude =
      finiteCoordinate(
        coordinate[1],
        -90,
        90,
      );

    if (
      longitude === null
      || latitude === null
    ) {
      return null;
    }

    coordinates.push([
      longitude,
      latitude,
    ]);
  }

  return {
    type: 'LineString',
    coordinates,
  };
}

export function runtimeRouteBackend():
  RouteBackend {
  return createRouteBackend(
    Deno.env.get('SUPABASE_URL') ?? '',
    serverSecret(),
  );
}

export function createRouteBackend(
  supabaseUrl: string,
  secret: string,
  fetcher: typeof fetch = fetch,
): RouteBackend {
  function root(): string {
    if (!secret) {
      throw new Error('Unavailable');
    }

    return rootUrl(supabaseUrl);
  }

  async function request(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    const response =
      await fetcher(
        `${root()}${path}`,
        {
          ...init,
          signal,
          redirect: 'error',
          cache: 'no-store',
        },
      );

        if (
      !response.ok
      || response.redirected
    ) {
      throw new Error('Unavailable');
    }

    return response;
  }

  async function json(
    response: Response,
    signal: AbortSignal,
  ): Promise<unknown> {
    const bytes =
      await readBounded(
        response.body,
        64 * 1024,
        signal,
      );

    return JSON.parse(
      new TextDecoder().decode(bytes),
    );
  }

  async function rpc(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!ALLOWED_RPCS.has(name)) {
      throw new Error('Unavailable');
    }

    const response =
      await request(
        `/rest/v1/rpc/${name}`,
        {
          method: 'POST',
          headers: {
            ...serviceHeaders(secret),
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify(args),
        },
        signal,
      );

    return json(
      response,
      signal,
    );
  }

  function trustedMatchingContext(
    row: Record<string, unknown>,
    movementNeedId: string,
    expectedOfferingMovementIntentId:
      string | null,
    expectedRequestingMemberId:
      string | null,
  ): TrustedMatchingContext | null {
    if (
      typeof row.movement_need_id
        !== 'string'
      || !UUID.test(
        row.movement_need_id,
      )
      || row.movement_need_id
        !== movementNeedId
      || typeof row
        .requesting_member_id
        !== 'string'
      || !UUID.test(
        row.requesting_member_id,
      )
      || (
        expectedRequestingMemberId !== null
        && row.requesting_member_id
          !== expectedRequestingMemberId
      )
      || typeof row
        .offering_movement_intent_id
        !== 'string'
      || !UUID.test(
        row.offering_movement_intent_id,
      )
      || (
        expectedOfferingMovementIntentId
          !== null
        && row.offering_movement_intent_id
          !== expectedOfferingMovementIntentId
      )
      || typeof row
        .offering_member_id
        !== 'string'
      || !UUID.test(
        row.offering_member_id,
      )
      || typeof row
        .requester_origin_location_reference_id
        !== 'string'
      || !UUID.test(
        row
          .requester_origin_location_reference_id,
      )
      || typeof row
        .requester_destination_location_reference_id
        !== 'string'
      || !UUID.test(
        row
          .requester_destination_location_reference_id,
      )
      || row
          .requester_origin_location_reference_id
        === row
          .requester_destination_location_reference_id
    ) {
      return null;
    }

    const offeringIntentVersion =
      positiveSafeInteger(
        row.offering_intent_version,
      );

    const routeEvidenceVersion =
      positiveSafeInteger(
        row.route_evidence_version,
      );

    const routeDistanceMeters =
      positiveSafeInteger(
        row.route_distance_meters,
      );

    const routeDurationSeconds =
      positiveSafeInteger(
        row.route_duration_seconds,
      );

    const requesterOriginLatitude =
      finiteCoordinate(
        row.requester_origin_latitude,
        -90,
        90,
      );

    const requesterOriginLongitude =
      finiteCoordinate(
        row.requester_origin_longitude,
        -180,
        180,
      );

    const requesterDestinationLatitude =
      finiteCoordinate(
        row.requester_destination_latitude,
        -90,
        90,
      );

    const requesterDestinationLongitude =
      finiteCoordinate(
        row.requester_destination_longitude,
        -180,
        180,
      );

    const requesterEarliestDepartureAt =
      nullableIso(
        row.requester_earliest_departure_at,
      );

    const requesterLatestDepartureAt =
      nullableIso(
        row.requester_latest_departure_at,
      );

    const offeringEarliestDepartureAt =
      nullableIso(
        row.offering_earliest_departure_at,
      );

    const offeringLatestDepartureAt =
      nullableIso(
        row.offering_latest_departure_at,
      );

    const routeGeneratedAt =
      nullableIso(
        row.route_generated_at,
      );

    const routeExpiresAt =
      nullableIso(
        row.route_expires_at,
      );

    const routeShape =
      trustedLineString(
        row.route_shape,
      );

    if (
      offeringIntentVersion === null
      || routeEvidenceVersion === null
      || routeDistanceMeters === null
      || routeDurationSeconds === null
      || requesterOriginLatitude === null
      || requesterOriginLongitude === null
      || requesterDestinationLatitude === null
      || requesterDestinationLongitude === null
      || requesterEarliestDepartureAt === null
      || requesterEarliestDepartureAt
        === undefined
      || requesterLatestDepartureAt
        === undefined
      || offeringEarliestDepartureAt === null
      || offeringEarliestDepartureAt
        === undefined
      || offeringLatestDepartureAt
        === undefined
      || routeGeneratedAt === null
      || routeGeneratedAt === undefined
      || routeExpiresAt === undefined
      || typeof row.route_evidence_id
        !== 'string'
      || !UUID.test(
        row.route_evidence_id,
      )
      || row.route_shape_format
        !== 'geojson_linestring_v1'
      || routeShape === null
    ) {
      return null;
    }

    return {
      movementNeedId:
        row.movement_need_id,

      requestingMemberId:
        row.requesting_member_id,

      requesterOriginLocationReferenceId:
        row
          .requester_origin_location_reference_id,

      requesterOrigin: {
        latitude:
          requesterOriginLatitude,
        longitude:
          requesterOriginLongitude,
      },

      requesterDestinationLocationReferenceId:
        row
          .requester_destination_location_reference_id,

      requesterDestination: {
        latitude:
          requesterDestinationLatitude,
        longitude:
          requesterDestinationLongitude,
      },

      requesterEarliestDepartureAt,
      requesterLatestDepartureAt,

      offeringMovementIntentId:
        row.offering_movement_intent_id,

      offeringMemberId:
        row.offering_member_id,

      offeringIntentVersion,

      offeringEarliestDepartureAt,
      offeringLatestDepartureAt,

      routeEvidenceId:
        row.route_evidence_id,

      routeEvidenceVersion,

      routeShapeFormat:
        'geojson_linestring_v1',

      routeShape,

      routeDistanceMeters,
      routeDurationSeconds,

      routeGeneratedAt,
      routeExpiresAt,
    };
  }

  return {
    async authenticate(
      jwt,
      signal,
    ) {
      try {
        const response =
          await request(
            '/auth/v1/user',
            {
              headers: {
                apikey: secret,
                Authorization:
                  `Bearer ${jwt}`,
              },
            },
            signal,
          );

        const body =
          await json(
            response,
            signal,
          );

        if (
          !body
          || typeof body !== 'object'
          || Array.isArray(body)
        ) {
          return null;
        }

        const value =
          body as Record<
            string,
            unknown
          >;

        return value.role
            === 'authenticated'
          && typeof value.id
            === 'string'
          && UUID.test(value.id)
          ? value.id
          : null;
      } catch {
        return null;
      }
    },

    async memberExists(
      memberId,
      signal,
    ) {
      if (!UUID.test(memberId)) {
        throw new Error(
          'Unavailable',
        );
      }

      const query =
        new URLSearchParams({
          select: 'id',
          id: `eq.${memberId}`,
          limit: '2',
        });

      const response =
        await request(
          `/rest/v1/members?${query}`,
          {
            headers:
              serviceHeaders(secret),
          },
          signal,
        );

      const body =
        await json(
          response,
          signal,
        );

      return Array.isArray(body)
        && body.length === 1
        && body[0]
        && typeof body[0]
          === 'object'
        && !Array.isArray(body[0])
        && (
          body[0] as Record<
            string,
            unknown
          >
        ).id === memberId;
    },

        async consumeRouteProviderQuota(
      memberId,
      signal,
    ): Promise<RouteProviderQuotaResult> {
      if (!UUID.test(memberId)) {
        throw new Error(
          'Unavailable',
        );
      }

      signal.throwIfAborted();

      const body =
        await rpc(
          RPC_ROUTE_QUOTA,
          {
            p_verified_member_id:
              memberId,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) {
        throw new Error(
          'Unavailable',
        );
      }

      if (
        typeof row.admitted !==
          'boolean'
        || !Number.isInteger(
          row.retry_after_seconds,
        )
        || Number(
          row.retry_after_seconds,
        ) < 0
        || Number(
          row.retry_after_seconds,
        ) > 86400
      ) {
        throw new Error(
          'Unavailable',
        );
      }

      const retryAfterSeconds =
        Number(
          row.retry_after_seconds,
        );

      if (
        row.admitted
        && retryAfterSeconds !== 0
      ) {
        throw new Error(
          'Unavailable',
        );
      }

      if (
        !row.admitted
        && retryAfterSeconds < 1
      ) {
        throw new Error(
          'Unavailable',
        );
      }

      return {
        admitted:
          row.admitted,
        retryAfterSeconds,
      };
    },

        async claimRouteGeneration(
      offeringMovementIntentId,
      offeringMemberId,
      signal,
    ): Promise<RouteGenerationClaim | null> {
      if (
        !UUID.test(
          offeringMovementIntentId,
        )
        || !UUID.test(
          offeringMemberId,
        )
      ) {
        throw new Error('Unavailable');
      }

      signal.throwIfAborted();

      const body =
        await rpc(
          RPC_ROUTE_CLAIM,
          {
            p_offering_movement_intent_id:
              offeringMovementIntentId,

            p_offering_member_id:
              offeringMemberId,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) {
        return null;
      }

      if (
        row.generation_state ===
          'existing'
      ) {
        const expiresAt =
          nullableIso(
            row
              .route_evidence_expires_at,
          );

        if (
          row.generation_claim_token
            !== null
          || row.retry_after_seconds
            !== 0
          || typeof row
            .route_evidence_id
            !== 'string'
          || !UUID.test(
            row.route_evidence_id,
          )
          || !Number.isInteger(
            row.route_evidence_version,
          )
          || Number(
            row.route_evidence_version,
          ) < 1
          || row.route_evidence_status
            !== 'current'
          || expiresAt === undefined
          || row
            .origin_location_reference_id
            !== null
          || row.origin_latitude
            !== null
          || row.origin_longitude
            !== null
          || row
            .destination_location_reference_id
            !== null
          || row.destination_latitude
            !== null
          || row.destination_longitude
            !== null
        ) {
          return null;
        }

        return {
          state: 'existing',

          routeEvidence: {
            routeEvidenceId:
              row.route_evidence_id,

            routeEvidenceVersion:
              Number(
                row.route_evidence_version,
              ),

            routeEvidenceStatus:
              row.route_evidence_status,

            routeEvidenceExpiresAt:
              expiresAt,
          },
        };
      }

      if (
        row.generation_state ===
          'busy'
      ) {
        if (
          row.generation_claim_token
            !== null
          || !Number.isInteger(
            row.retry_after_seconds,
          )
          || Number(
            row.retry_after_seconds,
          ) < 1
          || Number(
            row.retry_after_seconds,
          ) > 30
          || row.route_evidence_id
            !== null
          || row.route_evidence_version
            !== null
          || row.route_evidence_status
            !== null
          || row
            .route_evidence_expires_at
            !== null
          || row
            .origin_location_reference_id
            !== null
          || row.origin_latitude
            !== null
          || row.origin_longitude
            !== null
          || row
            .destination_location_reference_id
            !== null
          || row.destination_latitude
            !== null
          || row.destination_longitude
            !== null
        ) {
          return null;
        }

        return {
          state: 'busy',

          retryAfterSeconds:
            Number(
              row.retry_after_seconds,
            ),
        };
      }

      if (
        row.generation_state !==
          'claimed'
      ) {
        return null;
      }

      if (
        typeof row
          .generation_claim_token
          !== 'string'
        || !UUID.test(
          row.generation_claim_token,
        )
        || row.retry_after_seconds
          !== 0
        || row.route_evidence_id
          !== null
        || row.route_evidence_version
          !== null
        || row.route_evidence_status
          !== null
        || row
          .route_evidence_expires_at
          !== null
        || typeof row
          .origin_location_reference_id
          !== 'string'
        || !UUID.test(
          row
            .origin_location_reference_id,
        )
        || typeof row
          .destination_location_reference_id
          !== 'string'
        || !UUID.test(
          row
            .destination_location_reference_id,
        )
        || row
            .origin_location_reference_id
          === row
            .destination_location_reference_id
      ) {
        return null;
      }

      const originLatitude =
        finiteCoordinate(
          row.origin_latitude,
          -90,
          90,
        );

      const originLongitude =
        finiteCoordinate(
          row.origin_longitude,
          -180,
          180,
        );

      const destinationLatitude =
        finiteCoordinate(
          row.destination_latitude,
          -90,
          90,
        );

      const destinationLongitude =
        finiteCoordinate(
          row.destination_longitude,
          -180,
          180,
        );

      if (
        originLatitude === null
        || originLongitude === null
        || destinationLatitude
          === null
        || destinationLongitude
          === null
      ) {
        return null;
      }

      return {
        state: 'claimed',

        claimToken:
          row.generation_claim_token,

        context: {
          offeringMovementIntentId,
          offeringMemberId,

          originLocationReferenceId:
            row
              .origin_location_reference_id,

          origin: {
            latitude:
              originLatitude,
            longitude:
              originLongitude,
          },

          destinationLocationReferenceId:
            row
              .destination_location_reference_id,

          destination: {
            latitude:
              destinationLatitude,
            longitude:
              destinationLongitude,
          },
        },
      };
    },


    async getRouteGenerationContext(
      offeringMovementIntentId,
      offeringMemberId,
      signal,
    ): Promise<
      RouteGenerationContext | null
    > {
      if (
        !UUID.test(
          offeringMovementIntentId,
        )
        || !UUID.test(
          offeringMemberId,
        )
      ) {
        throw new Error('Unavailable');
      }

      signal.throwIfAborted();

      const body =
        await rpc(
          RPC_ROUTE_CONTEXT,
          {
            p_offering_movement_intent_id:
              offeringMovementIntentId,

            p_offering_member_id:
              offeringMemberId,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) {
        return null;
      }

      if (
        typeof row
          .offering_movement_intent_id
          !== 'string'
        || !UUID.test(
          row.offering_movement_intent_id,
        )
        || row
            .offering_movement_intent_id
          !== offeringMovementIntentId
        || typeof row
          .offering_member_id
          !== 'string'
        || !UUID.test(
          row.offering_member_id,
        )
        || row.offering_member_id
          !== offeringMemberId
        || typeof row
          .origin_location_reference_id
          !== 'string'
        || !UUID.test(
          row.origin_location_reference_id,
        )
        || typeof row
          .destination_location_reference_id
          !== 'string'
        || !UUID.test(
          row.destination_location_reference_id,
        )
        || row
            .origin_location_reference_id
          === row
            .destination_location_reference_id
      ) {
        return null;
      }

      const originLatitude =
        finiteCoordinate(
          row.origin_latitude,
          -90,
          90,
        );

      const originLongitude =
        finiteCoordinate(
          row.origin_longitude,
          -180,
          180,
        );

      const destinationLatitude =
        finiteCoordinate(
          row.destination_latitude,
          -90,
          90,
        );

      const destinationLongitude =
        finiteCoordinate(
          row.destination_longitude,
          -180,
          180,
        );

      if (
        originLatitude === null
        || originLongitude === null
        || destinationLatitude === null
        || destinationLongitude === null
      ) {
        return null;
      }

      return {
        offeringMovementIntentId:
          row
            .offering_movement_intent_id,

        offeringMemberId:
          row.offering_member_id,

        originLocationReferenceId:
          row.origin_location_reference_id,

        origin: {
          latitude:
            originLatitude,
          longitude:
            originLongitude,
        },

        destinationLocationReferenceId:
          row
            .destination_location_reference_id,

        destination: {
          latitude:
            destinationLatitude,
          longitude:
            destinationLongitude,
        },
      };
    },

    async getAuthorizedTrustedMatchingContext(
      verifiedMemberId,
      movementNeedId,
      offeringMovementIntentId,
      signal,
    ): Promise<
      TrustedMatchingContext | null
    > {
      if (
        !UUID.test(verifiedMemberId)
        || !UUID.test(movementNeedId)
        || !UUID.test(
          offeringMovementIntentId,
        )
      ) {
        throw new Error('Unavailable');
      }

      signal.throwIfAborted();

      const body =
        await rpc(
          RPC_AUTHORIZED_MATCHING_CONTEXT,
          {
            p_verified_member_id:
              verifiedMemberId,

            p_movement_need_id:
              movementNeedId,

            p_offering_movement_intent_id:
              offeringMovementIntentId,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) {
        return null;
      }

      return trustedMatchingContext(
        row,
        movementNeedId,
        offeringMovementIntentId,
        null,
      );
    },


    async getRequesterAvailabilityMatchingContext(
      verifiedMemberId,
      movementNeedId,
      availabilityId,
      signal,
    ): Promise<
      TrustedMatchingContext | null
    > {
      if (
        !UUID.test(verifiedMemberId)
        || !UUID.test(movementNeedId)
        || !UUID.test(availabilityId)
      ) {
        throw new Error('Unavailable');
      }

      signal.throwIfAborted();

      const body =
        await rpc(
          RPC_REQUESTER_AVAILABILITY_MATCHING_CONTEXT,
          {
            p_verified_member_id:
              verifiedMemberId,

            p_movement_need_id:
              movementNeedId,

            p_availability_id:
              availabilityId,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) {
        return null;
      }

      /*
       * Unlike the older intent-based path, the
       * requester does not know the hidden offering
       * movement-intent id.
       *
       * 0046 derives and validates that binding in
       * the database. Here we independently require
       * the returned requester identity to equal the
       * verified authenticated member.
       */
      return trustedMatchingContext(
        row,
        movementNeedId,
        null,
        verifiedMemberId,
      );
    },



    async recordTrustedRouteMatchEvidence(
      input,
      signal,
    ): Promise<
      RecordedRouteMatchEvidence | null
    > {
      if (
        !UUID.test(
          input.movementNeedId,
        )
        || !UUID.test(
          input.offeringMovementIntentId,
        )
        || !UUID.test(
          input.expectedRouteEvidenceId,
        )
      ) {
        throw new Error('Unavailable');
      }

      const expectedRouteEvidenceVersion =
        positiveSafeInteger(
          input.expectedRouteEvidenceVersion,
        );

      const requesterOriginDistanceToRouteMeters =
        nonNegativeSafeInteger(
          input.requesterOriginDistanceToRouteMeters,
        );

      const requesterDestinationDistanceToRouteMeters =
        nonNegativeSafeInteger(
          input.requesterDestinationDistanceToRouteMeters,
        );

      const calculatedRouteShapeLengthMeters =
        positiveSafeInteger(
          input.calculatedRouteShapeLengthMeters,
        );

      const requesterOriginPositionAlongRouteMeters =
        nonNegativeSafeInteger(
          input.requesterOriginPositionAlongRouteMeters,
        );

      const requesterDestinationPositionAlongRouteMeters =
        nonNegativeSafeInteger(
          input.requesterDestinationPositionAlongRouteMeters,
        );

      const requesterOriginClosestLatitude =
        finiteCoordinate(
          input.requesterOriginClosestRoute.latitude,
          -90,
          90,
        );

      const requesterOriginClosestLongitude =
        finiteCoordinate(
          input.requesterOriginClosestRoute.longitude,
          -180,
          180,
        );

      const requesterDestinationClosestLatitude =
        finiteCoordinate(
          input.requesterDestinationClosestRoute.latitude,
          -90,
          90,
        );

      const requesterDestinationClosestLongitude =
        finiteCoordinate(
          input.requesterDestinationClosestRoute.longitude,
          -180,
          180,
        );

      const calculatedAt =
        nullableIso(
          input.calculatedAt,
        );

      const expiresAt =
        nullableIso(
          input.expiresAt,
        );

      if (
        expectedRouteEvidenceVersion === null
        || requesterOriginDistanceToRouteMeters
          === null
        || requesterDestinationDistanceToRouteMeters
          === null
        || calculatedRouteShapeLengthMeters
          === null
        || requesterOriginPositionAlongRouteMeters
          === null
        || requesterDestinationPositionAlongRouteMeters
          === null
        || requesterOriginPositionAlongRouteMeters
          > calculatedRouteShapeLengthMeters
        || requesterDestinationPositionAlongRouteMeters
          > calculatedRouteShapeLengthMeters
        || requesterOriginClosestLatitude
          === null
        || requesterOriginClosestLongitude
          === null
        || requesterDestinationClosestLatitude
          === null
        || requesterDestinationClosestLongitude
          === null
        || calculatedAt === null
        || calculatedAt === undefined
        || expiresAt === undefined
      ) {
        throw new Error('Unavailable');
      }

      signal.throwIfAborted();

      const body =
        await rpc(
          RPC_RECORD_ROUTE_MATCH,
          {
            p_movement_need_id:
              input.movementNeedId,

            p_offering_movement_intent_id:
              input.offeringMovementIntentId,

            p_expected_route_evidence_id:
              input.expectedRouteEvidenceId,

            p_expected_route_evidence_version:
              expectedRouteEvidenceVersion,

            p_requester_origin_distance_to_route_meters:
              requesterOriginDistanceToRouteMeters,

            p_requester_destination_distance_to_route_meters:
              requesterDestinationDistanceToRouteMeters,

            p_calculated_route_shape_length_meters:
              calculatedRouteShapeLengthMeters,

            p_requester_origin_position_along_route_meters:
              requesterOriginPositionAlongRouteMeters,

            p_requester_destination_position_along_route_meters:
              requesterDestinationPositionAlongRouteMeters,

            p_requester_origin_closest_route_latitude:
              requesterOriginClosestLatitude,

            p_requester_origin_closest_route_longitude:
              requesterOriginClosestLongitude,

            p_requester_destination_closest_route_latitude:
              requesterDestinationClosestLatitude,

            p_requester_destination_closest_route_longitude:
              requesterDestinationClosestLongitude,

            p_calculated_at:
              calculatedAt,

            p_expires_at:
              expiresAt,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) {
        return null;
      }

      const routeMatchEvidenceVersion =
        positiveSafeInteger(
          row.route_match_evidence_version,
        );

      const routeMatchEvidenceExpiresAt =
        nullableIso(
          row.route_match_evidence_expires_at,
        );

      if (
        typeof row
          .route_match_evidence_id
          !== 'string'
        || !UUID.test(
          row.route_match_evidence_id,
        )
        || routeMatchEvidenceVersion
          === null
        || row.route_match_evidence_status
          !== 'current'
        || routeMatchEvidenceExpiresAt
          === undefined
      ) {
        return null;
      }

      return {
        routeMatchEvidenceId:
          row.route_match_evidence_id,

        routeMatchEvidenceVersion,

        routeMatchEvidenceStatus:
          row.route_match_evidence_status,

        routeMatchEvidenceExpiresAt,
      };
    },

    async recordClaimedRouteEvidence(
      input,
      signal,
    ): Promise<
      RecordedRouteEvidence | null
    > {
      if (
        !UUID.test(
          input
            .offeringMovementIntentId,
        )
        || !UUID.test(
          input.offeringMemberId,
        )
        || !UUID.test(
          input.generationClaimToken,
        )
      ) {
        throw new Error('Unavailable');
      }

      signal.throwIfAborted();

      const body =
        await rpc(
          RPC_RECORD_CLAIMED_ROUTE,
          {
            p_offering_movement_intent_id:
              input
                .offeringMovementIntentId,

            p_offering_member_id:
              input.offeringMemberId,

            p_generation_claim_token:
              input.generationClaimToken,

            p_provider_namespace:
              input.providerNamespace,

            p_provider_product:
              input.providerProduct,

            p_provider_version:
              input.providerVersion,

            p_provider_route_reference:
              input
                .providerRouteReference,

            p_route_shape:
              input.routeShape,

            p_route_distance_meters:
              input.routeDistanceMeters,

            p_route_duration_seconds:
              input.routeDurationSeconds,

            p_generated_at:
              input.generatedAt,

            p_expires_at:
              input.expiresAt,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) {
        return null;
      }

      const expiresAt =
        nullableIso(
          row
            .route_evidence_expires_at,
        );

      if (
        typeof row
          .route_evidence_id
          !== 'string'
        || !UUID.test(
          row.route_evidence_id,
        )
        || !Number.isInteger(
          row.route_evidence_version,
        )
        || Number(
          row.route_evidence_version,
        ) < 1
        || row.route_evidence_status
          !== 'current'
        || expiresAt === undefined
      ) {
        return null;
      }

      return {
        routeEvidenceId:
          row.route_evidence_id,

        routeEvidenceVersion:
          Number(
            row.route_evidence_version,
          ),

        routeEvidenceStatus:
          row.route_evidence_status,

        routeEvidenceExpiresAt:
          expiresAt,
      };
    },

    async recordRouteEvidence(
      input,
      signal,
    ): Promise<
      RecordedRouteEvidence | null
    > {
      if (
        !UUID.test(
          input
            .offeringMovementIntentId,
        )
      ) {
        throw new Error('Unavailable');
      }

      signal.throwIfAborted();

      const body =
        await rpc(
          RPC_RECORD_ROUTE,
          {
            p_offering_movement_intent_id:
              input
                .offeringMovementIntentId,

            p_provider_namespace:
              input.providerNamespace,

            p_provider_product:
              input.providerProduct,

            p_provider_version:
              input.providerVersion,

            p_provider_route_reference:
              input
                .providerRouteReference,

            p_route_shape:
              input.routeShape,

            p_route_distance_meters:
              input.routeDistanceMeters,

            p_route_duration_seconds:
              input.routeDurationSeconds,

            p_generated_at:
              input.generatedAt,

            p_expires_at:
              input.expiresAt,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) {
        return null;
      }

      const expiresAt =
        nullableIso(
          row
            .route_evidence_expires_at,
        );

      if (
        typeof row
          .route_evidence_id
          !== 'string'
        || !UUID.test(
          row.route_evidence_id,
        )
        || !Number.isInteger(
          row.route_evidence_version,
        )
        || Number(
          row.route_evidence_version,
        ) < 1
        || typeof row
          .route_evidence_status
          !== 'string'
        || row.route_evidence_status
          !== 'current'
        || expiresAt === undefined
      ) {
        return null;
      }

      return {
        routeEvidenceId:
          row.route_evidence_id,

        routeEvidenceVersion:
          Number(
            row.route_evidence_version,
          ),

        routeEvidenceStatus:
          row.route_evidence_status,

        routeEvidenceExpiresAt:
          expiresAt,
      };
    },
  };
}