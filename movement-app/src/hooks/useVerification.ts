import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getMyAlignmentFaceVerificationStatus, getMyProfilePhotoSubmissionStatus } from '../services/faceVerificationService';
import { submitMovementIdentityPhoto } from '../services/faceOrchestrationService';
import { unavailableBiometricProvider } from '../providers/movementBiometricProvider';
import type { MovementBiometricProvider } from '../providers/movementBiometricProvider';
import { createMovementController, createPhotoController, createStatusPoller } from '../state/verificationController';

// No account/session identifiers are stored in public verification state. Auth
// changes replace the entire owner; stale responses cannot cross accounts.
function useAccountGeneration() {
  const [account, setAccount] = useState({ generation: 0, signedIn: false });
  useEffect(() => {
    let alive = true; let seen = false; let who: string | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id;
      if (alive && (!seen || who !== next)) {
        seen = true; who = next;
        setAccount(previous => ({ generation: previous.generation + 1, signedIn: !!next }));
      }
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
  return account;
}
function useStatusOwner<T extends { refresh(): Promise<void>; shouldPoll(): boolean; reset(): void; activate(): void; deactivate(): void }>(owner: T, signedIn: boolean) {
  const poller = useMemo(() => createStatusPoller(() => owner.refresh(), () => owner.shouldPoll()), [owner]);
  useFocusEffect(useCallback(() => {
    const sync = () => {
      if (signedIn && AppState.currentState === 'active') { owner.activate(); poller.resume(); }
      else { poller.pause(); owner.deactivate(); }
    };
    sync(); const subscription = AppState.addEventListener('change', sync);
    return () => { subscription.remove(); poller.pause(); owner.deactivate(); owner.reset(); };
  }, [owner, poller, signedIn]));
  // Pausing plus reset supports React StrictMode's effect cleanup/remount.
  return poller;
}
export function useProfilePhotoVerification() {
  const account = useAccountGeneration();
  const owner = useMemo(() => createPhotoController({ status: getMyProfilePhotoSubmissionStatus, submit: submitMovementIdentityPhoto }), [account.generation]);
  const poller = useStatusOwner(owner, account.signedIn);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { state, signedIn: account.signedIn, refresh: poller.refresh,
    async submit(photo: Blob) { if (!account.signedIn) return; await owner.submit(photo); await poller.refresh(); } };
}
export function useMovementFaceVerification(movementNeedId: string, provider: MovementBiometricProvider = unavailableBiometricProvider) {
  const account = useAccountGeneration();
  const owner = useMemo(() => createMovementController(movementNeedId, getMyAlignmentFaceVerificationStatus, provider),
    [movementNeedId, provider, account.generation]);
  const poller = useStatusOwner(owner, account.signedIn);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  // An expiry timer performs a local downgrade without polling terminal states.
  useEffect(() => {
    if (!state.expiresAt || !['pending','provider_session_ready','succeeded'].includes(state.phase)) return;
    const delay = Math.max(0, Date.parse(state.expiresAt) - Date.now());
    const timer = setTimeout(() => owner.tick(), Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [state.expiresAt, state.phase, owner]);
  return { state, signedIn: account.signedIn, refresh: poller.refresh,
    async start() { if (!account.signedIn) return; await owner.start(); if (owner.getSnapshot().phase === 'pending') await poller.refresh(); } };
}
