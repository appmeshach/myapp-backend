import { readBounded } from './face-orchestration.ts';
import type { AssessmentBackend, AssessmentContext, PairIdentity, PublishedAssessment } from './shared-segment-assessment-contracts.ts';

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
