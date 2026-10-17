import { assessSharedSegment } from './shared-segment-assessment-geometry.ts';
import { ASSESSMENT_VERSION, emptyResult, parameterFingerprint } from './shared-segment-assessment-contracts.ts';
import type { AssessmentBackend, AssessmentResult, PairIdentity, PublishedAssessment } from './shared-segment-assessment-contracts.ts';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type AssessmentComputer = typeof assessSharedSegment;
function validatePair(pair:PairIdentity):void {
  if(!pair || ![pair.needId,pair.requesterId,pair.intentId,pair.offererId].every(v=>typeof v==='string' && UUID.test(v)))
    throw new Error('Assessment unavailable');
}

// Internal module only: no HTTP handler, participant authentication or provider.
// Each RPC ends its transaction before local CPU work starts.
export async function produceSharedSegmentAssessment(backend: AssessmentBackend, pair: PairIdentity,
  signal: AbortSignal = new AbortController().signal, assess:AssessmentComputer=assessSharedSegment): Promise<{ result: AssessmentResult; publication: PublishedAssessment | null }> {
  validatePair(pair);
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
  const result=assess(snapshot.offerer_shape,snapshot.requester_shape);
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

export type AssessmentResolution = {
  lookupState: 'reuse_existing' | 'not_found' | 'not_ready';
  result: AssessmentResult | null;
  publication: PublishedAssessment | null;
};

export async function getOrProduceSharedSegmentAssessment(backend:AssessmentBackend,pair:PairIdentity,
  signal:AbortSignal=new AbortController().signal,assess:AssessmentComputer=assessSharedSegment):Promise<AssessmentResolution> {
  validatePair(pair);
  signal.throwIfAborted();
  const lookup=await backend.lookup(pair,signal);
  signal.throwIfAborted();
  if(lookup.lookup_state==='reuse_existing') {
    if(lookup.algorithm_version!==ASSESSMENT_VERSION || lookup.parameter_fingerprint!==await parameterFingerprint())
      throw new Error('Assessment unavailable');
    signal.throwIfAborted();
    return {lookupState:'reuse_existing',result:lookup.canonical_result,
      publication:{assessment_id:lookup.assessment_id,publication_state:'reuse_existing'}};
  }
  if(lookup.lookup_state==='not_ready') return {lookupState:'not_ready',result:null,publication:null};
  const produced=await produceSharedSegmentAssessment(backend,pair,signal,assess);
  if(produced.result.assessmentState==='not_run' && produced.result.inputState!=='ready')
    return {lookupState:'not_ready',result:null,publication:null};
  return {lookupState:'not_found',...produced};
}
