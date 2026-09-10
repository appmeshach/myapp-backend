export type Vehicle = {
  id: string;
  ownerMemberId: string;
  make: string;
  model: string;
  year?: number;
  color: string;
  seatCapacity: number;
  verified: boolean;
  photoUrls?: string[];
  createdAt: string;
};

export type VehiclePublicProfile = {
  vehicleId: string;
  make: string;
  model: string;
  year?: number;
  color: string;
  verified: boolean;
  photoUrls?: string[];
  seatCapacity: number;
};
