import type { DisputeReason, MovementDisputeStatus } from '../services/movementDisputeService';
type Api = { read: (need: string, signal: AbortSignal) => Promise<MovementDisputeStatus>; open: (need: string, signal: AbortSignal, reason: DisputeReason) => Promise<MovementDisputeStatus> };
export type MovementDisputeState = { status: MovementDisputeStatus | null; busy: boolean; error: boolean };
export function createMovementDisputeController(need: string, api: Api) {
  let state: MovementDisputeState = { status: null, busy: false, error: false };
  let active = false, generation = 0;
  let pending: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: MovementDisputeState) => { state = next; listeners.forEach(fn => fn()); };
  async function run(reason?: DisputeReason) {
    if (!active || state.busy || (reason !== undefined && !state.status?.canOpen)) return;
    const token = ++generation, abort = pending = new AbortController();
    publish({ status: state.status, busy: true, error: false });
    const timer = setTimeout(() => { if (token === generation) { generation++; abort.abort(); publish({ status: null, busy: false, error: true }); } }, 30_000);
    try {
      if (reason !== undefined) {
        await api.open(need, abort.signal, reason);
        if (!active || generation !== token || abort.signal.aborted) return;
      }
      const status = await api.read(need, abort.signal);
      if (active && generation === token && !abort.signal.aborted) publish({ status, busy: false, error: false });
    } catch { if (active && generation === token && !abort.signal.aborted) publish({ status: null, busy: false, error: true }); }
    finally { clearTimeout(timer); }
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, getSnapshot: () => state,
    activate() { active = true; },
    clear() { active = false; generation++; pending?.abort(); publish({ status: null, busy: false, error: false }); },
    refresh: () => run(), openDispute: (reason: DisputeReason) => run(reason),
  };
}
