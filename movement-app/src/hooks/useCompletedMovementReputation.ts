import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { getCompletedMovementRatingTargets, rateCompletedMovementPerson } from '../services/completedMovementReputationService';
import { createCompletedMovementReputationController } from '../state/completedMovementReputationController';
export function useCompletedMovementReputation(need: string) {
  const owner = useMemo(() => createCompletedMovementReputationController(need, { read: getCompletedMovementRatingTargets, rate: rateCompletedMovementPerson }), [need]);
  useEffect(() => {
    let live = true;
    owner.activate();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (live) owner.setAccount(session?.user.id ?? null); });
    return () => { live = false; owner.dispose(); data.subscription.unsubscribe(); };
  }, [owner]);
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { state, select: owner.select, submit: owner.submit, refresh: owner.refresh };
}
