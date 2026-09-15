import type { MovementState, PhotoState, VerificationError } from '../state/verificationState';
export const errorCopy: Record<VerificationError,string> = {
  authentication_required: 'Sign in to continue.', verification_unavailable: 'This check is unavailable right now. Please try again later.',
  photo_invalid: 'Choose a JPEG, PNG, or WebP photo.', photo_too_large: 'Choose a photo smaller than 5 MiB.',
  photo_processing_failed: 'We could not prepare this photo. Please try another.',
  verification_expired: 'Your check expired. Please try again.', verification_failed: 'The check could not be completed. Please try again.',
  network_unavailable: 'Connection unavailable. Your last status is shown. Try refreshing.', unknown: 'Unable to refresh right now.',
};
export function photoCopy(s: PhotoState) {
  const copy = {
    none: 'Add a current photo for movement identification.', submitting: 'Submitting your photo…',
    processing: 'Photo submitted. Waiting for preparation.', prepared_unverified: 'Photo prepared. A live face check is still required.',
    verified: 'Your movement identity photo has passed a live face check.', failed: 'Your photo could not be prepared.',
  };
  return { title: 'Movement identity photo', body: copy[s.phase],
    // This is own-photo status, not the public account Verified badge.
    label: s.phase === 'verified' ? 'Verified photo' : s.phase === 'prepared_unverified' ? 'Prepared' : null };
}
export function movementCopy(s: MovementState) {
  const copy = {
    not_required: 'No face check is available for this movement.', required: 'Complete a fresh live face check before this movement can activate.',
    starting: 'Starting your check…', provider_unavailable: 'Live face checks are not available yet. Please try again later.',
    provider_session_ready: 'Your check is ready to continue.', pending: 'Verification in progress.',
    succeeded: s.ownReady ? 'Your face check is ready for this movement.' : 'Your check is recorded. Activation readiness must be confirmed again.',
    failed: 'The check could not be completed. You can try again.', expired: 'Verification expired. Start a new check to continue.',
  };
  return { title: 'Live face check required', body: copy[s.phase],
    canStart: ['required','provider_unavailable','failed','expired'].includes(s.phase) || (s.phase === 'succeeded' && !s.ownReady),
    action: ['failed','expired','provider_unavailable'].includes(s.phase) ? 'Try again' : 'Start face check' };
}
