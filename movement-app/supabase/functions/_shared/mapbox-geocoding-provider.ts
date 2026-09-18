import {
  MAX_LOCATION_LABEL_LENGTH,
  MAX_LOCATION_SUGGESTIONS,
  MAX_PROVIDER_REFERENCE_LENGTH,
  NIGERIA_COUNTRY_CODE,
} from './location-contracts.ts';

import type {
  DurableLocationResolution,
  DurableLocationResolver,
  LocationSearchInput,
  LocationSearchProvider,
  LocationSearchResult,
  ProviderSearchSuggestion,
} from './location-contracts.ts';

export const MAPBOX_GEOCODING_NAMESPACE =
  'mapbox-geocoding-v6';

export const MAPBOX_GEOCODING_PRODUCT =
  'mapbox-geocoding-v6';

export const MAPBOX_GEOCODING_PROVIDER_VERSION =
  'v6';

export const MAPBOX_GEOCODING_RESOLUTION_VERSION =
  'mapbox-geocoding-v6-normalization-v1';

const MAPBOX_ORIGIN =
  'https://api.mapbox.com';

const MAPBOX_FORWARD_PATH =
  '/search/geocode/v6/forward';

const MAPBOX_COUNTRY =
  'ng';

const MAPBOX_TYPES =
  'address,street,neighborhood,locality,place';

const MAPBOX_LANGUAGE =
  'en';

const MAPBOX_FORMAT =
  'geojson';

const MAPBOX_SEARCH_LIMIT =
  MAX_LOCATION_SUGGESTIONS;

const MAPBOX_RESOLUTION_LIMIT = 1;

const MIN_MAPBOX_QUERY_CODE_POINTS = 3;

const MAX_MAPBOX_QUERY_CODE_POINTS = 200;

const MAX_MAPBOX_QUERY_TOKENS = 20;

const MAX_PROVIDER_RESPONSE_BYTES =
  256 * 1024;

const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

const MAX_ACCESS_TOKEN_LENGTH = 4096;

const SUPPORTED_FEATURE_TYPES =
  new Set([
    'address',
    'street',
    'neighborhood',
    'locality',
    'place',
  ]);

type FetchLike =
  (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;

export interface MapboxGeocodingProviderOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

export class MapboxGeocodingProviderError
  extends Error {
  readonly code:
    | 'provider_unavailable'
    | 'invalid_input'
    | 'invalid_response';

  constructor(
    code:
      | 'provider_unavailable'
      | 'invalid_input'
      | 'invalid_response',
  ) {
    super(
      code === 'invalid_input'
        ? 'Invalid location provider input'
        : code === 'invalid_response'
          ? 'Invalid location provider response'
          : 'Location provider unavailable',
    );

    this.name =
      'MapboxGeocodingProviderError';

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

  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function validAccessToken(
  value: string | undefined,
): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || codePointLength(value)
      > MAX_ACCESS_TOKEN_LENGTH
    || /\s/u.test(value)
  ) {
    return false;
  }

  return true;
}

function validOpaqueReference(
  value: unknown,
): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && codePointLength(value)
      <= MAX_PROVIDER_REFERENCE_LENGTH
    && !value.includes(';')
  );
}

function validateSearchInput(
  input: LocationSearchInput,
): string {
  if (
    !isPlainObject(input)
    || typeof input.query !== 'string'
    || input.countryCode
      !== NIGERIA_COUNTRY_CODE
    || input.limit
      !== MAPBOX_SEARCH_LIMIT
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_input',
    );
  }

  const query = input.query.trim();

  const length =
    codePointLength(query);

  if (
    length
      < MIN_MAPBOX_QUERY_CODE_POINTS
    || length
      > MAX_MAPBOX_QUERY_CODE_POINTS
    || query.includes(';')
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_input',
    );
  }

  const tokens =
    query.split(/\s+/u);

  if (
    tokens.length === 0
    || tokens.length
      > MAX_MAPBOX_QUERY_TOKENS
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_input',
    );
  }

  return query;
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
            'Location provider timeout',
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
      throw new MapboxGeocodingProviderError(
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
      throw new MapboxGeocodingProviderError(
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

      throw new MapboxGeocodingProviderError(
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

      throw new MapboxGeocodingProviderError(
        'provider_unavailable',
      );
    }

    bounded.signal.throwIfAborted();

    if (
      response.redirected
      || response.status < 200
      || response.status >= 300
    ) {
      throw new MapboxGeocodingProviderError(
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
    ) {
      throw new MapboxGeocodingProviderError(
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
      throw new MapboxGeocodingProviderError(
        'invalid_response',
      );
    }

    return parsed;
  } finally {
    bounded.cleanup();

    // Keep the parameter intentionally consumed
    // only by URL construction; never include it
    // in errors or returned values.
    void accessToken;
  }
}

function buildForwardUrl(
  query: string,
  accessToken: string,
  options: {
    limit: number;
    autocomplete: boolean;
  },
): URL {
  const url =
    new URL(
      MAPBOX_FORWARD_PATH,
      MAPBOX_ORIGIN,
    );

  url.searchParams.set(
    'q',
    query,
  );

  url.searchParams.set(
    'access_token',
    accessToken,
  );

  url.searchParams.set(
    'permanent',
    'true',
  );

  url.searchParams.set(
    'country',
    MAPBOX_COUNTRY,
  );

  url.searchParams.set(
    'types',
    MAPBOX_TYPES,
  );

  url.searchParams.set(
    'limit',
    String(options.limit),
  );

  url.searchParams.set(
    'autocomplete',
    options.autocomplete
      ? 'true'
      : 'false',
  );

  url.searchParams.set(
    'language',
    MAPBOX_LANGUAGE,
  );

  url.searchParams.set(
    'format',
    MAPBOX_FORMAT,
  );

  return url;
}

function parseFeatureCollection(
  value: unknown,
): {
  features: unknown[];
  attribution: string[];
} {
  if (
    !isPlainObject(value)
    || value.type !== 'FeatureCollection'
    || !Array.isArray(value.features)
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  const attribution: string[] = [];

  if (
    typeof value.attribution
      === 'string'
  ) {
    const normalized =
      value.attribution.trim();

    if (normalized) {
      attribution.push(normalized);
    }
  } else if (
    value.attribution !== undefined
    && value.attribution !== null
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  return {
    features: value.features,
    attribution,
  };
}

function featureProperties(
  feature: unknown,
): Record<string, unknown> {
  if (
    !isPlainObject(feature)
    || feature.type !== 'Feature'
    || !isPlainObject(
      feature.properties,
    )
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  return feature.properties;
}

function featureIdentity(
  feature: unknown,
): {
  id: string;
  properties: Record<string, unknown>;
  featureType: string;
} {
  if (!isPlainObject(feature)) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  const properties =
    featureProperties(feature);

  const id =
    nonblankString(feature.id);

  const mapboxId =
    nonblankString(
      properties.mapbox_id,
    );

  if (
    id === null
    || mapboxId === null
    || id !== mapboxId
    || !validOpaqueReference(
      mapboxId,
    )
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  const featureType =
    nonblankString(
      properties.feature_type,
    );

  if (
    featureType === null
    || !SUPPORTED_FEATURE_TYPES.has(
      featureType,
    )
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  return {
    id: mapboxId,
    properties,
    featureType,
  };
}

function requireNigeria(
  properties: Record<string, unknown>,
): void {
  const context =
    properties.context;

  if (!isPlainObject(context)) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  const country =
    context.country;

  if (!isPlainObject(country)) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  const countryCode =
    nonblankString(
      country.country_code,
    );

  if (
    countryCode === null
    || countryCode.toUpperCase()
      !== NIGERIA_COUNTRY_CODE
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }
}

function canonicalLabel(
  properties: Record<string, unknown>,
): string {
  const fullAddress =
    nonblankString(
      properties.full_address,
    );

  if (fullAddress !== null) {
    if (
      codePointLength(fullAddress)
        > MAX_LOCATION_LABEL_LENGTH
    ) {
      throw new MapboxGeocodingProviderError(
        'invalid_response',
      );
    }

    return fullAddress;
  }

  const name =
    nonblankString(
      properties.name_preferred,
    )
    ?? nonblankString(
      properties.name,
    );

  if (name === null) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  const placeFormatted =
    nonblankString(
      properties.place_formatted,
    );

  const label =
    placeFormatted === null
      ? name
      : `${name}, ${placeFormatted}`;

  if (
    codePointLength(label)
      > MAX_LOCATION_LABEL_LENGTH
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  return label;
}

function searchSuggestion(
  feature: unknown,
): ProviderSearchSuggestion {
  const identity =
    featureIdentity(feature);

  requireNigeria(
    identity.properties,
  );

  return {
    declaredLabel:
      canonicalLabel(
        identity.properties,
      ),

    providerNamespace:
      MAPBOX_GEOCODING_NAMESPACE,

    providerPlaceReference:
      identity.id,

    persistentSelectionAllowed:
      true,
  };
}

function resolutionCoordinates(
  feature: unknown,
): {
  longitude: number;
  latitude: number;
} {
  if (
    !isPlainObject(feature)
    || !isPlainObject(
      feature.geometry,
    )
    || feature.geometry.type
      !== 'Point'
    || !Array.isArray(
      feature.geometry.coordinates,
    )
    || feature.geometry.coordinates.length
      !== 2
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  const [
    longitude,
    latitude,
  ] = feature.geometry.coordinates;

  if (
    typeof longitude !== 'number'
    || typeof latitude !== 'number'
    || !Number.isFinite(longitude)
    || !Number.isFinite(latitude)
    || longitude < -180
    || longitude > 180
    || latitude < -90
    || latitude > 90
  ) {
    throw new MapboxGeocodingProviderError(
      'invalid_response',
    );
  }

  return {
    longitude,
    latitude,
  };
}

export function createMapboxGeocodingProvider(
  accessToken: string | undefined,
  options:
    MapboxGeocodingProviderOptions = {},
): LocationSearchProvider
  & DurableLocationResolver {
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
      throw new MapboxGeocodingProviderError(
        'provider_unavailable',
      );
    }

    return accessToken;
  };

  return {
    name:
      MAPBOX_GEOCODING_NAMESPACE,

    providerNamespace:
      MAPBOX_GEOCODING_NAMESPACE,

    isAvailable() {
      return available;
    },

    async search(
      input: LocationSearchInput,
      signal: AbortSignal,
    ): Promise<LocationSearchResult> {
      const token =
        requireAvailable();

      signal.throwIfAborted();

      const query =
        validateSearchInput(input);

      const url =
        buildForwardUrl(
          query,
          token,
          {
            limit:
              MAPBOX_SEARCH_LIMIT,
            autocomplete: true,
          },
        );

      const raw =
        await fetchProviderJson(
          url,
          token,
          fetchImpl,
          signal,
          timeoutMs,
        );

      const collection =
        parseFeatureCollection(raw);

      if (
        collection.features.length
          > MAPBOX_SEARCH_LIMIT
      ) {
        throw new MapboxGeocodingProviderError(
          'invalid_response',
        );
      }

      const seen =
        new Set<string>();

      const suggestions =
        collection.features.map(
          feature => {
            const suggestion =
              searchSuggestion(feature);

            if (
              seen.has(
                suggestion
                  .providerPlaceReference,
              )
            ) {
              throw new MapboxGeocodingProviderError(
                'invalid_response',
              );
            }

            seen.add(
              suggestion
                .providerPlaceReference,
            );

            return suggestion;
          },
        );

      return {
        suggestions,
        attribution:
          collection.attribution,
      };
    },

    async resolve(
      input: {
        providerNamespace: string;
        providerPlaceReference: string;
      },
      signal: AbortSignal,
    ): Promise<DurableLocationResolution> {
      const token =
        requireAvailable();

      signal.throwIfAborted();

      if (
        !isPlainObject(input)
        || input.providerNamespace
          !== MAPBOX_GEOCODING_NAMESPACE
        || !validOpaqueReference(
          input.providerPlaceReference,
        )
      ) {
        throw new MapboxGeocodingProviderError(
          'invalid_input',
        );
      }

      const reference =
        input.providerPlaceReference;

      const url =
        buildForwardUrl(
          reference,
          token,
          {
            limit:
              MAPBOX_RESOLUTION_LIMIT,
            autocomplete: false,
          },
        );

      const raw =
        await fetchProviderJson(
          url,
          token,
          fetchImpl,
          signal,
          timeoutMs,
        );

      const collection =
        parseFeatureCollection(raw);

      if (
        collection.features.length
          !== 1
      ) {
        throw new MapboxGeocodingProviderError(
          'invalid_response',
        );
      }

      const feature =
        collection.features[0];

      const identity =
        featureIdentity(feature);

      if (identity.id !== reference) {
        throw new MapboxGeocodingProviderError(
          'invalid_response',
        );
      }

      requireNigeria(
        identity.properties,
      );

      const coordinates =
        resolutionCoordinates(
          feature,
        );

      const resolvedAt =
        now();

      if (
        !(resolvedAt instanceof Date)
        || !Number.isFinite(
          resolvedAt.getTime(),
        )
      ) {
        throw new MapboxGeocodingProviderError(
          'provider_unavailable',
        );
      }

      return {
        providerNamespace:
          MAPBOX_GEOCODING_NAMESPACE,

        providerProduct:
          MAPBOX_GEOCODING_PRODUCT,

        providerVersion:
          MAPBOX_GEOCODING_PROVIDER_VERSION,

        providerPlaceReference:
          reference,

        resolutionVersion:
          MAPBOX_GEOCODING_RESOLUTION_VERSION,

        latitude:
          coordinates.latitude,

        longitude:
          coordinates.longitude,

        resolvedAt:
          resolvedAt.toISOString(),

        expiresAt: null,

        durableStorageAllowed: true,
      };
    },
  };
}
