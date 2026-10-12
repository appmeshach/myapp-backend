import { createRouteBackend } from './route-runtime.ts';
import { createAssessmentJobBackend } from './shared-segment-assessment-job-runtime.ts';
import type { RequesterGeographicBackend } from './requester-geographic-support-contracts.ts';
declare const Deno: { env: { get(name: string): string | undefined } };

export function createRequesterGeographicBackend(url: string, secret: string, fetcher: typeof fetch = fetch): RequesterGeographicBackend {
  const selected = createRouteBackend(url, secret, fetcher);
  const jobs = createAssessmentJobBackend(url, secret, fetcher);
  return {
    authenticate: selected.authenticate, memberExists: selected.memberExists,
    authorize: async (member, need, availability, signal) => !!await selected.getRequesterAvailabilityMatchingContext(member, need, availability, signal),
    register: jobs.register,
  };
}
export function runtimeRequesterGeographicBackend(): RequesterGeographicBackend {
  let secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  try { const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); if (typeof keys.default === 'string' && keys.default) secret = keys.default; } catch { /* established fallback */ }
  return createRequesterGeographicBackend(Deno.env.get('SUPABASE_URL') ?? '', secret);
}
