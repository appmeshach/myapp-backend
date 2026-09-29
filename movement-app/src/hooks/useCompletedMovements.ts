import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { listMyCompletedMovementRecoveries } from '../services/completedMovementService';
import { createCompletedMovementController } from '../state/completedMovementController';

export function useCompletedMovements() {
  const owner = useMemo(() => createCompletedMovementController(listMyCompletedMovementRecoveries), []);
  useEffect(() => {
    let live = true;
    owner.activate();
    // INITIAL_SESSION loads on mount; every subsequent identity change clears
    // the old account's history before starting another authoritative read.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (live) owner.setAccount(session?.user.id ?? null);
    });
    return () => { live = false; owner.dispose(); data.subscription.unsubscribe(); };
  }, [owner]);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { state, refresh: owner.refresh };
}
