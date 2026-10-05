import type { CompletedMovementRatingTarget } from '../services/completedMovementReputationService';
type API = {
  read: (need: string, signal: AbortSignal) => Promise<CompletedMovementRatingTarget[]>;
  rate: (need: string, person: number, stars: number, signal: AbortSignal) => Promise<CompletedMovementRatingTarget[]>;
};
export function createCompletedMovementReputationController(need: string, api: API) {
  let state: { target: CompletedMovementRatingTarget | null; selected: number | null; busy: boolean; error: boolean } = { target: null, selected: null, busy: false, error: false };
  let live = false, account: string | null = null, generation = 0;
  let active: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: typeof state) => { state = next; listeners.forEach(fn => fn()); };
  async function perform(stars?: number) {
    if (!live || !account || state.busy) return;
    const token = ++generation, abort = active = new AbortController();
    publish({ ...state, busy: true, error: false });
    const timer = setTimeout(() => { if (live && token === generation) { generation++; abort.abort(); publish({ ...state, busy: false, error: true }); } }, 30_000);
    try {
      const rows = stars === undefined ? await api.read(need, abort.signal) : await api.rate(need, 1, stars, abort.signal);
      if (live && token === generation && !abort.signal.aborted) publish({ target: rows[0], selected: rows[0].myStars, busy: false, error: false });
    } catch { if (live && token === generation && !abort.signal.aborted) publish({ ...state, busy: false, error: true }); }
    finally { clearTimeout(timer); }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    activate() { live = true; },
    setAccount(next: string | null) {
      if (!live || next === account) return;
      generation++; active?.abort(); account = next;
      publish({ target: null, selected: null, busy: false, error: false });
      if (account) void perform();
    },
    dispose() { live = false; account = null; generation++; active?.abort(); publish({ target: null, selected: null, busy: false, error: false }); },
    refresh: () => perform(),
    select(stars: number) { if (!state.busy && state.target && !state.target.alreadyRated && Number.isInteger(stars) && stars >= 1 && stars <= 5) publish({ ...state, selected: stars }); },
    submit() { if (!state.target || state.target.alreadyRated || state.selected === null) return Promise.resolve(); return perform(state.selected); },
  };
}
