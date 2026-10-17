import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assessTwoRouteOverlap } from '../functions/_shared/route-two-route-overlap.ts';

function line(...coordinates) {
  return { type: 'LineString', coordinates };
}

test('same-direction overlap is measured as a candidate but never confirmed', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.12, 0]),
    requesterRouteShape: line([0.03, 0], [0.15, 0]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.version, 'route_two_route_overlap_v0');
  assert.equal(result.classification, 'possible_shared_section');
  assert.ok(result.hasPotentialOverlap);
  assert.ok(result.totalSharedLengthMeters > 0);
  assert.equal(result.overlapIntervals.length, 1);
  assert.ok(result.overlapIntervals[0].offeredStartMeters < result.overlapIntervals[0].offeredEndMeters);
  assert.ok(result.overlapIntervals[0].requesterStartMeters < result.overlapIntervals[0].requesterEndMeters);
  assert.equal(result.confirmsUsableSharedSegment, false);
  assert.equal(result.authorizesAdmission, false);
});

test('requester route starting before the offered route still preserves a normalized reciprocal correspondence', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0.10, 0], [0.30, 0]),
    requesterRouteShape: line([0.02, 0], [0.18, 0]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.classification, 'possible_shared_section');
  assert.ok(result.overlapIntervals.length >= 1);
  assert.ok(result.overlapIntervals[0].offeredStartMeters <= result.overlapIntervals[0].offeredEndMeters);
  assert.ok(result.overlapIntervals[0].requesterStartMeters <= result.overlapIntervals[0].requesterEndMeters);
});

test('reverse traversal is treated as a direction mismatch rather than a supported shared corridor', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.12, 0]),
    requesterRouteShape: line([0.12, 0], [0, 0]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.classification, 'reverse_traversal');
  assert.ok(result.totalSharedLengthMeters > 0);
  assert.equal(result.authorizesAdmission, false);
});

test('partial overlap with different origins and destinations is retained as a measured interval on both routes', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.2, 0]),
    requesterRouteShape: line([0.08, 0], [0.18, 0]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.classification, 'possible_shared_section');
  assert.equal(result.overlapIntervals.length, 1);
  assert.ok(result.overlapIntervals[0].sharedLengthMeters > 0);
  assert.ok(result.overlapIntervals[0].offeredStartMeters < result.overlapIntervals[0].offeredEndMeters);
  assert.ok(result.overlapIntervals[0].requesterStartMeters < result.overlapIntervals[0].requesterEndMeters);
});

test('genuinely separate corridors remain non-overlap evidence, not a merged shared corridor', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.12, 0]),
    requesterRouteShape: line([0, 0.002], [0.12, 0.002]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.classification, 'no_observed_overlap');
  assert.equal(result.hasPotentialOverlap, false);
  assert.equal(result.totalSharedLengthMeters, 0);
});

test('an abrupt route jump away from the corridor keeps the valid initial shared interval without merging across the divergence', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.12, 0]),
    requesterRouteShape: line([0.01, 0], [0.03, 0], [0.13, 0.1], [0.16, 0.1]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.classification, 'possible_shared_section');
  assert.ok(result.hasPotentialOverlap);
  assert.equal(result.confirmsUsableSharedSegment, false);
  assert.equal(result.authorizesAdmission, false);
  assert.equal(result.overlapIntervals.length, 1);
  assert.ok(result.overlapIntervals[0].sharedLengthMeters > 0);
  assert.ok(result.overlapIntervals[0].sharedLengthMeters < 5000);
});

test('repeated requester traversal on the same offered corridor is not merged into one continuous shared interval', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.12, 0]),
    requesterRouteShape: line([0.01, 0], [0.03, 0], [0.1, 0], [0.12, 0], [0.02, 0], [0.04, 0]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.ok(result.classification === 'ambiguous_loop' || result.classification === 'possible_shared_section');
  assert.ok(result.overlapIntervals.length > 1 || result.notes.some(part => part.includes('Multiple candidate overlap intervals')));
  assert.equal(result.confirmsUsableSharedSegment, false);
  assert.equal(result.authorizesAdmission, false);
});

test('opposing direction across an apparent shared section is not accepted as a supported corridor', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.15, 0]),
    requesterRouteShape: line([0.15, 0], [0, 0]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.classification, 'reverse_traversal');
  assert.ok(result.overlapIntervals[0].directionality === 'reverse_direction');
});

test('loops and repeated roads are left conservative and ambiguous', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.08, 0], [0.04, 0], [0.08, 0]),
    requesterRouteShape: line([0.02, 0], [0.06, 0]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.classification, 'ambiguous_loop');
  assert.ok(result.overlapIntervals.length > 1 || result.notes.some(part => part.includes('Multiple candidate overlap intervals')));
});

test('self-intersections remain conservative rather than a confirmed corridor', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.06, 0], [0.03, 0], [0.06, 0]),
    requesterRouteShape: line([0.01, 0], [0.07, 0]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.ok(result.hasPotentialOverlap);
  assert.equal(result.confirmsUsableSharedSegment, false);
  assert.equal(result.authorizesAdmission, false);
});

test('near-parallel roads are not reported as disconnected roads; the prototype only reports no observed overlap', () => {
  const result = assessTwoRouteOverlap({
    offeredRouteShape: line([0, 0], [0.2, 0]),
    requesterRouteShape: line([0, 0.002], [0.2, 0.002]),
    comparisonToleranceMeters: 5,
    sampleSpacingMeters: 5,
  });

  assert.equal(result.classification, 'no_observed_overlap');
  assert.equal(result.hasPotentialOverlap, false);
  assert.equal(result.totalSharedLengthMeters, 0);
  assert.equal(result.notes[0].includes('No near-coincident route geometry'), true);
});

test('zero-length geometry fails closed before advisory analysis', () => {
  assert.throws(
    () => assessTwoRouteOverlap({
      offeredRouteShape: line([0, 0], [0, 0]),
      requesterRouteShape: line([0, 0], [0.1, 0]),
    }),
    /Invalid route overlap input/,
  );
});

test('invalid shapes fail closed before advisory analysis', () => {
  assert.throws(
    () => assessTwoRouteOverlap({
      offeredRouteShape: { type: 'LineString', coordinates: [[0, 0], [181, 0]] },
      requesterRouteShape: line([0, 0], [0.1, 0]),
    }),
    /Invalid route overlap input/,
  );

  assert.throws(
    () => assessTwoRouteOverlap({
      offeredRouteShape: line([0, 0], [0.1, 0]),
      requesterRouteShape: { type: 'LineString', coordinates: [[0, 0], [NaN, 0]] },
    }),
    /Invalid route overlap input/,
  );
});

test('routes with a large segment length fail before sample allocation grows past the experimental budget', () => {
  assert.throws(
    () => assessTwoRouteOverlap({
      offeredRouteShape: line([0, 0], [179, 0]),
      requesterRouteShape: line([0, 0], [0.1, 0]),
      sampleSpacingMeters: 1,
    }),
    /exceeds supported experimental sampling budget/,
  );
});

test('excessive route coordinates and work budgets are rejected before the prototype runs', () => {
  const excessiveVertices = Array.from({ length: 2001 }, (_, index) => [index / 10, 0]);
  assert.throws(
    () => assessTwoRouteOverlap({
      offeredRouteShape: { type: 'LineString', coordinates: excessiveVertices },
      requesterRouteShape: line([0, 0], [0.1, 0]),
    }),
    /exceeds supported experimental/,
  );
});
