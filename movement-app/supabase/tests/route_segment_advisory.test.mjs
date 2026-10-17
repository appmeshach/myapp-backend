import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessTrustedRouteSegmentAdvisory,
  ROUTE_SEGMENT_ADVISORY_VERSION,
} from '../functions/_shared/route-segment-advisory.ts';

function advisory(origin, destination, coordinates) {
  return assessTrustedRouteSegmentAdvisory({
    requesterOrigin: { longitude: origin, latitude: 0 },
    requesterDestination: { longitude: destination, latitude: 0 },
    routeShape: { type: 'LineString', coordinates },
  });
}

test('ordinary ordered corridor remains provisional and never authorizes admission', () => {
  const result = advisory(0.02, 0.08, [[0, 0], [0.1, 0]]);
  assert.equal(result.version, ROUTE_SEGMENT_ADVISORY_VERSION);
  assert.equal(result.classification, 'forward_projection_candidate');
  assert.equal(result.reason, 'ordered_projection_unverified');
  assert.equal(result.originAmbiguity.hasMultipleRoutePositions, false);
  assert.equal(result.destinationAmbiguity.hasMultipleRoutePositions, false);
  assert.equal(result.confirmsUsableSharedSegment, false);
  assert.equal(result.authorizesAdmission, false);
});

test('repeated corridor cannot be presented as an unambiguous forward segment', () => {
  const result = advisory(0.02, 0.08, [[0, 0], [0.1, 0], [0, 0]]);
  assert.equal(result.projection.classification, 'forward_projection_candidate');
  assert.equal(result.classification, 'needs_coordination');
  assert.equal(result.reason, 'multiple_route_positions');
  assert.equal(result.originAmbiguity.hasMultipleRoutePositions, true);
  assert.equal(result.destinationAmbiguity.hasMultipleRoutePositions, true);
});

test('reverse projection remains advisory coordination even without repeated route', () => {
  const result = advisory(0.08, 0.02, [[0, 0], [0.1, 0]]);
  assert.equal(result.classification, 'needs_coordination');
  assert.equal(result.reason, 'reverse_projection');
});

test('invalid source shape fails closed', () => {
  assert.throws(
    () => advisory(0.02, 0.08, [[0, 0], [181, 0]]),
    /Invalid trusted route-match route shape/,
  );
});
