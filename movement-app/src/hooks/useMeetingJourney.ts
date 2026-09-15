import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { createMeetingController } from '../state/meetingJourneyController';
import { getMeetingJourneyStatus, setMeetingPoint, requestMovementStart, confirmMovementStart } from '../services/meetingJourneyService';
export function useMeetingJourney(need: string) {
  const owner = useMemo(() => createMeetingController(need, { read: getMeetingJourneyStatus, set: setMeetingPoint, request: requestMovementStart, confirm: confirmMovementStart }), [need]);
  useFocusEffect(useCallback(() => {
    let live = true; let who: string | undefined;
    const sync = () => { owner.clear(); if (who && AppState.currentState === 'active') { owner.activate(); void owner.refresh(); } };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (!live) return; const next = session?.user.id; if (who !== next) { who = next; sync(); } });
    const app = AppState.addEventListener('change', sync);
    return () => { live = false; owner.clear(); app.remove(); data.subscription.unsubscribe(); };
  }, [owner]));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { state, refresh: owner.refresh, save: owner.save, requestStart: owner.requestStart, confirmStart: owner.confirmStart };
}
