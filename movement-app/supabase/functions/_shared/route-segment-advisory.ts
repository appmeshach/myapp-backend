import type { TrustedRouteCoordinate } from './route-contracts.ts';
import {
  calculateTrustedRouteMatchGeometry,
  type TrustedRouteMatchLineString,
} from './route-match-geometry.ts';
import {
  assessRouteProjectionAmbiguity,
  type RouteProjectionAmbiguity,
} from './route-projection-ambiguity.ts';
import {
  assessRouteSegmentProjection,
  type RouteSegmentProjectionAssessment,
} from './route-segment-assessment.ts';

export const ROUTE_SEGMENT_ADVISORY_VERSION = 'route_segment_advisory_v0';

export interface RouteSegmentAdvisory {
  version: typeof ROUTE_SEGMENT_ADVISORY_VERSION;
  projection: RouteSegmentProjectionAssessment;
  originAmbiguity: RouteProjectionAmbiguity;
  destinationAmbiguity: RouteProjectionAmbiguity;
  classification: 'forward_projection_candidate' | 'needs_coordination';
  reason: 'ordered_projection_unverified' | 'reverse_projection'
    | 'same_position' | 'multiple_route_positions';
  confirmsUsableSharedSegment: false;
  authorizesAdmission: false;
}

/**
 * Trusted-server-only advisory. Accept full trusted route shape and requester
 * endpoints. Do not return this record directly from public discovery APIs:
 * it contains protected requester destination geometry.
 *
 * This does not validate provider evidence provenance/currentness, pickup
 * legality, permission, timing, occupancy, or accepted journey lifecycle.
 */
export function assessTrustedRouteSegmentAdvisory(input: {
  requesterOrigin: TrustedRouteCoordinate;
  requesterDestination: TrustedRouteCoordinate;
  routeShape: TrustedRouteMatchLineString;
}): RouteSegmentAdvisory {
  const geometry = calculateTrustedRouteMatchGeometry(input);
  const projection = assessRouteSegmentProjection(geometry);
  const originAmbiguity = assessRouteProjectionAmbiguity(
    input.requesterOrigin, input.routeShape,
  );
  const destinationAmbiguity = assessRouteProjectionAmbiguity(
    input.requesterDestination, input.routeShape,
  );
  const ambiguous = originAmbiguity.hasMultipleRoutePositions
    || destinationAmbiguity.hasMultipleRoutePositions;

  return {
    version: ROUTE_SEGMENT_ADVISORY_VERSION,
    projection,
    originAmbiguity,
    destinationAmbiguity,
    classification: ambiguous ? 'needs_coordination' : projection.classification,
    reason: ambiguous ? 'multiple_route_positions' : projection.reason,
    confirmsUsableSharedSegment: false,
    authorizesAdmission: false,
  };
}
