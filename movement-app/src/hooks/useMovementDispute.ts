import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { createMovementDisputeController } from '../state/movementDisputeController';
import { getMovementDisputeStatus, openMovementDispute } from '../services/movementDisputeService';
export function useMovementDispute(need: string) {
  const owner = useMemo(() => createMovementDisputeController(need, { read: getMovementDisputeStatus, open: openMovementDispute }), [need]);
  useFocusEffect(useCallback(() => {
    let live = true;
    let who: string | undefined;
    const sync = () => {
      if (!live) return;
      owner.clear();
      if (who && AppState.currentState === 'active') { owner.activate(); void owner.refresh(); }
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!live) return;
      const next = session?.user.id;
      if (who !== next) { who = next; sync(); }
    });
    const app = AppState.addEventListener('change', sync);
    return () => { live = false; owner.clear(); app.remove(); data.subscription.unsubscribe(); };
  }, [owner]));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { state, refresh: owner.refresh, openDispute: owner.openDispute };
}
