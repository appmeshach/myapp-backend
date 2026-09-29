import type { MovementEndStatus } from '../services/movementEndService';

type Action = 'read' | 'request' | 'confirm' | 'decline';
type Api = Record<Action, (need: string, signal: AbortSignal) => Promise<MovementEndStatus>>;
export type MovementEndState = { status: MovementEndStatus | null; busy: boolean; error: boolean };

export function createMovementEndController(need: string, api: Api) {
  let state: MovementEndState = { status: null, busy: false, error: false };
  let active = false;
  let generation = 0;
  let pending: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: MovementEndState) => { state = next; listeners.forEach(fn => fn()); };
  async function run(action: Action) {
    if (!active || state.busy) return;
    const s = state.status;
    if (action === 'request' && s?.endStatus !== 'no_pending_end_request') return;
    if ((action === 'confirm' || action === 'decline') && !s?.actionRequiredFromMe) return;
    const token = ++generation;
    const abort = pending = new AbortController();
    // Synchronous guard covers repeated taps before React renders again.
    publish({ status: s, busy: true, error: false });
    const timer = setTimeout(() => {
      if (token === generation) {
        generation++; abort.abort(); publish({ status: null, busy: false, error: true });
      }
    }, 30_000);
    try {
      if (action !== 'read') {
        await api[action](need, abort.signal);
        if (!active || token !== generation || abort.signal.aborted) return;
      }
      // Never optimistically publish a completion or trust the mutation response
      // over a fresh authoritative read. Reads and writes share one generation.
      const status = await api.read(need, abort.signal);
      if (active && token === generation && !abort.signal.aborted) publish({ status, busy: false, error: false });
    } catch {
      if (active && token === generation && !abort.signal.aborted) publish({ status: null, busy: false, error: true });
    } finally { clearTimeout(timer); }
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    activate() { active = true; },
    clear() { active = false; generation++; pending?.abort(); publish({ status: null, busy: false, error: false }); },
    refresh: () => run('read'), requestEnd: () => run('request'),
    confirmEnd: () => run('confirm'), declineEnd: () => run('decline'),
  };
}
