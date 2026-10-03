import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { requestActivationPayment } from '../services/activationPaymentService';
import { createActivationPaymentController } from '../state/activationPaymentState';
import type { PaymentViewState } from '../state/activationPaymentState';
import { openMyFundedMovementCoordination, getMyFundedMovementCoordinationReadiness } from '../services/movementService';
import { createFundedCoordinationEntryController, type CoordinationEntryState } from '../state/fundedCoordinationEntryState';

export function useActivationPayment(movementNeedId: string) {
  const owner = useMemo(() => {
    let state: PaymentViewState = 'idle';
    let signedIn = false;
    let active = false;
    let controller: ReturnType<typeof createActivationPaymentController> | null = null;
    let coordination: ReturnType<typeof createFundedCoordinationEntryController> | null = null;
    let coordinationState: CoordinationEntryState = 'idle';
    let fundedActivated = false;
    let legacyCoordinationReady = false;
    let readinessAbort: AbortController | null = null;
    let snapshot: { state: PaymentViewState; signedIn: boolean; active: boolean; coordinationState: CoordinationEntryState; fundedActivated: boolean; legacyCoordinationReady: boolean } = { state, signedIn, active, coordinationState, fundedActivated, legacyCoordinationReady };
    const listeners = new Set<() => void>();
    const publish = () => { snapshot = { state, signedIn, active, coordinationState, fundedActivated, legacyCoordinationReady }; listeners.forEach(fn => fn()); };
    return {
      subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
      getSnapshot: () => snapshot,
      connect() {
        let alive = true;
        let who: string | undefined;
        const reset = () => {
          controller?.dispose();
          coordination?.dispose();
          readinessAbort?.abort();
          readinessAbort = null;
          fundedActivated = false;
          legacyCoordinationReady = false;
          coordination = null;
          coordinationState = 'idle';
          controller = null;
          state = 'idle';
          active = AppState.currentState === 'active';
          if (signedIn && active) controller = createActivationPaymentController(movementNeedId, requestActivationPayment, next => { state = next; publish(); });
          if (signedIn && active) coordination = createFundedCoordinationEntryController(movementNeedId, async (need, signal) => {
            if (fundedActivated) return openMyFundedMovementCoordination(need, signal);
            const ready = await getMyFundedMovementCoordinationReadiness(need, signal);
            if (ready === true) return openMyFundedMovementCoordination(need, signal);
            if (ready === false) {
              // Server proved an existing legacy not_started container. No
              // financial construction or activation authority is inferred.
              return { movementNeedId: need, journeyState: 'not_started', coordinationReady: true };
            }
            throw new Error('movement_coordination_unavailable');
          }, next => { coordinationState = next; publish(); });
          if (signedIn && active) {
            const read = new AbortController();
            readinessAbort = read;
            // Read-only observation; construction remains exclusively an explicit tap.
            void getMyFundedMovementCoordinationReadiness(movementNeedId, read.signal).then(ready => {
              if (!alive || read.signal.aborted || readinessAbort !== read) return;
              fundedActivated = ready === true;
              legacyCoordinationReady = ready === false;
              publish();
            }).catch(() => {});
          }
          publish();
        };
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!alive) return;
          const next = session?.user.id;
          if (who !== next || !controller) { who = next; signedIn = !!next; reset(); }
        });
        const app = AppState.addEventListener('change', reset);
        return () => { alive = false; app.remove(); data.subscription.unsubscribe(); controller?.dispose(); coordination?.dispose(); readinessAbort?.abort(); readinessAbort = null; fundedActivated = false; legacyCoordinationReady = false; controller = null; coordination = null; coordinationState = 'idle'; signedIn = false; active = false; state = 'idle'; publish(); };
      },
      async start() { if (signedIn && active) await controller?.start(); },
      async continueCoordination(onReady: () => void) { if (signedIn && active && (fundedActivated || legacyCoordinationReady || state === 'activated')) await coordination?.open(onReady); },
    };
  }, [movementNeedId]);
  useFocusEffect(useCallback(() => owner.connect(), [owner]));
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { ...snapshot, start: owner.start, continueCoordination: owner.continueCoordination };
}
