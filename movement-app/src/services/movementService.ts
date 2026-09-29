import { supabase } from '../lib/supabase';
import {
  AcceptedAlignment,
  AlignmentStatusSummary,
  CreatedMovementOffer,
  CreateMovementOfferInput,
  MaskedMovementNeed,
  MaskedMovementOffer,
  PostActivationPerson,
  PostActivationVehicle,
} from '../types/movement';

export interface CreateMovementNeedInput {
  requestId: string;
  originLocationReferenceId: string;
  destinationLocationReferenceId: string;
  earliestDepartureAt: string;
  latestDepartureAt?: string | null;
  peopleCount?: number;
}

export interface CreatedMovementNeed {
  movementNeedId: string;
}

interface RecoverableMovementNeedRow {
  movement_need_id: string;
}

export async function recoverLatestActiveMovementNeed(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_my_current_movement_need');

  if (error) {
    throw new Error('movement_need_recovery_unavailable');
  }

  const rows = data as RecoverableMovementNeedRow[] | null;

  return rows?.[0]?.movement_need_id ?? null;
}

export async function recoverRequesterMovementContinuation(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_requester_movement_continuation');
    if (error || !Array.isArray(data) || data.length > 1) {
      throw new Error('Invalid continuation response');
    }
    if (data.length === 0) return null;

    const row: unknown = data[0];
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).length !== 1 || !('movement_need_id' in row)
      || typeof row.movement_need_id !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.movement_need_id)) {
      throw new Error('Invalid continuation response');
    }
    return row.movement_need_id;
  } catch {
    throw new Error('movement_continuation_recovery_unavailable');
  }
}

export type OffererMovementContinuation = {
  movementNeedId: string;
  alignmentStatus: 'awaiting_activation_payment' | 'activated';
  originArea: string;
  destinationArea: string;
  createdAt: string;
};

export async function listMyOffererMovementContinuations(
  limit: number = 20,
): Promise<OffererMovementContinuation[]> {
  const safeLabel = (value: unknown): value is string => typeof value === 'string'
    && !!value.trim() && value.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  const timestamp = (value: unknown): value is string => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts) return false;
    const [, year, month, day, hour, minute, second] = parts.map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && hour < 24 && minute < 60 && second < 60;
  };
  try {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error();
    const { data, error } = await supabase.rpc(
      'list_my_offerer_movement_continuations', { p_limit: limit },
    );
    if (error || !Array.isArray(data) || data.length > limit) throw new Error();
    const keys = ['alignment_status', 'created_at', 'destination_area', 'movement_need_id', 'origin_area'];
    const seen = new Set<string>();
    return data.map((value: unknown): OffererMovementContinuation => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const row = value as Record<string, unknown>;
      const actual = Object.keys(row).sort();
      if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])
        || typeof row.movement_need_id !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.movement_need_id)
        || seen.has(row.movement_need_id.toLowerCase())
        || (row.alignment_status !== 'awaiting_activation_payment' && row.alignment_status !== 'activated')
        || !safeLabel(row.origin_area) || !safeLabel(row.destination_area) || !timestamp(row.created_at)) {
        throw new Error();
      }
      seen.add(row.movement_need_id.toLowerCase());
      return {
        movementNeedId: row.movement_need_id, alignmentStatus: row.alignment_status,
        originArea: row.origin_area, destinationArea: row.destination_area, createdAt: row.created_at,
      };
    });
  } catch {
    throw new Error('offerer_movement_continuation_recovery_unavailable');
  }
}

export type ActiveMovementContinuation = {
  movementNeedId: string;
  originArea: string;
  destinationArea: string;
  startedAt: string;
};

export async function listMyActiveMovementContinuations(
  limit: number = 20,
): Promise<ActiveMovementContinuation[]> {
  const safeLabel = (value: unknown): value is string => typeof value === 'string'
    && !!value.trim() && value.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  const timestamp = (value: unknown): value is string => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts) return false;
    const [, year, month, day, hour, minute, second] = parts.map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && hour < 24 && minute < 60 && second < 60;
  };
  try {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error();
    const { data, error } = await supabase.rpc(
      'list_my_active_movement_continuations', { p_limit: limit },
    );
    if (error || !Array.isArray(data) || data.length > limit) throw new Error();
    const keys = ['destination_area', 'movement_need_id', 'origin_area', 'started_at'];
    const seen = new Set<string>();
    return data.map((value: unknown): ActiveMovementContinuation => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const row = value as Record<string, unknown>;
      const actual = Object.keys(row).sort();
      if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])
        || typeof row.movement_need_id !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.movement_need_id)
        || seen.has(row.movement_need_id.toLowerCase())
        || !safeLabel(row.origin_area) || !safeLabel(row.destination_area) || !timestamp(row.started_at)) {
        throw new Error();
      }
      seen.add(row.movement_need_id.toLowerCase());
      return {
        movementNeedId: row.movement_need_id,
        originArea: row.origin_area, destinationArea: row.destination_area, startedAt: row.started_at,
      };
    });
  } catch {
    throw new Error('active_movement_recovery_unavailable');
  }
}

interface CreatedMovementNeedRpcRow {
  movement_need_id: string;
}

interface MaskedMovementNeedRpcRow {
  movement_need_id: string;
  origin_area: string;
  destination_area: string;
  earliest_departure_at: string;
  latest_departure_at: string | null;
  people_count: number;
  age: number | null;
  common_movement_area: string | null;
  identity_verified: boolean;
  profile_media_verified: boolean;
  completed_movements: number;
  rating: number | null;
}

interface CreatedMovementOfferRpcRow {
  movement_offer_id: string;
  status: string;
  created_at: string;
}

interface MaskedMovementOfferRpcRow {
  movement_offer_id: string;
  seats_offered: number;
  estimated_arrival_minutes: number | null;
  offer_status: string;
  offer_created_at: string;
  vehicle_make: string;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string;
  vehicle_seat_capacity: number;
  age: number | null;
  common_movement_area: string | null;
  identity_verified: boolean;
  profile_media_verified: boolean;
  completed_movements: number;
  rating: number | null;
}

interface AcceptedAlignmentRpcRow {
  alignment_id: string;
  alignment_status: string;
  movement_need_id: string;
  movement_offer_id: string;
  created_at: string;
}

interface AlignmentStatusSummaryRpcRow {
  alignment_id: string;
  movement_need_id: string;
  movement_offer_id: string;
  alignment_status: string;
  activation_fee_minor: number | null;
  activation_currency: string;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PostActivationPersonRpcRow {
  person_number: number;
  person_role: PostActivationPerson['personRole'];
  first_name: string | null;
  age: number | null;
  verified: boolean;
  rating: number | null;
  completed_movements: number;
  profile_photo_token: string | null;
  profile_photo_expires_at: string | null;
}

interface PostActivationVehicleRpcRow {
  vehicle_display_name: string;
  plate_number: string;
}

export async function createMovementNeed(
  input: CreateMovementNeedInput
): Promise<CreatedMovementNeed> {
  const { data, error } = await supabase.rpc('create_movement_need', {
    p_request_id: input.requestId,
    p_origin_location_reference_id: input.originLocationReferenceId,
    p_destination_location_reference_id: input.destinationLocationReferenceId,
    p_earliest_departure_at: input.earliestDepartureAt,
    p_latest_departure_at: input.latestDepartureAt ?? null,
    p_people_count: input.peopleCount ?? 1,
  });

  if (error) {
    throw error;
  }

  const row = (data as CreatedMovementNeedRpcRow[] | null)?.[0] ?? null;

  if (!row) {
    throw new Error(
      'No movement need data returned from create_movement_need'
    );
  }

  return {
    movementNeedId: row.movement_need_id,
  };
}

export async function discoverMaskedMovementNeeds(
  limit: number = 20
): Promise<MaskedMovementNeed[]> {
  const { data, error } = await supabase.rpc('discover_masked_movement_needs', {
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as MaskedMovementNeedRpcRow[];

  return rows.map((row) => ({
    movementNeedId: row.movement_need_id,
    originArea: row.origin_area,
    destinationArea: row.destination_area,
    earliestDepartureAt: row.earliest_departure_at,
    latestDepartureAt: row.latest_departure_at,
    peopleCount: row.people_count,
    age: row.age,
    commonMovementArea: row.common_movement_area,
    identityVerified: row.identity_verified,
    profileMediaVerified: row.profile_media_verified,
    completedMovements: row.completed_movements,
    rating: row.rating,
  }));
}

export async function createMovementOffer(
  input: CreateMovementOfferInput
): Promise<CreatedMovementOffer> {
  const { data, error } = await supabase.rpc('create_movement_offer', {
    p_movement_need_id: input.movementNeedId,
    p_route_match_evidence_id: input.routeMatchEvidenceId,
    p_availability_id: input.availabilityId,
    p_seats_offered: input.seatsOffered,
    p_proposed_pickup_area: input.proposedPickupArea ?? null,
    p_proposed_dropoff_area: input.proposedDropoffArea ?? null,
    p_estimated_arrival_minutes: input.estimatedArrivalMinutes ?? null,
  });

  if (error) {
    throw error;
  }

  const row = (data as CreatedMovementOfferRpcRow[] | null)?.[0] ?? null;

  if (!row) {
    throw new Error('No movement offer data returned from create_movement_offer');
  }

  return {
    movementOfferId: row.movement_offer_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export interface CreateMovementOfferFromInterestInput {
  interestId: string;
  seatsOffered: number;
  proposedPickupArea?: string | null;
  proposedDropoffArea?: string | null;
  estimatedArrivalMinutes?: number | null;
}

export async function createMovementOfferFromInterest(
  input: CreateMovementOfferFromInterestInput
): Promise<CreatedMovementOffer> {
  const { data, error } = await supabase.rpc(
    'create_movement_offer_from_interest',
    {
      p_interest_id: input.interestId,
      p_seats_offered: input.seatsOffered,
      p_proposed_pickup_area:
        input.proposedPickupArea ?? null,
      p_proposed_dropoff_area:
        input.proposedDropoffArea ?? null,
      p_estimated_arrival_minutes:
        input.estimatedArrivalMinutes ?? null,
    }
  );

  if (error) {
    throw error;
  }

  const row =
    (data as CreatedMovementOfferRpcRow[] | null)?.[0]
    ?? null;

  if (!row) {
    throw new Error(
      'No movement offer data returned from create_movement_offer_from_interest'
    );
  }

  return {
    movementOfferId: row.movement_offer_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function discoverMaskedOffersForMyNeed(
  movementNeedId: string,
  limit: number = 20
): Promise<MaskedMovementOffer[]> {
  const { data, error } = await supabase.rpc('discover_masked_offers_for_my_need', {
    p_movement_need_id: movementNeedId,
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as MaskedMovementOfferRpcRow[];

  return rows.map((row) => ({
    movementOfferId: row.movement_offer_id,
    seatsOffered: row.seats_offered,
    estimatedArrivalMinutes: row.estimated_arrival_minutes,
    offerStatus: row.offer_status,
    offerCreatedAt: row.offer_created_at,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleYear: row.vehicle_year,
    vehicleColor: row.vehicle_color,
    vehicleSeatCapacity: row.vehicle_seat_capacity,
    age: row.age,
    commonMovementArea: row.common_movement_area,
    identityVerified: row.identity_verified,
    profileMediaVerified: row.profile_media_verified,
    completedMovements: row.completed_movements,
    rating: row.rating,
  }));
}

export async function acceptMovementOffer(
  movementOfferId: string
): Promise<AcceptedAlignment> {
  const { data, error } = await supabase.rpc('accept_movement_offer', {
    p_movement_offer_id: movementOfferId,
  });

  if (error) {
    throw error;
  }

  const row = (data as AcceptedAlignmentRpcRow[] | null)?.[0] ?? null;

  if (!row) {
    throw new Error('No alignment data returned from accept_movement_offer');
  }

  return {
    alignmentId: row.alignment_id,
    alignmentStatus: row.alignment_status,
    movementNeedId: row.movement_need_id,
    movementOfferId: row.movement_offer_id,
    createdAt: row.created_at,
  };
}

export async function getMyAlignmentStatus(
  alignmentId: string
): Promise<AlignmentStatusSummary> {
  const { data, error } = await supabase.rpc('get_my_alignment_status', {
    p_alignment_id: alignmentId,
  });

  if (error) {
    throw error;
  }

  const row = (data as AlignmentStatusSummaryRpcRow[] | null)?.[0] ?? null;

  if (!row) {
    throw new Error('No alignment status data returned from get_my_alignment_status');
  }

  return {
    alignmentId: row.alignment_id,
    movementNeedId: row.movement_need_id,
    movementOfferId: row.movement_offer_id,
    alignmentStatus: row.alignment_status,
    activationFeeMinor: row.activation_fee_minor,
    activationCurrency: row.activation_currency,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPostActivationPeople(
  movementNeedId: string
): Promise<PostActivationPerson[]> {
  const { data, error } = await supabase.rpc('get_post_activation_people', {
    p_movement_need_id: movementNeedId,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as PostActivationPersonRpcRow[];

  return rows.map((row) => ({
    personNumber: row.person_number,
    personRole: row.person_role,
    firstName: row.first_name,
    age: row.age,
    verified: row.verified,
    rating: row.rating,
    completedMovements: row.completed_movements,
    profilePhotoToken: row.profile_photo_token,
    profilePhotoExpiresAt: row.profile_photo_expires_at,
  }));
}

export async function getPostActivationVehicle(
  movementNeedId: string
): Promise<PostActivationVehicle | null> {
  const { data, error } = await supabase.rpc('get_post_activation_vehicle', {
    p_movement_need_id: movementNeedId,
  });

  if (error) {
    throw error;
  }

  const row = (data as PostActivationVehicleRpcRow[] | null)?.[0];

  if (!row) {
    return null;
  }

  return {
    vehicleDisplayName: row.vehicle_display_name,
    plateNumber: row.plate_number,
  };
}
