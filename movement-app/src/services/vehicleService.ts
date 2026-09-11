import { supabase } from '../lib/supabase';

interface RegisterVehicleWithAccessRpcRow {
  vehicle_id: string;
  access_id: string;
}

export type RegisteredVehicleAccess = {
  vehicleId: string;
  accessId: string;
};

// This vehicle registration represents a vehicle the authenticated member currently
// has access to use and does not establish legal ownership.
export async function registerVehicleWithAccess(input: {
  make: string;
  model: string;
  year: number | null;
  color: string;
  seatCapacity: number;
}): Promise<RegisteredVehicleAccess> {
  const { data, error } = await supabase.rpc('register_vehicle_with_access', {
    p_make: input.make,
    p_model: input.model,
    p_year: input.year,
    p_color: input.color,
    p_seat_capacity: input.seatCapacity,
  });

  if (error) {
    throw error;
  }

  const row = data as RegisterVehicleWithAccessRpcRow | null;

  if (!row) {
    throw new Error('No vehicle registration data returned from register_vehicle_with_access');
  }

  return {
    vehicleId: row.vehicle_id,
    accessId: row.access_id,
  };
}
