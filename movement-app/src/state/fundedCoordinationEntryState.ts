import type { FundedCoordinationEntry } from '../services/movementService';

export type CoordinationEntryState = 'idle' | 'opening' | 'unavailable';

// An owner is bound to one focused screen, account and foreground generation.
export function createFundedCoordinationEntryController(
  need: string,
  request: (need: string, signal: AbortSignal) => Promise<FundedCoordinationEntry>,
  publish: (state: CoordinationEntryState) => void,
) {
  let disposed = false;
  let pending = false;
  let abort: AbortController | null = null;
  return {
    async open(onReady: () => void) {
      if (disposed || pending) return;
      pending = true;
      abort = new AbortController();
      publish('opening');
      try {
        const result = await request(need, abort.signal);
        if (disposed || abort.signal.aborted) return;
        if (result.movementNeedId.toLowerCase() !== need.toLowerCase()
          || result.journeyState !== 'not_started' || result.coordinationReady !== true) throw new Error();
        publish('idle');
        if (!disposed && !abort.signal.aborted) onReady();
      } catch {
        if (!disposed) publish('unavailable');
      } finally { pending = false; }
    },
    dispose() { disposed = true; abort?.abort(); },
  };
}
