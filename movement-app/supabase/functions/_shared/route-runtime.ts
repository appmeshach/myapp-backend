import { readBounded } from './face-orchestration.ts';

import type {
    RecordedRouteEvidence,
    RouteBackend,
    RouteGenerationContext,
    RouteProviderQuotaResult,
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

const RPC_ROUTE_QUOTA =
  'consume_route_provider_quota_for_server';

const RPC_RECORD_ROUTE =
  'record_offering_route_evidence_for_server';

const ALLOWED_RPCS = new Set([
  RPC_ROUTE_CONTEXT,
  RPC_ROUTE_QUOTA,
  RPC_RECORD_ROUTE,
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