import type {
  TrustedRouteMatchGeometry,
} from './route-match-geometry.ts';

/**
 * Advisory route-projection analysis only. This is NOT an eligibility,
 * admission, road-accessibility, or human-consent decision.
 *
 * Version deliberately separate from the trusted geometry evidence version.
 */
export const ROUTE_SEGMENT_ASSESSMENT_VERSION =
  'route_segment_assessment_v0';

export type RouteSegmentProjectionClassification =
  | 'forward_projection_candidate'
  | 'needs_coordination';

export type RouteSegmentProjectionReason =
  | 'ordered_projection_unverified'
  | 'reverse_projection'
  | 'same_position';

export interface RouteSegmentProjectionAssessment {
  assessmentVersion: typeof ROUTE_SEGMENT_ASSESSMENT_VERSION;
  classification: RouteSegmentProjectionClassification;
  reason: RouteSegmentProjectionReason;
  projectedSharedLengthMeters: number;
  /** Always false until independent topology, boarding and policy checks exist. */
  confirmsUsableSharedSegment: false;
  /** This module never makes an admission decision. */
  authorizesAdmission: false;
}

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max;
}

function validRoutePoint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const point = value as { latitude?: unknown; longitude?: unknown };
  return validCoordinate(point.latitude, -90, 90)
    && validCoordinate(point.longitude, -180, 180);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

/**
 * Accepts only already-produced trusted geometry, not arbitrary client input.
 * The caller is responsible for provenance and current-evidence validation.
 *
 * A forward nearest-point ordering is a *candidate*, not proof that multiple
 * loop/parallel-road projections have been disambiguated or boarding is legal.
 */
export function assessRouteSegmentProjection(
  geometry: TrustedRouteMatchGeometry,
): RouteSegmentProjectionAssessment {
  if (
    geometry?.algorithmVersion !== 'route_match_geometry_v1'
    || !nonnegativeInteger(geometry.calculatedRouteShapeLengthMeters)
    || geometry.calculatedRouteShapeLengthMeters === 0
    || !nonnegativeInteger(geometry.requesterOrigin?.distanceToRouteMeters)
    || !nonnegativeInteger(geometry.requesterDestination?.distanceToRouteMeters)
    || !nonnegativeInteger(geometry.requesterOrigin?.positionAlongRouteMeters)
    || !nonnegativeInteger(geometry.requesterDestination?.positionAlongRouteMeters)
    || !validRoutePoint(geometry.requesterOrigin?.closestRoutePoint)
    || !validRoutePoint(geometry.requesterDestination?.closestRoutePoint)
    || geometry.requesterOrigin.positionAlongRouteMeters
      > geometry.calculatedRouteShapeLengthMeters
    || geometry.requesterDestination.positionAlongRouteMeters
      > geometry.calculatedRouteShapeLengthMeters
  ) {
    throw new Error('Invalid trusted route-segment assessment input');
  }

  const distance =
    geometry.requesterDestination.positionAlongRouteMeters
    - geometry.requesterOrigin.positionAlongRouteMeters;

  let reason: RouteSegmentProjectionReason;
  let classification: RouteSegmentProjectionClassification;

  if (distance < 0) {
    classification = 'needs_coordination';
    reason = 'reverse_projection';
  } else if (distance === 0) {
    classification = 'needs_coordination';
    reason = 'same_position';
  } else {
    classification = 'forward_projection_candidate';
    reason = 'ordered_projection_unverified';
  }

  return {
    assessmentVersion: ROUTE_SEGMENT_ASSESSMENT_VERSION,
    classification,
    reason,
    projectedSharedLengthMeters: Math.max(0, distance),
    confirmsUsableSharedSegment: false,
    authorizesAdmission: false,
  };
}
