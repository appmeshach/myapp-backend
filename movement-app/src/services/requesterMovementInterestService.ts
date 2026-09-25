import { supabase } from '../lib/supabase';
import type {
  OffererRequesterInterest,
  RequesterMovementInterestWriteResult,
} from '../types/movement';

export type CreateRequesterMovementInterestInput = {
  requestId: string;
  movementNeedId: string;
  availabilityId: string;
  routeMatchEvidenceId: string;
};

export type ListRequesterMovementInterestsInput = {
  availabilityId?: string | null;
  limit?: number;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const label = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

function exactRow(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function parseWrite(data: unknown): RequesterMovementInterestWriteResult {
  const row: unknown = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (!exactRow(row, ['interest_id', 'interest_status', 'created_at'])
    || !uuid(row.interest_id) || !date(row.created_at)
    || (row.interest_status !== 'active' && row.interest_status !== 'withdrawn' && row.interest_status !== 'expired')) {
    throw new Error('requester_interest_response_invalid');
  }
  return { interestId: row.interest_id, interestStatus: row.interest_status, createdAt: row.created_at };
}

export async function createRequesterMovementInterest(
  input: CreateRequesterMovementInterestInput,
): Promise<RequesterMovementInterestWriteResult> {
  if (!input || !uuid(input.requestId) || !uuid(input.movementNeedId)
    || !uuid(input.availabilityId) || !uuid(input.routeMatchEvidenceId)) {
    throw new Error('invalid_requester_interest');
  }
  const { data, error } = await supabase.rpc('create_requester_movement_interest', {
    p_request_id: input.requestId,
    p_movement_need_id: input.movementNeedId,
    p_availability_id: input.availabilityId,
    p_route_match_evidence_id: input.routeMatchEvidenceId,
  });
  if (error) throw new Error('requester_interest_unavailable');
  const result = parseWrite(data);
  if (result.interestStatus !== 'active') {
    throw new Error('requester_interest_response_invalid');
  }
  return result;
}

export async function withdrawRequesterMovementInterest(
  interestId: string,
): Promise<RequesterMovementInterestWriteResult> {
  if (!uuid(interestId)) throw new Error('invalid_requester_interest');
  const { data, error } = await supabase.rpc('withdraw_requester_movement_interest', {
    p_interest_id: interestId,
  });
  if (error) throw new Error('requester_interest_withdrawal_unavailable');
  const result = parseWrite(data);
  if (result.interestId !== interestId || result.interestStatus !== 'withdrawn') {
    throw new Error('requester_interest_response_invalid');
  }
  return result;
}

export async function listRequesterMovementInterestsForOfferer(
  input: ListRequesterMovementInterestsInput = {},
): Promise<OffererRequesterInterest[]> {
  const availabilityId = input.availabilityId ?? null;
  const limit = input.limit === undefined ? 20 : input.limit;
  if ((availabilityId !== null && !uuid(availabilityId))
    || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('invalid_requester_interest_inbox');
  }
  const { data, error } = await supabase.rpc('list_requester_movement_interests_for_offerer', {
    p_availability_id: availabilityId,
    p_limit: limit,
  });
  if (error) throw new Error('requester_interest_inbox_unavailable');
  if (!Array.isArray(data) || data.length > limit) throw new Error('requester_interest_inbox_response_invalid');
  const seen = new Set<string>();
  return data.map((row: unknown) => {
    if (!exactRow(row, [
      'interest_id', 'movement_need_id', 'availability_id', 'origin_area', 'destination_area',
      'people_count', 'earliest_departure_at', 'latest_departure_at',
      'requester_origin_distance_to_route_meters', 'interest_created_at',
    ]) || !uuid(row.interest_id) || seen.has(row.interest_id)
      || !uuid(row.movement_need_id) || !uuid(row.availability_id)
      || (availabilityId !== null && row.availability_id !== availabilityId)
      || !label(row.origin_area) || !label(row.destination_area)
      || typeof row.people_count !== 'number' || !Number.isSafeInteger(row.people_count) || row.people_count < 1
      || !date(row.earliest_departure_at)
      || (row.latest_departure_at !== null && (!date(row.latest_departure_at)
        || Date.parse(row.latest_departure_at) < Date.parse(row.earliest_departure_at)))
      || typeof row.requester_origin_distance_to_route_meters !== 'number'
      || !Number.isSafeInteger(row.requester_origin_distance_to_route_meters)
      || row.requester_origin_distance_to_route_meters < 0 || !date(row.interest_created_at)) {
      throw new Error('requester_interest_inbox_response_invalid');
    }
    seen.add(row.interest_id);
    return {
      interestId: row.interest_id, movementNeedId: row.movement_need_id, availabilityId: row.availability_id,
      originArea: row.origin_area, destinationArea: row.destination_area, peopleCount: row.people_count,
      earliestDepartureAt: row.earliest_departure_at, latestDepartureAt: row.latest_departure_at,
      requesterOriginDistanceToRouteMeters: row.requester_origin_distance_to_route_meters,
      interestCreatedAt: row.interest_created_at,
    };
  });
}
