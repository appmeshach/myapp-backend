export interface TrustedRouteCoordinate {
  latitude: number;
  longitude: number;
}

export interface RouteGenerationContext {
  offeringMovementIntentId: string;
  offeringMemberId: string;

  originLocationReferenceId: string;
  origin: TrustedRouteCoordinate;

  destinationLocationReferenceId: string;
  destination: TrustedRouteCoordinate;
}

export interface TrustedMatchingContext {
  movementNeedId: string;
  requestingMemberId: string;

  requesterOriginLocationReferenceId: string;
  requesterOrigin: TrustedRouteCoordinate;

  requesterDestinationLocationReferenceId: string;
  requesterDestination: TrustedRouteCoordinate;

  requesterEarliestDepartureAt: string;
  requesterLatestDepartureAt: string | null;

  offeringMovementIntentId: string;
  offeringMemberId: string;
  offeringIntentVersion: number;

  offeringEarliestDepartureAt: string;
  offeringLatestDepartureAt: string | null;

  routeEvidenceId: string;
  routeEvidenceVersion: number;

  routeShapeFormat:
    'geojson_linestring_v1';

  routeShape: {
    type: 'LineString';
    coordinates: number[][];
  };

  routeDistanceMeters: number;
  routeDurationSeconds: number;

  routeGeneratedAt: string;
  routeExpiresAt: string | null;
}

export interface RouteProviderResult {
  providerNamespace: string;
  providerProduct: string;
  providerVersion: string;
  providerRouteReference: string;

  routeShape: {
    type: 'LineString';
    coordinates: number[][];
  };

  routeDistanceMeters: number;
  routeDurationSeconds: number;

  generatedAt: string;
  expiresAt: string | null;
}

export interface RouteProvider {
  name: string;

  providerNamespace: string;

  isAvailable(): boolean;

  route(
    input: {
      origin: TrustedRouteCoordinate;
      destination: TrustedRouteCoordinate;
    },
    signal: AbortSignal,
  ): Promise<RouteProviderResult>;
}

export interface RecordedRouteEvidence {
  routeEvidenceId: string;
  routeEvidenceVersion: number;
  routeEvidenceStatus: string;
  routeEvidenceExpiresAt: string | null;
}

export interface RecordedRouteMatchEvidence {
  routeMatchEvidenceId: string;
  routeMatchEvidenceVersion: number;
  routeMatchEvidenceStatus: string;
  routeMatchEvidenceExpiresAt: string | null;
}

export interface RouteMatchPublicationPayload {
  movementNeedId: string;
  offeringMovementIntentId: string;
  expectedRouteEvidenceId: string;
  expectedRouteEvidenceVersion: number;
  requesterOriginDistanceToRouteMeters: number;
  requesterDestinationDistanceToRouteMeters: number;
  calculatedRouteShapeLengthMeters: number;
  requesterOriginPositionAlongRouteMeters: number;
  requesterDestinationPositionAlongRouteMeters: number;
  requesterOriginClosestRoute: TrustedRouteCoordinate;
  requesterDestinationClosestRoute: TrustedRouteCoordinate;
  calculatedAt: string;
  expiresAt: null;
}

export type RouteMatchContextIdentity = ReturnType<typeof routeMatchContextIdentity>;
export function routeMatchContextIdentity(c: TrustedMatchingContext, availabilityId: string) {
  return {
    movementNeedId: c.movementNeedId, requestingMemberId: c.requestingMemberId, availabilityId,
    requesterOriginLocationReferenceId: c.requesterOriginLocationReferenceId,
    requesterDestinationLocationReferenceId: c.requesterDestinationLocationReferenceId,
    offeringMovementIntentId: c.offeringMovementIntentId, offeringMemberId: c.offeringMemberId,
    offeringIntentVersion: c.offeringIntentVersion,
    routeEvidenceId: c.routeEvidenceId, routeEvidenceVersion: c.routeEvidenceVersion,
  };
}

export type CurrentRequesterRouteMatch =
  | { state: 'not_found'; identity: RouteMatchContextIdentity }
  | { state: 'reuse_existing'; identity: RouteMatchContextIdentity;
      evidence: RecordedRouteMatchEvidence; payload: RouteMatchPublicationPayload };

// Compare canonical structures without depending on JSON object key order.
export function sameRouteMatchValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return Object.keys(x).length === Object.keys(y).length
    && Object.keys(x).every(k => Object.hasOwn(y, k) && sameRouteMatchValue(x[k], y[k]));
}

export interface PricingClassificationContext {
  routeMatchEvidenceId: string;
  routeMatchEvidenceVersion: number;

  movementNeedId: string;

  offeringMovementIntentId: string;
  offeringIntentVersion: number;

  routeEvidenceId: string;
  routeEvidenceVersion: number;

  routeShapeFormat:
    'geojson_linestring_v1';

  routeShape: {
    type: 'LineString';
    coordinates: number[][];
  };

  calculatedRouteShapeLengthMeters: number;

  requesterOriginPositionAlongRouteMeters: number;
  requesterDestinationPositionAlongRouteMeters: number;

  requesterOriginClosestRoute:
    TrustedRouteCoordinate;

  requesterDestinationClosestRoute:
    TrustedRouteCoordinate;

  routeOrder:
    | 'forward'
    | 'same_position'
    | 'reverse';

  routeMatchEvidenceExpiresAt:
    string | null;
}

export interface RouteProviderQuotaResult {
  admitted: boolean;
  retryAfterSeconds: number;
}

export type RouteGenerationClaim =
  | {
      state: 'existing';

      routeEvidence:
        RecordedRouteEvidence;
    }
  | {
      state: 'busy';

      retryAfterSeconds: number;
    }
  | {
      state: 'claimed';

      claimToken: string;

      context: RouteGenerationContext;
    };

export interface RouteBackend {
  authenticate(
    jwt: string,
    signal: AbortSignal,
  ): Promise<string | null>;

  memberExists(
    memberId: string,
    signal: AbortSignal,
  ): Promise<boolean>;

    consumeRouteProviderQuota(
    memberId: string,
    signal: AbortSignal,
  ): Promise<RouteProviderQuotaResult>;

  claimRouteGeneration(
    offeringMovementIntentId: string,
    offeringMemberId: string,
    signal: AbortSignal,
  ): Promise<RouteGenerationClaim | null>;

  getRouteGenerationContext(
    offeringMovementIntentId: string,
    offeringMemberId: string,
    signal: AbortSignal,
  ): Promise<RouteGenerationContext | null>;

  getAuthorizedTrustedMatchingContext(
    verifiedMemberId: string,
    movementNeedId: string,
    offeringMovementIntentId: string,
    signal: AbortSignal,
  ): Promise<TrustedMatchingContext | null>;

  getRequesterAvailabilityMatchingContext(
    verifiedMemberId: string,
    movementNeedId: string,
    availabilityId: string,
    signal: AbortSignal,
  ): Promise<TrustedMatchingContext | null>;

  getCurrentRequesterAvailabilityRouteMatch(
    verifiedMemberId: string, movementNeedId: string, availabilityId: string, signal: AbortSignal,
    expectedPayload?: RouteMatchPublicationPayload,
  ): Promise<CurrentRequesterRouteMatch | null>;

  publishRequesterAvailabilityRouteMatch(
    verifiedMemberId: string, movementNeedId: string, availabilityId: string,
    identity: RouteMatchContextIdentity, payload: RouteMatchPublicationPayload, signal: AbortSignal,
  ): Promise<CurrentRequesterRouteMatch | null>;

  getPricingClassificationContext(
    routeMatchEvidenceId: string,
    expectedRouteMatchEvidenceVersion: number,
    expectedRouteEvidenceId: string,
    expectedRouteEvidenceVersion: number,
    signal: AbortSignal,
  ): Promise<PricingClassificationContext | null>;

  recordTrustedRouteMatchEvidence(
    input: {
      movementNeedId: string;
      offeringMovementIntentId: string;

      expectedRouteEvidenceId: string;
      expectedRouteEvidenceVersion: number;

      requesterOriginDistanceToRouteMeters: number;
      requesterDestinationDistanceToRouteMeters: number;

      calculatedRouteShapeLengthMeters: number;

      requesterOriginPositionAlongRouteMeters: number;
      requesterDestinationPositionAlongRouteMeters: number;

      requesterOriginClosestRoute: TrustedRouteCoordinate;
      requesterDestinationClosestRoute: TrustedRouteCoordinate;

      calculatedAt: string;
      expiresAt: string | null;
    },
    signal: AbortSignal,
  ): Promise<RecordedRouteMatchEvidence | null>;

  recordClaimedRouteEvidence(
    input: {
      offeringMovementIntentId: string;
      offeringMemberId: string;
      generationClaimToken: string;

      providerNamespace: string;
      providerProduct: string;
      providerVersion: string;
      providerRouteReference: string;

      routeShape: {
        type: 'LineString';
        coordinates: number[][];
      };

      routeDistanceMeters: number;
      routeDurationSeconds: number;

      generatedAt: string;
      expiresAt: string | null;
    },
    signal: AbortSignal,
  ): Promise<RecordedRouteEvidence | null>;

  recordRouteEvidence(
    input: {
      offeringMovementIntentId: string;

      providerNamespace: string;
      providerProduct: string;
      providerVersion: string;
      providerRouteReference: string;

      routeShape: {
        type: 'LineString';
        coordinates: number[][];
      };

      routeDistanceMeters: number;
      routeDurationSeconds: number;

      generatedAt: string;
      expiresAt: string | null;
    },
    signal: AbortSignal,
  ): Promise<RecordedRouteEvidence | null>;
}

export const unavailableRouteProvider:
  RouteProvider =
  Object.freeze({
    name: 'unavailable',

    providerNamespace: 'unavailable',

    isAvailable: () => false,

    async route() {
      throw new Error(
        'Route provider unavailable',
      );
    },
  });
