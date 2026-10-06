import { supabase } from '../lib/supabase';

export type DisputeReason = 'unable_to_agree' | 'movement_concern';
export type MovementDisputeStatus = { active: boolean; canOpen: boolean; openedByMe: boolean; openedAt: string | null };
function parse(value: unknown): MovementDisputeStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const r = value as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== 'can_open,dispute_active,opened_at,opened_by_me'
    || typeof r.dispute_active !== 'boolean' || typeof r.can_open !== 'boolean' || typeof r.opened_by_me !== 'boolean') throw new Error();
  if (r.dispute_active) {
    if (r.can_open || typeof r.opened_at !== 'string' || !validInstant(r.opened_at)) throw new Error();
  } else if (r.opened_by_me || r.opened_at !== null) throw new Error();
  return { active: r.dispute_active, canOpen: r.can_open, openedByMe: r.opened_by_me, openedAt: r.opened_at as string | null };
}
function validInstant(value: string): boolean {
  const p = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!p || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = p.slice(1, 7).map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60 && (!p[8] || (Number(p[8]) < 24 && Number(p[9]) < 60));
}
async function call(name: string, need: string, signal: AbortSignal, reason?: DisputeReason): Promise<MovementDisputeStatus> {
  try {
    signal.throwIfAborted();
    if (typeof need !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(need)
      || (name === 'open_my_funded_movement_dispute' && reason === undefined)
      || (reason !== undefined && !['unable_to_agree', 'movement_concern'].includes(reason))) throw new Error();
    const { data, error } = await supabase.rpc(name, { p_movement_need_id: need, ...(reason === undefined ? {} : { p_reason_category: reason }) }).abortSignal(signal);
    signal.throwIfAborted();
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
    return parse(data[0]);
  } catch { throw new Error('movement_review_unavailable'); }
}
export const getMovementDisputeStatus = (need: string, signal: AbortSignal) => call('get_my_funded_movement_dispute_status', need, signal);
export const openMovementDispute = (need: string, signal: AbortSignal, reason: DisputeReason) => call('open_my_funded_movement_dispute', need, signal, reason);
