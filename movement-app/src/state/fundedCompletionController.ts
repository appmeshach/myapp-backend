import type { FundedCompletionStatus } from '../services/fundedCompletionService';
type State = { status: FundedCompletionStatus | null; busy: boolean; error: boolean };
type Api = Record<'read' | 'request' | 'confirm' | 'dispute', (need: string, signal: AbortSignal) => Promise<FundedCompletionStatus>>;
export function createFundedCompletionController(need: string, api: Api) {
  let state: State = { status: null, busy: false, error: false };
  let active = false, generation = 0;
  let request: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: State) => { state = next; listeners.forEach(fn => fn()); };
  async function run(action: keyof Api) {
    if (!active || state.busy || (action === 'request' && !state.status?.canRequestCompletion)
      || (action === 'confirm' && !state.status?.canConfirmCompletion)
      || (action === 'dispute' && !state.status?.canDisputeCompletion)) return;
    const token = ++generation, abort = request = new AbortController();
    publish({ status: null, busy: true, error: false });
    const timer = setTimeout(() => { if (token === generation) { generation++; abort.abort(); publish({ status: null, busy: false, error: true }); } }, 30_000);
    try {
      let result = await api[action](need, abort.signal);
      if (action !== 'read' && active && token === generation && !abort.signal.aborted) result = await api.read(need, abort.signal);
      if (active && token === generation && !abort.signal.aborted) publish({ status: result, busy: false, error: false });
    } catch { if (active && token === generation && !abort.signal.aborted) publish({ status: null, busy: false, error: true }); }
    finally { clearTimeout(timer); }
  }
  return { subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, getSnapshot: () => state,
    activate() { active = true; }, clear() { active = false; generation++; request?.abort(); publish({ status: null, busy: false, error: false }); },
    refresh: () => run('read'), requestCompletion: () => run('request'), confirmCompletion: () => run('confirm'), disputeCompletion: () => run('dispute') };
}
