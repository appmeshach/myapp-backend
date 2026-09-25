import { supabase } from '../lib/supabase';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type CreateOfferingMovementIntentInput = {
  requestId: string;
  originLocationReferenceId: string;
  destinationLocationReferenceId: string;
  earliestDepartureAt: string;
  latestDepartureAt?: string | null;
};

export type CreatedOfferingMovementIntent = {
  offeringMovementIntentId: string;
};

export type OpenOfferingMovementAvailabilityInput = {
  requestId: string;
  offeringMovementIntentId: string;
  vehicleId: string;
  totalPlaces: number;
};

export type OpenedOfferingMovementAvailability = {
  availabilityId: string;
};

export type DiscoverableOfferingMovement = {
  availabilityId: string;
  originArea: string;
  destinationArea: string;
  earliestDepartureAt: string;
  latestDepartureAt: string | null;
  remainingPlaces: number;
  make: string;
  model: string | null;
  year: number | null;
  color: string;
};

export type OfferingRouteReady = {
  state: 'ready';
  routeEvidenceId: string;
  routeEvidenceVersion: number;
  routeEvidenceStatus: 'current';
  routeEvidenceExpiresAt: string | null;
};

export type OfferingRouteRetry = {
  state:
    | 'route_generation_in_progress'
    | 'route_rate_limited';
  retryAfterSeconds: number;
};

export type GenerateOfferingRouteResult =
  | OfferingRouteReady
  | OfferingRouteRetry;

export type RouteMatchReady = {
  state: 'ready';
  routeMatchEvidenceId: string;
  routeMatchEvidenceVersion: number;
  routeMatchEvidenceStatus: 'current';
  routeMatchEvidenceExpiresAt: string | null;
  straightLineDistanceFromRouteMeters: number;
};

export type RouteMatchSelector =
  | {
      offeringMovementIntentId: string;
    }
  | {
      availabilityId: string;
    };

function isValidUuid(
  value: unknown,
): value is string {
  return (
    typeof value === 'string'
    && UUID.test(value)
  );
}

function isValidIsoDate(
  value: string,
): boolean {
  return Number.isFinite(
    Date.parse(value),
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual =
    Object.keys(value).sort();

  const wanted =
    [...expected].sort();

  return (
    actual.length === wanted.length
    && actual.every(
      (key, index) =>
        key === wanted[index],
    )
  );
}

export async function createOfferingMovementIntent(
  input: CreateOfferingMovementIntentInput,
): Promise<CreatedOfferingMovementIntent> {
  if (
    !input
    || !isValidUuid(input.requestId)
    || !isValidUuid(
      input.originLocationReferenceId,
    )
    || !isValidUuid(
      input.destinationLocationReferenceId,
    )
    || input.originLocationReferenceId
      === input.destinationLocationReferenceId
    || typeof input.earliestDepartureAt
      !== 'string'
    || !isValidIsoDate(
      input.earliestDepartureAt,
    )
    || (
      input.latestDepartureAt != null
      && (
        typeof input.latestDepartureAt
          !== 'string'
        || !isValidIsoDate(
          input.latestDepartureAt,
        )
      )
    )
  ) {
    throw new Error(
      'invalid_offering_movement_intent',
    );
  }

  if (
    input.latestDepartureAt != null
    && Date.parse(
      input.latestDepartureAt,
    )
      < Date.parse(
        input.earliestDepartureAt,
      )
  ) {
    throw new Error(
      'invalid_offering_movement_intent',
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'create_offering_movement_intent',
    {
      p_request_id:
        input.requestId,

      p_origin_location_reference_id:
        input.originLocationReferenceId,

      p_destination_location_reference_id:
        input.destinationLocationReferenceId,

      p_earliest_departure_at:
        input.earliestDepartureAt,

      p_latest_departure_at:
        input.latestDepartureAt ?? null,
    },
  );

  if (error) {
    throw new Error(
      'offering_movement_intent_unavailable',
    );
  }

  const row =
    (
      data as
        | Array<{
            offering_movement_intent_id?:
              unknown;
          }>
        | null
    )?.[0];

  if (
    !row
    || !isValidUuid(
      row.offering_movement_intent_id,
    )
  ) {
    throw new Error(
      'offering_movement_intent_unavailable',
    );
  }

  return {
    offeringMovementIntentId:
      row.offering_movement_intent_id,
  };
}

export async function openOfferingMovementAvailability(
  input: OpenOfferingMovementAvailabilityInput,
): Promise<OpenedOfferingMovementAvailability> {
  if (
    !input
    || !isValidUuid(input.requestId)
    || !isValidUuid(input.offeringMovementIntentId)
    || !isValidUuid(input.vehicleId)
    || !Number.isInteger(input.totalPlaces)
    || input.totalPlaces < 1
  ) {
    throw new Error('invalid_offering_movement_availability');
  }

  const { data, error } = await supabase.rpc(
    'open_offering_movement_availability',
    {
      p_request_id: input.requestId,
      p_offering_movement_intent_id: input.offeringMovementIntentId,
      p_vehicle_id: input.vehicleId,
      p_total_places: input.totalPlaces,
    },
  );

  if (error) {
    throw new Error('offering_movement_availability_unavailable');
  }

  const row: unknown = Array.isArray(data) && data.length === 1
    ? data[0]
    : null;

  if (!isRecord(row) || !isValidUuid(row.availability_id)) {
    throw new Error('offering_movement_availability_unavailable');
  }

  return { availabilityId: row.availability_id };
}

export async function discoverOfferingMovementAvailability(
  limit: number = 20,
): Promise<DiscoverableOfferingMovement[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('invalid_offering_movement_discovery');
  }

  try {
    const { data, error } = await supabase.rpc(
      'discover_offering_movement_availability',
      { p_limit: limit },
    );

    if (error || !Array.isArray(data)) {
      throw new Error('offering_movement_discovery_unavailable');
    }

    return data.map((row: unknown) => {
      if (
        !isRecord(row)
        || !hasExactKeys(row, [
          'availability_id', 'origin_area', 'destination_area',
          'earliest_departure_at', 'latest_departure_at',
          'remaining_places', 'make', 'model', 'year', 'color',
        ])
        || !isValidUuid(row.availability_id)
        || typeof row.origin_area !== 'string' || !row.origin_area.trim()
        || typeof row.destination_area !== 'string' || !row.destination_area.trim()
        || typeof row.earliest_departure_at !== 'string'
        || !isValidIsoDate(row.earliest_departure_at)
        || (row.latest_departure_at !== null && (
          typeof row.latest_departure_at !== 'string'
          || !isValidIsoDate(row.latest_departure_at)
        ))
        || typeof row.remaining_places !== 'number'
        || !Number.isInteger(row.remaining_places) || row.remaining_places < 1
        || typeof row.make !== 'string' || !row.make.trim()
        || (row.model !== null && typeof row.model !== 'string')
        || (row.year !== null && (
          typeof row.year !== 'number' || !Number.isInteger(row.year)
        ))
        || typeof row.color !== 'string' || !row.color.trim()
      ) {
        throw new Error('offering_movement_discovery_unavailable');
      }

      return {
        availabilityId: row.availability_id,
        originArea: row.origin_area,
        destinationArea: row.destination_area,
        earliestDepartureAt: row.earliest_departure_at,
        latestDepartureAt: row.latest_departure_at,
        remainingPlaces: row.remaining_places,
        make: row.make,
        model: row.model,
        year: row.year,
        color: row.color,
      };
    });
  } catch {
    throw new Error('offering_movement_discovery_unavailable');
  }
}

export async function generateOfferingRoute(
  offeringMovementIntentId: string,
  signal?: AbortSignal,
): Promise<GenerateOfferingRouteResult> {
  if (
    !isValidUuid(
      offeringMovementIntentId,
    )
  ) {
    throw new Error(
      'invalid_offering_movement_intent',
    );
  }

  const abort =
    new AbortController();

  const cancel =
    () => abort.abort();

  signal?.addEventListener(
    'abort',
    cancel,
    { once: true },
  );

  if (signal?.aborted) {
    cancel();
  }

  const timer =
    setTimeout(
      cancel,
      30_000,
    );

  try {
    abort.signal.throwIfAborted();

    const {
      data,
      error,
    } =
      await supabase.auth.getSession();

    abort.signal.throwIfAborted();

    if (
      error
      || !data.session?.access_token
    ) {
      throw new Error(
        'authentication_required',
      );
    }

    const url =
      process.env
        .EXPO_PUBLIC_SUPABASE_URL;

    const key =
      process.env
        .EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new Error(
        'route_generation_unavailable',
      );
    }

    const response =
      await fetch(
        `${url.replace(/\/$/, '')}/functions/v1/generate-offering-route`,
        {
          method: 'POST',

          headers: {
            Authorization:
              `Bearer ${data.session.access_token}`,

            apikey: key,

            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            offeringMovementIntentId,
          }),

          signal:
            abort.signal,

          redirect:
            'error',

          cache:
            'no-store',
        },
      );

    abort.signal.throwIfAborted();

    if (response.status === 401) {
      throw new Error(
        'authentication_required',
      );
    }

    if (response.redirected) {
      throw new Error(
        'route_generation_unavailable',
      );
    }

    let body: unknown;

    try {
      body =
        await response.json();
    } catch {
      throw new Error(
        'route_generation_unavailable',
      );
    }

    abort.signal.throwIfAborted();

    if (!isRecord(body)) {
      throw new Error(
        'route_generation_unavailable',
      );
    }

    if (
      response.status === 200
      && hasExactKeys(
        body,
        [
          'state',
          'routeEvidenceId',
          'routeEvidenceVersion',
          'routeEvidenceStatus',
          'routeEvidenceExpiresAt',
        ],
      )
      && body.state === 'ready'
      && isValidUuid(
        body.routeEvidenceId,
      )
            && typeof body.routeEvidenceVersion
        === 'number'
      && Number.isInteger(
        body.routeEvidenceVersion,
      )
      && body.routeEvidenceVersion >= 1
      && body.routeEvidenceStatus
        === 'current'
      && (
        body.routeEvidenceExpiresAt
          === null
        || (
          typeof body
            .routeEvidenceExpiresAt
            === 'string'
          && isValidIsoDate(
            body.routeEvidenceExpiresAt,
          )
        )
      )
    ) {
      return {
        state: 'ready',

        routeEvidenceId:
          body.routeEvidenceId,

                routeEvidenceVersion:
          body.routeEvidenceVersion,

        routeEvidenceStatus:
          'current',

        routeEvidenceExpiresAt:
          body.routeEvidenceExpiresAt,
      };
    }

    if (
      (
        response.status === 409
        && body.state
          === 'route_generation_in_progress'
      )
      || (
        response.status === 429
        && body.state
          === 'route_rate_limited'
      )
    ) {
      if (
        !hasExactKeys(
          body,
          [
            'state',
            'retryAfterSeconds',
          ],
        )
                || typeof body.retryAfterSeconds
          !== 'number'
        || !Number.isInteger(
          body.retryAfterSeconds,
        )
        || body.retryAfterSeconds < 1
      ) {
        throw new Error(
          'route_generation_unavailable',
        );
      }

      return {
        state:
          body.state as
            | 'route_generation_in_progress'
            | 'route_rate_limited',

                retryAfterSeconds:
          body.retryAfterSeconds,
      };
    }

    throw new Error(
      'route_generation_unavailable',
    );
  } catch (error) {
    if (
      error instanceof Error
      && [
        'authentication_required',
        'route_generation_unavailable',
      ].includes(error.message)
    ) {
      throw error;
    }

    if (
      abort.signal.aborted
      || error instanceof TypeError
    ) {
      throw new Error(
        'network_unavailable',
      );
    }

    throw new Error(
      'route_generation_unavailable',
    );
  } finally {
    clearTimeout(timer);

    signal?.removeEventListener(
      'abort',
      cancel,
    );
  }
}

export async function calculateRouteMatch(
  movementNeedId: string,
  selector: RouteMatchSelector,
  signal?: AbortSignal,
): Promise<RouteMatchReady> {
  if (!isValidUuid(movementNeedId)) {
    throw new Error(
      'invalid_route_match',
    );
  }

  const intentRequest =
    'offeringMovementIntentId' in selector;

  const availabilityRequest =
    'availabilityId' in selector;

  if (
    intentRequest === availabilityRequest
  ) {
    throw new Error(
      'invalid_route_match',
    );
  }

  if (
    intentRequest
    && !isValidUuid(
      selector.offeringMovementIntentId,
    )
  ) {
    throw new Error(
      'invalid_route_match',
    );
  }

  if (
    availabilityRequest
    && !isValidUuid(
      selector.availabilityId,
    )
  ) {
    throw new Error(
      'invalid_route_match',
    );
  }

  const abort =
    new AbortController();

  const cancel =
    () => abort.abort();

  signal?.addEventListener(
    'abort',
    cancel,
    { once: true },
  );

  if (signal?.aborted) {
    cancel();
  }

  const timer =
    setTimeout(
      cancel,
      30_000,
    );

  try {
    abort.signal.throwIfAborted();

    const {
      data,
      error,
    } =
      await supabase.auth.getSession();

    abort.signal.throwIfAborted();

    if (
      error
      || !data.session?.access_token
    ) {
      throw new Error(
        'authentication_required',
      );
    }

    const url =
      process.env
        .EXPO_PUBLIC_SUPABASE_URL;

    const key =
      process.env
        .EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new Error(
        'route_match_unavailable',
      );
    }

    const response =
      await fetch(
        `${url.replace(/\/$/, '')}/functions/v1/calculate-route-match`,
        {
          method: 'POST',

          headers: {
            Authorization:
              `Bearer ${data.session.access_token}`,

            apikey: key,

            'Content-Type':
              'application/json',
          },

          body: JSON.stringify(
            'offeringMovementIntentId' in selector
              ? {
                  movementNeedId,
                  offeringMovementIntentId:
                    selector.offeringMovementIntentId,
                }
              : {
                  movementNeedId,
                  availabilityId:
                    selector.availabilityId,
                },
          ),

          signal:
            abort.signal,

          redirect:
            'error',

          cache:
            'no-store',
        },
      );

    abort.signal.throwIfAborted();

    if (response.status === 401) {
      throw new Error(
        'authentication_required',
      );
    }

    if (response.redirected) {
      throw new Error(
        'route_match_unavailable',
      );
    }

    let body: unknown;

    try {
      body =
        await response.json();
    } catch {
      throw new Error(
        'route_match_unavailable',
      );
    }

    abort.signal.throwIfAborted();

    if (!isRecord(body)) {
      throw new Error(
        'route_match_unavailable',
      );
    }

    if (
      response.status === 200
      && hasExactKeys(
        body,
        [
          'state',
          'routeMatchEvidenceId',
          'routeMatchEvidenceVersion',
          'routeMatchEvidenceStatus',
          'routeMatchEvidenceExpiresAt',
          'straightLineDistanceFromRouteMeters',
        ],
      )
      && body.state === 'ready'
      && isValidUuid(
        body.routeMatchEvidenceId,
      )
      && typeof body.routeMatchEvidenceVersion
        === 'number'
      && Number.isInteger(
        body.routeMatchEvidenceVersion,
      )
      && body.routeMatchEvidenceVersion >= 1
      && body.routeMatchEvidenceStatus
        === 'current'
      && (
        body.routeMatchEvidenceExpiresAt
          === null
        || (
          typeof body
            .routeMatchEvidenceExpiresAt
            === 'string'
          && isValidIsoDate(
            body.routeMatchEvidenceExpiresAt,
          )
        )
      )
      && typeof body
        .straightLineDistanceFromRouteMeters
        === 'number'
      && Number.isInteger(
        body
          .straightLineDistanceFromRouteMeters,
      )
      && body
        .straightLineDistanceFromRouteMeters
        >= 0
    ) {
      return {
        state: 'ready',

        routeMatchEvidenceId:
          body.routeMatchEvidenceId,

        routeMatchEvidenceVersion:
          body.routeMatchEvidenceVersion,

        routeMatchEvidenceStatus:
          'current',

        routeMatchEvidenceExpiresAt:
          body.routeMatchEvidenceExpiresAt,

        straightLineDistanceFromRouteMeters:
          body
            .straightLineDistanceFromRouteMeters,
      };
    }

    throw new Error(
      'route_match_unavailable',
    );
  } catch (error) {
    if (
      error instanceof Error
      && [
        'authentication_required',
        'invalid_route_match',
        'route_match_unavailable',
      ].includes(error.message)
    ) {
      throw error;
    }

    if (
      abort.signal.aborted
      || error instanceof TypeError
    ) {
      throw new Error(
        'network_unavailable',
      );
    }

    throw new Error(
      'route_match_unavailable',
    );
  } finally {
    clearTimeout(timer);

    signal?.removeEventListener(
      'abort',
      cancel,
    );
  }
}
