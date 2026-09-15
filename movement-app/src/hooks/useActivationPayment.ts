import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { requestActivationPayment } from '../services/activationPaymentService';
import { createActivationPaymentController } from '../state/activationPaymentState';
import type { PaymentViewState } from '../state/activationPaymentState';

export function useActivationPayment(movementNeedId: string) {
  const owner = useMemo(() => {
    let state: PaymentViewState = 'idle';
    let signedIn = false;
    let active = false;
    let controller: ReturnType<typeof createActivationPaymentController> | null = null;
    let snapshot: { state: PaymentViewState; signedIn: boolean; active: boolean } = { state, signedIn, active };
    const listeners = new Set<() => void>();
    const publish = () => { snapshot = { state, signedIn, active }; listeners.forEach(fn => fn()); };
    return {
      subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
      getSnapshot: () => snapshot,
      connect() {
        let alive = true;
        let who: string | undefined;
        const reset = () => {
          controller?.dispose();
          controller = null;
          state = 'idle';
          active = AppState.currentState === 'active';
          if (signedIn && active) controller = createActivationPaymentController(movementNeedId, requestActivationPayment, next => { state = next; publish(); });
          publish();
        };
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!alive) return;
          const next = session?.user.id;
          if (who !== next || !controller) { who = next; signedIn = !!next; reset(); }
        });
        const app = AppState.addEventListener('change', reset);
        return () => { alive = false; app.remove(); data.subscription.unsubscribe(); controller?.dispose(); controller = null; signedIn = false; active = false; state = 'idle'; publish(); };
      },
      async start() { if (signedIn && active) await controller?.start(); },
    };
  }, [movementNeedId]);
  useFocusEffect(useCallback(() => owner.connect(), [owner]));
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { ...snapshot, start: owner.start };
}
