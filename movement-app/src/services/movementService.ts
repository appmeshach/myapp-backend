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
    p_vehicle_id: input.vehicleId,
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
