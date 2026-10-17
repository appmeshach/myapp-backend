import { readBounded } from './face-orchestration.ts';
import { ASSESSMENT_VERSION, parameterFingerprint } from './shared-segment-assessment-contracts.ts';
import type { AssessmentContext, AssessmentLookup } from './shared-segment-assessment-contracts.ts';
import { assessmentResult } from './shared-segment-assessment-runtime.ts';
import type { AssessmentJobBackend, JobClaim, JobCompletion, JobContext, JobRegistration } from './shared-segment-assessment-job-contracts.ts';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const statuses=['pending','running','completed','failed','stale','expired'];
function unavailable():never {throw new Error('Assessment job unavailable');}
function object(v:unknown):Record<string,unknown> {if(!v||typeof v!=='object'||Array.isArray(v))return unavailable();return v as Record<string,unknown>;}
function keys(v:Record<string,unknown>,expected:string) {if(Object.keys(v).sort().join('|')!==expected.split('|').sort().join('|'))unavailable();}
function id(v:unknown):string {return typeof v==='string'&&UUID.test(v)?v:unavailable();}
function time(v:unknown):string {return typeof v==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?v:unavailable();}
function attempts(v:unknown,minimum=0) {if(typeof v!=='number'||!Number.isInteger(v)||v<minimum||v>3)unavailable();}
export class JobContractMismatch extends Error {code='contract_mismatch';constructor(){super('Assessment job contract unavailable');}}
async function lookup(v:unknown):Promise<AssessmentLookup> {
  const r=object(v);keys(r,'lookup_state|assessment_id|algorithm_version|parameter_fingerprint|canonical_result');
  if(r.lookup_state==='reuse_existing') {
    id(r.assessment_id);
    if(r.algorithm_version!==ASSESSMENT_VERSION||r.parameter_fingerprint!==await parameterFingerprint())throw new JobContractMismatch();
    assessmentResult(r.canonical_result);
  } else if(!['not_found','not_ready'].includes(String(r.lookup_state))||r.assessment_id!==null||r.algorithm_version!==null||r.parameter_fingerprint!==null||r.canonical_result!==null)unavailable();
  return r as unknown as AssessmentLookup;
}
export function createAssessmentJobBackend(url:string,secret:string,fetcher:typeof fetch=fetch):AssessmentJobBackend {
  async function rpc(name:string,args:Record<string,unknown>,signal:AbortSignal) {
    let root:URL;try{root=new URL(url);}catch{return unavailable();}
    if(!secret||root.username||root.password||root.pathname!=='/'||root.search||root.hash||
      !(root.protocol==='https:'||root.protocol==='http:'&&['localhost','127.0.0.1','kong'].includes(root.hostname)))unavailable();
    signal.throwIfAborted();const headers:Record<string,string>={apikey:secret,'Content-Type':'application/json'};
    if(!secret.startsWith('sb_secret_'))headers.Authorization=`Bearer ${secret}`;
    const r=await fetcher(`${root.origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args),signal,redirect:'error',cache:'no-store'});
    if(r.redirected)unavailable();
    if(!r.ok){
      // Recognize only fixed trusted safety failures; never expose raw DB text.
      try{
        const bytes=await readBounded(r.body,16384,signal),failure=object(JSON.parse(new TextDecoder().decode(bytes)));
        if(failure.code==='23514'&&['Assessment job context mismatch','Assessment job result mismatch',
          'Assessment completion identity mismatch','Geographic assessment nondeterminism or identity collision'].includes(String(failure.message)))
          throw new JobContractMismatch();
      }catch(error){if(error instanceof JobContractMismatch)throw error;signal.throwIfAborted();}
      unavailable();
    }
    const bytes=await readBounded(r.body,4*1024*1024,signal);signal.throwIfAborted();
    try{return object(JSON.parse(new TextDecoder().decode(bytes)));}catch{return unavailable();}
  }
  return {
    async register(member,need,availability,signal):Promise<JobRegistration> {
      const r=await rpc('register_requester_availability_assessment_job_for_server',{
        p_verified_member_id:id(member),p_movement_need_id:id(need),p_availability_id:id(availability)},signal);
      if(r.state==='assessment_reuse'){keys(r,'state|assessment');if((await lookup(r.assessment)).lookup_state!=='reuse_existing')unavailable();}
      else if(r.state==='not_ready')keys(r,'state');
      else if(r.state==='job_registered'){keys(r,'state|job_id|status|attempt_count');id(r.job_id);attempts(r.attempt_count);if(!statuses.includes(String(r.status)))unavailable();}
      else unavailable();return r as unknown as JobRegistration;
    },
    async claim(signal):Promise<JobClaim> {
      const r=await rpc('claim_shared_segment_assessment_job_for_server',{},signal);
      if(r.state==='idle')keys(r,'state');
      else if(r.state==='claimed'){keys(r,'state|job_id|lease_token|lease_expires_at|attempt_count');id(r.job_id);id(r.lease_token);time(r.lease_expires_at);attempts(r.attempt_count,1);}
      else unavailable();return r as unknown as JobClaim;
    },
    async load(job,token,signal):Promise<JobContext> {
      const r=await rpc('load_shared_segment_assessment_job_context_for_server',{p_job_id:id(job),p_lease_token:id(token)},signal);
      if(r.state!=='ready'){keys(r,'state');if(!['lease_invalid','stale','expired','failed'].includes(String(r.state)))unavailable();return r as unknown as JobContext;}
      keys(r,'state|job_id|attempt_count|lease_expires_at|snapshot|assessment');if(id(r.job_id)!==job)unavailable();attempts(r.attempt_count,1);time(r.lease_expires_at);
      const s=object(r.snapshot);keys(s,'input_state|reason|context|input_context_fingerprint|expires_at|offerer_shape|requester_shape');
      if(s.input_state!=='ready'||s.reason!==null||typeof s.input_context_fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(s.input_context_fingerprint))unavailable();
      time(s.expires_at);const c=object(s.context);
      if(c.algorithm_version!==ASSESSMENT_VERSION||c.parameter_fingerprint!==await parameterFingerprint())throw new JobContractMismatch();
      for(const k of ['need_id','requester_id','intent_id','offerer_id'])id(c[k]);
      for(const k of ['offerer_evidence','requester_evidence']){const e=object(c[k]);id(e.id);if(typeof e.version!=='number'||!Number.isSafeInteger(e.version)||e.version<1)unavailable();}
      if(c.expires_at!==s.expires_at)unavailable();await lookup(r.assessment);
      return r as unknown as {state:'ready';job_id:string;attempt_count:number;lease_expires_at:string;snapshot:AssessmentContext;assessment:AssessmentLookup};
    },
    async finalize(job,token,context,result,signal,recoveryOnly=false):Promise<JobCompletion> {
      const r=await rpc('finalize_shared_segment_assessment_job_for_server',{p_job_id:id(job),p_lease_token:id(token),p_context:context,p_result:result,p_recovery_only:recoveryOnly},signal);
      if(r.state==='completed'){keys(r,'state|assessment_id|publication_state');id(r.assessment_id);if(!['published','reuse_existing'].includes(String(r.publication_state)))unavailable();}
      else {keys(r,'state');if(!['not_found','lease_invalid','stale','expired','failed'].includes(String(r.state)))unavailable();}
      return r as unknown as JobCompletion;
    },
    async fail(job,token,category,signal) {
      if(!['calculation_failed','compute_timeout','compute_terminated','transport_failure','invalid_evidence','contract_mismatch'].includes(category))unavailable();
      const r=await rpc('fail_shared_segment_assessment_job_for_server',{p_job_id:id(job),p_lease_token:id(token),p_category:category},signal);
      keys(r,'state');if(![...statuses,'lease_invalid'].includes(String(r.state)))unavailable();
      return r as {state:'pending'|'running'|'completed'|'failed'|'stale'|'expired'|'lease_invalid'};
    },
  };
}
