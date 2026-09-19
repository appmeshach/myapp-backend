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

export interface RouteProviderQuotaResult {
  admitted: boolean;
  retryAfterSeconds: number;
}

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

  getRouteGenerationContext(
    offeringMovementIntentId: string,
    offeringMemberId: string,
    signal: AbortSignal,
  ): Promise<RouteGenerationContext | null>;

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