import { readBounded } from './face-orchestration.ts';
import { ASSESSMENT_VERSION } from './shared-segment-assessment-contracts.ts';
import type { AssessmentBackend, AssessmentContext, AssessmentLookup, AssessmentResult, PairIdentity, PublishedAssessment } from './shared-segment-assessment-contracts.ts';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const unavailable=():never=>{throw new Error('Assessment unavailable');};
function args(p:PairIdentity) {
  if(!Object.values(p).every(v=>typeof v==='string' && UUID.test(v)))return unavailable();
  return {p_movement_need_id:p.needId,p_requesting_member_id:p.requesterId,p_offering_movement_intent_id:p.intentId,p_offering_member_id:p.offererId};
}
function object(v:unknown):Record<string,unknown> {
  if(!v || typeof v!=='object' || Array.isArray(v))return unavailable();
  return v as Record<string,unknown>;
}
export function assessmentResult(v:unknown):AssessmentResult {
  const r=object(v),keys=['algorithmVersion','inputState','assessmentState','geographicResult','reasons','alternativeCorridors',
    'authorizesAdmission','confirmsUsableSharedSegment','roadTopologyVerified','offererTotal','requesterTotal','offererSupported',
    'requesterSupported','offererFraction','requesterFraction','supportIntervals','ambiguityCount','sameDirectionCount',
    'reverseDirectionCount','offererPointCount','requesterPointCount','workUnits'];
  if(Object.keys(r).sort().join('|')!==[...keys].sort().join('|') || r.algorithmVersion!==ASSESSMENT_VERSION ||
    !['ready','evidence_unavailable','evidence_stale','evidence_invalid'].includes(String(r.inputState)) ||
    !['not_run','assessment_unavailable','complete'].includes(String(r.assessmentState)) ||
    ![null,'inconclusive','overlap_observed','geometric_corridor_support'].includes(r.geographicResult as never) ||
    r.alternativeCorridors!=='unassessed' || r.authorizesAdmission!==false || r.confirmsUsableSharedSegment!==false ||
    r.roadTopologyVerified!==false || !Array.isArray(r.reasons) || !Array.isArray(r.supportIntervals))return unavailable();
  for(const k of ['offererTotal','requesterTotal','offererSupported','requesterSupported','offererFraction','requesterFraction',
    'ambiguityCount','sameDirectionCount','reverseDirectionCount','offererPointCount','requesterPointCount','workUnits'])
    if(typeof r[k]!=='number' || !Number.isFinite(r[k]) || (r[k] as number)<0)return unavailable();
  return r as unknown as AssessmentResult;
}
export function createSharedSegmentAssessmentBackend(url:string,secret:string,fetcher:typeof fetch=fetch):AssessmentBackend {
  async function rpc(name:string,body:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>> {
    let root:URL;try {root=new URL(url);}catch {return unavailable();}
    if(!secret || root.username || root.password || root.pathname!=='/' || root.search || root.hash ||
      !(root.protocol==='https:' || root.protocol==='http:' && ['localhost','127.0.0.1','kong'].includes(root.hostname)))return unavailable();
    signal.throwIfAborted();
    const headers:Record<string,string>={apikey:secret,'Content-Type':'application/json'};
    if(!secret.startsWith('sb_secret_'))headers.Authorization=`Bearer ${secret}`;
    const response=await fetcher(`${root.origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body),signal,redirect:'error',cache:'no-store'});
    if(!response.ok || response.redirected)return unavailable();
    const bytes=await readBounded(response.body,4*1024*1024,signal);
    signal.throwIfAborted();
    let value:unknown;try {value=JSON.parse(new TextDecoder().decode(bytes));}catch {return unavailable();}
    return object(value);
  }
  return {
    async lookup(pair,signal):Promise<AssessmentLookup> {
      const v=await rpc('get_current_shared_segment_geographic_assessment_for_server',args(pair),signal);
      if(Object.keys(v).sort().join('|')!=='algorithm_version|assessment_id|canonical_result|lookup_state|parameter_fingerprint')return unavailable();
      if(v.lookup_state==='reuse_existing') {
        if(typeof v.assessment_id!=='string' || !UUID.test(v.assessment_id) || v.algorithm_version!==ASSESSMENT_VERSION ||
          typeof v.parameter_fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(v.parameter_fingerprint))return unavailable();
        return {lookup_state:'reuse_existing',assessment_id:v.assessment_id,algorithm_version:v.algorithm_version,
          parameter_fingerprint:v.parameter_fingerprint,canonical_result:assessmentResult(v.canonical_result)};
      }
      if(!['not_found','not_ready'].includes(String(v.lookup_state)) || v.assessment_id!==null || v.algorithm_version!==null ||
        v.parameter_fingerprint!==null || v.canonical_result!==null)return unavailable();
      return v as unknown as AssessmentLookup;
    },
    async context(pair,signal):Promise<AssessmentContext> {
      const v=await rpc('get_shared_segment_geographic_assessment_context_for_server',args(pair),signal);
      if(!['ready','evidence_unavailable','evidence_stale','evidence_invalid'].includes(String(v.input_state)))return unavailable();
      if(v.input_state!=='ready') {
        if(v.context!==null || v.input_context_fingerprint!==null || v.expires_at!==null || v.offerer_shape!==null || v.requester_shape!==null ||
          !(v.reason===null || v.reason==='unsupported_provider_contract'))return unavailable();
      } else {
        const c=object(v.context);
        if(c.need_id!==pair.needId || c.requester_id!==pair.requesterId || c.intent_id!==pair.intentId || c.offerer_id!==pair.offererId ||
          typeof v.input_context_fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(v.input_context_fingerprint) ||
          typeof v.expires_at!=='string' || !Number.isFinite(Date.parse(v.expires_at)) || c.expires_at!==v.expires_at || v.reason!==null)return unavailable();
      }
      return v as unknown as AssessmentContext;
    },
    async publish(pair,context,result,signal):Promise<PublishedAssessment> {
      const v=await rpc('publish_shared_segment_geographic_assessment_for_server',{...args(pair),p_context:context,p_result:result},signal);
      if(typeof v.assessment_id!=='string' || !UUID.test(v.assessment_id) || !['published','reuse_existing'].includes(String(v.publication_state)) || Object.keys(v).length!==2)return unavailable();
      return v as unknown as PublishedAssessment;
    },
  };
}
