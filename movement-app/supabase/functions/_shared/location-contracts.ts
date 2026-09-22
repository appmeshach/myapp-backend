export const LOCATION_PROOF_VERSION = 'selection_proof_v1' as const;
export const LOCATION_PROOF_AUDIENCE = 'movement-location-selection' as const;

export const MAX_LOCATION_QUERY_CODE_POINTS = 200;
export const MIN_LOCATION_QUERY_CODE_POINTS = 2;
export const MAX_LOCATION_SUGGESTIONS = 10;

export const MAX_LOCATION_LABEL_LENGTH = 300;
export const MAX_PROVIDER_NAMESPACE_LENGTH = 100;
export const MAX_PROVIDER_REFERENCE_LENGTH = 500;
export const MAX_SELECTION_PROOF_LENGTH = 4096;

export const NIGERIA_COUNTRY_CODE = 'NG' as const;

export interface LocationSearchInput {
  query: string;
  countryCode: typeof NIGERIA_COUNTRY_CODE;
  limit: number;
}

export interface ProviderSearchSuggestion {
  declaredLabel: string;
  providerNamespace: string;
  providerPlaceReference: string;
  persistentSelectionAllowed: boolean;
}

export interface LocationSearchResult {
  suggestions: ProviderSearchSuggestion[];
  attribution: string[];
}

export interface LocationSearchProvider {
  readonly name: string;
  isAvailable(): boolean;
  search(
    input: LocationSearchInput,
    signal: AbortSignal,
  ): Promise<LocationSearchResult>;
}

export interface DurableLocationResolution {
  providerNamespace: string;
  providerProduct: string;
  providerVersion: string;
  providerPlaceReference: string;
  resolutionVersion: string;
  discoveryAreaLabel: string;
  latitude: number;
  longitude: number;
  resolvedAt: string;
  expiresAt: string | null;
  durableStorageAllowed: boolean;
}

export interface DurableLocationResolver {
  readonly providerNamespace: string;
  isAvailable(): boolean;
  resolve(
    input: {
      providerNamespace: string;
      providerPlaceReference: string;
    },
    signal: AbortSignal,
  ): Promise<DurableLocationResolution>;
}

export interface SelectionProofClaims {
  audience: typeof LOCATION_PROOF_AUDIENCE;
  version: typeof LOCATION_PROOF_VERSION;
  memberId: string;
  selectionRequestId: string;
  declaredLabel: string;
  providerNamespace: string;
  providerPlaceReference: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SelectionProofSigner {
  isAvailable(): boolean;
  sign(
    claims: SelectionProofClaims,
    signal: AbortSignal,
  ): Promise<string>;
  verify(
    proof: string,
    expectedMemberId: string,
    signal: AbortSignal,
  ): Promise<SelectionProofClaims | null>;
}

export interface VerifiedSelectionRecord {
  locationReferenceId: string;
  declaredLabel: string;
}

export interface LocationResolutionContext {
  providerNamespace: string;
  providerPlaceReference: string;
  sourceCreatedAt: string;
  sourceExpiresAt: string | null;
  evidenceId: string | null;
  resolvedLocationReferenceId: string | null;
  version: number | null;
  expiresAt: string | null;
}

export interface AttestedResolutionRecord {
  evidenceId: string;
  resolvedLocationReferenceId: string;
  version: number;
  expiresAt: string | null;
}

export interface LocationBackend {
  consumeProviderQuota(
    memberId: string,
    operation: 'location_search' | 'location_resolution',
    signal: AbortSignal,
  ): Promise<{ admitted: boolean; retryAfterSeconds: number }>;

  authenticate(
    jwt: string,
    signal: AbortSignal,
  ): Promise<string | null>;

  memberExists(
    memberId: string,
    signal: AbortSignal,
  ): Promise<boolean>;

  recordVerifiedSelection(
    input: {
      verifiedMemberId: string;
      selectionRequestId: string;
      declaredLabel: string;
      providerNamespace: string;
      providerPlaceReference: string;
      proofVersion: typeof LOCATION_PROOF_VERSION;
      proofIssuedAt: string;
      proofExpiresAt: string;
    },
    signal: AbortSignal,
  ): Promise<VerifiedSelectionRecord | null>;

  recoverVerifiedSelection(
    verifiedMemberId: string,
    selectionRequestId: string,
    signal: AbortSignal,
  ): Promise<VerifiedSelectionRecord | null>;

  getResolutionContext(
    verifiedMemberId: string,
    sourceLocationReferenceId: string,
    producerRequestId: string,
    signal: AbortSignal,
  ): Promise<LocationResolutionContext | null>;

  recordAttestedResolution(
    input: {
      verifiedMemberId: string;
      sourceLocationReferenceId: string;
      producerRequestId: string;
      providerNamespace: string;
      providerProduct: string;
      providerVersion: string;
      providerPlaceReference: string;
      resolutionVersion: string;
      discoveryAreaLabel: string;
      latitude: number;
      longitude: number;
      resolvedAt: string;
      expiresAt: string | null;
    },
    signal: AbortSignal,
  ): Promise<AttestedResolutionRecord | null>;
}

export const unavailableLocationSearchProvider: LocationSearchProvider =
  Object.freeze({
    name: 'unavailable',
    isAvailable: () => false,
    async search() {
      throw new Error('Location search unavailable');
    },
  });

export const unavailableDurableLocationResolver: DurableLocationResolver =
  Object.freeze({
    providerNamespace: 'unavailable',
    isAvailable: () => false,
    async resolve() {
      throw new Error('Location resolution unavailable');
    },
  });

export const unavailableSelectionProofSigner: SelectionProofSigner =
  Object.freeze({
    isAvailable: () => false,
    async sign() {
      throw new Error('Selection proof unavailable');
    },
    async verify() {
      return null;
    },
  });
