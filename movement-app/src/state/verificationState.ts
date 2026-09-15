import type { AlignmentFaceVerificationStatus, ProfilePhotoSubmissionStatus } from '../types/faceVerification';

export type VerificationError = 'authentication_required' | 'verification_unavailable' | 'photo_invalid'
  | 'photo_too_large' | 'photo_processing_failed' | 'verification_expired' | 'verification_failed'
  | 'network_unavailable' | 'unknown';
export function safeVerificationError(value: unknown): VerificationError {
  const message = value instanceof Error ? value.message : '';
  if (message === 'authentication_required') return message;
  if (message === 'invalid_photo' || message === 'photo_invalid') return 'photo_invalid';
  if (message === 'photo_too_large') return message;
  if (message === 'network_unavailable' || (value instanceof Error && ['TypeError','AbortError','TimeoutError'].includes(value.name))) return 'network_unavailable';
  return 'verification_unavailable';
}
export type PhotoPhase = 'none' | 'submitting' | 'processing' | 'prepared_unverified' | 'verified' | 'failed';
export type PhotoState = { [P in PhotoPhase]: {
  phase: P; error: VerificationError | null; loaded: boolean;
  submittedAt: string | null; replacementPending: boolean;
} }[PhotoPhase];
export const initialPhoto: PhotoState = { phase: 'none', error: null, loaded: false, submittedAt: null, replacementPending: false };
export type PhotoEvent = { type: 'submit' } | { type: 'uploaded'; status: 'pending' | 'ready' }
  | { type: 'backend'; row: ProfilePhotoSubmissionStatus | null }
  | { type: 'error'; error: VerificationError };
export function photoTransition(state: PhotoState, event: PhotoEvent): PhotoState {
  switch (event.type) {
    case 'submit':
      if (state.phase === 'submitting') throw new Error('Invalid photo transition');
      return { ...state, phase: 'submitting', error: null, replacementPending: true };
    case 'uploaded':
      if (state.phase !== 'submitting') throw new Error('Invalid photo transition');
      return { ...state, phase: event.status === 'ready' ? 'prepared_unverified' : 'processing', error: null };
    case 'error': return { ...state, error: event.error, ...(state.phase === 'submitting' ? { phase: 'none' as const } : {}) };
    case 'backend': {
      if (state.phase === 'submitting') return state;
      const row = event.row;
      // A replacement may still be in flight or have an ambiguous upload result.
      // Never re-display the previous photo's verified state as its replacement.
      if (state.replacementPending && (!row || row.submittedAt === state.submittedAt)) return { ...state, loaded: true };
      if (!row) return { ...initialPhoto, loaded: true };
      const phase: PhotoPhase = row.status === 'pending' ? 'processing'
        : row.status === 'failed' ? 'failed'
        : row.status === 'ready' ? (row.currentPhotoVerified ? 'verified' : 'prepared_unverified') : 'none';
      return { phase, submittedAt: row.submittedAt, loaded: true, replacementPending: false,
        error: phase === 'failed' ? 'photo_processing_failed' : null };
    }
  }
}

export type MovementPhase = 'not_required' | 'required' | 'starting' | 'provider_unavailable'
  | 'provider_session_ready' | 'pending' | 'succeeded' | 'failed' | 'expired';
export type MovementState = { [P in MovementPhase]: {
  phase: P; error: VerificationError | null; loaded: boolean; ownReady: boolean;
  expiresAt: string | null; completedAt: string | null; awaitingNewAttempt: boolean;
} }[MovementPhase];
export const initialMovement: MovementState = { phase: 'required', error: null, loaded: false, ownReady: false,
  expiresAt: null, completedAt: null, awaitingNewAttempt: false };
// PostgreSQL timestamps carry microseconds; Date.parse alone collapses distinct
// attempts created within the same millisecond. 0016 fixes lifetime at 10 minutes.
function attemptTime(value: string | null): number {
  if (!value) return 0;
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '';
  return Date.parse(value) * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
}
export type MovementEvent = { type: 'start' } | { type: 'unavailable' }
  | { type: 'session'; expiresAt: string } | { type: 'capture_submitted' }
  | { type: 'backend'; row: AlignmentFaceVerificationStatus | null; now: number }
  | { type: 'error'; error: VerificationError } | { type: 'tick'; now: number };
export function movementTransition(state: MovementState, event: MovementEvent): MovementState {
  switch (event.type) {
    case 'start':
      if (['starting','provider_session_ready','pending','not_required'].includes(state.phase)) throw new Error('Invalid movement transition');
      return { ...state, phase: 'starting', ownReady: false, error: null, awaitingNewAttempt: true };
    case 'unavailable':
      if (!['starting','provider_session_ready'].includes(state.phase)) throw new Error('Invalid movement transition');
      return { ...state, phase: 'provider_unavailable', ownReady: false, error: 'verification_unavailable' };
    case 'session':
      if (state.phase !== 'starting' || !Number.isFinite(Date.parse(event.expiresAt))) throw new Error('Invalid movement transition');
      if (state.expiresAt && attemptTime(event.expiresAt) <= attemptTime(state.expiresAt)) throw new Error('Stale provider receipt');
      return { ...state, phase: 'provider_session_ready', expiresAt: event.expiresAt, completedAt: null, awaitingNewAttempt: false };
    case 'capture_submitted':
      if (state.phase !== 'provider_session_ready') throw new Error('Invalid movement transition');
      return { ...state, phase: 'pending' };
    case 'error': return { ...state, error: event.error, ownReady: false,
      ...(['starting','provider_session_ready'].includes(state.phase) ? { phase: 'required' as const } : {}) };
    case 'tick':
      if (state.expiresAt && Date.parse(state.expiresAt) <= event.now && ['pending','provider_session_ready','succeeded'].includes(state.phase)) {
        return { ...state, phase: 'expired', ownReady: false, error: null };
      }
      return state;
    case 'backend': {
      if (state.phase === 'starting' || state.phase === 'provider_session_ready') return state;
      const row = event.row;
      if (!row) return state.awaitingNewAttempt ? state : { ...initialMovement, phase: 'not_required', loaded: true };
      // A fresh authorized read can remove readiness (for example a new alignment).
      if (row.status === 'not_started') return { ...initialMovement, loaded: true };
      const time = attemptTime(row.expiresAt);
      const previous = attemptTime(state.expiresAt);
      if (time < previous || (state.awaitingNewAttempt && time <= previous)) return state;
      // A failed/expired attempt cannot become a success without a newer attempt.
      if (time === previous && ['expired','failed'].includes(state.phase) && row.status === 'succeeded') return state;
      const expired = !!time && time <= event.now * 1000 && ['pending','succeeded','expired'].includes(row.status);
      const phase: MovementPhase = expired ? 'expired' : row.status === 'superseded'
        ? 'required' : row.status;
      return { phase, loaded: true, error: null, expiresAt: row.expiresAt, completedAt: row.completedAt,
        ownReady: phase === 'succeeded' && row.readyForActivation, awaitingNewAttempt: false };
    }
  }
}
export function ownPaymentReadiness(s: MovementState): 'current_member_ready' | 'not_ready' | 'provider_unavailable' | 'verification_in_progress' {
  if (s.error && s.phase !== 'provider_unavailable') return 'not_ready';
  if (s.phase === 'succeeded' && s.ownReady) return 'current_member_ready';
  if (s.phase === 'provider_unavailable') return 'provider_unavailable';
  if (['starting','provider_session_ready','pending'].includes(s.phase)) return 'verification_in_progress';
  return 'not_ready';
}
