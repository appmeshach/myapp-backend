import type {
  TrustedRouteCoordinate,
} from './route-contracts.ts';

export const ROUTE_MATCH_GEOMETRY_VERSION =
  'route_match_geometry_v1';

const EARTH_RADIUS_METERS = 6_371_008.8;

const DEGREES_TO_RADIANS =
  Math.PI / 180;

const RADIANS_TO_DEGREES =
  180 / Math.PI;

export interface TrustedRouteMatchLineString {
  type: 'LineString';
  coordinates: number[][];
}

export interface RoutePointMatch {
  distanceToRouteMeters: number;

  positionAlongRouteMeters: number;

  closestRoutePoint:
    TrustedRouteCoordinate;
}

export interface TrustedRouteMatchGeometry {
  algorithmVersion:
    typeof ROUTE_MATCH_GEOMETRY_VERSION;

  calculatedRouteShapeLengthMeters:
    number;

  requesterOrigin:
    RoutePointMatch;

  requesterDestination:
    RoutePointMatch;
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

function trustedCoordinate(
  value: TrustedRouteCoordinate,
): TrustedRouteCoordinate {
  if (
    !value
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
    throw new Error(
      'Invalid trusted route-match coordinate',
    );
  }

  return {
    latitude: value.latitude,
    longitude: value.longitude,
  };
}

function toRadians(
  degrees: number,
): number {
  return degrees * DEGREES_TO_RADIANS;
}

function toDegrees(
  radians: number,
): number {
  return radians * RADIANS_TO_DEGREES;
}

function normalizeLongitude(
  longitude: number,
): number {
  const normalized =
    (
      (
        longitude + 540
      ) % 360
    ) - 180;

  return Object.is(
    normalized,
    -0,
  )
    ? 0
    : normalized;
}

function angularDistance(
  first: TrustedRouteCoordinate,
  second: TrustedRouteCoordinate,
): number {
  const firstLatitude =
    toRadians(first.latitude);

  const secondLatitude =
    toRadians(second.latitude);

  const latitudeDifference =
    secondLatitude - firstLatitude;

  const longitudeDifference =
    toRadians(
      normalizeLongitude(
        second.longitude
        - first.longitude,
      ),
    );

  const sinLatitude =
    Math.sin(
      latitudeDifference / 2,
    );

  const sinLongitude =
    Math.sin(
      longitudeDifference / 2,
    );

  const haversine =
    sinLatitude * sinLatitude
    + Math.cos(firstLatitude)
      * Math.cos(secondLatitude)
      * sinLongitude
      * sinLongitude;

  return 2 * Math.atan2(
    Math.sqrt(
      Math.max(
        0,
        Math.min(1, haversine),
      ),
    ),
    Math.sqrt(
      Math.max(
        0,
        1 - Math.min(1, haversine),
      ),
    ),
  );
}

function distanceMeters(
  first: TrustedRouteCoordinate,
  second: TrustedRouteCoordinate,
): number {
  return (
    angularDistance(
      first,
      second,
    )
    * EARTH_RADIUS_METERS
  );
}

function initialBearingRadians(
  first: TrustedRouteCoordinate,
  second: TrustedRouteCoordinate,
): number {
  const firstLatitude =
    toRadians(first.latitude);

  const secondLatitude =
    toRadians(second.latitude);

  const longitudeDifference =
    toRadians(
      normalizeLongitude(
        second.longitude
        - first.longitude,
      ),
    );

  return Math.atan2(
    Math.sin(longitudeDifference)
      * Math.cos(secondLatitude),

    Math.cos(firstLatitude)
      * Math.sin(secondLatitude)
      - Math.sin(firstLatitude)
        * Math.cos(secondLatitude)
        * Math.cos(
          longitudeDifference,
        ),
  );
}

function destinationPoint(
  start: TrustedRouteCoordinate,
  bearingRadians: number,
  angularDistanceValue: number,
): TrustedRouteCoordinate {
  const latitude =
    toRadians(start.latitude);

  const longitude =
    toRadians(start.longitude);

  const sinLatitude =
    Math.sin(latitude);

  const cosLatitude =
    Math.cos(latitude);

  const sinDistance =
    Math.sin(
      angularDistanceValue,
    );

  const cosDistance =
    Math.cos(
      angularDistanceValue,
    );

  const destinationLatitude =
    Math.asin(
      Math.max(
        -1,
        Math.min(
          1,
          sinLatitude
            * cosDistance
          + cosLatitude
            * sinDistance
            * Math.cos(
              bearingRadians,
            ),
        ),
      ),
    );

  const destinationLongitude =
    longitude
    + Math.atan2(
      Math.sin(
        bearingRadians,
      )
        * sinDistance
        * cosLatitude,

      cosDistance
        - sinLatitude
          * Math.sin(
            destinationLatitude,
          ),
    );

  return {
    latitude:
      toDegrees(
        destinationLatitude,
      ),

    longitude:
      normalizeLongitude(
        toDegrees(
          destinationLongitude,
        ),
      ),
  };
}

interface SegmentMatch {
  closestRoutePoint:
    TrustedRouteCoordinate;

  distanceToPointMeters: number;

  distanceFromSegmentStartMeters:
    number;
}

function closestPointOnSegment(
  point: TrustedRouteCoordinate,
  start: TrustedRouteCoordinate,
  end: TrustedRouteCoordinate,
): SegmentMatch {
  const segmentAngularLength =
    angularDistance(
      start,
      end,
    );

  if (
    !Number.isFinite(
      segmentAngularLength,
    )
    || segmentAngularLength <= 0
  ) {
    return {
      closestRoutePoint: start,

      distanceToPointMeters:
        distanceMeters(
          point,
          start,
        ),

      distanceFromSegmentStartMeters:
        0,
    };
  }

  const startToPoint =
    angularDistance(
      start,
      point,
    );

  const segmentBearing =
    initialBearingRadians(
      start,
      end,
    );

  const pointBearing =
    initialBearingRadians(
      start,
      point,
    );

  const bearingDifference =
    pointBearing
    - segmentBearing;

  const alongTrackAngularDistance =
    Math.atan2(
      Math.sin(startToPoint)
        * Math.cos(
          bearingDifference,
        ),
      Math.cos(startToPoint),
    );

  if (
    !Number.isFinite(
      alongTrackAngularDistance,
    )
    || alongTrackAngularDistance <= 0
  ) {
    return {
      closestRoutePoint: start,

      distanceToPointMeters:
        distanceMeters(
          point,
          start,
        ),

      distanceFromSegmentStartMeters:
        0,
    };
  }

  if (
    alongTrackAngularDistance
      >= segmentAngularLength
  ) {
    return {
      closestRoutePoint: end,

      distanceToPointMeters:
        distanceMeters(
          point,
          end,
        ),

      distanceFromSegmentStartMeters:
        segmentAngularLength
        * EARTH_RADIUS_METERS,
    };
  }

  const closestRoutePoint =
    destinationPoint(
      start,
      segmentBearing,
      alongTrackAngularDistance,
    );

  return {
    closestRoutePoint,

    distanceToPointMeters:
      distanceMeters(
        point,
        closestRoutePoint,
      ),

    distanceFromSegmentStartMeters:
      alongTrackAngularDistance
      * EARTH_RADIUS_METERS,
  };
}

function routeCoordinates(
  routeShape:
    TrustedRouteMatchLineString,
): TrustedRouteCoordinate[] {
  if (
    !routeShape
    || routeShape.type !== 'LineString'
    || !Array.isArray(
      routeShape.coordinates,
    )
    || routeShape.coordinates.length < 2
  ) {
    throw new Error(
      'Invalid trusted route-match route shape',
    );
  }

  return routeShape.coordinates.map(
    point => {
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
        throw new Error(
          'Invalid trusted route-match route shape',
        );
      }

      return {
        longitude: point[0],
        latitude: point[1],
      };
    },
  );
}

function matchPointToRoute(
  point: TrustedRouteCoordinate,
  coordinates:
    TrustedRouteCoordinate[],
  segmentLengths: number[],
  totalRouteLengthMeters: number,
): RoutePointMatch {
  let bestDistance =
    Number.POSITIVE_INFINITY;

  let bestPosition =
    0;

  let bestPoint =
    coordinates[0];

  let distanceBeforeSegment =
    0;

  for (
    let index = 0;
    index < coordinates.length - 1;
    index += 1
  ) {
    const segment =
      closestPointOnSegment(
        point,
        coordinates[index],
        coordinates[index + 1],
      );

    const position =
      distanceBeforeSegment
      + segment
        .distanceFromSegmentStartMeters;

    if (
      segment.distanceToPointMeters
        < bestDistance
    ) {
      bestDistance =
        segment.distanceToPointMeters;

      bestPosition =
        position;

      bestPoint =
        segment.closestRoutePoint;
    }

    distanceBeforeSegment +=
      segmentLengths[index];
  }

  if (
    !Number.isFinite(bestDistance)
    || !Number.isFinite(bestPosition)
  ) {
    throw new Error(
      'Trusted route-match geometry unavailable',
    );
  }

  const roundedTotal =
    Math.round(
      totalRouteLengthMeters,
    );

  const roundedPosition =
    Math.min(
      roundedTotal,
      Math.max(
        0,
        Math.round(bestPosition),
      ),
    );

  return {
    distanceToRouteMeters:
      Math.max(
        0,
        Math.round(bestDistance),
      ),

    positionAlongRouteMeters:
      roundedPosition,

    closestRoutePoint: {
      latitude:
        bestPoint.latitude,

      longitude:
        bestPoint.longitude,
    },
  };
}

export function calculateTrustedRouteMatchGeometry(
  input: {
    requesterOrigin:
      TrustedRouteCoordinate;

    requesterDestination:
      TrustedRouteCoordinate;

    routeShape:
      TrustedRouteMatchLineString;
  },
): TrustedRouteMatchGeometry {
  const requesterOrigin =
    trustedCoordinate(
      input.requesterOrigin,
    );

  const requesterDestination =
    trustedCoordinate(
      input.requesterDestination,
    );

  const coordinates =
    routeCoordinates(
      input.routeShape,
    );

  const segmentLengths:
    number[] = [];

  let totalRouteLengthMeters = 0;

  for (
    let index = 0;
    index < coordinates.length - 1;
    index += 1
  ) {
    const length =
      distanceMeters(
        coordinates[index],
        coordinates[index + 1],
      );

    if (
      !Number.isFinite(length)
      || length < 0
    ) {
      throw new Error(
        'Trusted route-match geometry unavailable',
      );
    }

    segmentLengths.push(length);

    totalRouteLengthMeters +=
      length;
  }

  const roundedTotal =
    Math.round(
      totalRouteLengthMeters,
    );

  if (
    !Number.isSafeInteger(
      roundedTotal,
    )
    || roundedTotal <= 0
  ) {
    throw new Error(
      'Trusted route-match route shape length must be positive',
    );
  }

  return {
    algorithmVersion:
      ROUTE_MATCH_GEOMETRY_VERSION,

    calculatedRouteShapeLengthMeters:
      roundedTotal,

    requesterOrigin:
      matchPointToRoute(
        requesterOrigin,
        coordinates,
        segmentLengths,
        totalRouteLengthMeters,
      ),

    requesterDestination:
      matchPointToRoute(
        requesterDestination,
        coordinates,
        segmentLengths,
        totalRouteLengthMeters,
      ),
  };
}
