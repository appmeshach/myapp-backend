import { supabase } from '../lib/supabase';
import { validMovementNeed } from './coordinationService';

export type FundedCompletionStatus = {
  journeyState: 'not_started' | 'in_progress' | 'completed';
  completionRequestedAt: string | null;
  completedAt: string | null;
  canRequestCompletion: boolean;
  canConfirmCompletion: boolean;
  responseDeadlineAt: string | null;
  completionMethod: 'requester_confirmed' | 'response_timeout' | null;
  canDisputeCompletion: boolean;
  disputeActive: boolean;
  settlementState: 'not_ready' | 'awaiting_confirmation' | 'under_review' | 'settled';
};
function instant(value: unknown): value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offsetHour = '0', offsetMinute = '0'] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 && Number(offsetHour) < 24 && Number(offsetMinute) < 60;
}
function project(value: unknown): FundedCompletionStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unavailable');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== 'can_confirm_completion,can_dispute_completion,can_request_completion,completed_at,completion_method,completion_requested_at,dispute_active,journey_state,response_deadline_at,settlement_state'
    || typeof r.journey_state !== 'string' || !['not_started', 'in_progress', 'completed'].includes(r.journey_state)
    || typeof r.settlement_state !== 'string' || !['not_ready', 'awaiting_confirmation', 'under_review', 'settled'].includes(r.settlement_state)
    || typeof r.can_request_completion !== 'boolean' || typeof r.can_confirm_completion !== 'boolean'
    || typeof r.can_dispute_completion !== 'boolean' || typeof r.dispute_active !== 'boolean'
    || (r.completion_method !== null && r.completion_method !== 'requester_confirmed' && r.completion_method !== 'response_timeout')
    || (r.response_deadline_at !== null && !instant(r.response_deadline_at))
    || (r.completion_requested_at !== null && !instant(r.completion_requested_at))
    || (r.completed_at !== null && !instant(r.completed_at))) throw new Error('unavailable');
  const settled = r.journey_state === 'completed';
  const requested = r.completion_requested_at !== null;
  // Validate a deterministic pair from one server event, never live expiry.
  const fraction = (value: string) => value.match(/\.(\d+)/)?.[1].replace(/0+$/, '') ?? '';
  if (settled !== (r.settlement_state === 'settled') || settled !== (r.completed_at !== null)
    || settled !== (r.completion_method !== null) || requested !== (r.response_deadline_at !== null)
    || (requested && (Date.parse(r.response_deadline_at as string) - Date.parse(r.completion_requested_at as string) !== 43_200_000
      || fraction(r.response_deadline_at as string) !== fraction(r.completion_requested_at as string)))
    || (settled && !requested)
    || (r.dispute_active && (!requested || settled || r.can_confirm_completion || r.can_dispute_completion || r.can_request_completion))
    || (!settled && r.settlement_state !== (r.dispute_active ? 'under_review' : requested ? 'awaiting_confirmation' : 'not_ready'))
    || (requested && r.journey_state === 'not_started')
    || (r.can_request_completion && (r.journey_state !== 'in_progress' || requested))
    || (r.can_confirm_completion && (r.journey_state !== 'in_progress' || !requested))
    || r.can_dispute_completion !== r.can_confirm_completion) throw new Error('unavailable');
  return { journeyState: r.journey_state as FundedCompletionStatus['journeyState'], completionRequestedAt: r.completion_requested_at as string | null,
    completedAt: r.completed_at as string | null, canRequestCompletion: r.can_request_completion, canConfirmCompletion: r.can_confirm_completion,
    responseDeadlineAt: r.response_deadline_at as string | null, completionMethod: r.completion_method as FundedCompletionStatus['completionMethod'],
    canDisputeCompletion: r.can_dispute_completion, disputeActive: r.dispute_active,
    settlementState: r.settlement_state as FundedCompletionStatus['settlementState'] };
}
async function call(name: string, need: string, signal: AbortSignal, reason?: string): Promise<FundedCompletionStatus> {
  if (!validMovementNeed(need)) throw new Error('unavailable');
  signal.throwIfAborted();
  try {
    const args = reason === undefined ? { p_movement_need_id: need } : { p_movement_need_id: need, p_reason_category: reason };
    const { data, error } = await supabase.rpc(name, args).abortSignal(signal);
    signal.throwIfAborted();
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
    return project(data[0]);
  } catch { throw new Error('unavailable'); }
}
export const getFundedCompletionStatus = (need: string, signal: AbortSignal) => call('get_my_funded_movement_completion_status', need, signal);
export async function requestFundedCompletion(need: string, signal: AbortSignal) {
  const result = await call('request_my_funded_movement_completion', need, signal);
  if (result.completionRequestedAt === null) throw new Error('unavailable');
  return result;
}
export async function confirmFundedCompletion(need: string, signal: AbortSignal) {
  const result = await call('confirm_my_funded_movement_completion', need, signal);
  if (result.settlementState !== 'settled') throw new Error('unavailable');
  return result;
}
export async function disputeFundedCompletion(need: string, signal: AbortSignal) {
  const result = await call('dispute_my_funded_movement_completion', need, signal, 'completion_concern');
  if (!result.disputeActive) throw new Error('unavailable');
  return result;
}
