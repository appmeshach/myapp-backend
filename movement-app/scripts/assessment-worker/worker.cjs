'use strict';
const {getOrProduceSharedSegmentAssessment}=require('../../supabase/functions/_shared/shared-segment-assessment-orchestration.ts');
const {calculateIsolated}=require('./compute.cjs');
const {ASSESSMENT_VERSION,parameterFingerprint}=require('../../supabase/functions/_shared/shared-segment-assessment-contracts.ts');
// One supervisor operation; no SQL transaction or lock spans the child process.
async function executeOne(backend,{signal=new AbortController().signal,compute=calculateIsolated,log=(_event)=>{}}={}){
 const io=()=>AbortSignal.any([signal,AbortSignal.timeout(5000)]);
 const claim=await backend.claim(io());if(claim.state==='idle')return {state:'idle'};
 const started=performance.now();let loaded,metrics,computed;
 const finish=(state,result)=>{log({jobId:claim.job_id,state,attemptCount:claim.attempt_count,durationMs:performance.now()-started,
  ...(result?{resultCategory:result.geographicResult||result.reasons[0]||result.inputState,workUnits:result.workUnits}:{})});return {state,...(metrics?{metrics}:{}),...(result?{result}:{} )};};
 try{
  loaded=await backend.load(claim.job_id,claim.lease_token,io());if(loaded.state!=='ready')return finish(loaded.state);
  const fingerprint=await parameterFingerprint();
  if(loaded.snapshot.context.algorithm_version!==ASSESSMENT_VERSION||loaded.snapshot.context.parameter_fingerprint!==fingerprint
   ||loaded.assessment.lookup_state==='reuse_existing'&&(loaded.assessment.algorithm_version!==ASSESSMENT_VERSION||loaded.assessment.parameter_fingerprint!==fingerprint))
   throw Object.assign(Error(),{code:'contract_mismatch'});
  if(loaded.assessment.lookup_state==='not_ready')throw Object.assign(Error(),{code:'invalid_evidence'});
  const remaining=Date.parse(loaded.lease_expires_at)-Date.now();if(loaded.assessment.lookup_state==='not_found'&&remaining<=10000)throw Object.assign(Error(),{code:'compute_timeout'});
  // 0097 stays reuse-first. Its computer interface is synchronous, so isolated
  // CPU runs only after a validated miss, then supplies that exact one result.
  if(loaded.assessment.lookup_state==='not_found'){
   const got=await compute(loaded.snapshot.offerer_shape,loaded.snapshot.requester_shape,
    {signal,timeoutMs:Math.min(15000,Math.floor(remaining-10000))});computed=got.result;metrics=got.metrics;
   if(computed.assessmentState==='not_run')throw Object.assign(Error(),{code:'invalid_evidence'});
  }
  const pair={needId:loaded.snapshot.context.need_id,requesterId:loaded.snapshot.context.requester_id,
   intentId:loaded.snapshot.context.intent_id,offererId:loaded.snapshot.context.offerer_id};
  let completion;
  const result=await getOrProduceSharedSegmentAssessment({
   lookup:async()=>loaded.assessment,context:async()=>loaded.snapshot,
   publish:async(_pair,context,value)=>{
    completion=await backend.finalize(claim.job_id,claim.lease_token,context,value,io());
    if(completion.state!=='completed')throw Object.assign(Error(),{state:completion.state});
    return {assessment_id:completion.assessment_id,publication_state:completion.publication_state};
   },
  },pair,signal,()=>computed);
  if(result.result?.reasons[0]==='calculation_failed')throw Object.assign(Error(),{code:'calculation_failed'});
  if(!completion){completion=await backend.finalize(claim.job_id,claim.lease_token,loaded.snapshot.context,null,io());}
  return finish(completion.state,result.result);
 }catch(error){
  // One reuse recovery, including COMMIT followed by lost response. No CPU replay.
  if(loaded?.state==='ready'&&!signal.aborted&&!['contract_mismatch','invalid_evidence'].includes(error?.code)){
   try{const expected=computed||(loaded.assessment.lookup_state==='reuse_existing'?loaded.assessment.canonical_result:null);
    const recovered=await backend.finalize(claim.job_id,claim.lease_token,loaded.snapshot.context,expected,io(),true);
    if(recovered.state==='completed')return finish('completed',expected);
    if(['stale','expired','lease_invalid'].includes(recovered.state))return finish(recovered.state);
   }catch{/* Failure registration remains bounded; a crash leaves a reclaimable lease. */}
  }
  if(signal.aborted)return finish('interrupted');
  const category=['calculation_failed','compute_timeout','compute_terminated','invalid_evidence','contract_mismatch'].includes(error?.code)?error.code:'transport_failure';
  try{const failed=await backend.fail(claim.job_id,claim.lease_token,category,io());return finish(failed.state==='completed'?'unavailable':failed.state);}
  catch{return finish('unavailable');}
 }
}
module.exports={executeOne};
