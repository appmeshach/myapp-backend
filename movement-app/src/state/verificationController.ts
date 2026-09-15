import { initialMovement, initialPhoto, movementTransition, photoTransition, safeVerificationError } from './verificationState';
import type { MovementEvent, MovementState, PhotoEvent, PhotoState } from './verificationState';
import type { AlignmentFaceVerificationStatus, ProfilePhotoSubmissionStatus, PhotoSubmissionReceipt, FaceVerificationStartResult } from '../types/faceVerification';
import type { MovementBiometricProvider } from '../providers/movementBiometricProvider';

// One timer and at most one read per owner; timers begin after a read finishes.
// Cleanup invalidates in-flight results even when the transport cannot abort.
export function createStatusPoller(read: () => Promise<void>, shouldPoll: () => boolean,
  schedule: (fn: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout) {
  let active = false; let disposed = false; let running = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let polls = 0; let queued = false;
  function clear() { if (timer !== undefined) cancel(timer); timer = undefined; }
  async function refresh() {
    clear();
    if (!active || disposed) return;
    if (running) { queued = true; return; }
    running = true;
    try { await read(); } finally {
      running = false;
      if (active && !disposed && queued) { queued = false; void refresh(); }
      else if (active && !disposed && shouldPoll() && polls++ < 20) timer = schedule(() => { void refresh(); }, 15_000);
    }
  }
  return { refresh,
    resume() { if (active || disposed) return; active = true; polls = 0; void refresh(); },
    pause() { active = false; queued = false; clear(); },
    dispose() { disposed = true; active = false; queued = false; clear(); },
  };
}

export function createPhotoController(services: { status(signal?: AbortSignal): Promise<ProfilePhotoSubmissionStatus | null>; submit(photo: Blob): Promise<PhotoSubmissionReceipt> }) {
  let state: PhotoState = { ...initialPhoto }; let generation = 0; let dead = false; let busy = false;
  let readId = 0; let readAbort: AbortController | undefined;
  function cancelRead() { readId++; readAbort?.abort(); }
  const listeners = new Set<() => void>();
  function event(e: PhotoEvent) { if (dead) return; state = photoTransition(state,e); listeners.forEach(fn => fn()); }
  async function refresh() {
    if (busy || dead) return; const current = generation;
    cancelRead(); const request = readId; readAbort = new AbortController();
    const live = () => !dead && current === generation && request === readId;
    try { const row = await services.status(readAbort.signal); if (live()) event({ type: 'backend', row }); }
    catch (e) { if (live()) event({ type: 'error', error: safeVerificationError(e) }); }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, refresh,
    shouldPoll: () => busy || state.phase === 'processing' || (!state.loaded && state.error === 'network_unavailable'),
    async submit(photo: Blob) {
      if (busy || dead) return false; busy = true; cancelRead(); const current = ++generation; event({ type: 'submit' });
      try { const receipt = await services.submit(photo); if (!dead && current === generation) {
        event({ type: 'uploaded', status: receipt.status }); return true;
      } return false; }
      catch (e) { if (!dead && current === generation) event({ type: 'error', error: safeVerificationError(e) }); return false; }
      finally { busy = false; if (!dead && current !== generation) await refresh(); }
    },
    reset() { generation++; cancelRead(); state = { ...initialPhoto }; if (!dead) listeners.forEach(fn => fn()); },
    activate() { dead = false; listeners.forEach(fn => fn()); },
    deactivate() {
      if (state.phase === 'submitting') {
        state = { ...state, phase: 'none', error: 'verification_unavailable' };
      }
      dead = true; generation++; cancelRead();
    },
    dispose() { dead = true; generation++; cancelRead(); listeners.clear(); },
  };
}
export function createMovementController(need: string, services: {
  status(need: string, signal?: AbortSignal): Promise<AlignmentFaceVerificationStatus | null>;
  start(need: string, signal: AbortSignal): Promise<FaceVerificationStartResult>;
}, provider: MovementBiometricProvider,
  now: () => number = Date.now) {
  let state: MovementState = { ...initialMovement }; let generation = 0; let dead = false; let busy = false;
  let readId = 0; let readAbort: AbortController | undefined;
  let startAbort: AbortController | undefined;
  const validNeed = typeof need === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(need);
  function cancelRead() { readId++; readAbort?.abort(); }
  function stopAttempt() { generation++; startAbort?.abort(); startAbort = undefined; busy = false; cancelRead(); }
  const listeners = new Set<() => void>();
  function event(e: MovementEvent) { if (dead) return; state = movementTransition(state,e); listeners.forEach(fn => fn()); }
  async function refresh() {
    if (busy || dead) return; const current = generation;
    if (!validNeed) { event({ type: 'backend', row: null, now: now() }); return; }
    cancelRead(); const request = readId; readAbort = new AbortController();
    const live = () => !dead && current === generation && request === readId;
    event({ type: 'tick', now: now() });
    try { const row = await services.status(need, readAbort.signal); if (live()) event({ type: 'backend', row, now: now() }); }
    catch (e) { if (live()) event({ type: 'error', error: safeVerificationError(e) }); }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, refresh,
    shouldPoll: () => busy || state.phase === 'pending' || (!state.loaded && state.error === 'network_unavailable'),
    tick() { event({ type: 'tick', now: now() }); if (state.phase === 'expired' && busy) stopAttempt(); },
    cancel() { if (dead) return; stopAttempt(); event({ type: 'cancel' }); },
    async start() {
      if (!validNeed || busy || dead || ['not_required','pending','provider_session_ready'].includes(state.phase)) return false;
      busy = true; cancelRead(); const current = ++generation; event({ type: 'start' });
      startAbort = new AbortController(); const signal = startAbort.signal;
      const live = () => !dead && current === generation && !signal.aborted;
      try {
        const receipt = await services.start(need, signal);
        if (!live()) return false;
        if (receipt.status === 'provider_unavailable') { event({ type: 'unavailable' }); return false; }
        event({ type: 'session', expiresAt: receipt.expiresAt });
        if (Date.parse(receipt.expiresAt) <= now()) { event({ type: 'tick', now: now() }); return false; }
        if (!await provider.isAvailable(signal)) { if (live()) event({ type: 'unavailable' }); return false; }
        if (!live()) return false;
        const prepared = await provider.start({ movementNeedId: need, expiresAt: receipt.expiresAt }, signal);
        if (!live()) return false;
        if (prepared !== 'ready') { event({ type: 'unavailable' }); return false; }
        const captured = await provider.presentCapture(signal);
        if (!live()) return false;
        if (captured === 'submitted') { event({ type: 'capture_submitted' }); return true; }
        else if (captured === 'cancelled') { event({ type: 'cancel' }); return true; }
        else if (captured === 'unavailable') event({ type: 'unavailable' });
        else event({ type: 'error', error: 'verification_unavailable' });
      } catch (e) { if (live()) event({ type: 'error', error: safeVerificationError(e) }); }
      finally { if (current === generation) { busy = false; startAbort?.abort(); startAbort = undefined; } }
      return false;
    },
    reset() { stopAttempt(); state = { ...initialMovement }; if (!dead) listeners.forEach(fn => fn()); },
    activate() { dead = false; listeners.forEach(fn => fn()); },
    deactivate() {
      if (state.phase === 'starting' || state.phase === 'provider_session_ready') {
        state = { ...state, phase: 'required', ownReady: false };
      }
      dead = true; stopAttempt();
    },
    dispose() { dead = true; stopAttempt(); listeners.clear(); },
  };
}
