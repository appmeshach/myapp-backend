import { supabase } from '../lib/supabase';

export type MovementEndStatus = {
  journeyState: 'not_started' | 'in_progress' | 'completed' | 'cancelled';
  endStatus: 'no_pending_end_request' | 'awaiting_other_member' | 'action_required_from_me' | 'completed' | 'mutual_no_travel';
  requestedByMe: boolean;
  actionRequiredFromMe: boolean;
  requestedAt: string | null;
  completedAt: string | null;
};

function timestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, offsetHour = 0, offsetMinute = 0] = parts.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60
    && (Number.isNaN(offsetHour) || offsetHour < 24) && (Number.isNaN(offsetMinute) || offsetMinute < 60);
}

function parse(value: unknown): MovementEndStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const row = value as Record<string, unknown>;
  const keys = ['action_required_from_me', 'completed_at', 'end_status', 'journey_state', 'requested_at', 'requested_by_me'];
  if (Object.keys(row).sort().join(',') !== keys.join(',')
    || !['not_started', 'in_progress', 'completed', 'cancelled'].includes(row.journey_state as string)
    || !['no_pending_end_request', 'awaiting_other_member', 'action_required_from_me', 'completed', 'mutual_no_travel'].includes(row.end_status as string)
    || typeof row.requested_by_me !== 'boolean' || typeof row.action_required_from_me !== 'boolean'
    || !timestamp(row.requested_at) || !timestamp(row.completed_at)
    || row.requested_by_me !== (row.end_status === 'awaiting_other_member')
    || row.action_required_from_me !== (row.end_status === 'action_required_from_me')
    || (row.end_status === 'no_pending_end_request' && row.requested_at !== null)
    || (row.end_status !== 'no_pending_end_request' && row.requested_at === null)
    || (row.end_status === 'completed') !== (row.journey_state === 'completed')
    || (row.end_status === 'mutual_no_travel') !== (row.journey_state === 'cancelled')
    || (row.end_status === 'completed') !== (row.completed_at !== null)) throw new Error();
  return { journeyState: row.journey_state as MovementEndStatus['journeyState'],
    endStatus: row.end_status as MovementEndStatus['endStatus'], requestedByMe: row.requested_by_me,
    actionRequiredFromMe: row.action_required_from_me, requestedAt: row.requested_at, completedAt: row.completed_at };
}

async function call(name: string, need: string, signal: AbortSignal, reason?: string): Promise<MovementEndStatus> {
  try {
    if (typeof need !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(need)
      || (reason !== undefined && (typeof reason !== 'string' || !reason.trim() || reason.length > 500))) throw new Error();
    signal.throwIfAborted();
    const { data, error } = await supabase.rpc(name, {
      p_movement_need_id: need, ...(reason === undefined ? {} : { p_reason: reason.trim() }),
    }).abortSignal(signal);
    signal.throwIfAborted();
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
    return parse(data[0]);
  } catch { throw new Error('movement_end_unavailable'); }
}

export const getMovementEndStatus = (need: string, signal: AbortSignal) => call('get_my_movement_end_status_by_need', need, signal);
export const requestMovementEnd = (need: string, signal: AbortSignal, reason?: string) => call('request_my_movement_end', need, signal, reason);
export const confirmMovementEnd = (need: string, signal: AbortSignal) => call('confirm_my_movement_end', need, signal);
export const declineMovementEnd = (need: string, signal: AbortSignal) => call('decline_my_movement_end', need, signal);
