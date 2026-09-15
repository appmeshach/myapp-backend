import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { loadMovementCoordination, validMovementNeed } from '../services/coordinationService';
import type { CoordinationReveal } from '../services/coordinationService';

export type CoordinationState = { phase: 'signed_out' | 'loading' | 'ready' | 'unavailable' | 'error'; reveal: CoordinationReveal | null };
export function useMovementCoordination(need: string) {
  const owner = useMemo(() => {
    let state: CoordinationState = { phase: 'signed_out', reveal: null };
    let live = false; let signedIn = false; let generation = 0;
    let abort: AbortController | null = null;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const listeners = new Set<() => void>();
    const set = (next: CoordinationState) => { state = next; listeners.forEach(fn => fn()); };
    const clear = () => { generation++; abort?.abort(); abort = null; clearTimeout(expiry); set({ phase: signedIn ? 'unavailable' : 'signed_out', reveal: null }); };
    async function refresh() {
      clear();
      if (!live || !signedIn || AppState.currentState !== 'active' || !validMovementNeed(need)) return;
      const attempt = generation; const request = abort = new AbortController();
      set({ phase: 'loading', reveal: null });
      const timeout = setTimeout(() => { if (attempt === generation) { clear(); set({ phase: 'error', reveal: null }); } }, 30_000);
      try {
        const reveal = await loadMovementCoordination(need, request.signal);
        if (live && attempt === generation && !request.signal.aborted) {
          set({ phase: reveal ? 'ready' : 'unavailable', reveal });
          // Drop in-memory identity/photo bytes rather than retain indefinitely.
          expiry = setTimeout(clear, 4 * 60_000);
        }
      } catch { if (live && attempt === generation && !request.signal.aborted) set({ phase: 'error', reveal: null }); }
      finally { clearTimeout(timeout); }
    }
    return {
      subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
      getSnapshot: () => state, refresh,
      connect() {
        live = true; let connected = true; let who: string | undefined;
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!connected || !live) return;
          const next = session?.user.id;
          if (who !== next) { who = next; signedIn = !!next; clear(); if (signedIn) void refresh(); }
        });
        const app = AppState.addEventListener('change', () => { clear(); if (AppState.currentState === 'active') void refresh(); });
        return () => { connected = false; live = false; signedIn = false; clear(); data.subscription.unsubscribe(); app.remove(); };
      },
    };
  }, [need]);
  useFocusEffect(useCallback(() => owner.connect(), [owner]));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { state, refresh: owner.refresh };
}
