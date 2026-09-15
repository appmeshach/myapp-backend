import { supabase } from '../lib/supabase';
import { validMovementNeed } from './coordinationService';
export type MeetingJourneyStatus = {
  meetingPointText: string | null; meetingPointRevision: number | null;
  journeyState: 'not_started' | 'in_progress' | 'completed';
  startRequestedAt: string | null; startedAt: string | null;
  canEditMeetingPoint: boolean; canRequestStart: boolean; canConfirmStart: boolean;
};
function project(row: Record<string, unknown>): MeetingJourneyStatus {
  const text = row.meeting_point_text; const revision = row.meeting_point_revision;
  const requested = row.start_requested_at; const started = row.started_at; const status = row.journey_state;
  const timestamp = (v: unknown) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)));
  if ((text !== null && (typeof text !== 'string' || !text.trim() || text.length > 200))
    || (revision !== null && (!Number.isSafeInteger(revision) || Number(revision) < 1))
    || ((text === null) !== (revision === null)) || !timestamp(requested) || !timestamp(started)
    || !['not_started','in_progress','completed'].includes(String(status))
    || !['can_edit_meeting_point','can_request_start','can_confirm_start'].every(k => typeof row[k] === 'boolean')
    || (status === 'not_started' && started !== null)
    || (status !== 'not_started' && started === null)
    || (row.can_edit_meeting_point && (status !== 'not_started' || requested !== null))
    || (row.can_request_start && (status !== 'not_started' || requested !== null || text === null))
    || (row.can_confirm_start && (status !== 'not_started' || requested === null || text === null))) throw new Error('unavailable');
  return { meetingPointText: text as string | null, meetingPointRevision: revision as number | null,
    journeyState: status as MeetingJourneyStatus['journeyState'], startRequestedAt: requested as string | null, startedAt: started as string | null,
    canEditMeetingPoint: row.can_edit_meeting_point as boolean, canRequestStart: row.can_request_start as boolean, canConfirmStart: row.can_confirm_start as boolean };
}
async function call(name: string, need: string, fields: Record<string, unknown>, signal: AbortSignal): Promise<MeetingJourneyStatus | null> {
  if (!validMovementNeed(need)) throw new Error('unavailable');
  signal.throwIfAborted();
  try {
    const { data, error } = await supabase.rpc(name, { p_movement_need_id: need, ...fields }).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error(error.code === '40001' ? 'conflict' : 'unavailable');
    if (!Array.isArray(data) || data.length > 1) throw new Error('unavailable');
    return data.length ? project(data[0]) : null;
  } catch (e) { throw new Error(e instanceof Error && e.message === 'conflict' ? 'conflict' : 'unavailable'); }
}
export const getMeetingJourneyStatus = (need: string, signal: AbortSignal) => call('get_my_movement_coordination_status', need, {}, signal);
export function setMeetingPoint(need: string, text: string, revision: number | null, signal: AbortSignal) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 200 || (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))) return Promise.reject(new Error('unavailable'));
  return call('set_my_movement_meeting_point', need, { p_place_text: text.trim(), p_expected_revision: revision }, signal);
}
export const requestMovementStart = (need: string, signal: AbortSignal) => call('request_my_movement_start', need, {}, signal);
export const confirmMovementStart = (need: string, signal: AbortSignal) => call('confirm_my_movement_start', need, {}, signal);
