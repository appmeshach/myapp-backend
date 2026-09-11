import { supabase } from '../lib/supabase';

interface UpdateMyProfileRpcRow {
  id: string;
  first_name: string;
  date_of_birth: string | null;
  identity_verified: boolean;
  profile_media_verified: boolean;
  common_movement_area: string | null;
  completed_movements: number;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

export type UpdatedMemberProfile = {
  id: string;
  firstName: string;
  dateOfBirth: string | null;
  identityVerified: boolean;
  profileMediaVerified: boolean;
  commonMovementArea: string | null;
  completedMovements: number;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
};

export async function updateMyProfile(input: {
  firstName: string;
  dateOfBirth: string | null;
}): Promise<UpdatedMemberProfile> {
  const { data, error } = await supabase.rpc('update_my_profile', {
    p_first_name: input.firstName,
    p_date_of_birth: input.dateOfBirth,
  });

  if (error) {
    throw error;
  }

  const row = data as UpdateMyProfileRpcRow | null;

  if (!row) {
    throw new Error('No profile data returned from update_my_profile');
  }

  return {
    id: row.id,
    firstName: row.first_name,
    dateOfBirth: row.date_of_birth,
    identityVerified: row.identity_verified,
    profileMediaVerified: row.profile_media_verified,
    commonMovementArea: row.common_movement_area,
    completedMovements: row.completed_movements,
    rating: row.rating,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
