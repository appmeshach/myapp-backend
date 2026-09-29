import { supabase } from '../lib/supabase';

export type CompletedMovementRecovery = {
  movementNeedId: string;
  originArea: string;
  destinationArea: string;
  completedAt: string;
  settlementStatus: 'pending_amount' | 'pending_settlement' | 'settled' | 'failed';
  settlementIsForMe: boolean;
  settledAt: string | null;
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


export async function listMyCompletedMovementRecoveries(limit = 20, signal?: AbortSignal): Promise<CompletedMovementRecovery[]> {
  try {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error();
    signal?.throwIfAborted();
    const query = supabase.rpc('list_my_completed_movement_recoveries', { p_limit: limit });
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    signal?.throwIfAborted();
    if (error || !Array.isArray(data) || data.length > limit) throw new Error();
    const keys = ['completed_at', 'destination_area', 'movement_need_id', 'origin_area', 'settled_at', 'settlement_is_for_me', 'settlement_status'];
    const seen = new Set<string>();
    const label = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v === v.trim()
      && v.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
    return data.map((value: unknown): CompletedMovementRecovery => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const row = value as Record<string, unknown>;
      if (Object.keys(row).sort().join(',') !== keys.join(',')
        || typeof row.movement_need_id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.movement_need_id)
        || seen.has(row.movement_need_id.toLowerCase()) || !label(row.origin_area) || !label(row.destination_area)
        || row.completed_at === null || !timestamp(row.completed_at) || !timestamp(row.settled_at)
        || typeof row.settlement_is_for_me !== 'boolean'
        || !['pending_amount', 'pending_settlement', 'settled', 'failed'].includes(row.settlement_status as string)
        || (row.settlement_status === 'settled') !== (row.settled_at !== null)
        || (row.settled_at !== null && Date.parse(row.settled_at) < Date.parse(row.completed_at))) throw new Error();
      seen.add(row.movement_need_id.toLowerCase());
      return { movementNeedId: row.movement_need_id, originArea: row.origin_area, destinationArea: row.destination_area,
        completedAt: row.completed_at, settlementStatus: row.settlement_status as CompletedMovementRecovery['settlementStatus'],
        settlementIsForMe: row.settlement_is_for_me, settledAt: row.settled_at };
    });
  } catch { throw new Error('completed_movement_recovery_unavailable'); }
}
