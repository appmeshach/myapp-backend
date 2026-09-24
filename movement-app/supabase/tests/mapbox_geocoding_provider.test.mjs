import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAPBOX_GEOCODING_NAMESPACE,
  MAPBOX_GEOCODING_PRODUCT,
  MAPBOX_GEOCODING_PROVIDER_VERSION,
  MAPBOX_GEOCODING_RESOLUTION_VERSION,
  MapboxGeocodingProviderError,
  createMapboxGeocodingProvider,
} from '../functions/_shared/mapbox-geocoding-provider.ts';

const TOKEN = 'test-mapbox-token';

function signal() {
  return new AbortController().signal;
}

function jsonResponse(
  body,
  init = {},
) {
  return new Response(
    JSON.stringify(body),
    {
      status: init.status ?? 200,
      headers: {
        'content-type':
          'application/json',
        ...(init.headers ?? {}),
      },
    },
  );
}

function feature({
  id = 'dXJuOm1ieHBsYzpUZXN0',
  featureType = 'place',
  name = 'Ologolo',
  placeFormatted =
    'Lekki, Lagos, Nigeria',
  fullAddress,
  countryCode = 'NG',
  includeCountryContext = true,
  neighborhoodName,
  localityName,
  placeName,
  longitude = 3.501,
  latitude = 6.437,
} = {}) {
  const properties = {
    mapbox_id: id,
    feature_type: featureType,
    name,
    place_formatted:
      placeFormatted,
  };

  const context = {};

  if (includeCountryContext) {
    context.country = {
      country_code:
        countryCode,
      name: 'Nigeria',
    };
  }

  if (neighborhoodName !== undefined) {
    context.neighborhood = {
      name: neighborhoodName,
    };
  }

  if (localityName !== undefined) {
    context.locality = {
      name: localityName,
    };
  }

  if (placeName !== undefined) {
    context.place = {
      name: placeName,
    };
  }

  if (Object.keys(context).length > 0) {
    properties.context = context;
  }

  if (fullAddress !== undefined) {
    properties.full_address =
      fullAddress;
  }

  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'Point',
      coordinates: [
        longitude,
        latitude,
      ],
    },
    properties,
  };
}

function collection(
  features = [feature()],
  attribution =
    'NOTICE: test attribution',
) {
  return {
    type: 'FeatureCollection',
    features,
    attribution,
  };
}

function captureProvider({
  response =
    jsonResponse(collection()),
  timeoutMs = 5000,
  now,
} = {}) {
  const calls = [];

  const provider =
    createMapboxGeocodingProvider(
      TOKEN,
      {
        timeoutMs,
        now,
        fetchImpl: async (input, init) => {
          calls.push({
            input,
            init,
          });

          return response;
        },
      },
    );

  return {
    provider,
    calls,
  };
}

function searchInput(
  overrides = {},
) {
  return {
    query: 'Ologolo',
    countryCode: 'NG',
    limit: 10,
    ...overrides,
  };
}

test(
  'provider identity and availability are fixed',
  () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
      );

    assert.equal(
      provider.name,
      MAPBOX_GEOCODING_NAMESPACE,
    );

    assert.equal(
      provider.providerNamespace,
      MAPBOX_GEOCODING_NAMESPACE,
    );

    assert.equal(
      provider.isAvailable(),
      true,
    );
  },
);

test(
  'missing or malformed token leaves provider unavailable',
  async () => {
    for (const token of [
      undefined,
      '',
      ' ',
      ' token',
      'token ',
      'token with space',
    ]) {
      let fetches = 0;

      const provider =
        createMapboxGeocodingProvider(
          token,
          {
            async fetchImpl() {
              fetches += 1;

              return jsonResponse(
                collection(),
              );
            },
          },
        );

      assert.equal(
        provider.isAvailable(),
        false,
      );

      await assert.rejects(
        provider.search(
          searchInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxGeocodingProviderError
          && error.code
            === 'provider_unavailable',
      );

      assert.equal(
        fetches,
        0,
      );
    }
  },
);

test(
  'search constructs exact permanent Nigeria Mapbox v6 request',
  async () => {
    const {
      provider,
      calls,
    } = captureProvider();

    await provider.search(
      searchInput({
        query:
          '  Ologolo Lekki  ',
      }),
      signal(),
    );

    assert.equal(
      calls.length,
      1,
    );

    const url =
      new URL(
        String(
          calls[0].input,
        ),
      );

    assert.equal(
      url.origin,
      'https://api.mapbox.com',
    );

    assert.equal(
      url.pathname,
      '/search/geocode/v6/forward',
    );

    assert.equal(
      url.searchParams.get('q'),
      'Ologolo Lekki',
    );

    assert.equal(
      url.searchParams.get(
        'access_token',
      ),
      TOKEN,
    );

    assert.equal(
      url.searchParams.get(
        'permanent',
      ),
      'true',
    );

    assert.equal(
      url.searchParams.get(
        'country',
      ),
      'ng',
    );

    assert.equal(
      url.searchParams.get(
        'types',
      ),
      'address,street,neighborhood,locality,place',
    );

    assert.equal(
      url.searchParams.get(
        'limit',
      ),
      '10',
    );

    assert.equal(
      url.searchParams.get(
        'autocomplete',
      ),
      'true',
    );

    assert.equal(
      url.searchParams.get(
        'language',
      ),
      'en',
    );

    assert.equal(
      url.searchParams.get(
        'format',
      ),
      'geojson',
    );

    assert.equal(
      url.searchParams.has(
        'proximity',
      ),
      false,
    );

    assert.equal(
      url.searchParams.has(
        'bbox',
      ),
      false,
    );

    assert.equal(
      url.searchParams.has(
        'routing',
      ),
      false,
    );

    assert.equal(
      calls[0].init.method,
      'GET',
    );

    assert.equal(
      calls[0].init.redirect,
      'error',
    );

    assert.equal(
      calls[0].init.cache,
      'no-store',
    );

    assert.equal(
      calls[0].init
        .headers.Authorization,
      undefined,
    );

    assert.equal(
      calls[0].init
        .headers.Cookie,
      undefined,
    );
  },
);

test(
  'resolution constructs exact permanent ID lookup request',
  async () => {
    const id =
      'dXJuOm1ieHBsYzpSZXNvbHZl';

    const calls = [];

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          now: () =>
            new Date(
              '2026-09-18T12:00:00.000Z',
            ),

          async fetchImpl(
            input,
            init,
          ) {
            calls.push({
              input,
              init,
            });

            return jsonResponse(
              collection([
                feature({ id }),
              ]),
            );
          },
        },
      );

    await provider.resolve(
      {
        providerNamespace:
          MAPBOX_GEOCODING_NAMESPACE,
        providerPlaceReference:
          id,
      },
      signal(),
    );

    assert.equal(
      calls.length,
      1,
    );

    const url =
      new URL(
        String(
          calls[0].input,
        ),
      );

    assert.equal(
      url.searchParams.get('q'),
      id,
    );

    assert.equal(
      url.searchParams.get(
        'limit',
      ),
      '1',
    );

    assert.equal(
      url.searchParams.get(
        'autocomplete',
      ),
      'false',
    );

    assert.equal(
      url.searchParams.get(
        'permanent',
      ),
      'true',
    );

    assert.equal(
      url.searchParams.get(
        'country',
      ),
      'ng',
    );

    assert.equal(
      url.searchParams.get(
        'types',
      ),
      'address,street,neighborhood,locality,place',
    );
  },
);

test(
  'invalid search inputs fail before fetch',
  async () => {
    const cases = [
      searchInput({
        query: '',
      }),
      searchInput({
        query: '  ',
      }),
      searchInput({
        query: 'ab',
      }),
      searchInput({
        query:
          'x'.repeat(201),
      }),
      searchInput({
        query: 'Olo;golo',
      }),
      searchInput({
        query:
          Array.from(
            { length: 21 },
            (_, index) =>
              `w${index}`,
          ).join(' '),
      }),
      searchInput({
        countryCode: 'US',
      }),
      searchInput({
        limit: 9,
      }),
    ];

    for (const input of cases) {
      let fetches = 0;

      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              fetches += 1;

              return jsonResponse(
                collection(),
              );
            },
          },
        );

      await assert.rejects(
        provider.search(
          input,
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxGeocodingProviderError
          && error.code
            === 'invalid_input',
      );

      assert.equal(
        fetches,
        0,
      );
    }
  },
);

test(
  'all five supported feature types normalize as selectable permanent suggestions',
  async () => {
    const types = [
      'address',
      'street',
      'neighborhood',
      'locality',
      'place',
    ];

    for (const type of types) {
      const id =
        `dXJuOnRlc3Q6${type}`;

      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                collection([
                  feature({
                    id,
                    featureType:
                      type,
                  }),
                ]),
              );
            },
          },
        );

      const result =
        await provider.search(
          searchInput(),
          signal(),
        );

      assert.equal(
        result.suggestions.length,
        1,
      );

      assert.deepEqual(
        result.suggestions[0],
        {
          declaredLabel:
            'Ologolo, Lekki, Lagos, Nigeria',

          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            id,

          persistentSelectionAllowed:
            true,
        },
      );
    }
  },
);

test(
  'full_address is preferred as canonical label',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  featureType:
                    'address',
                  fullAddress:
                    '12 Example Road, Lekki, Lagos, Nigeria',
                }),
              ]),
            );
          },
        },
      );

    const result =
      await provider.search(
        searchInput(),
        signal(),
      );

    assert.equal(
      result.suggestions[0]
        .declaredLabel,
      '12 Example Road, Lekki, Lagos, Nigeria',
    );
  },
);

test(
  'search returns no coordinates or raw provider payload',
  async () => {
    const {
      provider,
    } = captureProvider();

    const result =
      await provider.search(
        searchInput(),
        signal(),
      );

    const suggestion =
      result.suggestions[0];

    assert.equal(
      'latitude' in suggestion,
      false,
    );

    assert.equal(
      'longitude' in suggestion,
      false,
    );

    assert.equal(
      'geometry' in suggestion,
      false,
    );

    assert.equal(
      'properties' in suggestion,
      false,
    );
  },
);

test(
  'empty FeatureCollection is a valid empty search',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([]),
            );
          },
        },
      );

    const result =
      await provider.search(
        searchInput(),
        signal(),
      );

    assert.deepEqual(
      result.suggestions,
      [],
    );
  },
);

test(
  'provider attribution is normalized without invention',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection(
                [],
                '  Mapbox attribution  ',
              ),
            );
          },
        },
      );

    const result =
      await provider.search(
        searchInput(),
        signal(),
      );

    assert.deepEqual(
      result.attribution,
      [
        'Mapbox attribution',
      ],
    );
  },
);

test(
  'missing attribution does not invent attribution',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse({
              type:
                'FeatureCollection',
              features: [],
            });
          },
        },
      );

    const result =
      await provider.search(
        searchInput(),
        signal(),
      );

    assert.deepEqual(
      result.attribution,
      [],
    );
  },
);

test(
  'unsupported feature type fails closed',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  featureType:
                    'district',
                }),
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxGeocodingProviderError
        && error.code
          === 'invalid_response',
    );
  },
);

test(
  'missing mapbox_id fails closed',
  async () => {
    const broken =
      feature();

    delete broken.properties
      .mapbox_id;

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                broken,
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );
  },
);

test(
  'top-level id must agree with properties.mapbox_id',
  async () => {
    const broken =
      feature();

    broken.properties.mapbox_id =
      'different-id';

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                broken,
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );
  },
);

test(
  'duplicate Mapbox IDs fail closed',
  async () => {
    const duplicate =
      'duplicate-mapbox-id';

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  id: duplicate,
                }),
                feature({
                  id: duplicate,
                }),
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );
  },
);

test(
  'non-Nigeria search feature fails closed',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  countryCode:
                    'GH',
                }),
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );
  },
);

test(
  'search requires Nigeria context even when country context is absent',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  includeCountryContext:
                    false,
                }),
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxGeocodingProviderError
        && error.code
          === 'invalid_response',
    );
  },
);

test(
  'overlong canonical label fails closed',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  fullAddress:
                    'x'.repeat(301),
                }),
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );
  },
);

test(
  'more than ten returned search features fails closed',
  async () => {
    const features =
      Array.from(
        { length: 11 },
        (_, index) =>
          feature({
            id:
              `mapbox-id-${index}`,
          }),
      );

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection(features),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );
  },
);

test(
  'resolution returns exact durable provenance and coordinates',
  async () => {
    const id =
      'resolution-mapbox-id';

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          now: () =>
            new Date(
              '2026-09-18T12:34:56.000Z',
            ),

          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  id,
                  longitude: 3.501,
                  latitude: 6.437,
                }),
              ]),
            );
          },
        },
      );

    const result =
      await provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            id,
        },
        signal(),
      );

    assert.deepEqual(
      result,
      {
        providerNamespace:
          MAPBOX_GEOCODING_NAMESPACE,

        providerProduct:
          MAPBOX_GEOCODING_PRODUCT,

        providerVersion:
          MAPBOX_GEOCODING_PROVIDER_VERSION,

        providerPlaceReference:
          id,

        resolutionVersion:
          MAPBOX_GEOCODING_RESOLUTION_VERSION,

        discoveryAreaLabel:
          'Ologolo',

        latitude: 6.437,
        longitude: 3.501,

        resolvedAt:
          '2026-09-18T12:34:56.000Z',

        expiresAt: null,

        durableStorageAllowed:
          true,
      },
    );
  },
);

test(
  'address resolution exposes broad neighborhood and containing place only',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  id: 'address-id',
                  featureType: 'address',
                  name: '12 Example Road',
                  fullAddress:
                    '12 Example Road, Ologolo, Lekki, Lagos, Nigeria',
                  neighborhoodName:
                    'Ologolo',
                  placeName:
                    'Lagos',
                }),
              ]),
            );
          },
        },
      );

    const result =
      await provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            'address-id',
        },
        signal(),
      );

    assert.equal(
      result.discoveryAreaLabel,
      'Ologolo, Lagos',
    );
  },
);

test(
  'address resolution falls back from neighborhood to locality',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  id: 'locality-fallback-id',
                  featureType: 'address',
                  name: '12 Example Road',
                  localityName:
                    'Lekki',
                  placeName:
                    'Lagos',
                }),
              ]),
            );
          },
        },
      );

    const result =
      await provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            'locality-fallback-id',
        },
        signal(),
      );

    assert.equal(
      result.discoveryAreaLabel,
      'Lekki, Lagos',
    );
  },
);

test(
  'address resolution falls back to containing place',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  id: 'place-fallback-id',
                  featureType: 'street',
                  name: 'Example Street',
                  placeName:
                    'Lagos',
                }),
              ]),
            );
          },
        },
      );

    const result =
      await provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            'place-fallback-id',
        },
        signal(),
      );

    assert.equal(
      result.discoveryAreaLabel,
      'Lagos',
    );
  },
);

test(
  'neighborhood and locality resolutions include containing place when different',
  async () => {
    const cases = [
      {
        returned: feature({
          id: 'neighborhood-id',
          featureType:
            'neighborhood',
          name: 'Ologolo',
          placeName:
            'Lagos',
        }),
        expected:
          'Ologolo, Lagos',
      },
      {
        returned: feature({
          id: 'locality-id',
          featureType:
            'locality',
          name: 'Lekki',
          placeName:
            'Lagos',
        }),
        expected:
          'Lekki, Lagos',
      },
    ];

    for (const {
      returned,
      expected,
    } of cases) {
      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                collection([
                  returned,
                ]),
              );
            },
          },
        );

      const result =
        await provider.resolve(
          {
            providerNamespace:
              MAPBOX_GEOCODING_NAMESPACE,

            providerPlaceReference:
              returned.id,
          },
          signal(),
        );

      assert.equal(
        result.discoveryAreaLabel,
        expected,
      );
    }
  },
);

test(
  'street resolution recovers broad area from trusted-coordinate reverse fallback',
  async () => {
    const id =
      'street-no-inline-area';

    const returned =
      feature({
        id,
        featureType:
          'street',
        name:
          'Ologolo Road',
        longitude:
          3.501,
        latitude:
          6.437,
      });

    delete returned.properties
      .place_formatted;

    const calls = [];

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl(
            input,
            init,
          ) {
            calls.push({
              input,
              init,
            });

            const url =
              new URL(
                String(input),
              );

            if (
              url.pathname
                === '/search/geocode/v6/forward'
            ) {
              return jsonResponse(
                collection([
                  returned,
                ]),
              );
            }

            if (
              url.pathname
                === '/search/geocode/v6/reverse'
            ) {
              return jsonResponse(
                collection([
                  feature({
                    id:
                      'reverse-locality-id',
                    featureType:
                      'locality',
                    name:
                      'Lekki',
                    placeName:
                      'Lagos',
                    longitude:
                      3.501,
                    latitude:
                      6.437,
                  }),
                ]),
              );
            }

            throw new Error(
              'unexpected_provider_request',
            );
          },
        },
      );

    const result =
      await provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            id,
        },
        signal(),
      );

    assert.equal(
      result.discoveryAreaLabel,
      'Lekki, Lagos',
    );

    assert.equal(
      calls.length,
      2,
    );

    const reverseCall =
      calls[1];

    const reverseUrl =
      new URL(
        String(
          reverseCall.input,
        ),
      );

    assert.equal(
      reverseUrl.origin,
      'https://api.mapbox.com',
    );

    assert.equal(
      reverseUrl.pathname,
      '/search/geocode/v6/reverse',
    );

    assert.equal(
      reverseUrl.searchParams.get(
        'longitude',
      ),
      '3.501',
    );

    assert.equal(
      reverseUrl.searchParams.get(
        'latitude',
      ),
      '6.437',
    );

    assert.equal(
      reverseUrl.searchParams.get(
        'access_token',
      ),
      TOKEN,
    );

    assert.equal(
      reverseUrl.searchParams.get(
        'permanent',
      ),
      'true',
    );

    assert.equal(
      reverseUrl.searchParams.get(
        'country',
      ),
      'ng',
    );

    assert.equal(
      reverseUrl.searchParams.get(
        'types',
      ),
      'locality,place',
    );

    assert.equal(
      reverseUrl.searchParams.get(
        'language',
      ),
      'en',
    );

    assert.equal(
      reverseUrl.searchParams.has(
        'limit',
      ),
      false,
    );

    assert.equal(
      reverseUrl.searchParams.has(
        'q',
      ),
      false,
    );

    assert.equal(
      reverseUrl.searchParams.has(
        'autocomplete',
      ),
      false,
    );

    assert.equal(
      reverseCall.init?.method,
      'GET',
    );

    assert.equal(
      reverseCall.init?.redirect,
      'error',
    );

    assert.equal(
      reverseCall.init?.cache,
      'no-store',
    );

    assert.equal(
      reverseCall.init?.headers
        ?.Authorization,
      undefined,
    );

    assert.equal(
      reverseCall.init?.headers
        ?.Cookie,
      undefined,
    );
  },
);

test(
  'address and street resolution fail closed without broad area context',
  async () => {
    const cases = [
      feature({
        id: 'address-no-area',
        featureType:
          'address',
        name: '12 Example Road',
      }),
      feature({
        id: 'street-no-area',
        featureType:
          'street',
        name: 'Example Street',
      }),
    ];

    for (const returned of cases) {
      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                collection([
                  returned,
                ]),
              );
            },
          },
        );

      await assert.rejects(
        provider.resolve(
          {
            providerNamespace:
              MAPBOX_GEOCODING_NAMESPACE,

            providerPlaceReference:
              returned.id,
          },
          signal(),
        ),
      );
    }
  },
);

test(
  'resolution rejects malformed broad area context',
  async () => {
    const returned =
      feature({
        id: 'malformed-area-id',
        featureType:
          'address',
        neighborhoodName:
          'Ologolo',
        placeName:
          'Lagos',
      });

    returned.properties.context
      .neighborhood = {
        name: '   ',
      };

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                returned,
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            'malformed-area-id',
        },
        signal(),
      ),
    );
  },
);

test(
  'resolution rejects wrong namespace before fetch',
  async () => {
    let fetches = 0;

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            fetches += 1;

            return jsonResponse(
              collection(),
            );
          },
        },
      );

    await assert.rejects(
      provider.resolve(
        {
          providerNamespace:
            'other-provider',

          providerPlaceReference:
            'opaque-id',
        },
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxGeocodingProviderError
        && error.code
          === 'invalid_input',
    );

    assert.equal(
      fetches,
      0,
    );
  },
);

test(
  'resolution rejects invalid opaque reference before fetch',
  async () => {
    for (const reference of [
      '',
      ' ',
      ' ref',
      'ref ',
      'bad;ref',
      'x'.repeat(501),
    ]) {
      let fetches = 0;

      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              fetches += 1;

              return jsonResponse(
                collection(),
              );
            },
          },
        );

      await assert.rejects(
        provider.resolve(
          {
            providerNamespace:
              MAPBOX_GEOCODING_NAMESPACE,

            providerPlaceReference:
              reference,
          },
          signal(),
        ),
      );

      assert.equal(
        fetches,
        0,
      );
    }
  },
);

test(
  'resolution requires exact returned Mapbox ID',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  id:
                    'different-id',
                }),
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            'expected-id',
        },
        signal(),
      ),
    );
  },
);

test(
  'resolution rejects empty or multiple results',
  async () => {
    for (const features of [
      [],
      [
        feature({
          id: 'expected-id',
        }),
        feature({
          id: 'second-id',
        }),
      ],
    ]) {
      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                collection(features),
              );
            },
          },
        );

      await assert.rejects(
        provider.resolve(
          {
            providerNamespace:
              MAPBOX_GEOCODING_NAMESPACE,

            providerPlaceReference:
              'expected-id',
          },
          signal(),
        ),
      );
    }
  },
);

test(
  'resolution accepts exact trusted Mapbox ID when country context is absent',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({
                  id: 'expected-id',
                  includeCountryContext:
                    false,
                }),
              ]),
            );
          },
        },
      );

    const result =
      await provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,
          providerPlaceReference:
            'expected-id',
        },
        signal(),
      );

    assert.equal(
      result.providerPlaceReference,
      'expected-id',
    );

    assert.equal(
      result.providerNamespace,
      MAPBOX_GEOCODING_NAMESPACE,
    );

    assert.equal(
      result.durableStorageAllowed,
      true,
    );
  },
);

test(
  'resolution rejects unsupported type and non-Nigeria feature',
  async () => {
    const cases = [
      feature({
        id: 'expected-id',
        featureType: 'district',
      }),
      feature({
        id: 'expected-id',
        countryCode: 'GH',
      }),
    ];

    for (const returned of cases) {
      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                collection([
                  returned,
                ]),
              );
            },
          },
        );

      await assert.rejects(
        provider.resolve(
          {
            providerNamespace:
              MAPBOX_GEOCODING_NAMESPACE,

            providerPlaceReference:
              'expected-id',
          },
          signal(),
        ),
      );
    }
  },
);

test(
  'resolution rejects malformed and out-of-range coordinates',
  async () => {
    const cases = [
      [NaN, 6.4],
      [Infinity, 6.4],
      [3.4, NaN],
      [3.4, Infinity],
      [-181, 6.4],
      [181, 6.4],
      [3.4, -91],
      [3.4, 91],
    ];

    for (
      const [
        longitude,
        latitude,
      ] of cases
    ) {
      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                collection([
                  feature({
                    id:
                      'expected-id',
                    longitude,
                    latitude,
                  }),
                ]),
              );
            },
          },
        );

      await assert.rejects(
        provider.resolve(
          {
            providerNamespace:
              MAPBOX_GEOCODING_NAMESPACE,

            providerPlaceReference:
              'expected-id',
          },
          signal(),
        ),
      );
    }
  },
);

test(
  'resolution rejects malformed geometry',
  async () => {
    const broken =
      feature({
        id: 'expected-id',
      });

    broken.geometry = {
      type: 'LineString',
      coordinates: [
        [3.4, 6.4],
        [3.5, 6.5],
      ],
    };

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              collection([
                broken,
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            'expected-id',
        },
        signal(),
      ),
    );
  },
);

test(
  'redirect and non-success statuses fail generically',
  async () => {
    for (const status of [
      302,
      401,
      403,
      429,
      500,
    ]) {
      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              return new Response(
                'private provider error',
                {
                  status,
                  headers: {
                    'content-type':
                      'text/plain',
                  },
                },
              );
            },
          },
        );

      await assert.rejects(
        provider.search(
          searchInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxGeocodingProviderError
          && error.code
            === 'provider_unavailable'
          && !error.message.includes(
            TOKEN,
          )
          && !error.message.includes(
            'private provider error',
          ),
      );
    }
  },
);

test(
  'Mapbox vendor GeoJSON media type is accepted',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return new Response(
              JSON.stringify(
                collection(),
              ),
              {
                status: 200,
                headers: {
                  'content-type':
                    'application/vnd.geo+json; charset=utf-8',
                },
              },
            );
          },
        },
      );

    const result =
      await provider.search(
        searchInput(),
        signal(),
      );

    assert.equal(
      result.suggestions.length,
      1,
    );
  },
);


test(
  'invalid media type fails closed',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return new Response(
              JSON.stringify(
                collection(),
              ),
              {
                status: 200,
                headers: {
                  'content-type':
                    'text/plain',
                },
              },
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxGeocodingProviderError
        && error.code
          === 'invalid_response',
    );
  },
);

test(
  'malformed JSON fails closed',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return new Response(
              '{broken',
              {
                status: 200,
                headers: {
                  'content-type':
                    'application/json',
                },
              },
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );
  },
);

test(
  'invalid FeatureCollection shape fails closed',
  async () => {
    const invalid = [
      {},
      {
        type: 'Feature',
        features: [],
      },
      {
        type:
          'FeatureCollection',
        features: {},
      },
    ];

    for (const body of invalid) {
      const provider =
        createMapboxGeocodingProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                body,
              );
            },
          },
        );

      await assert.rejects(
        provider.search(
          searchInput(),
          signal(),
        ),
      );
    }
  },
);

test(
  'declared oversized Content-Length fails before parsing',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return new Response(
              '{}',
              {
                status: 200,
                headers: {
                  'content-type':
                    'application/json',

                  'content-length':
                    String(
                      256 * 1024
                      + 1,
                    ),
                },
              },
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxGeocodingProviderError
        && error.code
          === 'invalid_response',
    );
  },
);

test(
  'actual response body over 256 KiB fails closed',
  async () => {
    const huge =
      JSON.stringify({
        type:
          'FeatureCollection',
        features: [],
        padding:
          'x'.repeat(
            256 * 1024,
          ),
      });

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            return new Response(
              huge,
              {
                status: 200,
                headers: {
                  'content-type':
                    'application/json',
                },
              },
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );
  },
);

test(
  'already-aborted caller performs zero fetches',
  async () => {
    let fetches = 0;

    const controller =
      new AbortController();

    controller.abort();

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            fetches += 1;

            return jsonResponse(
              collection(),
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        controller.signal,
      ),
    );

    assert.equal(
      fetches,
      0,
    );
  },
);

test(
  'caller abort reaches in-flight provider request',
  async () => {
    let seenSignal;

    const controller =
      new AbortController();

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl(
            _input,
            init,
          ) {
            seenSignal =
              init.signal;

            return await new Promise(
              (
                _resolve,
                reject,
              ) => {
                init.signal
                  .addEventListener(
                    'abort',
                    () => {
                      reject(
                        init.signal
                          .reason,
                      );
                    },
                    {
                      once: true,
                    },
                  );
              },
            );
          },
        },
      );

    const pending =
      provider.search(
        searchInput(),
        controller.signal,
      );

    controller.abort(
      new DOMException(
        'caller aborted',
        'AbortError',
      ),
    );

    await assert.rejects(
      pending,
    );

    assert.equal(
      seenSignal.aborted,
      true,
    );
  },
);

test(
  'provider timeout aborts an in-flight fetch',
  async () => {
    let seenSignal;

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          timeoutMs: 10,

          async fetchImpl(
            _input,
            init,
          ) {
            seenSignal =
              init.signal;

            return await new Promise(
              (
                _resolve,
                reject,
              ) => {
                init.signal
                  .addEventListener(
                    'abort',
                    () => {
                      reject(
                        init.signal
                          .reason,
                      );
                    },
                    {
                      once: true,
                    },
                  );
              },
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
    );

    assert.equal(
      seenSignal.aborted,
      true,
    );
  },
);

test(
  'fetch transport failure is sanitized and token never leaks',
  async () => {
    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            throw new Error(
              `network failed ${TOKEN}`,
            );
          },
        },
      );

    await assert.rejects(
      provider.search(
        searchInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxGeocodingProviderError
        && error.code
          === 'provider_unavailable'
        && !error.message.includes(
          TOKEN,
        ),
    );
  },
);

test(
  'invalid server clock fails closed during resolution',
  async () => {
    const id =
      'expected-id';

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          now: () =>
            new Date(NaN),

          async fetchImpl() {
            return jsonResponse(
              collection([
                feature({ id }),
              ]),
            );
          },
        },
      );

    await assert.rejects(
      provider.resolve(
        {
          providerNamespace:
            MAPBOX_GEOCODING_NAMESPACE,

          providerPlaceReference:
            id,
        },
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxGeocodingProviderError
        && error.code
          === 'provider_unavailable',
    );
  },
);

test(
  'each search operation performs at most one provider fetch',
  async () => {
    const {
      provider,
      calls,
    } = captureProvider();

    await provider.search(
      searchInput(),
      signal(),
    );

    assert.equal(
      calls.length,
      1,
    );
  },
);

test(
  'resolution with inline broad area performs one provider fetch',
  async () => {
    const id =
      'expected-id';

    let calls = 0;

    const provider =
      createMapboxGeocodingProvider(
        TOKEN,
        {
          async fetchImpl() {
            calls += 1;

            return jsonResponse(
              collection([
                feature({ id }),
              ]),
            );
          },
        },
      );

    await provider.resolve(
      {
        providerNamespace:
          MAPBOX_GEOCODING_NAMESPACE,

        providerPlaceReference:
          id,
      },
      signal(),
    );

    assert.equal(
      calls,
      1,
    );
  },
);
