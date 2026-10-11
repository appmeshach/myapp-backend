import { createRouteBackend } from './route-runtime.ts';
import { readBounded } from './face-orchestration.ts';
import { REQUESTER_ROUTE_CONTRACT } from './requester-route-contracts.ts';
import type { RequesterClaim, RequesterGenerationContext, RequesterPublication, RequesterPublished, RequesterRouteBackend } from './requester-route-contracts.ts';

declare const Deno: { env: { get(name: string): string | undefined } };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const unavailable = (): never => { throw new Error('Unavailable'); };
const id = (v: unknown): string => typeof v === 'string' && UUID.test(v) ? v : unavailable();
const time = (v: unknown): string => typeof v === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? v : unavailable();
const version = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v>0 ? v : unavailable();
function row(v: unknown): Record<string, unknown> {
  if (!Array.isArray(v) || v.length!==1 || !v[0] || typeof v[0]!=='object' || Array.isArray(v[0])) return unavailable();
  return v[0];
}
function coordinate(v: unknown, min: number, max: number): number {
  // PostgREST numeric normally arrives as a JSON number, never accept strings.
  return typeof v==='number' && Number.isFinite(v) && v>=min && v<=max ? v : unavailable();
}
export function runtimeRequesterRouteBackend(): RequesterRouteBackend {
  let secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  try { const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); if(typeof keys.default==='string' && keys.default) secret=keys.default; } catch { /* established fallback */ }
  return createRequesterRouteBackend(Deno.env.get('SUPABASE_URL') ?? '',secret);
}
export function createRequesterRouteBackend(url: string, secret: string, fetcher: typeof fetch = fetch): RequesterRouteBackend {
  const common=createRouteBackend(url,secret,fetcher);
  const c=REQUESTER_ROUTE_CONTRACT;
  async function rpc(name: string, args: Record<string, unknown>, signal: AbortSignal, jwt?: string): Promise<unknown> {
    const root=new URL(url);
    if(!secret || root.username || root.password || root.pathname!=='/' || root.search || root.hash || !(root.protocol==='https:' || (root.protocol==='http:' && ['localhost','127.0.0.1','kong'].includes(root.hostname)))) return unavailable();
    signal.throwIfAborted();
    const headers: Record<string,string>={apikey:secret,'Content-Type':'application/json'};
    if(jwt) headers.Authorization=`Bearer ${jwt}`;
    else if(!secret.startsWith('sb_secret_')) headers.Authorization=`Bearer ${secret}`;
    const r=await fetcher(`${root.origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args),signal,redirect:'error',cache:'no-store'});
    signal.throwIfAborted();
    if(!r.ok || r.redirected) return unavailable();
    const bytes=await readBounded(r.body,64*1024,signal);
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return {
    authenticate: common.authenticate, memberExists: common.memberExists,
    consumeRouteProviderQuota: common.consumeRouteProviderQuota,
    async isCurrentNeed(jwt,need,signal) {
      id(need);
      const body=await rpc('get_my_current_movement_need',{},signal,jwt);
      if(!Array.isArray(body) || body.length>1) return unavailable();
      if(body.length===0) return false;
      return id(row(body).movement_need_id)===need;
    },
    async claim(need,member,signal): Promise<RequesterClaim> {
      const r=row(await rpc('claim_requester_route_generation_for_server',{
        p_movement_need_id:id(need),p_requesting_member_id:id(member),p_provider_namespace:c.providerNamespace,
        p_provider_product:c.providerProduct,p_provider_version:c.providerVersion,p_evidence_schema_version:c.evidenceSchemaVersion,p_route_shape_format:c.routeShapeFormat,
      },signal));
      if(r.generation_state==='reuse_existing') {
        if(r.generation_claim_token!==null || r.retry_after_seconds!==0 || r.origin_location_reference_id!==null || r.destination_location_reference_id!==null || r.lease_expires_at!==null) return unavailable();
        return {state:'reuse_existing',evidenceId:id(r.route_evidence_id),evidenceVersion:version(r.route_evidence_version)};
      }
      if(r.route_evidence_id!==null || r.route_evidence_version!==null) return unavailable();
      if(r.generation_state==='in_progress') {
        if(r.generation_claim_token!==null || r.origin_location_reference_id!==null || r.destination_location_reference_id!==null || r.lease_expires_at!==null || typeof r.retry_after_seconds!=='number' || !Number.isInteger(r.retry_after_seconds) || r.retry_after_seconds<1 || r.retry_after_seconds>30) return unavailable();
        return {state:'in_progress',retryAfterSeconds:r.retry_after_seconds};
      }
      if(r.generation_state!=='claimed' || r.retry_after_seconds!==0) return unavailable();
      const originId=id(r.origin_location_reference_id),destinationId=id(r.destination_location_reference_id);
      if(originId===destinationId) return unavailable();
      return {state:'claimed',token:id(r.generation_claim_token),originId,destinationId,leaseExpiresAt:time(r.lease_expires_at)};
    },
    async context(need,member,token,signal): Promise<RequesterGenerationContext> {
      const r=row(await rpc('get_claimed_requester_route_generation_context_for_server',{p_movement_need_id:id(need),p_requesting_member_id:id(member),p_generation_claim_token:id(token)},signal));
      if(r.movement_need_id!==need || r.requesting_member_id!==member || r.evidence_schema_version!==c.evidenceSchemaVersion || r.route_shape_format!==c.routeShapeFormat || r.provider_namespace!==c.providerNamespace || r.provider_product!==c.providerProduct || r.provider_version!==c.providerVersion) return unavailable();
      const result: RequesterGenerationContext={movementNeedId:need,memberId:member,originId:id(r.origin_location_reference_id),destinationId:id(r.destination_location_reference_id),
        origin:{latitude:coordinate(r.origin_latitude,-90,90),longitude:coordinate(r.origin_longitude,-180,180)},
        destination:{latitude:coordinate(r.destination_latitude,-90,90),longitude:coordinate(r.destination_longitude,-180,180)},
        claimedAt:time(r.claimed_at),leaseExpiresAt:time(r.lease_expires_at),serverObservedAt:time(r.server_observed_at),earliestGeneratedAt:time(r.earliest_generated_at),movementNeedDeadline:time(r.movement_need_deadline),evidenceExpiresAt:time(r.evidence_expires_at)};
      const observed=Date.parse(result.serverObservedAt);
      if(result.originId===result.destinationId || Date.parse(result.claimedAt)>observed || Date.parse(result.earliestGeneratedAt)>observed || Date.parse(result.leaseExpiresAt)<=observed || Date.parse(result.evidenceExpiresAt)<=observed || Date.parse(result.evidenceExpiresAt)>Date.parse(result.movementNeedDeadline) || Date.parse(result.leaseExpiresAt)-Date.parse(result.claimedAt)!==30000) return unavailable();
      return result;
    },
    async publish(p: Readonly<RequesterPublication>,signal): Promise<RequesterPublished> {
      if(p.providerNamespace!==c.providerNamespace || p.providerProduct!==c.providerProduct || p.providerVersion!==c.providerVersion || p.evidenceSchemaVersion!==c.evidenceSchemaVersion || p.routeShapeFormat!==c.routeShapeFormat) return unavailable();
      const r=row(await rpc('record_claimed_requester_route_evidence_for_server',{
        p_movement_need_id:id(p.movementNeedId),p_requesting_member_id:id(p.memberId),p_generation_claim_token:id(p.token),p_origin_location_reference_id:id(p.originId),p_destination_location_reference_id:id(p.destinationId),
        p_evidence_schema_version:p.evidenceSchemaVersion,p_route_shape_format:p.routeShapeFormat,p_provider_namespace:p.providerNamespace,p_provider_product:p.providerProduct,p_provider_version:p.providerVersion,
        p_provider_route_reference:p.providerRouteReference,p_route_shape:p.routeShape,p_route_distance_meters:p.routeDistanceMeters,p_route_duration_seconds:p.routeDurationSeconds,p_generated_at:time(p.generatedAt),p_expires_at:time(p.expiresAt),
      },signal));
      if(r.publication_state!=='published' && r.publication_state!=='reuse_existing') return unavailable();
      return {state:r.publication_state,evidenceId:id(r.route_evidence_id),evidenceVersion:version(r.route_evidence_version)};
    },
  };
}
