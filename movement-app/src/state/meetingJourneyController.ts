import type { MeetingJourneyStatus } from '../services/meetingJourneyService';
export type MeetingState = { status: MeetingJourneyStatus | null; busy: boolean; error: 'unavailable' | 'conflict' | null };
export type MeetingApi = {
  read(need: string, signal: AbortSignal): Promise<MeetingJourneyStatus | null>;
  set(need: string, text: string, revision: number | null, signal: AbortSignal): Promise<MeetingJourneyStatus | null>;
  request(need: string, signal: AbortSignal): Promise<MeetingJourneyStatus | null>;
  confirm(need: string, signal: AbortSignal): Promise<MeetingJourneyStatus | null>;
};
export function createMeetingController(need: string, api: MeetingApi) {
  let state: MeetingState = { status: null, busy: false, error: null };
  let generation = 0; let active = false; let request: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (s: MeetingState) => { state = s; listeners.forEach(fn => fn()); };
  async function run(action: 'read' | 'set' | 'request' | 'confirm', text?: string) {
    if (!active || state.busy) return;
    if (action === 'set' && !state.status?.canEditMeetingPoint || action === 'request' && !state.status?.canRequestStart || action === 'confirm' && !state.status?.canConfirmStart) return;
    const revision = state.status?.meetingPointRevision ?? null;
    const token = ++generation; const abort = request = new AbortController();
    publish({ status: null, busy: true, error: null });
    const timer = setTimeout(() => { if (generation === token) { generation++; abort.abort(); publish({ status: null, busy: false, error: 'unavailable' }); } }, 30_000);
    try {
      const result = action === 'set' ? await api.set(need, text ?? '', revision, abort.signal) : await api[action](need, abort.signal);
      if (active && token === generation && !abort.signal.aborted) publish({ status: result, busy: false, error: result ? null : 'unavailable' });
    } catch (e) { if (active && token === generation && !abort.signal.aborted) publish({ status: null, busy: false, error: e instanceof Error && e.message === 'conflict' ? 'conflict' : 'unavailable' }); }
    finally { clearTimeout(timer); }
  }
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, getSnapshot: () => state,
    activate() { active = true; },
    clear() { active = false; generation++; request?.abort(); publish({ status: null, busy: false, error: null }); },
    refresh: () => run('read'), save: (text: string) => run('set', text), requestStart: () => run('request'), confirmStart: () => run('confirm'),
  };
}
