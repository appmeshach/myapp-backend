import type { TrustedRouteCoordinate } from './route-contracts.ts';
import {
  calculateTrustedRoutePointSegmentProjections,
  type TrustedRouteMatchLineString,
} from './route-match-geometry.ts';

export const ROUTE_TWO_ROUTE_OVERLAP_VERSION = 'route_two_route_overlap_v0';

const DEFAULT_COMPARISON_TOLERANCE_METERS = 5;
const DEFAULT_SAMPLE_SPACING_METERS = 5;
const MAX_ROUTE_COORDINATES = 2000;
const MAX_SAMPLES_PER_ROUTE = 50000;
const MAX_SUPPORTING_PROJECTIONS = 50_000_000;
const CONTINUITY_GAP_TOLERANCE_FACTOR = 2.5;

// Experimental complexity: each sample on one route is projected against the other route's trusted geometry,
// so the practical work is O(Pa * Pb) in sample counts. These budgets are defensive limits for the prototype
// and are not Movement policies, detour thresholds or authorization criteria.

export type RouteOverlapDirectionality =
  | 'same_direction'
  | 'reverse_direction'
  | 'ambiguous';

export interface RouteOverlapInterval {
  offeredStartMeters: number;
  offeredEndMeters: number;
  requesterStartMeters: number;
  requesterEndMeters: number;
  sharedLengthMeters: number;
  directionality: RouteOverlapDirectionality;
  notes: string[];
}

export interface TwoRouteOverlapAssessment {
  version: typeof ROUTE_TWO_ROUTE_OVERLAP_VERSION;
  hasPotentialOverlap: boolean;
  classification:
    | 'possible_shared_section'
    | 'needs_coordination'
    | 'reverse_traversal'
    | 'no_observed_overlap'
    | 'ambiguous_loop';
  overlapIntervals: RouteOverlapInterval[];
  totalSharedLengthMeters: number;
  comparisonToleranceMeters: number;
  notes: string[];
  limitations: string[];
  confirmsUsableSharedSegment: false;
  authorizesAdmission: false;
}

type CandidateInterval = RouteOverlapInterval & {
  supportingSampleCount: number;
};

function validCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function normalizeLineString(shape: unknown): TrustedRouteMatchLineString {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
    throw new Error('Invalid route overlap input');
  }

  const candidate = shape as {
    type?: unknown;
    coordinates?: unknown;
  };

  if (candidate.type !== 'LineString' || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) {
    throw new Error('Invalid route overlap input');
  }

  if (candidate.coordinates.length > MAX_ROUTE_COORDINATES) {
    throw new Error('Route overlap input exceeds supported experimental coordinate budget');
  }

  for (const point of candidate.coordinates) {
    if (!Array.isArray(point) || point.length !== 2
      || !validCoordinate(point[0], -180, 180)
      || !validCoordinate(point[1], -90, 90)) {
      throw new Error('Invalid route overlap input');
    }
  }

  return {
    type: 'LineString',
    coordinates: candidate.coordinates as number[][],
  };
}

function distanceMeters(first: TrustedRouteCoordinate, second: TrustedRouteCoordinate): number {
  const earthRadiusMeters = 6_371_008.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const latitudeDifference = toRadians(second.latitude - first.latitude);
  const longitudeDifference = toRadians(second.longitude - first.longitude);
  const latitude1 = toRadians(first.latitude);
  const latitude2 = toRadians(second.latitude);

  const haversine =
    Math.sin(latitudeDifference / 2) * Math.sin(latitudeDifference / 2)
    + Math.cos(latitude1)
      * Math.cos(latitude2)
      * Math.sin(longitudeDifference / 2)
      * Math.sin(longitudeDifference / 2);

  const centralAngle = 2 * Math.atan2(
    Math.sqrt(Math.max(0, haversine)),
    Math.sqrt(Math.max(0, 1 - Math.min(1, haversine))),
  );

  return earthRadiusMeters * centralAngle;
}

function interpolatePoint(start: TrustedRouteCoordinate, end: TrustedRouteCoordinate, fraction: number): TrustedRouteCoordinate {
  const clamped = Math.min(1, Math.max(0, fraction));
  return {
    latitude: start.latitude + (end.latitude - start.latitude) * clamped,
    longitude: start.longitude + (end.longitude - start.longitude) * clamped,
  };
}

function routeLengthMeters(shape: TrustedRouteMatchLineString): number {
  const coordinates = shape.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }));
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    total += distanceMeters(coordinates[index], coordinates[index + 1]);
  }
  return total;
}

function sampleRoute(shape: TrustedRouteMatchLineString, sampleSpacingMeters: number): Array<{ point: TrustedRouteCoordinate; cumulativeMeters: number }> {
  const coordinates = shape.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }));
  const totalLength = routeLengthMeters(shape);
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    throw new Error('Invalid route overlap input');
  }

  let estimatedSampleCount = 1;
  let cumulativeMeters = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const segmentLength = distanceMeters(start, end);
    const stepCount = Math.max(1, Math.ceil(segmentLength / Math.max(1, sampleSpacingMeters)));
    estimatedSampleCount += stepCount;
    cumulativeMeters = cumulativeMeters + segmentLength;
  }

  if (estimatedSampleCount > MAX_SAMPLES_PER_ROUTE) {
    throw new Error('Route overlap input exceeds supported experimental sampling budget');
  }

  const samples: Array<{ point: TrustedRouteCoordinate; cumulativeMeters: number }> = [{ point: coordinates[0], cumulativeMeters: 0 }];
  cumulativeMeters = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const segmentLength = distanceMeters(start, end);
    const segmentStartMeters = cumulativeMeters;
    const stepCount = Math.max(1, Math.ceil(segmentLength / Math.max(1, sampleSpacingMeters)));

    for (let step = 1; step <= stepCount; step += 1) {
      const fraction = step / stepCount;
      const point = interpolatePoint(start, end, fraction);
      const position = segmentStartMeters + segmentLength * fraction;
      samples.push({ point, cumulativeMeters: position });
    }

    cumulativeMeters = segmentStartMeters + segmentLength;
  }

  const finalPoint = coordinates[coordinates.length - 1];
  if (samples[samples.length - 1]?.point.latitude !== finalPoint.latitude
    || samples[samples.length - 1]?.point.longitude !== finalPoint.longitude) {
    samples.push({ point: finalPoint, cumulativeMeters: totalLength });
  }

  return samples;
}

function directionHeading(vector: TrustedRouteCoordinate): number | null {
  if (Math.abs(vector.latitude) < 1e-12 && Math.abs(vector.longitude) < 1e-12) {
    return null;
  }

  return Math.atan2(vector.longitude, vector.latitude);
}

function routeDirectionAt(shape: TrustedRouteMatchLineString, positionMeters: number): TrustedRouteCoordinate {
  const coordinates = shape.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }));
  if (coordinates.length < 2) {
    return { latitude: 0, longitude: 0 };
  }

  let cumulative = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const segmentLength = distanceMeters(start, end);
    if (segmentLength <= 1e-9) {
      cumulative += segmentLength;
      continue;
    }

    if (positionMeters <= cumulative + segmentLength) {
      const fraction = (positionMeters - cumulative) / segmentLength;
      const localEnd = interpolatePoint(start, end, Math.min(1, Math.max(0, fraction + 0.01)));
      return {
        latitude: localEnd.latitude - start.latitude,
        longitude: localEnd.longitude - start.longitude,
      };
    }

    cumulative += segmentLength;
  }

  const last = coordinates[coordinates.length - 1];
  const previous = coordinates[coordinates.length - 2];
  return {
    latitude: last.latitude - previous.latitude,
    longitude: last.longitude - previous.longitude,
  };
}

function directionCompatibility(first: TrustedRouteCoordinate, second: TrustedRouteCoordinate): RouteOverlapDirectionality {
  const firstHeading = directionHeading(first);
  const secondHeading = directionHeading(second);

  if (firstHeading === null || secondHeading === null) {
    return 'ambiguous';
  }

  const difference = Math.abs((((firstHeading - secondHeading + Math.PI) % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2) - Math.PI);

  if (difference <= 0.55) {
    return 'same_direction';
  }
  if (difference >= 2.6) {
    return 'reverse_direction';
  }
  return 'ambiguous';
}

function buildCandidateIntervals(
  projections: Array<{ offeredPosition: number; requesterPosition: number; distance: number }>,
  offeredLabel: string,
  requesterLabel: string,
  toleranceMeters: number,
): CandidateInterval[] {
  if (projections.length === 0) {
    return [];
  }

  const sorted = [...projections].sort((left, right) => left.offeredPosition - right.offeredPosition);
  const intervals: CandidateInterval[] = [];
  let currentStart = sorted[0];
  let currentEnd = sorted[0];
  let currentSampleCount = 1;
  let lastRequesterDelta: number | null = null;

  for (let index = 1; index < sorted.length; index += 1) {
    const item = sorted[index];
    const offeredGap = item.offeredPosition - currentEnd.offeredPosition;
    const requesterGap = item.requesterPosition - currentEnd.requesterPosition;
    const requesterJump = Math.abs(requesterGap);
    const sameRequesterTrend = lastRequesterDelta === null || requesterGap * lastRequesterDelta >= 0;
    const offeredProgression = offeredGap >= -Math.max(toleranceMeters * 2, 25);
    const requesterContinuity = requesterJump <= Math.max(toleranceMeters * 4, 25);
    const offeredContinuity = offeredGap <= toleranceMeters * 1.5;

    if (offeredProgression && offeredContinuity && requesterContinuity && sameRequesterTrend) {
      currentEnd = item;
      currentSampleCount += 1;
      lastRequesterDelta = requesterGap;
      continue;
    }

    const segment: CandidateInterval = {
      offeredStartMeters: currentStart.offeredPosition,
      offeredEndMeters: currentEnd.offeredPosition,
      requesterStartMeters: Math.min(currentStart.requesterPosition, currentEnd.requesterPosition),
      requesterEndMeters: Math.max(currentStart.requesterPosition, currentEnd.requesterPosition),
      sharedLengthMeters: Math.max(0, currentEnd.offeredPosition - currentStart.offeredPosition),
      directionality: 'ambiguous',
      notes: [
        `${offeredLabel} and ${requesterLabel} remain within ${toleranceMeters}m over a contiguous measured interval.`,
      ],
      supportingSampleCount: currentSampleCount,
    };

    if (segment.sharedLengthMeters > 0) {
      intervals.push(segment);
    }

    currentStart = item;
    currentEnd = item;
    currentSampleCount = 1;
    lastRequesterDelta = null;
  }

  const finalSegment: CandidateInterval = {
    offeredStartMeters: currentStart.offeredPosition,
    offeredEndMeters: currentEnd.offeredPosition,
    requesterStartMeters: Math.min(currentStart.requesterPosition, currentEnd.requesterPosition),
    requesterEndMeters: Math.max(currentStart.requesterPosition, currentEnd.requesterPosition),
    sharedLengthMeters: Math.max(0, currentEnd.offeredPosition - currentStart.offeredPosition),
    directionality: 'ambiguous',
    notes: [
      `${offeredLabel} and ${requesterLabel} remain within ${toleranceMeters}m over a contiguous measured interval.`,
    ],
    supportingSampleCount: currentSampleCount,
  };

  if (finalSegment.sharedLengthMeters > 0) {
    intervals.push(finalSegment);
  }

  return intervals;
}

function mergeIntervalCandidates(intervals: CandidateInterval[], continuityWindowMeters: number): CandidateInterval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort((left, right) => left.offeredStartMeters - right.offeredStartMeters);
  const merged: CandidateInterval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...interval });
      continue;
    }

    const offeredGap = Math.max(0, interval.offeredStartMeters - last.offeredEndMeters);
    const requesterGap = Math.max(0, interval.requesterStartMeters - last.requesterEndMeters);
    const sameDirectionCompatible = last.directionality !== 'reverse_direction'
      && interval.directionality !== 'reverse_direction'
      && (last.directionality === 'ambiguous'
        || interval.directionality === 'ambiguous'
        || last.directionality === interval.directionality);

    if (sameDirectionCompatible && offeredGap <= continuityWindowMeters && requesterGap <= continuityWindowMeters) {
      last.offeredStartMeters = Math.min(last.offeredStartMeters, interval.offeredStartMeters);
      last.offeredEndMeters = Math.max(last.offeredEndMeters, interval.offeredEndMeters);
      last.requesterStartMeters = Math.min(last.requesterStartMeters, interval.requesterStartMeters);
      last.requesterEndMeters = Math.max(last.requesterEndMeters, interval.requesterEndMeters);
      last.sharedLengthMeters = Math.max(0, last.offeredEndMeters - last.offeredStartMeters);
      // Experimental support count only. It is not a Movement policy or an authorization signal.
      last.supportingSampleCount = last.supportingSampleCount + interval.supportingSampleCount;
      last.notes = [...new Set([...last.notes, ...interval.notes])];
      continue;
    }

    merged.push({ ...interval });
  }

  return merged;
}

export function assessTwoRouteOverlap(input: {
  offeredRouteShape: TrustedRouteMatchLineString;
  requesterRouteShape: TrustedRouteMatchLineString;
  comparisonToleranceMeters?: number;
  sampleSpacingMeters?: number;
}): TwoRouteOverlapAssessment {
  const offeredRouteShape = normalizeLineString(input.offeredRouteShape);
  const requesterRouteShape = normalizeLineString(input.requesterRouteShape);

  const comparisonToleranceMeters = Number.isFinite(input.comparisonToleranceMeters)
    ? Math.max(0, input.comparisonToleranceMeters as number)
    : DEFAULT_COMPARISON_TOLERANCE_METERS;

  const sampleSpacingMeters = Number.isFinite(input.sampleSpacingMeters)
    ? Math.max(5, input.sampleSpacingMeters as number)
    : DEFAULT_SAMPLE_SPACING_METERS;

  const offeredSamples = sampleRoute(offeredRouteShape, sampleSpacingMeters);
  const requesterSamples = sampleRoute(requesterRouteShape, sampleSpacingMeters);

  if (offeredSamples.length > MAX_SAMPLES_PER_ROUTE || requesterSamples.length > MAX_SAMPLES_PER_ROUTE) {
    throw new Error('Route overlap input exceeds supported experimental sampling budget');
  }

  if (offeredSamples.length * requesterSamples.length > MAX_SUPPORTING_PROJECTIONS) {
    throw new Error('Route overlap input exceeds supported experimental work budget');
  }

  const offeredToRequester: Array<{ offeredPosition: number; requesterPosition: number; distance: number }> = [];
  for (const sample of offeredSamples) {
    const candidates = calculateTrustedRoutePointSegmentProjections(sample.point, requesterRouteShape);
    const nearest = candidates.reduce((best, candidate) => {
      return candidate.distanceToRouteMeters < best.distanceToRouteMeters ? candidate : best;
    }, { distanceToRouteMeters: Number.POSITIVE_INFINITY, positionAlongRouteMeters: 0 });

    if (nearest.distanceToRouteMeters <= comparisonToleranceMeters) {
      offeredToRequester.push({
        offeredPosition: sample.cumulativeMeters,
        requesterPosition: nearest.positionAlongRouteMeters,
        distance: nearest.distanceToRouteMeters,
      });
    }
  }

  const requesterToOffered: Array<{ offeredPosition: number; requesterPosition: number; distance: number }> = [];
  for (const sample of requesterSamples) {
    const candidates = calculateTrustedRoutePointSegmentProjections(sample.point, offeredRouteShape);
    const nearest = candidates.reduce((best, candidate) => {
      return candidate.distanceToRouteMeters < best.distanceToRouteMeters ? candidate : best;
    }, { distanceToRouteMeters: Number.POSITIVE_INFINITY, positionAlongRouteMeters: 0 });

    if (nearest.distanceToRouteMeters <= comparisonToleranceMeters) {
      requesterToOffered.push({
        offeredPosition: nearest.positionAlongRouteMeters,
        requesterPosition: sample.cumulativeMeters,
        distance: nearest.distanceToRouteMeters,
      });
    }
  }

  const intervals = buildCandidateIntervals(
    offeredToRequester,
    'offered route',
    'requester route',
    comparisonToleranceMeters,
  );
  const reciprocalIntervals = buildCandidateIntervals(
    requesterToOffered,
    'requester route',
    'offered route',
    comparisonToleranceMeters,
  );

  const continuityWindowMeters = Math.max(
    comparisonToleranceMeters * CONTINUITY_GAP_TOLERANCE_FACTOR,
    sampleSpacingMeters * 2,
  );

  const minSupportPoints = Math.max(3, Math.ceil(continuityWindowMeters / Math.max(sampleSpacingMeters, 1)));

  const mergedIntervals = mergeIntervalCandidates(
    [...intervals, ...reciprocalIntervals].filter(interval => interval.sharedLengthMeters > 0),
    continuityWindowMeters,
  )
    .filter(interval => interval.supportingSampleCount >= minSupportPoints)
    .map((interval) => {
      const routeADirection = routeDirectionAt(offeredRouteShape, (interval.offeredStartMeters + interval.offeredEndMeters) / 2);
      const routeBDirection = routeDirectionAt(requesterRouteShape, (interval.requesterStartMeters + interval.requesterEndMeters) / 2);
      const directionality = directionCompatibility(routeADirection, routeBDirection);
      return {
        ...interval,
        directionality,
        notes: [
          ...interval.notes,
          directionality === 'same_direction'
            ? 'Same-direction geometry is consistent with a shared corridor candidate, but not proof of legal access or pickup.'
            : directionality === 'reverse_direction'
              ? 'Reverse traversal indicates opposite travel direction; this is not a supported forward shared section.'
              : 'Directionality is not unique enough to label a clean same-direction or reverse corridor.',
        ],
      };
    });

  const totalSharedLengthMeters = mergedIntervals.reduce((sum, interval) => sum + interval.sharedLengthMeters, 0);
  let classification: TwoRouteOverlapAssessment['classification'] = 'no_observed_overlap';
  let notes: string[] = [
    'No near-coincident route geometry was observed within the experimental tolerance.',
    'This prototype only estimates geometric closeness and cannot prove road identity, access or pickup legality.',
  ];

  if (mergedIntervals.length > 0) {
    if (mergedIntervals.length > 1) {
      classification = 'ambiguous_loop';
      notes = [
        'Multiple candidate overlap intervals were detected. This can occur with loops, repeated segments, or self-intersections.',
        'The geometry is not sufficient to assign a confirmed or legal shared-road identity.',
      ];
    } else {
      const interval = mergedIntervals[0];
      if (interval.directionality === 'reverse_direction') {
        classification = 'reverse_traversal';
        notes = [
          'Only reverse-direction overlap was found. This is not a supported forward shared section.',
        ];
      } else if (interval.directionality === 'same_direction') {
        classification = 'possible_shared_section';
        notes = [
          'A same-direction geometric overlap candidate exists, but it remains an advisory-only and non-authoritative shared-road estimate.',
        ];
      } else {
        classification = 'needs_coordination';
        notes = [
          'The geometry is close enough to merit coordination, but not enough to prove a genuine shared corridor or accessible pickup point.',
        ];
      }
    }
  }

  return {
    version: ROUTE_TWO_ROUTE_OVERLAP_VERSION,
    hasPotentialOverlap: mergedIntervals.length > 0,
    classification,
    overlapIntervals: mergedIntervals,
    totalSharedLengthMeters,
    comparisonToleranceMeters,
    notes,
    limitations: [
      'This prototype compares only route geometry; it does not establish road-network connectivity, legal pickup rights, or actual shared road identity.',
      'A nearby but disconnected carriageway can still appear close within a small geodesic tolerance, and geometry alone cannot prove disconnection or access.',
      'Loops, repeated roads and self-intersections can generate multiple candidate intervals and require conservative handling.',
      'No universal detour threshold or member eligibility rule is implied by this experimental comparison.',
    ],
    confirmsUsableSharedSegment: false,
    authorizesAdmission: false,
  };
}
