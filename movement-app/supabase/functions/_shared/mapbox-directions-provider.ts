export const MAPBOX_DIRECTIONS_NAMESPACE =
  'mapbox-directions-v5';

export const MAPBOX_DIRECTIONS_PRODUCT =
  'mapbox-directions';

export const MAPBOX_DIRECTIONS_PROVIDER_VERSION =
  'v5-driving-geojson-full-v1';

const MAPBOX_ORIGIN =
  'https://api.mapbox.com';

const MAPBOX_DIRECTIONS_PATH_PREFIX =
  '/directions/v5/mapbox/driving/';

const MAX_PROVIDER_RESPONSE_BYTES =
  256 * 1024;

const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

const MAX_ACCESS_TOKEN_LENGTH = 4096;

const MAX_PROVIDER_ROUTE_REFERENCE_LENGTH = 500;

type FetchLike =
  (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;

export interface TrustedRouteCoordinate {
  latitude: number;
  longitude: number;
}

export interface MapboxDirectionsInput {
  origin: TrustedRouteCoordinate;
  destination: TrustedRouteCoordinate;
}

export interface MapboxDirectionsResult {
  providerNamespace: string;
  providerProduct: string;
  providerVersion: string;
  providerRouteReference: string;

  routeShape: {
    type: 'LineString';
    coordinates: number[][];
  };

  routeDistanceMeters: number;
  routeDurationSeconds: number;

  generatedAt: string;
  expiresAt: null;
}

export interface MapboxDirectionsProvider {
  name: string;

  providerNamespace: string;

  isAvailable(): boolean;

  route(
    input: MapboxDirectionsInput,
    signal: AbortSignal,
  ): Promise<MapboxDirectionsResult>;
}

export interface MapboxDirectionsProviderOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

export class MapboxDirectionsProviderError
  extends Error {
  readonly code:
    | 'provider_unavailable'
    | 'invalid_input'
    | 'invalid_response'
    | 'route_unavailable';

  constructor(
    code:
      | 'provider_unavailable'
      | 'invalid_input'
      | 'invalid_response'
      | 'route_unavailable',
  ) {
    super(
      code === 'invalid_input'
        ? 'Invalid route provider input'
        : code === 'invalid_response'
          ? 'Invalid route provider response'
          : code === 'route_unavailable'
            ? 'Route unavailable'
            : 'Route provider unavailable',
    );

    this.name =
      'MapboxDirectionsProviderError';

    this.code = code;
  }
}

function codePointLength(
  value: string,
): number {
  return Array.from(value).length;
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
  );
}

function nonblankString(
  value: unknown,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed
    ? trimmed
    : null;
}

function validAccessToken(
  value: string | undefined,
): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && codePointLength(value)
      <= MAX_ACCESS_TOKEN_LENGTH
    && !/\s/u.test(value)
  );
}

function validCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
  );
}

function validateEndpoint(
  value: unknown,
): TrustedRouteCoordinate {
  if (
    !isPlainObject(value)
    || Object.keys(value).length !== 2
    || !validCoordinate(
      value.latitude,
      -90,
      90,
    )
    || !validCoordinate(
      value.longitude,
      -180,
      180,
    )
  ) {
    throw new MapboxDirectionsProviderError(
      'invalid_input',
    );
  }

  return {
    latitude: value.latitude,
    longitude: value.longitude,
  };
}

function validateInput(
  input: MapboxDirectionsInput,
): {
  origin: TrustedRouteCoordinate;
  destination: TrustedRouteCoordinate;
} {
  if (
    !isPlainObject(input)
    || Object.keys(input).length !== 2
  ) {
    throw new MapboxDirectionsProviderError(
      'invalid_input',
    );
  }

  const origin =
    validateEndpoint(input.origin);

  const destination =
    validateEndpoint(input.destination);

  if (
    origin.latitude === destination.latitude
    && origin.longitude === destination.longitude
  ) {
    throw new MapboxDirectionsProviderError(
      'invalid_input',
    );
  }

  return {
    origin,
    destination,
  };
}

function combineWithTimeout(
  parent: AbortSignal,
  timeoutMs: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller =
    new AbortController();

  const abortFromParent = () => {
    controller.abort(
      parent.reason
      ?? new DOMException(
        'Operation aborted',
        'AbortError',
      ),
    );
  };

  if (parent.aborted) {
    abortFromParent();
  } else {
    parent.addEventListener(
      'abort',
      abortFromParent,
      { once: true },
    );
  }

  const timeout =
    setTimeout(
      () => {
        controller.abort(
          new DOMException(
            'Route provider timeout',
            'TimeoutError',
          ),
        );
      },
      timeoutMs,
    );

  return {
    signal: controller.signal,

    cleanup() {
      clearTimeout(timeout);

      parent.removeEventListener(
        'abort',
        abortFromParent,
      );
    },
  };
}

async function readBoundedBody(
  response: Response,
): Promise<string> {
  const rawLength =
    response.headers.get(
      'content-length',
    );

  if (rawLength !== null) {
    const declared =
      Number(rawLength);

    if (
      !Number.isFinite(declared)
      || declared < 0
      || declared
        > MAX_PROVIDER_RESPONSE_BYTES
    ) {
      throw new MapboxDirectionsProviderError(
        'invalid_response',
      );
    }
  }

  if (!response.body) {
    return '';
  }

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let total = 0;
  let text = '';

  while (true) {
    const {
      done,
      value,
    } = await reader.read();

    if (done) {
      break;
    }

    if (!(value instanceof Uint8Array)) {
      throw new MapboxDirectionsProviderError(
        'invalid_response',
      );
    }

    total += value.byteLength;

    if (
      total
        > MAX_PROVIDER_RESPONSE_BYTES
    ) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation failure.
      }

      throw new MapboxDirectionsProviderError(
        'invalid_response',
      );
    }

    text += decoder.decode(
      value,
      { stream: true },
    );
  }

  text += decoder.decode();

  return text;
}

async function fetchProviderJson(
  url: URL,
  accessToken: string,
  fetchImpl: FetchLike,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  const bounded =
    combineWithTimeout(
      parentSignal,
      timeoutMs,
    );

  try {
    bounded.signal.throwIfAborted();

    let response: Response;

    try {
      response =
        await fetchImpl(
          url,
          {
            method: 'GET',
            redirect: 'error',
            cache: 'no-store',
            signal: bounded.signal,
            headers: {
              Accept:
                'application/json',
            },
          },
        );
    } catch {
      if (bounded.signal.aborted) {
        const reason =
          bounded.signal.reason;

        if (reason instanceof Error) {
          throw reason;
        }

        throw new DOMException(
          'Operation aborted',
          'AbortError',
        );
      }

      throw new MapboxDirectionsProviderError(
        'provider_unavailable',
      );
    }

    bounded.signal.throwIfAborted();

    if (
      response.redirected
      || response.status < 200
      || response.status >= 300
    ) {
      throw new MapboxDirectionsProviderError(
        'provider_unavailable',
      );
    }

    const contentType =
      response.headers
        .get('content-type')
        ?.toLowerCase()
      ?? '';

    if (
      !contentType.includes(
        'application/json',
      )
      && !contentType.includes(
        'application/geo+json',
      )
      && !contentType.includes(
        'application/vnd.geo+json',
      )
    ) {
      throw new MapboxDirectionsProviderError(
        'invalid_response',
      );
    }

    const text =
      await readBoundedBody(response);

    bounded.signal.throwIfAborted();

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MapboxDirectionsProviderError(
        'invalid_response',
      );
    }

    return parsed;
  } finally {
    bounded.cleanup();

    // Never include the access token in returned
    // values, logs, provider errors or diagnostics.
    void accessToken;
  }
}

function coordinateText(
  value: number,
): string {
  if (!Number.isFinite(value)) {
    throw new MapboxDirectionsProviderError(
      'invalid_input',
    );
  }

  return String(value);
}

function buildDirectionsUrl(
  input: {
    origin: TrustedRouteCoordinate;
    destination: TrustedRouteCoordinate;
  },
  accessToken: string,
): URL {
  const coordinates =
    [
      `${
        coordinateText(
          input.origin.longitude,
        )
      },${
        coordinateText(
          input.origin.latitude,
        )
      }`,

      `${
        coordinateText(
          input.destination.longitude,
        )
      },${
        coordinateText(
          input.destination.latitude,
        )
      }`,
    ].join(';');

  const url =
    new URL(
      `${MAPBOX_DIRECTIONS_PATH_PREFIX}${coordinates}`,
      MAPBOX_ORIGIN,
    );

  url.searchParams.set(
    'access_token',
    accessToken,
  );

  url.searchParams.set(
    'alternatives',
    'false',
  );

  url.searchParams.set(
    'geometries',
    'geojson',
  );

  url.searchParams.set(
    'overview',
    'full',
  );

  url.searchParams.set(
    'steps',
    'false',
  );

  return url;
}

function routeReference(
  responseUuid: unknown,
): string {
  const uuid =
    nonblankString(responseUuid);

  if (uuid === null) {
    throw new MapboxDirectionsProviderError(
      'invalid_response',
    );
  }

  const reference =
    `${uuid}:0`;

  if (
    codePointLength(reference)
      > MAX_PROVIDER_ROUTE_REFERENCE_LENGTH
  ) {
    throw new MapboxDirectionsProviderError(
      'invalid_response',
    );
  }

  return reference;
}

function normalizedGeometry(
  value: unknown,
): {
  type: 'LineString';
  coordinates: number[][];
} {
  if (
    !isPlainObject(value)
    || value.type !== 'LineString'
    || !Array.isArray(value.coordinates)
    || value.coordinates.length < 2
  ) {
    throw new MapboxDirectionsProviderError(
      'invalid_response',
    );
  }

  const coordinates =
    value.coordinates.map(
      point => {
        if (
          !Array.isArray(point)
          || point.length !== 2
        ) {
          throw new MapboxDirectionsProviderError(
            'invalid_response',
          );
        }

        const [
          longitude,
          latitude,
        ] = point;

        if (
          !validCoordinate(
            longitude,
            -180,
            180,
          )
          || !validCoordinate(
            latitude,
            -90,
            90,
          )
        ) {
          throw new MapboxDirectionsProviderError(
            'invalid_response',
          );
        }

        return [
          longitude,
          latitude,
        ];
      },
    );

  return {
    type: 'LineString',
    coordinates,
  };
}

function positiveRoundedInteger(
  value: unknown,
): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value <= 0
    || value > Number.MAX_SAFE_INTEGER
  ) {
    throw new MapboxDirectionsProviderError(
      'invalid_response',
    );
  }

  const rounded =
    Math.round(value);

  if (
    !Number.isSafeInteger(rounded)
    || rounded <= 0
  ) {
    throw new MapboxDirectionsProviderError(
      'invalid_response',
    );
  }

  return rounded;
}

function normalizeResponse(
  value: unknown,
  now: () => Date,
): MapboxDirectionsResult {
  if (!isPlainObject(value)) {
    throw new MapboxDirectionsProviderError(
      'invalid_response',
    );
  }

  if (value.code !== 'Ok') {
    if (
      value.code === 'NoRoute'
      || value.code === 'NoSegment'
    ) {
      throw new MapboxDirectionsProviderError(
        'route_unavailable',
      );
    }

    throw new MapboxDirectionsProviderError(
      'invalid_response',
    );
  }

  if (
    !Array.isArray(value.routes)
    || value.routes.length !== 1
    || !isPlainObject(value.routes[0])
  ) {
    throw new MapboxDirectionsProviderError(
      'invalid_response',
    );
  }

  const route =
    value.routes[0];

  const generatedAt =
    now();

  if (
    !(generatedAt instanceof Date)
    || !Number.isFinite(
      generatedAt.getTime(),
    )
  ) {
    throw new MapboxDirectionsProviderError(
      'provider_unavailable',
    );
  }

  return {
    providerNamespace:
      MAPBOX_DIRECTIONS_NAMESPACE,

    providerProduct:
      MAPBOX_DIRECTIONS_PRODUCT,

    providerVersion:
      MAPBOX_DIRECTIONS_PROVIDER_VERSION,

    providerRouteReference:
      routeReference(value.uuid),

    routeShape:
      normalizedGeometry(
        route.geometry,
      ),

    routeDistanceMeters:
      positiveRoundedInteger(
        route.distance,
      ),

    routeDurationSeconds:
      positiveRoundedInteger(
        route.duration,
      ),

    generatedAt:
      generatedAt.toISOString(),

    expiresAt: null,
  };
}

export function createMapboxDirectionsProvider(
  accessToken: string | undefined,
  options:
    MapboxDirectionsProviderOptions = {},
): MapboxDirectionsProvider {
  const fetchImpl =
    options.fetchImpl
    ?? fetch.bind(globalThis);

  const timeoutMs =
    options.timeoutMs
    ?? DEFAULT_PROVIDER_TIMEOUT_MS;

  const now =
    options.now
    ?? (() => new Date());

  const available =
    validAccessToken(accessToken)
    && Number.isInteger(timeoutMs)
    && timeoutMs > 0;

  const requireAvailable = (): string => {
    if (
      !available
      || !validAccessToken(accessToken)
    ) {
      throw new MapboxDirectionsProviderError(
        'provider_unavailable',
      );
    }

    return accessToken;
  };

  return {
    name:
      MAPBOX_DIRECTIONS_NAMESPACE,

    providerNamespace:
      MAPBOX_DIRECTIONS_NAMESPACE,

    isAvailable() {
      return available;
    },

    async route(
      input: MapboxDirectionsInput,
      signal: AbortSignal,
    ): Promise<MapboxDirectionsResult> {
      const token =
        requireAvailable();

      signal.throwIfAborted();

      const trusted =
        validateInput(input);

      const url =
        buildDirectionsUrl(
          trusted,
          token,
        );

      const raw =
        await fetchProviderJson(
          url,
          token,
          fetchImpl,
          signal,
          timeoutMs,
        );

      return normalizeResponse(
        raw,
        now,
      );
    },
  };
}