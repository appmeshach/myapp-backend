import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessRouteProjectionAmbiguity,
  PROJECTION_AMBIGUITY_VERSION,
} from '../functions/_shared/route-projection-ambiguity.ts';

const point = (longitude, latitude = 0) => ({ longitude, latitude });
const shape = (...coordinates) => ({ type: 'LineString', coordinates });

test('ordinary forward corridor has one projected position', () => {
  const r = assessRouteProjectionAmbiguity(point(0.05), shape([0, 0], [0.1, 0]));
  assert.equal(r.version, PROJECTION_AMBIGUITY_VERSION);
  assert.equal(r.hasMultipleRoutePositions, false);
  assert.equal(r.plausiblePositionsAlongRouteMeters.length, 1);
  assert.equal(r.authorizesAdmission, false);
});

test('returning over the same corridor yields distinct plausible positions', () => {
  const r = assessRouteProjectionAmbiguity(
    point(0.05),
    shape([0, 0], [0.1, 0], [0, 0]),
  );
  assert.equal(r.hasMultipleRoutePositions, true);
  assert.equal(r.plausiblePositionsAlongRouteMeters.length, 2);
  assert.ok(r.plausiblePositionsAlongRouteMeters[1] > r.plausiblePositionsAlongRouteMeters[0]);
  assert.equal(r.confirmsUsableSharedSegment, false);
});

test('self-intersection is recognized as multiple route positions', () => {
  const r = assessRouteProjectionAmbiguity(
    point(0),
    shape([-0.05, -0.05], [0.05, 0.05], [-0.05, 0.05], [0.05, -0.05]),
  );
  assert.equal(r.hasMultipleRoutePositions, true);
  assert.equal(r.plausiblePositionsAlongRouteMeters.length, 2);
});

test('adjacent sections sharing a vertex are not incorrectly counted twice', () => {
  const r = assessRouteProjectionAmbiguity(
    point(0.05), shape([0, 0], [0.05, 0], [0.1, 0]),
  );
  assert.equal(r.hasMultipleRoutePositions, false);
  assert.equal(r.plausiblePositionsAlongRouteMeters.length, 1);
});

test('zero-length intermediate segment does not introduce a second traversal', () => {
  const r = assessRouteProjectionAmbiguity(
    point(0.05), shape([0, 0], [0.05, 0], [0.05, 0], [0.1, 0]),
  );
  assert.equal(r.hasMultipleRoutePositions, false);
});

test('long segmented route keeps projection checks bounded and deterministic', () => {
  const coordinates = Array.from({ length: 1201 }, (_, i) => [i / 12000, 0]);
  const r = assessRouteProjectionAmbiguity(
    point(0.05),
    shape(...coordinates),
  );
  assert.equal(r.hasMultipleRoutePositions, false);
  assert.equal(r.plausiblePositionsAlongRouteMeters.length, 1);
  assert.equal(r.authorizesAdmission, false);
});

test('densely segmented route positions agree with trusted whole-route geometry', async () => {
  const { calculateTrustedRouteMatchGeometry } = await import(
    '../functions/_shared/route-match-geometry.ts'
  );
  const coordinates = Array.from({ length: 1201 }, (_, i) => [i / 12000, 0]);
  const pointOnRoute = point(0.075);
  const routeShape = shape(...coordinates);
  const whole = calculateTrustedRouteMatchGeometry({
    requesterOrigin: pointOnRoute,
    requesterDestination: pointOnRoute,
    routeShape,
  });
  const ambiguity = assessRouteProjectionAmbiguity(pointOnRoute, routeShape);
  assert.equal(ambiguity.hasMultipleRoutePositions, false);
  assert.ok(
    Math.abs(ambiguity.plausiblePositionsAlongRouteMeters[0]
      - whole.requesterOrigin.positionAlongRouteMeters) <= 1,
  );
});

test('malformed route and coordinate fail closed', () => {
  assert.throws(
    () => assessRouteProjectionAmbiguity(point(0), shape([0, 0], [181, 0])),
    /Invalid trusted route-match route shape/,
  );
  assert.throws(
    () => assessRouteProjectionAmbiguity(point(181), shape([0, 0], [0.1, 0])),
    /Invalid trusted route-match coordinate/,
  );
});
