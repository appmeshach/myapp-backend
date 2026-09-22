import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ROUTE_MATCH_GEOMETRY_VERSION,
  calculateTrustedRouteMatchGeometry,
} from '../functions/_shared/route-match-geometry.ts';

function approximately(
  actual,
  expected,
  tolerance = 2,
) {
  assert.ok(
    Math.abs(actual - expected)
      <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test(
  'geometry calculates distance and positions on a simple route',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 0.01,
          longitude: 0.02,
        },

        requesterDestination: {
          latitude: -0.02,
          longitude: 0.08,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.1, 0],
          ],
        },
      });

    assert.equal(
      result.algorithmVersion,
      ROUTE_MATCH_GEOMETRY_VERSION,
    );

    approximately(
      result.calculatedRouteShapeLengthMeters,
      11120,
    );

    approximately(
      result.requesterOrigin
        .distanceToRouteMeters,
      1112,
    );

    approximately(
      result.requesterOrigin
        .positionAlongRouteMeters,
      2224,
    );

    approximately(
      result.requesterDestination
        .distanceToRouteMeters,
      2224,
    );

    approximately(
      result.requesterDestination
        .positionAlongRouteMeters,
      8896,
    );

    approximately(
      result.requesterOrigin
        .closestRoutePoint.latitude,
      0,
      0.000001,
    );

    approximately(
      result.requesterOrigin
        .closestRoutePoint.longitude,
      0.02,
      0.000001,
    );
  },
);

test(
  'point already on route has zero distance',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 0,
          longitude: 0.025,
        },

        requesterDestination: {
          latitude: 0,
          longitude: 0.075,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.1, 0],
          ],
        },
      });

    assert.equal(
      result.requesterOrigin
        .distanceToRouteMeters,
      0,
    );

    assert.equal(
      result.requesterDestination
        .distanceToRouteMeters,
      0,
    );

    assert.ok(
      result.requesterOrigin
        .positionAlongRouteMeters
      < result.requesterDestination
        .positionAlongRouteMeters,
    );
  },
);

test(
  'geometry clamps nearest point to route start',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 0,
          longitude: -0.05,
        },

        requesterDestination: {
          latitude: 0,
          longitude: 0.05,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.1, 0],
          ],
        },
      });

    assert.equal(
      result.requesterOrigin
        .positionAlongRouteMeters,
      0,
    );

    approximately(
      result.requesterOrigin
        .closestRoutePoint.latitude,
      0,
      0.000001,
    );

    approximately(
      result.requesterOrigin
        .closestRoutePoint.longitude,
      0,
      0.000001,
    );
  },
);

test(
  'geometry clamps nearest point to route end',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 0,
          longitude: 0.05,
        },

        requesterDestination: {
          latitude: 0,
          longitude: 0.15,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.1, 0],
          ],
        },
      });

    assert.equal(
      result.requesterDestination
        .positionAlongRouteMeters,
      result.calculatedRouteShapeLengthMeters,
    );

    approximately(
      result.requesterDestination
        .closestRoutePoint.latitude,
      0,
      0.000001,
    );

    approximately(
      result.requesterDestination
        .closestRoutePoint.longitude,
      0.1,
      0.000001,
    );
  },
);

test(
  'multi-segment route chooses closest segment and preserves cumulative position',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 0.05,
          longitude: 0.1,
        },

        requesterDestination: {
          latitude: 0.09,
          longitude: 0.1,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.1, 0],
            [0.1, 0.1],
          ],
        },
      });

    assert.ok(
      result.requesterOrigin
        .distanceToRouteMeters
      <= 1,
    );

    assert.ok(
      result.requesterDestination
        .distanceToRouteMeters
      <= 1,
    );

    assert.ok(
      result.requesterOrigin
        .positionAlongRouteMeters
      > 11100,
    );

    assert.ok(
      result.requesterDestination
        .positionAlongRouteMeters
      > result.requesterOrigin
        .positionAlongRouteMeters,
    );
  },
);

test(
  'very large requester distance remains an objective fact and is not rejected',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 20,
          longitude: 20,
        },

        requesterDestination: {
          latitude: -20,
          longitude: -20,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.1, 0],
          ],
        },
      });

    assert.ok(
      result.requesterOrigin
        .distanceToRouteMeters
      > 1_000_000,
    );

    assert.ok(
      result.requesterDestination
        .distanceToRouteMeters
      > 1_000_000,
    );
  },
);

test(
  'reverse requester direction is preserved as objective positions',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 0,
          longitude: 0.08,
        },

        requesterDestination: {
          latitude: 0,
          longitude: 0.02,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0.1, 0],
          ],
        },
      });

    assert.ok(
      result.requesterOrigin
        .positionAlongRouteMeters
      > result.requesterDestination
        .positionAlongRouteMeters,
    );
  },
);

test(
  'duplicate route points are tolerated when total route length remains positive',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 0,
          longitude: 0.02,
        },

        requesterDestination: {
          latitude: 0,
          longitude: 0.08,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0, 0],
            [0.1, 0],
          ],
        },
      });

    assert.ok(
      result.calculatedRouteShapeLengthMeters
      > 0,
    );

    assert.equal(
      result.requesterOrigin
        .distanceToRouteMeters,
      0,
    );
  },
);

test(
  'invalid requester coordinates fail closed',
  () => {
    assert.throws(
      () =>
        calculateTrustedRouteMatchGeometry({
          requesterOrigin: {
            latitude: 91,
            longitude: 3,
          },

          requesterDestination: {
            latitude: 6,
            longitude: 3,
          },

          routeShape: {
            type: 'LineString',
            coordinates: [
              [3, 6],
              [3.1, 6.1],
            ],
          },
        }),
      /Invalid trusted route-match coordinate/,
    );
  },
);

test(
  'invalid route shape coordinates fail closed',
  () => {
    assert.throws(
      () =>
        calculateTrustedRouteMatchGeometry({
          requesterOrigin: {
            latitude: 6,
            longitude: 3,
          },

          requesterDestination: {
            latitude: 6.1,
            longitude: 3.1,
          },

          routeShape: {
            type: 'LineString',
            coordinates: [
              [3, 6],
              [181, 6],
            ],
          },
        }),
      /Invalid trusted route-match route shape/,
    );
  },
);

test(
  'zero-length route fails closed',
  () => {
    assert.throws(
      () =>
        calculateTrustedRouteMatchGeometry({
          requesterOrigin: {
            latitude: 6,
            longitude: 3,
          },

          requesterDestination: {
            latitude: 6.1,
            longitude: 3.1,
          },

          routeShape: {
            type: 'LineString',
            coordinates: [
              [3, 6],
              [3, 6],
            ],
          },
        }),
      /route shape length must be positive/,
    );
  },
);

test(
  'geometry handles a route crossing the antimeridian',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 0.01,
          longitude: 180,
        },

        requesterDestination: {
          latitude: -0.01,
          longitude: -179.95,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [179.9, 0],
            [-179.9, 0],
          ],
        },
      });

    assert.ok(
      result.calculatedRouteShapeLengthMeters
      > 20_000,
    );

    assert.ok(
      result.calculatedRouteShapeLengthMeters
      < 23_000,
    );

    approximately(
      result.requesterOrigin
        .distanceToRouteMeters,
      1112,
      3,
    );

    approximately(
      result.requesterDestination
        .distanceToRouteMeters,
      1112,
      3,
    );

    assert.ok(
      result.requesterOrigin
        .positionAlongRouteMeters
      < result.requesterDestination
        .positionAlongRouteMeters,
    );
  },
);

test(
  'geometry remains finite and bounded at higher latitude',
  () => {
    const result =
      calculateTrustedRouteMatchGeometry({
        requesterOrigin: {
          latitude: 60.01,
          longitude: 10.02,
        },

        requesterDestination: {
          latitude: 59.99,
          longitude: 10.08,
        },

        routeShape: {
          type: 'LineString',
          coordinates: [
            [10, 60],
            [10.1, 60],
          ],
        },
      });

    assert.ok(
      Number.isSafeInteger(
        result.calculatedRouteShapeLengthMeters,
      ),
    );

    assert.ok(
      result.calculatedRouteShapeLengthMeters
      > 5_000,
    );

    assert.ok(
      result.calculatedRouteShapeLengthMeters
      < 6_000,
    );

    assert.ok(
      Number.isSafeInteger(
        result.requesterOrigin
          .distanceToRouteMeters,
      ),
    );

    assert.ok(
      Number.isSafeInteger(
        result.requesterDestination
          .distanceToRouteMeters,
      ),
    );

    assert.ok(
      result.requesterOrigin
        .positionAlongRouteMeters
      >= 0,
    );

    assert.ok(
      result.requesterDestination
        .positionAlongRouteMeters
      <= result.calculatedRouteShapeLengthMeters,
    );
  },
);
