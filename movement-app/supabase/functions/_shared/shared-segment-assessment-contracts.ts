// Private geometric facts only. No route metric grants admission or road identity.
export const ASSESSMENT_VERSION = 'shared_segment_geographic_assessment_v1';
export const PARAMETERS = Object.freeze({
  samplingSpacingMeters: 5, proximityMeters: 5, minimumSupportedMeters: 100,
  maximumHeadingDegrees: 45, maximumUnsupportedGapMeters: 15,
  maximumOriginalCoordinates: 2000, maximumResampledPoints: 20000,
  maximumWorkUnits: 1000000, earthRadiusMeters: 6371008.8,
  maximumStoredIntervals: 20000,
  numericalEpsilonMeters: 1e-7, outputDecimalPlaces: 6,
  model: 'spherical-arcs-ecef-chord-correspondence-v1',
  ambiguity: 'overlapping-support-with-alternative-position-over-15m-v1',
});
export const PARAMETER_CANONICAL = JSON.stringify(PARAMETERS);
export async function parameterFingerprint(): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PARAMETER_CANONICAL));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export type InputState = 'ready' | 'evidence_unavailable' | 'evidence_stale' | 'evidence_invalid';
export type Reason = 'no_positive_support_on_reference_route' | 'reverse_direction_only' |
  'ambiguous_traversal' | 'below_positive_support_standard' | 'unsupported_provider_contract' |
  'processing_limit' | 'calculation_failed';
export interface SupportInterval {
  offererStart: number; offererEnd: number; requesterStart: number; requesterEnd: number;
  chain: number;
}
export interface AssessmentResult {
  algorithmVersion: typeof ASSESSMENT_VERSION;
  inputState: InputState;
  assessmentState: 'not_run' | 'assessment_unavailable' | 'complete';
  geographicResult: 'inconclusive' | 'overlap_observed' | 'geometric_corridor_support' | null;
  reasons: Reason[]; alternativeCorridors: 'unassessed';
  authorizesAdmission: false; confirmsUsableSharedSegment: false; roadTopologyVerified: false;
  offererTotal: number; requesterTotal: number; offererSupported: number; requesterSupported: number;
  offererFraction: number; requesterFraction: number;
  supportIntervals: SupportInterval[];
  ambiguityCount: number; sameDirectionCount: number; reverseDirectionCount: number;
  offererPointCount: number; requesterPointCount: number; workUnits: number;
}
export interface PairIdentity {
  needId: string; requesterId: string; intentId: string; offererId: string;
}
export interface AssessmentContext {
  input_state: InputState; reason: Reason | null;
  context: Record<string, unknown> | null; input_context_fingerprint: string | null;
  expires_at: string | null; offerer_shape: unknown; requester_shape: unknown;
}
export interface PublishedAssessment { assessment_id: string; publication_state: 'published' | 'reuse_existing'; }
export type AssessmentLookup =
  | { lookup_state: 'reuse_existing'; assessment_id: string; algorithm_version: string;
      parameter_fingerprint: string; canonical_result: AssessmentResult }
  | { lookup_state: 'not_found' | 'not_ready'; assessment_id: null; algorithm_version: null;
      parameter_fingerprint: null; canonical_result: null };
export interface AssessmentBackend {
  lookup(pair: PairIdentity, signal: AbortSignal): Promise<AssessmentLookup>;
  context(pair: PairIdentity, signal: AbortSignal): Promise<AssessmentContext>;
  publish(pair: PairIdentity, context: Record<string, unknown>, result: AssessmentResult, signal: AbortSignal): Promise<PublishedAssessment>;
}
export function emptyResult(inputState: InputState = 'ready'): AssessmentResult {
  return { algorithmVersion: ASSESSMENT_VERSION, inputState, assessmentState: 'not_run',
    geographicResult: null, reasons: [], alternativeCorridors: 'unassessed',
    authorizesAdmission: false, confirmsUsableSharedSegment: false, roadTopologyVerified: false,
    offererTotal: 0, requesterTotal: 0, offererSupported: 0, requesterSupported: 0,
    offererFraction: 0, requesterFraction: 0, supportIntervals: [], ambiguityCount: 0,
    sameDirectionCount: 0, reverseDirectionCount: 0, offererPointCount: 0, requesterPointCount: 0, workUnits: 0 };
}
