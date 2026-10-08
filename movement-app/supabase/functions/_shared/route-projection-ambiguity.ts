import {
  calculateTrustedRouteMatchGeometry,
  calculateTrustedRoutePointSegmentProjections,
  type TrustedRouteMatchLineString,
} from './route-match-geometry.ts';
import type { TrustedRouteCoordinate } from './route-contracts.ts';

/**
 * Advisory geometric ambiguity, NOT a valid pickup, suitability, or admission
 * decision. Two meters is a numerical proximity tolerance for essentially
 * equal projections, not a maximum detour or member eligibility threshold.
 */
export const PROJECTION_AMBIGUITY_VERSION = 'route_projection_ambiguity_v0';
const EQUIVALENT_DISTANCE_TOLERANCE_METERS = 2;
const DISTINCT_ROUTE_POSITION_METERS = 2;

export interface RouteProjectionAmbiguity {
  version: typeof PROJECTION_AMBIGUITY_VERSION;
  hasMultipleRoutePositions: boolean;
  plausiblePositionsAlongRouteMeters: number[];
  minimumDistanceToRouteMeters: number;
  confirmsUsableSharedSegment: false;
  authorizesAdmission: false;
}

/**
 * Compare every constituent segment using the EXISTING trusted geometry
 * producer, rather than adding a second projection calculation.
 *
 * Adjacent segments sharing a vertex produce the same cumulative position,
 * which is correctly deduplicated; revisits later in the itinerary are not.
 * This detects near-equal projections, not every possibly negotiable pickup.
 */
export function assessRouteProjectionAmbiguity(
  point: TrustedRouteCoordinate,
  routeShape: TrustedRouteMatchLineString,
): RouteProjectionAmbiguity {
  const coordinates = routeShape?.coordinates;
  if (routeShape?.type !== 'LineString'
    || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('Invalid route-projection ambiguity input');
  }

  // Validate the whole route, including any degenerate segments.
  calculateTrustedRouteMatchGeometry({
    requesterOrigin: point,
    requesterDestination: point,
    routeShape,
  });

  const candidates = calculateTrustedRoutePointSegmentProjections(point, routeShape)
    .map(projection => ({
      distance: projection.distanceToRouteMeters,
      position: projection.positionAlongRouteMeters,
    }));

  // Avoid spreading route-sized arrays as function arguments; sufficiently
  // detailed routes can otherwise exceed JavaScript argument limits.
  let nearest = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.distance < nearest) nearest = candidate.distance;
  }
  const positions = candidates
    .filter(x => x.distance <= nearest + EQUIVALENT_DISTANCE_TOLERANCE_METERS)
    .map(x => x.position)
    .sort((a, b) => a - b);

  const distinct: number[] = [];
  for (const position of positions) {
    if (distinct.length === 0
      || position - distinct[distinct.length - 1] > DISTINCT_ROUTE_POSITION_METERS) {
      distinct.push(position);
    }
  }

  return {
    version: PROJECTION_AMBIGUITY_VERSION,
    hasMultipleRoutePositions: distinct.length > 1,
    plausiblePositionsAlongRouteMeters: distinct,
    minimumDistanceToRouteMeters: nearest,
    confirmsUsableSharedSegment: false,
    authorizesAdmission: false,
  };
}
