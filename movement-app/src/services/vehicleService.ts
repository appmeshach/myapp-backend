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
  model?: string | null;
  year: number | null;
  color: string;
  seatCapacity: number;
  // Privately collected declaration; this does not mark the vehicle as verified.
  plateNumber: string;
}): Promise<RegisteredVehicleAccess> {
  const plateNumber = input.plateNumber?.trim();
  if (!plateNumber || plateNumber.length > 32 || /[\u0000-\u001f\u007f]/.test(plateNumber)) {
    throw new Error('Plate number must contain 1 to 32 characters without control characters');
  }

  const args = {
    p_make: input.make,
    p_model: input.model ?? null,
    p_year: input.year,
    p_color: input.color,
    p_seat_capacity: input.seatCapacity,
  };
  // Requires 0014. Never fall back to plate-less registration on RPC failure.
  const { data, error } = await supabase.rpc('register_vehicle_with_plate', {
    ...args,
    p_plate_number: plateNumber,
  });

  if (error) {
    throw error;
  }

  const row = (data as RegisterVehicleWithAccessRpcRow[] | null)?.[0];

  if (!row) {
    throw new Error('No vehicle registration data returned');
  }

  return {
    vehicleId: row.vehicle_id,
    accessId: row.access_id,
  };
}
