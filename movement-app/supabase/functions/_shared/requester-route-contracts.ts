import type { RouteProviderQuotaResult } from './route-contracts.ts';
import type { MapboxDirectionsResult, TrustedRouteCoordinate } from './mapbox-directions-provider.ts';
import { MAPBOX_DIRECTIONS_NAMESPACE, MAPBOX_DIRECTIONS_PRODUCT, MAPBOX_DIRECTIONS_PROVIDER_VERSION } from './mapbox-directions-provider.ts';

// One private provider-derived automotive-road-network reference path between
// trusted endpoints, used only as compatibility support geometry. The requester
// need not drive or follow it. Non-overlap alone cannot establish incompatibility.
export const REQUESTER_ROUTE_CONTRACT = Object.freeze({
  providerNamespace: MAPBOX_DIRECTIONS_NAMESPACE,
  providerProduct: MAPBOX_DIRECTIONS_PRODUCT,
  providerVersion: MAPBOX_DIRECTIONS_PROVIDER_VERSION,
  evidenceSchemaVersion: 'requester_route_evidence_v1',
  routeShapeFormat: 'geojson_linestring_v1',
});
export const REQUESTER_ROUTE_MAX_POINTS = 2000; // Computational envelope, never eligibility.
export const REQUESTER_ENDPOINT_EQUIVALENCE_METERS = 2; // Numerical equivalence only.
export type RequesterClaim =
  | { state: 'reuse_existing'; evidenceId: string; evidenceVersion: number }
  | { state: 'in_progress'; retryAfterSeconds: number }
  | { state: 'claimed'; token: string; originId: string; destinationId: string; leaseExpiresAt: string };
export interface RequesterGenerationContext {
  movementNeedId: string; memberId: string; originId: string; destinationId: string;
  origin: TrustedRouteCoordinate; destination: TrustedRouteCoordinate;
  claimedAt: string; leaseExpiresAt: string; serverObservedAt: string;
  earliestGeneratedAt: string; movementNeedDeadline: string; evidenceExpiresAt: string;
}
export interface RequesterPublication {
  movementNeedId: string; memberId: string; token: string; originId: string; destinationId: string;
  providerNamespace: string; providerProduct: string; providerVersion: string;
  evidenceSchemaVersion: string; routeShapeFormat: string; providerRouteReference: string;
  routeShape: { type: 'LineString'; coordinates: number[][] };
  routeDistanceMeters: number; routeDurationSeconds: number; generatedAt: string; expiresAt: string;
}
export interface RequesterPublished {
  state: 'published' | 'reuse_existing'; evidenceId: string; evidenceVersion: number;
}
export interface RequesterRouteBackend {
  authenticate(jwt: string, signal: AbortSignal): Promise<string | null>;
  memberExists(memberId: string, signal: AbortSignal): Promise<boolean>;
  isCurrentNeed(jwt: string, movementNeedId: string, signal: AbortSignal): Promise<boolean>;
  claim(needId: string, memberId: string, signal: AbortSignal): Promise<RequesterClaim>;
  context(needId: string, memberId: string, token: string, signal: AbortSignal): Promise<RequesterGenerationContext>;
  consumeRouteProviderQuota(memberId: string, signal: AbortSignal): Promise<RouteProviderQuotaResult>;
  publish(input: Readonly<RequesterPublication>, signal: AbortSignal): Promise<RequesterPublished>;
}
export interface RequesterRouteProvider {
  isAvailable(): boolean;
  route(input: { origin: TrustedRouteCoordinate; destination: TrustedRouteCoordinate }, signal: AbortSignal): Promise<MapboxDirectionsResult>;
}
