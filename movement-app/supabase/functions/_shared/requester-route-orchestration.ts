import { readBounded } from './face-orchestration.ts';
import { REQUESTER_ROUTE_CONTRACT, REQUESTER_ROUTE_MAX_POINTS, REQUESTER_ENDPOINT_EQUIVALENCE_METERS } from './requester-route-contracts.ts';
import type { RequesterGenerationContext, RequesterPublication, RequesterRouteBackend, RequesterRouteProvider } from './requester-route-contracts.ts';
import type { MapboxDirectionsResult, TrustedRouteCoordinate } from './mapbox-directions-provider.ts';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const headers={'Cache-Control':'private, no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff',Vary:'Authorization, Origin','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
class Denied extends Error {
  readonly status:number; readonly state:string; readonly retry:number|null;
  constructor(status:number,state:string,retry:number|null=null){super(state);this.status=status;this.state=state;this.retry=retry;}
}
function response(status:number,state:string,retry:number|null=null):Response {
  return new Response(JSON.stringify({state,...(retry===null?{}:{retryAfterSeconds:retry})}),{status,headers:{...headers,...(retry===null?{}:{'Retry-After':String(retry)})}});
}
// Abort a wait even if a test/provider transport ignores cancellation. Its late
// result is consumed but cannot flow into publication or another provider call.
async function call<T>(work:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal):Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve,reject)=>{
    const aborted=()=>{signal.removeEventListener('abort',aborted);reject(signal.reason);};
    signal.addEventListener('abort',aborted,{once:true});
    Promise.resolve().then(()=>{signal.throwIfAborted();return work(signal);}).then(value=>{
      signal.removeEventListener('abort',aborted);
      if(signal.aborted)reject(signal.reason);else resolve(value);
    },error=>{signal.removeEventListener('abort',aborted);reject(error);});
  });
}
function distance(a:number[],b:TrustedRouteCoordinate):number {
  const rad=Math.PI/180,dy=(b.latitude-a[1])*rad,dx=(b.longitude-a[0])*rad;
  const h=Math.sin(dy/2)**2+Math.cos(a[1]*rad)*Math.cos(b.latitude*rad)*Math.sin(dx/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(Math.max(0,Math.min(1,h))),Math.sqrt(Math.max(0,1-h)));
}
function coordinate(v:unknown,min:number,max:number):boolean {return typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;}
export function validateRequesterProviderResult(r:MapboxDirectionsResult):void {
  const c=REQUESTER_ROUTE_CONTRACT;
  if(!r || r.providerNamespace!==c.providerNamespace || r.providerProduct!==c.providerProduct || r.providerVersion!==c.providerVersion
    || typeof r.providerRouteReference!=='string' || r.providerRouteReference!==r.providerRouteReference.trim() || !/\S/u.test(r.providerRouteReference) || Array.from(r.providerRouteReference).length>500
    || !Number.isSafeInteger(r.routeDistanceMeters) || r.routeDistanceMeters<1 || !Number.isSafeInteger(r.routeDurationSeconds) || r.routeDurationSeconds<1
    || typeof r.generatedAt!=='string' || !Number.isFinite(Date.parse(r.generatedAt)) || r.expiresAt!==null
    || !r.routeShape || r.routeShape.type!=='LineString' || Object.keys(r.routeShape).sort().join(',')!=='coordinates,type' || !Array.isArray(r.routeShape.coordinates) || r.routeShape.coordinates.length<2) {
    throw new Denied(502,'provider_response_invalid');
  }
  const points=r.routeShape.coordinates;
  if(points.length>REQUESTER_ROUTE_MAX_POINTS)throw new Denied(422,'unsupported_evidence');
  if(points.some(p=>!Array.isArray(p) || p.length!==2 || !coordinate(p[0],-180,180) || !coordinate(p[1],-90,90))
    || !points.some(p=>p[0]!==points[0][0] || p[1]!==points[0][1]))throw new Denied(502,'provider_response_invalid');
  const waypoints=r.snappedWaypoints;
  if(!Array.isArray(waypoints) || waypoints.length!==2 || waypoints.some(p=>!p || !coordinate(p.latitude,-90,90) || !coordinate(p.longitude,-180,180))
    || distance(points[0],waypoints[0])>REQUESTER_ENDPOINT_EQUIVALENCE_METERS || distance(points[points.length-1],waypoints[1])>REQUESTER_ENDPOINT_EQUIVALENCE_METERS) {
    throw new Denied(502,'provider_response_invalid');
  }
  // Two metres compares geometry to the PROVIDER'S snapped waypoints only.
  // No trusted-endpoint-to-snapped displacement threshold is imposed.
}
export interface RequesterRouteBudgets { overallMs:number; providerMs:number; recoveryMs:number; bootstrapMs:number; minimumPublicationMs:number }
const DEFAULT_BUDGETS:RequesterRouteBudgets={overallMs:20000,providerMs:5000,recoveryMs:3000,bootstrapMs:5000,minimumPublicationMs:2000};
export function createRequesterRouteGenerationHandler(backend:RequesterRouteBackend,provider:RequesterRouteProvider,options:Partial<RequesterRouteBudgets>={}) {
  const budget={...DEFAULT_BUDGETS,...options};
  if(Object.values(budget).some(v=>!Number.isInteger(v)||v<=0) || budget.overallMs>20000 || budget.providerMs>5000 || budget.recoveryMs>3000)throw new Error('Invalid server execution budget');
  return async(request:Request):Promise<Response>=>{
    try {
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(request.method!=='POST' || new URL(request.url).search)throw new Denied(400,'invalid_request');
      const started=performance.now();
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(budget.overallMs)]);
      const bootstrap=AbortSignal.any([signal,AbortSignal.timeout(budget.bootstrapMs)]);
      const jwt=request.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if(!jwt)throw new Denied(401,'authentication_required');
      const member=await call(s=>backend.authenticate(jwt,s),bootstrap);
      if(!member || !UUID.test(member))throw new Denied(401,'authentication_required');
      if(request.headers.get('Content-Type')?.split(';')[0].toLowerCase()!=='application/json')throw new Denied(415,'unsupported_content_type');
      const length=Number(request.headers.get('Content-Length'));
      if(Number.isFinite(length)&&length>2048)throw new Denied(413,'request_too_large');
      let body:unknown;
      try { body=JSON.parse(new TextDecoder().decode(await call(s=>readBounded(request.body,2048,s),bootstrap))); }
      catch(error) { bootstrap.throwIfAborted(); if(error && typeof error==='object' && 'status' in error && error.status===413)throw new Denied(413,'request_too_large');throw new Denied(400,'invalid_request'); }
      if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).join(',')!=='movementNeedId' || typeof (body as {movementNeedId?:unknown}).movementNeedId!=='string' || !UUID.test((body as {movementNeedId:string}).movementNeedId))throw new Denied(400,'invalid_request');
      const need=(body as {movementNeedId:string}).movementNeedId;
      if(!await call(s=>backend.memberExists(member,s),bootstrap))throw new Denied(403,'membership_required');
      if(!await call(s=>backend.isCurrentNeed(jwt,need,s),bootstrap))throw new Denied(404,'route_generation_unavailable');
      const claim=await call(s=>backend.claim(need,member,s),bootstrap);
      if(claim.state==='reuse_existing')return response(200,'reuse_existing');
      if(claim.state==='in_progress') {
        if(!Number.isInteger(claim.retryAfterSeconds)||claim.retryAfterSeconds<1||claim.retryAfterSeconds>30)throw new Error('Unavailable');
        return response(409,'in_progress',claim.retryAfterSeconds);
      }
      if(claim.state!=='claimed' || !UUID.test(claim.token) || !UUID.test(claim.originId) || !UUID.test(claim.destinationId) || claim.originId===claim.destinationId)throw new Error('Unavailable');
      let observedStart=performance.now();
      let ctx=await call(s=>backend.context(need,member,claim.token,s),bootstrap);
      const assertContext=(value:RequesterGenerationContext)=>{
        if(value.movementNeedId!==need || value.memberId!==member || value.originId!==claim.originId || value.destinationId!==claim.destinationId || value.leaseExpiresAt!==claim.leaseExpiresAt)throw new Error('Unavailable');
      };
      assertContext(ctx);
      const remaining=()=>Math.min(budget.overallMs-(performance.now()-started),Date.parse(ctx.leaseExpiresAt)-Date.parse(ctx.serverObservedAt)-(performance.now()-observedStart));
      const required=budget.providerMs+budget.minimumPublicationMs+budget.recoveryMs;
      if(!provider.isAvailable() || !(remaining()>required))throw new Error('Unavailable');
      const quota=await call(s=>backend.consumeRouteProviderQuota(member,s),bootstrap);
      if(typeof quota.admitted!=='boolean'||!Number.isInteger(quota.retryAfterSeconds)||(quota.admitted?quota.retryAfterSeconds!==0:quota.retryAfterSeconds<1||quota.retryAfterSeconds>86400))throw new Error('Unavailable');
      if(!quota.admitted)return response(429,'route_rate_limited',quota.retryAfterSeconds);
      signal.throwIfAborted();
      if(!(remaining()>required))throw new Error('Unavailable');
      const providerSignal=AbortSignal.any([signal,AbortSignal.timeout(budget.providerMs)]);
      const result=await call(s=>provider.route({origin:ctx.origin,destination:ctx.destination},s),providerSignal);
      providerSignal.throwIfAborted();
      validateRequesterProviderResult(result);
      // Observe the completed result using DB time and revalidate dependencies.
      // No live transaction is retained across provider work.
      observedStart=performance.now();
      ctx=await call(s=>backend.context(need,member,claim.token,s),signal);
      assertContext(ctx);
      const shape={type:'LineString' as const,coordinates:result.routeShape.coordinates.map(p=>[...p])};
      shape.coordinates.forEach(p=>Object.freeze(p));Object.freeze(shape.coordinates);Object.freeze(shape);
      const payload:Readonly<RequesterPublication>=Object.freeze({movementNeedId:need,memberId:member,token:claim.token,originId:ctx.originId,destinationId:ctx.destinationId,...REQUESTER_ROUTE_CONTRACT,
        providerRouteReference:result.providerRouteReference,routeShape:shape,routeDistanceMeters:result.routeDistanceMeters,routeDurationSeconds:result.routeDurationSeconds,
        generatedAt:ctx.serverObservedAt,expiresAt:ctx.evidenceExpiresAt});
      const writeMs=Math.floor(remaining()-budget.recoveryMs);
      if(writeMs<budget.minimumPublicationMs)throw new Error('Unavailable');
      let published;
      try { published=await call(s=>backend.publish(payload,s),AbortSignal.any([signal,AbortSignal.timeout(writeMs)])); }
      catch {
        signal.throwIfAborted();
        // Exact writer replay only: never acquire another claim or call provider.
        const recoveryMs=Math.floor(Math.min(budget.recoveryMs,remaining()));
        if(recoveryMs<=0)throw new Error('Unavailable');
        published=await call(s=>backend.publish(payload,s),AbortSignal.any([signal,AbortSignal.timeout(recoveryMs)]));
      }
      signal.throwIfAborted();
      if(!published || (published.state!=='published' && published.state!=='reuse_existing') || !UUID.test(published.evidenceId) || !Number.isSafeInteger(published.evidenceVersion) || published.evidenceVersion<1)throw new Error('Unavailable');
      return response(200,published.state==='reuse_existing'?'reuse_existing':'generated');
    } catch(error) {
      if(error instanceof Denied)return response(error.status,error.state,error.retry);
      if(error && typeof error==='object' && 'code' in error && error.code==='processing_limit')return response(422,'unsupported_evidence');
      return response(503,'route_generation_unavailable');
    }
  };
}
