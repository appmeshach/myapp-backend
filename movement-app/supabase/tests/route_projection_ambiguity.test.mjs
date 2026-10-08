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
