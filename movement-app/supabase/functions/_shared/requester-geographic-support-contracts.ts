import type { JobRegistration } from './shared-segment-assessment-job-contracts.ts';

export type GeographicSupport = 'geometric_corridor_support' | 'overlap_observed' | 'inconclusive' | 'pending' | 'unavailable';
export interface GeographicResponse { geographicSupport: GeographicSupport; retryAfterSeconds?: number }
export interface RequesterGeographicBackend {
  authenticate(jwt: string, signal: AbortSignal): Promise<string | null>;
  memberExists(member: string, signal: AbortSignal): Promise<boolean>;
  authorize(member: string, need: string, availability: string, signal: AbortSignal): Promise<boolean>;
  register(member: string, need: string, availability: string, signal: AbortSignal): Promise<JobRegistration>;
}
