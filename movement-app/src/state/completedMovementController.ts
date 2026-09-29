import type { CompletedMovementRecovery } from '../services/completedMovementService';

export type CompletedMovementState = {
  phase: 'signed_out' | 'loading' | 'ready' | 'error';
  rows: CompletedMovementRecovery[];
};
type Read = (limit: number, signal: AbortSignal) => Promise<CompletedMovementRecovery[]>;

export function createCompletedMovementController(read: Read) {
  let state: CompletedMovementState = { phase: 'signed_out', rows: [] };
  let account: string | null = null;
  let live = false;
  let generation = 0;
  let request: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: CompletedMovementState) => { state = next; listeners.forEach(fn => fn()); };
  async function refresh() {
    if (!live || !account) return;
    const token = ++generation;
    request?.abort();
    const abort = request = new AbortController();
    publish({ phase: 'loading', rows: [] });
    const timer = setTimeout(() => {
      if (live && token === generation) {
        generation++; abort.abort(); publish({ phase: 'error', rows: [] });
      }
    }, 30_000);
    try {
      const rows = await read(20, abort.signal);
      if (live && token === generation && !abort.signal.aborted) publish({ phase: 'ready', rows });
    } catch {
      if (live && token === generation && !abort.signal.aborted) publish({ phase: 'error', rows: [] });
    } finally { clearTimeout(timer); }
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    activate() { live = true; },
    setAccount(next: string | null) {
      if (!live || next === account) return;
      generation++; request?.abort(); account = next;
      publish({ phase: 'signed_out', rows: [] });
      if (account) void refresh();
    },
    dispose() {
      live = false; account = null; generation++; request?.abort();
      publish({ phase: 'signed_out', rows: [] });
    },
    refresh,
  };
}
