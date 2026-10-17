import { readBounded } from './face-orchestration.ts';
import type { GeographicResponse, RequesterGeographicBackend } from './requester-geographic-support-contracts.ts';
import type { JobRegistration } from './shared-segment-assessment-job-contracts.ts';
import { assessmentResult } from './shared-segment-assessment-runtime.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Origin', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (status = 200, body: GeographicResponse = { geographicSupport: 'unavailable' }) => new Response(JSON.stringify(body), { status, headers });
function completed(value: JobRegistration): GeographicResponse | null {
  if (value.state !== 'assessment_reuse') return null;
  const result = assessmentResult(value.assessment.canonical_result);
  if (result.assessmentState !== 'complete') return { geographicSupport: 'unavailable' };
  if (!['geometric_corridor_support', 'overlap_observed', 'inconclusive'].includes(String(result.geographicResult))) throw Error('Unavailable');
  return { geographicSupport: result.geographicResult! };
}
// Reuse the entire unchanged 0094 handler as an in-process preparation operation.
// Its JWT/current-need checks, claim, quota, provider deadline and writer recovery
// all remain authoritative. No second network call or duplicated generation logic.
export function createRequesterGeographicSupportHandler(backend: RequesterGeographicBackend, prepareRoute: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST' || new URL(request.url).search) return response(400);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
      const bootstrap = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
      const jwt = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!jwt) return response(401);
      bootstrap.throwIfAborted();
      const member = await backend.authenticate(jwt, bootstrap);
      bootstrap.throwIfAborted();
      if (!member || !UUID.test(member)) return response(401);
      if (request.headers.get('Content-Type')?.split(';')[0].toLowerCase() !== 'application/json') return response(415);
      if (Number(request.headers.get('Content-Length')) > 2048) return response(413);
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(new TextDecoder().decode(await readBounded(request.body, 2048, bootstrap)));
      } catch (error) { bootstrap.throwIfAborted(); return response(error && typeof error === 'object' && 'status' in error && error.status === 413 ? 413 : 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join('|') !== 'availabilityId|movementNeedId'
        || typeof body.movementNeedId !== 'string' || !UUID.test(body.movementNeedId) || typeof body.availabilityId !== 'string' || !UUID.test(body.availabilityId)) return response(400);
      const need = body.movementNeedId, availability = body.availabilityId;
      if (!await backend.memberExists(member, bootstrap)) return response(403);
      if (!await backend.authorize(member, need, availability, bootstrap)) return response(404);
      bootstrap.throwIfAborted();
      const prepared = await prepareRoute(new Request(new URL('/generate-requester-route', request.url), {
        method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ movementNeedId: need }), signal,
      }));
      signal.throwIfAborted();
      const route = JSON.parse(new TextDecoder().decode(await readBounded(prepared.body, 2048, signal)));
      if (!route || typeof route !== 'object' || Array.isArray(route)) return response();
      if (prepared.status === 409 && route.state === 'in_progress' && Object.keys(route).sort().join('|') === 'retryAfterSeconds|state'
        && Number.isInteger(route.retryAfterSeconds) && route.retryAfterSeconds >= 1 && route.retryAfterSeconds <= 30) {
        if (!await backend.authorize(member, need, availability, signal)) return response();
        signal.throwIfAborted(); return response(200, { geographicSupport: 'pending', retryAfterSeconds: route.retryAfterSeconds });
      }
      if (prepared.status !== 200 || Object.keys(route).join('|') !== 'state' || !['generated', 'reuse_existing'].includes(route.state)) return response();
      if (!await backend.authorize(member, need, availability, signal)) return response();
      signal.throwIfAborted();
      let registered = await backend.register(member, need, availability, signal);
      signal.throwIfAborted();
      const hit = completed(registered); if (hit) return response(200, hit);
      if (registered.state === 'job_registered' && registered.status === 'completed') {
        // A completion racing registration gets one exact-current selected lookup,
        // never a compute or a reset of the terminal canonical job.
        registered = await backend.register(member, need, availability, signal);
        signal.throwIfAborted(); return response(200, completed(registered) ?? { geographicSupport: 'unavailable' });
      }
      return response(200, { geographicSupport: registered.state === 'job_registered' && ['pending', 'running'].includes(registered.status) ? 'pending' : 'unavailable' });
    } catch { return response(503); }
  };
}
