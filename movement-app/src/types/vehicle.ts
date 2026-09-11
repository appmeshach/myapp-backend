export type Vehicle = {
  id: string;
  make: string;
  model: string;
  year?: number | null;
  color: string;
  seatCapacity: number;
  createdAt: string;
  updatedAt: string;
};

// This relationship represents the member's declared/current access to use a vehicle,
// and does not mean the member legally owns the vehicle.
export type MemberVehicleAccess = {
  id: string;
  memberId: string;
  vehicleId: string;
  active: boolean;
  createdAt: string;
};

export type VehiclePublicProfile = {
  vehicleId: string;
  make: string;
  model: string;
  year?: number | null;
  color: string;
  seatCapacity: number;
};
