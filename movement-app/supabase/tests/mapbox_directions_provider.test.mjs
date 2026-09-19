import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    MAPBOX_DIRECTIONS_NAMESPACE,
    MAPBOX_DIRECTIONS_PRODUCT,
    MAPBOX_DIRECTIONS_PROVIDER_VERSION,
    MapboxDirectionsProviderError,
    createMapboxDirectionsProvider,
} from '../functions/_shared/mapbox-directions-provider.ts';

const TOKEN = 'test-mapbox-token';

function signal() {
  return new AbortController().signal;
}

function routeBody({
  code = 'Ok',
  uuid = 'test-route-response-uuid',
  routes,
} = {}) {
  return {
    code,
    uuid,
    routes:
      routes ?? [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [3.501, 6.437],
              [3.401, 6.428],
            ],
          },
          distance: 12500.4,
          duration: 1800.4,
        },
      ],
  };
}

function jsonResponse(
  body = routeBody(),
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

function routeInput(
  overrides = {},
) {
  return {
    origin: {
      latitude: 6.437,
      longitude: 3.501,
    },
    destination: {
      latitude: 6.428,
      longitude: 3.401,
    },
    ...overrides,
  };
}

function captureProvider({
  response = jsonResponse(),
  timeoutMs = 5000,
  now,
} = {}) {
  const calls = [];

  const provider =
    createMapboxDirectionsProvider(
      TOKEN,
      {
        timeoutMs,
        now,
        fetchImpl: async (
          input,
          init,
        ) => {
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

test(
  'provider identity and availability are fixed',
  () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
      );

    assert.equal(
      provider.name,
      MAPBOX_DIRECTIONS_NAMESPACE,
    );

    assert.equal(
      provider.providerNamespace,
      MAPBOX_DIRECTIONS_NAMESPACE,
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
    const tokens = [
      undefined,
      '',
      ' ',
      ' token',
      'token ',
      'token with space',
      'x'.repeat(4097),
    ];

    for (const token of tokens) {
      let fetches = 0;

      const provider =
        createMapboxDirectionsProvider(
          token,
          {
            async fetchImpl() {
              fetches += 1;

              return jsonResponse();
            },
          },
        );

      assert.equal(
        provider.isAvailable(),
        false,
      );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
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
  'route constructs exact Mapbox driving request',
  async () => {
    const {
      provider,
      calls,
    } = captureProvider();

    await provider.route(
      routeInput(),
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
      '/directions/v5/mapbox/driving/3.501,6.437;3.401,6.428',
    );

    assert.equal(
      url.searchParams.get(
        'access_token',
      ),
      TOKEN,
    );

    assert.equal(
      url.searchParams.get(
        'alternatives',
      ),
      'false',
    );

    assert.equal(
      url.searchParams.get(
        'geometries',
      ),
      'geojson',
    );

    assert.equal(
      url.searchParams.get(
        'overview',
      ),
      'full',
    );

    assert.equal(
      url.searchParams.get(
        'steps',
      ),
      'false',
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
  'valid route performs exactly one provider fetch',
  async () => {
    const {
      provider,
      calls,
    } = captureProvider();

    await provider.route(
      routeInput(),
      signal(),
    );

    assert.equal(
      calls.length,
      1,
    );
  },
);

test(
  'successful response normalizes exact route contract',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          now: () =>
            new Date(
              '2026-09-18T12:34:56.000Z',
            ),

          async fetchImpl() {
            return jsonResponse();
          },
        },
      );

    const result =
      await provider.route(
        routeInput(),
        signal(),
      );

    assert.deepEqual(
      result,
      {
        providerNamespace:
          MAPBOX_DIRECTIONS_NAMESPACE,

        providerProduct:
          MAPBOX_DIRECTIONS_PRODUCT,

        providerVersion:
          MAPBOX_DIRECTIONS_PROVIDER_VERSION,

        providerRouteReference:
          'test-route-response-uuid:0',

        routeShape: {
          type: 'LineString',
          coordinates: [
            [3.501, 6.437],
            [3.401, 6.428],
          ],
        },

        routeDistanceMeters:
          12500,

        routeDurationSeconds:
          1800,

        generatedAt:
          '2026-09-18T12:34:56.000Z',

        expiresAt: null,
      },
    );
  },
);

test(
  'invalid top-level route inputs fail before fetch',
  async () => {
    const cases = [
      null,
      undefined,
      [],
      'route',
      123,
      {},
      {
        origin: {
          latitude: 6.437,
          longitude: 3.501,
        },
      },
      {
        destination: {
          latitude: 6.428,
          longitude: 3.401,
        },
      },
      {
        ...routeInput(),
        extra: true,
      },
    ];

    for (const input of cases) {
      let fetches = 0;

      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              fetches += 1;

              return jsonResponse();
            },
          },
        );

      await assert.rejects(
        provider.route(
          input,
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
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
  'invalid route endpoint shapes fail before fetch',
  async () => {
    const invalidOrigins = [
      null,
      undefined,
      [],
      'origin',
      123,
      {},
      {
        latitude: 6.437,
      },
      {
        longitude: 3.501,
      },
      {
        latitude: 6.437,
        longitude: 3.501,
        extra: true,
      },
    ];

    for (const origin of invalidOrigins) {
      let fetches = 0;

      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              fetches += 1;

              return jsonResponse();
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput({
            origin,
          }),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
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
  'invalid coordinate values fail before fetch',
  async () => {
    const invalidOrigins = [
      {
        latitude: NaN,
        longitude: 3.501,
      },
      {
        latitude: Infinity,
        longitude: 3.501,
      },
      {
        latitude: -Infinity,
        longitude: 3.501,
      },
      {
        latitude: -91,
        longitude: 3.501,
      },
      {
        latitude: 91,
        longitude: 3.501,
      },
      {
        latitude: 6.437,
        longitude: NaN,
      },
      {
        latitude: 6.437,
        longitude: Infinity,
      },
      {
        latitude: 6.437,
        longitude: -Infinity,
      },
      {
        latitude: 6.437,
        longitude: -181,
      },
      {
        latitude: 6.437,
        longitude: 181,
      },
      {
        latitude: '6.437',
        longitude: 3.501,
      },
      {
        latitude: 6.437,
        longitude: '3.501',
      },
    ];

    for (const origin of invalidOrigins) {
      let fetches = 0;

      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              fetches += 1;

              return jsonResponse();
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput({
            origin,
          }),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
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
  'invalid destination coordinates fail before fetch',
  async () => {
    const invalidDestinations = [
      {
        latitude: NaN,
        longitude: 3.401,
      },
      {
        latitude: Infinity,
        longitude: 3.401,
      },
      {
        latitude: -91,
        longitude: 3.401,
      },
      {
        latitude: 91,
        longitude: 3.401,
      },
      {
        latitude: 6.428,
        longitude: NaN,
      },
      {
        latitude: 6.428,
        longitude: Infinity,
      },
      {
        latitude: 6.428,
        longitude: -181,
      },
      {
        latitude: 6.428,
        longitude: 181,
      },
    ];

    for (
      const destination
      of invalidDestinations
    ) {
      let fetches = 0;

      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              fetches += 1;

              return jsonResponse();
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput({
            destination,
          }),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
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
  'identical origin and destination fail before fetch',
  async () => {
    let fetches = 0;

    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            fetches += 1;

            return jsonResponse();
          },
        },
      );

    await assert.rejects(
      provider.route(
        {
          origin: {
            latitude: 6.437,
            longitude: 3.501,
          },
          destination: {
            latitude: 6.437,
            longitude: 3.501,
          },
        },
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxDirectionsProviderError
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
  'boundary coordinate values are accepted',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse({
              code: 'Ok',
              uuid:
                'boundary-route-response',
              routes: [
                {
                  geometry: {
                    type: 'LineString',
                    coordinates: [
                      [-180, -90],
                      [180, 90],
                    ],
                  },
                  distance: 1,
                  duration: 1,
                },
              ],
            });
          },
        },
      );

    const result =
      await provider.route(
        {
          origin: {
            latitude: -90,
            longitude: -180,
          },
          destination: {
            latitude: 90,
            longitude: 180,
          },
        },
        signal(),
      );

    assert.deepEqual(
      result.routeShape.coordinates,
      [
        [-180, -90],
        [180, 90],
      ],
    );
  },
);

test(
  'NoRoute and NoSegment normalize as route unavailable',
  async () => {
    for (const code of [
      'NoRoute',
      'NoSegment',
    ]) {
      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse({
                code,
                uuid:
                  'route-unavailable-response',
                routes: [],
              });
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'route_unavailable',
      );
    }
  },
);

test(
  'unknown or missing provider code fails closed',
  async () => {
    const cases = [
      {
        code: 'Unknown',
        uuid: 'test-uuid',
        routes: [],
      },
      {
        uuid: 'test-uuid',
        routes: [],
      },
      {},
    ];

    for (const body of cases) {
      const provider =
        createMapboxDirectionsProvider(
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
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);

test(
  'route collection must contain exactly one object route',
  async () => {
    const validRoute = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [3.501, 6.437],
          [3.401, 6.428],
        ],
      },
      distance: 1000,
      duration: 300,
    };

    const cases = [
      {
        code: 'Ok',
        uuid: 'test-uuid',
      },
      {
        code: 'Ok',
        uuid: 'test-uuid',
        routes: null,
      },
      {
        code: 'Ok',
        uuid: 'test-uuid',
        routes: {},
      },
      {
        code: 'Ok',
        uuid: 'test-uuid',
        routes: [],
      },
      {
        code: 'Ok',
        uuid: 'test-uuid',
        routes: [
          validRoute,
          validRoute,
        ],
      },
      {
        code: 'Ok',
        uuid: 'test-uuid',
        routes: [
          null,
        ],
      },
      {
        code: 'Ok',
        uuid: 'test-uuid',
        routes: [
          [],
        ],
      },
      {
        code: 'Ok',
        uuid: 'test-uuid',
        routes: [
          'route',
        ],
      },
    ];

    for (const body of cases) {
      const provider =
        createMapboxDirectionsProvider(
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
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);

test(
  'provider route reference requires a usable response uuid',
  async () => {
    const invalidBodies = [
      {
        code: 'Ok',
        routes: routeBody().routes,
      },
      {
        code: 'Ok',
        uuid: null,
        routes: routeBody().routes,
      },
      {
        code: 'Ok',
        uuid: '',
        routes: routeBody().routes,
      },
      {
        code: 'Ok',
        uuid: '   ',
        routes: routeBody().routes,
      },
      {
        code: 'Ok',
        uuid: 123,
        routes: routeBody().routes,
      },
      {
        code: 'Ok',
        uuid: {},
        routes: routeBody().routes,
      },
      {
        code: 'Ok',
        uuid: [],
        routes: routeBody().routes,
      },
    ];

    for (const body of invalidBodies) {
      const provider =
        createMapboxDirectionsProvider(
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
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);


test(
  'provider route reference is response uuid plus route index zero',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              routeBody({
                uuid:
                  'response-identity-123',
              }),
            );
          },
        },
      );

    const result =
      await provider.route(
        routeInput(),
        signal(),
      );

    assert.equal(
      result.providerRouteReference,
      'response-identity-123:0',
    );
  },
);

test(
  'overlong provider route reference fails closed',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              routeBody({
                uuid:
                  'x'.repeat(499),
              }),
            );
          },
        },
      );

    await assert.rejects(
      provider.route(
        routeInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxDirectionsProviderError
        && error.code
          === 'invalid_response',
    );
  },
);

test(
  'distance and duration use positive rounded safe integers',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              routeBody({
                routes: [
                  {
                    geometry: {
                      type: 'LineString',
                      coordinates: [
                        [3.501, 6.437],
                        [3.401, 6.428],
                      ],
                    },
                    distance: 1000.6,
                    duration: 300.6,
                  },
                ],
              }),
            );
          },
        },
      );

    const result =
      await provider.route(
        routeInput(),
        signal(),
      );

    assert.equal(
      result.routeDistanceMeters,
      1001,
    );

    assert.equal(
      result.routeDurationSeconds,
      301,
    );
  },
);

test(
  'invalid distance values fail closed',
  async () => {
    const values = [
      0,
      -1,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      0.4,
      '1000',
      null,
    ];

    for (const distance of values) {
      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                routeBody({
                  routes: [
                    {
                      geometry: {
                        type: 'LineString',
                        coordinates: [
                          [3.501, 6.437],
                          [3.401, 6.428],
                        ],
                      },
                      distance,
                      duration: 300,
                    },
                  ],
                }),
              );
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);

test(
  'invalid duration values fail closed',
  async () => {
    const values = [
      0,
      -1,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      0.4,
      '300',
      null,
    ];

    for (const duration of values) {
      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                routeBody({
                  routes: [
                    {
                      geometry: {
                        type: 'LineString',
                        coordinates: [
                          [3.501, 6.437],
                          [3.401, 6.428],
                        ],
                      },
                      distance: 1000,
                      duration,
                    },
                  ],
                }),
              );
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);

test(
  'route geometry must be a valid GeoJSON LineString',
  async () => {
    const invalidGeometries = [
      undefined,
      null,
      'geometry',
      [],
      {},
      {
        type: 'Point',
        coordinates: [
          3.501,
          6.437,
        ],
      },
      {
        type: 'MultiLineString',
        coordinates: [
          [
            [3.501, 6.437],
            [3.401, 6.428],
          ],
        ],
      },
      {
        type: 'LineString',
      },
      {
        type: 'LineString',
        coordinates: null,
      },
      {
        type: 'LineString',
        coordinates: {},
      },
      {
        type: 'LineString',
        coordinates: [],
      },
      {
        type: 'LineString',
        coordinates: [
          [3.501, 6.437],
        ],
      },
    ];

    for (
      const geometry
      of invalidGeometries
    ) {
      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                routeBody({
                  routes: [
                    {
                      geometry,
                      distance: 1000,
                      duration: 300,
                    },
                  ],
                }),
              );
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);

test(
  'route geometry points must contain exactly longitude and latitude',
  async () => {
    const invalidPoints = [
      null,
      'point',
      123,
      {},
      [],
      [3.501],
      [
        3.501,
        6.437,
        7,
      ],
    ];

    for (const point of invalidPoints) {
      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                routeBody({
                  routes: [
                    {
                      geometry: {
                        type: 'LineString',
                        coordinates: [
                          point,
                          [3.401, 6.428],
                        ],
                      },
                      distance: 1000,
                      duration: 300,
                    },
                  ],
                }),
              );
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);

test(
  'route geometry rejects invalid longitude values',
  async () => {
    const invalidLongitudes = [
      NaN,
      Infinity,
      -Infinity,
      -181,
      181,
      '3.501',
      null,
    ];

    for (
      const longitude
      of invalidLongitudes
    ) {
      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                routeBody({
                  routes: [
                    {
                      geometry: {
                        type: 'LineString',
                        coordinates: [
                          [
                            longitude,
                            6.437,
                          ],
                          [
                            3.401,
                            6.428,
                          ],
                        ],
                      },
                      distance: 1000,
                      duration: 300,
                    },
                  ],
                }),
              );
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);

test(
  'route geometry rejects invalid latitude values',
  async () => {
    const invalidLatitudes = [
      NaN,
      Infinity,
      -Infinity,
      -91,
      91,
      '6.437',
      null,
    ];

    for (
      const latitude
      of invalidLatitudes
    ) {
      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              return jsonResponse(
                routeBody({
                  routes: [
                    {
                      geometry: {
                        type: 'LineString',
                        coordinates: [
                          [
                            3.501,
                            latitude,
                          ],
                          [
                            3.401,
                            6.428,
                          ],
                        ],
                      },
                      distance: 1000,
                      duration: 300,
                    },
                  ],
                }),
              );
            },
          },
        );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
          && error.code
            === 'invalid_response',
      );
    }
  },
);

test(
  'valid route geometry preserves longitude latitude ordering',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse(
              routeBody({
                routes: [
                  {
                    geometry: {
                      type: 'LineString',
                      coordinates: [
                        [3.501, 6.437],
                        [3.45, 6.432],
                        [3.401, 6.428],
                      ],
                    },
                    distance: 1000,
                    duration: 300,
                  },
                ],
              }),
            );
          },
        },
      );

    const result =
      await provider.route(
        routeInput(),
        signal(),
      );

    assert.deepEqual(
      result.routeShape,
      {
        type: 'LineString',
        coordinates: [
          [3.501, 6.437],
          [3.45, 6.432],
          [3.401, 6.428],
        ],
      },
    );
  },
);

test(
  'non-success provider statuses fail generically',
  async () => {
    for (const status of [
      302,
      401,
      403,
      429,
      500,
    ]) {
      const provider =
        createMapboxDirectionsProvider(
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
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
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
  'supported JSON and GeoJSON media types are accepted',
  async () => {
    const mediaTypes = [
      'application/json',
      'application/json; charset=utf-8',
      'application/geo+json',
      'application/geo+json; charset=utf-8',
      'application/vnd.geo+json',
      'application/vnd.geo+json; charset=utf-8',
    ];

    for (
      const contentType
      of mediaTypes
    ) {
      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            async fetchImpl() {
              return new Response(
                JSON.stringify(
                  routeBody(),
                ),
                {
                  status: 200,
                  headers: {
                    'content-type':
                      contentType,
                  },
                },
              );
            },
          },
        );

      const result =
        await provider.route(
          routeInput(),
          signal(),
        );

      assert.equal(
        result.providerRouteReference,
        'test-route-response-uuid:0',
      );
    }
  },
);

test(
  'invalid provider media type fails closed',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            return new Response(
              JSON.stringify(
                routeBody(),
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
      provider.route(
        routeInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxDirectionsProviderError
        && error.code
          === 'invalid_response',
    );
  },
);

test(
  'malformed provider JSON fails closed',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
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
      provider.route(
        routeInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxDirectionsProviderError
        && error.code
          === 'invalid_response',
    );
  },
);

test(
  'declared oversized Content-Length fails before parsing',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
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
      provider.route(
        routeInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxDirectionsProviderError
        && error.code
          === 'invalid_response',
    );
  },
);

test(
  'actual provider body over 256 KiB fails closed',
  async () => {
    const huge =
      JSON.stringify({
        ...routeBody(),
        padding:
          'x'.repeat(
            256 * 1024,
          ),
      });

    const provider =
      createMapboxDirectionsProvider(
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
      provider.route(
        routeInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxDirectionsProviderError
        && error.code
          === 'invalid_response',
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
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            fetches += 1;

            return jsonResponse();
          },
        },
      );

    await assert.rejects(
      provider.route(
        routeInput(),
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
      createMapboxDirectionsProvider(
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
      provider.route(
        routeInput(),
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
      createMapboxDirectionsProvider(
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
      provider.route(
        routeInput(),
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
  'invalid timeout configuration leaves provider unavailable',
  async () => {
    for (const timeoutMs of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
    ]) {
      let fetches = 0;

      const provider =
        createMapboxDirectionsProvider(
          TOKEN,
          {
            timeoutMs,

            async fetchImpl() {
              fetches += 1;

              return jsonResponse();
            },
          },
        );

      assert.equal(
        provider.isAvailable(),
        false,
      );

      await assert.rejects(
        provider.route(
          routeInput(),
          signal(),
        ),
        error =>
          error
            instanceof
              MapboxDirectionsProviderError
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
  'fetch transport failure is sanitized and token never leaks',
  async () => {
    const privateText =
      'private transport failure';

    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            throw new Error(
              `${privateText} ${TOKEN}`,
            );
          },
        },
      );

    await assert.rejects(
      provider.route(
        routeInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxDirectionsProviderError
        && error.code
          === 'provider_unavailable'
        && !error.message.includes(
          TOKEN,
        )
        && !error.message.includes(
          privateText,
        ),
    );
  },
);

test(
  'invalid server clock fails closed',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          now: () =>
            new Date(NaN),

          async fetchImpl() {
            return jsonResponse();
          },
        },
      );

    await assert.rejects(
      provider.route(
        routeInput(),
        signal(),
      ),
      error =>
        error
          instanceof
            MapboxDirectionsProviderError
        && error.code
          === 'provider_unavailable',
    );
  },
);

test(
  'successful route result exposes only normalized provider fields',
  async () => {
    const provider =
      createMapboxDirectionsProvider(
        TOKEN,
        {
          async fetchImpl() {
            return jsonResponse({
              code: 'Ok',
              uuid:
                'safe-output-response',
              message:
                'private provider message',
              arbitraryTopLevelField:
                'must not escape',
              routes: [
                {
                  geometry: {
                    type: 'LineString',
                    coordinates: [
                      [3.501, 6.437],
                      [3.401, 6.428],
                    ],
                  },
                  distance: 1000,
                  duration: 300,
                  weight: 999,
                  weight_name:
                    'auto',
                  legs: [
                    {
                      summary:
                        'private route leg',
                    },
                  ],
                  arbitraryRouteField:
                    'must not escape',
                },
              ],
            });
          },
        },
      );

    const result =
      await provider.route(
        routeInput(),
        signal(),
      );

    assert.deepEqual(
      Object.keys(result).sort(),
      [
        'expiresAt',
        'generatedAt',
        'providerNamespace',
        'providerProduct',
        'providerRouteReference',
        'providerVersion',
        'routeDistanceMeters',
        'routeDurationSeconds',
        'routeShape',
      ].sort(),
    );

    assert.equal(
      'code' in result,
      false,
    );

    assert.equal(
      'message' in result,
      false,
    );

    assert.equal(
      'routes' in result,
      false,
    );

    assert.equal(
      'uuid' in result,
      false,
    );

    assert.equal(
      'weight' in result,
      false,
    );

    assert.equal(
      'legs' in result,
      false,
    );

    assert.equal(
      'arbitraryTopLevelField'
        in result,
      false,
    );

    assert.equal(
      'arbitraryRouteField'
        in result,
      false,
    );
  },
);