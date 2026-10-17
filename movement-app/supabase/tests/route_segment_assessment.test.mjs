import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculateTrustedRouteMatchGeometry,
} from '../functions/_shared/route-match-geometry.ts';
import {
  ROUTE_SEGMENT_ASSESSMENT_VERSION,
  assessRouteSegmentProjection,
} from '../functions/_shared/route-segment-assessment.ts';

const route = {
  type: 'LineString',
  coordinates: [[0, 0], [0.1, 0]],
};

function calculate(startLongitude, endLongitude, shape = route) {
  return calculateTrustedRouteMatchGeometry({
    requesterOrigin: { latitude: 0, longitude: startLongitude },
    requesterDestination: { latitude: 0, longitude: endLongitude },
    routeShape: shape,
  });
}

test('forward projection is a candidate, never automatic suitability or admission', () => {
  const result = assessRouteSegmentProjection(calculate(0.02, 0.08));
  assert.equal(result.assessmentVersion, ROUTE_SEGMENT_ASSESSMENT_VERSION);
  assert.equal(result.classification, 'forward_projection_candidate');
  assert.equal(result.reason, 'ordered_projection_unverified');
  assert.ok(result.projectedSharedLengthMeters > 0);
  assert.equal(result.confirmsUsableSharedSegment, false);
  assert.equal(result.authorizesAdmission, false);
});

test('reverse projection remains negotiable rather than a universal rejection', () => {
  const result = assessRouteSegmentProjection(calculate(0.08, 0.02));
  assert.equal(result.classification, 'needs_coordination');
  assert.equal(result.reason, 'reverse_projection');
  assert.equal(result.projectedSharedLengthMeters, 0);
  assert.equal(result.authorizesAdmission, false);
});

test('same route position does not establish shared movement', () => {
  const result = assessRouteSegmentProjection(calculate(0.05, 0.05));
  assert.equal(result.classification, 'needs_coordination');
  assert.equal(result.reason, 'same_position');
});

test('repeat traversal cannot be confirmed merely from first nearest projection', () => {
  const shape = { type: 'LineString', coordinates: [[0, 0], [0.1, 0], [0, 0]] };
  const result = assessRouteSegmentProjection(calculate(0.08, 0.02, shape));
  assert.equal(result.classification, 'needs_coordination');
  assert.equal(result.confirmsUsableSharedSegment, false);
});

test('distance away from corridor does not introduce universal detour exclusion', () => {
  const g = calculate(0.02, 0.08);
  const assessment = assessRouteSegmentProjection({
    ...g,
    requesterOrigin: { ...g.requesterOrigin, distanceToRouteMeters: 200000 },
  });
  assert.equal(assessment.classification, 'forward_projection_candidate');
  assert.equal(assessment.authorizesAdmission, false);
});

test('untrusted projected coordinates are rejected before classification', () => {
  const g = calculate(0.02, 0.08);
  assert.throws(
    () => assessRouteSegmentProjection({
      ...g,
      requesterOrigin: {
        ...g.requesterOrigin,
        closestRoutePoint: { latitude: NaN, longitude: 0.02 },
      },
    }),
    /Invalid trusted route-segment assessment input/,
  );
  assert.throws(
    () => assessRouteSegmentProjection({
      ...g,
      requesterDestination: {
        ...g.requesterDestination,
        closestRoutePoint: { latitude: 0, longitude: 181 },
      },
    }),
    /Invalid trusted route-segment assessment input/,
  );
});

test('invalid or corrupted measurements are rejected before advisory classification', () => {
  const g = calculate(0.02, 0.08);
  assert.throws(
    () => assessRouteSegmentProjection({
      ...g,
      requesterDestination: {
        ...g.requesterDestination,
        positionAlongRouteMeters: g.calculatedRouteShapeLengthMeters + 1,
      },
    }),
    /Invalid trusted route-segment assessment input/,
  );
  assert.throws(
    () => assessRouteSegmentProjection({ ...g, algorithmVersion: 'untrusted' }),
    /Invalid trusted route-segment assessment input/,
  );
});
