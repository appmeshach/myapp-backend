import { supabase } from '../lib/supabase';
import { validMovementNeed } from './coordinationService';

export type CompletedMovementRatingTarget = {
  personNumber: 1;
  personRole: 'offering_member' | 'primary_requester';
  firstName: string | null;
  rating: number | null;
  completedMovements: number;
  alreadyRated: boolean;
  myStars: number | null;
};
export function parseCompletedMovementRatingTargets(data: unknown): CompletedMovementRatingTarget[] {
  if (!Array.isArray(data) || data.length !== 1) throw new Error('unavailable');
  return data.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unavailable');
    const r = value as Record<string, unknown>;
    if (Object.keys(r).sort().join(',') !== 'already_rated,completed_movements,first_name,my_stars,person_number,person_role,rating'
      || r.person_number !== 1 || (r.person_role !== 'offering_member' && r.person_role !== 'primary_requester')
      || (r.first_name !== null && (typeof r.first_name !== 'string' || !r.first_name.trim() || r.first_name.length > 100 || /[\u0000-\u001f\u007f]/.test(r.first_name)))
      || (r.rating !== null && (typeof r.rating !== 'number' || !Number.isFinite(r.rating) || r.rating < 1 || r.rating > 5 || Math.round(r.rating * 100) / 100 !== r.rating))
      || typeof r.completed_movements !== 'number' || !Number.isSafeInteger(r.completed_movements) || r.completed_movements < 1
      || typeof r.already_rated !== 'boolean'
      || (r.my_stars !== null && (typeof r.my_stars !== 'number' || !Number.isInteger(r.my_stars) || r.my_stars < 1 || r.my_stars > 5))
      || r.already_rated !== (r.my_stars !== null)) throw new Error('unavailable');
    return { personNumber: 1, personRole: r.person_role, firstName: r.first_name, rating: r.rating,
      completedMovements: r.completed_movements, alreadyRated: r.already_rated, myStars: r.my_stars };
  });
}
async function request(name: string, args: Record<string, string | number>, signal: AbortSignal) {
  try {
    signal.throwIfAborted();
    const { data, error } = await supabase.rpc(name, args).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error();
    return parseCompletedMovementRatingTargets(data);
  } catch { throw new Error('unavailable'); }
}
export async function getCompletedMovementRatingTargets(need: string, signal: AbortSignal) {
  if (!validMovementNeed(need)) throw new Error('unavailable');
  return request('get_my_completed_movement_rating_targets', { p_movement_need_id: need }, signal);
}
export async function rateCompletedMovementPerson(need: string, personNumber: number, stars: number, signal: AbortSignal) {
  if (!validMovementNeed(need) || personNumber !== 1 || !Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error('unavailable');
  const rows = await request('rate_my_completed_movement_person', { p_movement_need_id: need, p_person_number: personNumber, p_stars: stars }, signal);
  if (!rows[0].alreadyRated || rows[0].myStars !== stars) throw new Error('unavailable');
  return rows;
}
