import type { AssessmentContext, AssessmentLookup, AssessmentResult } from './shared-segment-assessment-contracts.ts';
export type JobStatus='pending'|'running'|'completed'|'failed'|'stale'|'expired';
export type JobFailure='calculation_failed'|'compute_timeout'|'compute_terminated'|'transport_failure'|'invalid_evidence'|'contract_mismatch';
export type JobRegistration={state:'not_ready'}|{state:'assessment_reuse';assessment:AssessmentLookup}|
  {state:'job_registered';job_id:string;status:JobStatus;attempt_count:number};
export type JobClaim={state:'idle'}|{state:'claimed';job_id:string;lease_token:string;lease_expires_at:string;attempt_count:number};
export type JobContext={state:'lease_invalid'|'stale'|'expired'|'failed'}|
  {state:'ready';job_id:string;attempt_count:number;lease_expires_at:string;snapshot:AssessmentContext;assessment:AssessmentLookup};
export type JobCompletion={state:'completed';assessment_id:string;publication_state:'published'|'reuse_existing'}|{state:'not_found'|'lease_invalid'|'stale'|'expired'|'failed'};
export interface AssessmentJobBackend {
  register(member:string,need:string,availability:string,signal:AbortSignal):Promise<JobRegistration>;
  claim(signal:AbortSignal):Promise<JobClaim>;
  load(job:string,token:string,signal:AbortSignal):Promise<JobContext>;
  finalize(job:string,token:string,context:Record<string,unknown>,result:AssessmentResult|null,signal:AbortSignal,recoveryOnly?:boolean):Promise<JobCompletion>;
  fail(job:string,token:string,category:JobFailure,signal:AbortSignal):Promise<{state:JobStatus|'lease_invalid'}>;
}
