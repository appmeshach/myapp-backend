import { supabase } from '../lib/supabase';
import { validMovementNeed } from './coordinationService';
export type MeetingJourneyStatus = {
  startAuthority: 'legacy' | 'funded';
  meetingPointText: string | null; meetingPointRevision: number | null;
  journeyState: 'not_started' | 'in_progress' | 'completed';
  startRequestedAt: string | null; startedAt: string | null;
  canEditMeetingPoint: boolean; canRequestStart: boolean; canConfirmStart: boolean;
};
function project(value: unknown, extended: boolean): MeetingJourneyStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unavailable');
  const row = value as Record<string, unknown>;
  const keys = ['meeting_point_text', 'meeting_point_revision', 'journey_state', 'start_requested_at', 'started_at', 'can_edit_meeting_point', 'can_request_start', 'can_confirm_start'];
  if (extended) keys.push('start_authority');
  if (Object.keys(row).sort().join(',') !== keys.sort().join(',')
    || (extended && row.start_authority !== 'legacy' && row.start_authority !== 'funded')) throw new Error('unavailable');
  const text = row.meeting_point_text; const revision = row.meeting_point_revision;
  const requested = row.start_requested_at; const started = row.started_at; const status = row.journey_state;
  const timestamp = (v: unknown) => {
    if (v === null) return true;
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(v);
    if (!parts) return false;
    const [, year, month, day, hour, minute, second, offsetHour = 0, offsetMinute = 0] = parts.map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && hour < 24 && minute < 60 && second < 60
      && (Number.isNaN(offsetHour) || offsetHour < 24) && (Number.isNaN(offsetMinute) || offsetMinute < 60);
  };
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
  if (extended && row.start_authority === 'funded' && ((started !== null && requested === null)
    || (requested !== null && text === null))) throw new Error('unavailable');
  return { startAuthority: extended ? row.start_authority as MeetingJourneyStatus['startAuthority'] : 'legacy',
    meetingPointText: text as string | null, meetingPointRevision: revision as number | null,
    journeyState: status as MeetingJourneyStatus['journeyState'], startRequestedAt: requested as string | null, startedAt: started as string | null,
    canEditMeetingPoint: row.can_edit_meeting_point as boolean, canRequestStart: row.can_request_start as boolean, canConfirmStart: row.can_confirm_start as boolean };
}
async function call(name: string, need: string, fields: Record<string, unknown>, signal: AbortSignal, extended = false): Promise<MeetingJourneyStatus | null> {
  if (!validMovementNeed(need)) throw new Error('unavailable');
  signal.throwIfAborted();
  try {
    const { data, error } = await supabase.rpc(name, { p_movement_need_id: need, ...fields }).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error(error.code === '40001' ? 'conflict' : 'unavailable');
    if (!Array.isArray(data) || data.length > 1) throw new Error('unavailable');
    return data.length ? project(data[0], extended) : null;
  } catch (e) { throw new Error(e instanceof Error && e.message === 'conflict' ? 'conflict' : 'unavailable'); }
}
export const getMeetingJourneyStatus = (need: string, signal: AbortSignal) => call('get_my_movement_start_status', need, {}, signal, true);
async function mutateLegacyShape(name: string, need: string, fields: Record<string, unknown>, signal: AbortSignal) {
  const result = await call(name, need, fields, signal);
  if (!result) throw new Error('unavailable');
  // The old mutation signatures remain compatible. Only the fresh backend
  // projection supplies authority for a subsequent explicit start action.
  return getMeetingJourneyStatus(need, signal);
}
export function setMeetingPoint(need: string, text: string, revision: number | null, signal: AbortSignal) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 200 || (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))) return Promise.reject(new Error('unavailable'));
  return mutateLegacyShape('set_my_movement_meeting_point', need, { p_place_text: text.trim(), p_expected_revision: revision }, signal);
}
export const requestMovementStart = (need: string, signal: AbortSignal) => mutateLegacyShape('request_my_movement_start', need, {}, signal);
export const confirmMovementStart = (need: string, signal: AbortSignal) => mutateLegacyShape('confirm_my_movement_start', need, {}, signal);
async function fundedStart(name: string, need: string, signal: AbortSignal, confirm = false) {
  const result = await call(name, need, {}, signal, true);
  if (!result || result.startAuthority !== 'funded' || result.startRequestedAt === null
    || (confirm && (!['in_progress', 'completed'].includes(result.journeyState) || result.startedAt === null))) throw new Error('unavailable');
  return result;
}
export const requestMyFundedMovementStart = (need: string, signal: AbortSignal) => fundedStart('request_my_funded_movement_start', need, signal);
export const confirmMyFundedMovementStart = (need: string, signal: AbortSignal) => fundedStart('confirm_my_funded_movement_start', need, signal, true);
