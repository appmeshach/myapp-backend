import { assessSharedSegment } from './shared-segment-assessment-geometry.ts';
import { ASSESSMENT_VERSION, emptyResult, parameterFingerprint } from './shared-segment-assessment-contracts.ts';
import type { AssessmentBackend, AssessmentResult, PairIdentity, PublishedAssessment } from './shared-segment-assessment-contracts.ts';

// Internal module only: no HTTP handler, participant authentication or provider.
// Each RPC ends its transaction before local CPU work starts.
export async function produceSharedSegmentAssessment(backend: AssessmentBackend, pair: PairIdentity,
  signal: AbortSignal = new AbortController().signal): Promise<{ result: AssessmentResult; publication: PublishedAssessment | null }> {
  signal.throwIfAborted();
  const snapshot=await backend.context(pair,signal);
  signal.throwIfAborted();
  if(snapshot.input_state!=='ready') {
    const result=emptyResult(snapshot.input_state);
    if(snapshot.reason)result.reasons=[snapshot.reason];
    return {result,publication:null};
  }
  if(!snapshot.context || !snapshot.expires_at || Date.parse(snapshot.expires_at)<=Date.now()) throw new Error('Assessment unavailable');
  if(snapshot.context.algorithm_version!==ASSESSMENT_VERSION ||
    snapshot.context.parameter_fingerprint!==await parameterFingerprint()) throw new Error('Assessment unavailable');
  const result=assessSharedSegment(snapshot.offerer_shape,snapshot.requester_shape);
  signal.throwIfAborted();
  // Runtime failures are retryable and must never become immutable evidence.
  if(result.assessmentState==='assessment_unavailable' && result.reasons[0]==='calculation_failed') {
    return {result,publication:null};
  }
  // Revalidation and deterministic conflict recovery happen in SQL. Retry this
  // producer after a lost response: exact context identity recovers the row.
  const publication=await backend.publish(pair,snapshot.context,result,signal);
  signal.throwIfAborted();
  return {result,publication};
}
