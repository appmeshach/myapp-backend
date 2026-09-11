export type MovementNeedStatus =
  | "discoverable"
  | "paused"
  | "expired"
  | "closed";

export type MovementOfferStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "expired";

export type AlignmentStatus =
  | "awaiting_activation_payment"
  | "activated"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export type JourneyStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export type MovementNeed = {
  id: string;
  memberId: string;
  originArea: string;
  destinationArea: string;
  earliestDepartureAt: string;
  latestDepartureAt?: string;
  peopleCount: number;
  status: MovementNeedStatus;
  createdAt: string;
};

export type MovementOffer = {
  id: string;
  movementNeedId: string;
  offeringMemberId: string;
  vehicleId: string;
  seatsOffered: number;
  proposedPickupArea?: string;
  proposedDropoffArea?: string;
  estimatedArrivalMinutes?: number;
  status: MovementOfferStatus;
  createdAt: string;
};

export type Alignment = {
  id: string;
  movementNeedId: string;
  movementOfferId: string;
  memberNeedingMovementId: string;
  offeringMemberId: string;
  // Production values should later use integer minor units rather than floating-point arithmetic.
  activationFeeAmount?: number;
  activationPaymentId?: string;
  status: AlignmentStatus;
  activatedAt?: string;
  createdAt: string;
};

export type Journey = {
  id: string;
  alignmentId: string;
  vehicleId: string;
  status: JourneyStatus;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
};

export type JourneyReview = {
  id: string;
  journeyId: string;
  reviewerMemberId: string;
  reviewedMemberId: string;
  overallRating: number;
  wouldMoveTogetherAgain?: boolean;
  punctualityRating?: number;
  respectRating?: number;
  communicationRating?: number;
  profileResemblanceConfirmed?: boolean;
  createdAt: string;
};

export type MaskedMovementNeed = {
  movementNeedId: string;
  originArea: string;
  destinationArea: string;
  earliestDepartureAt: string;
  latestDepartureAt: string | null;
  peopleCount: number;
  age: number | null;
  commonMovementArea: string | null;
  identityVerified: boolean;
  profileMediaVerified: boolean;
  completedMovements: number;
  rating: number | null;
};

export type CreateMovementOfferInput = {
  movementNeedId: string;
  vehicleId: string;
  seatsOffered: number;
  proposedPickupArea?: string | null;
  proposedDropoffArea?: string | null;
  estimatedArrivalMinutes?: number | null;
};

export type CreatedMovementOffer = {
  movementOfferId: string;
  status: string;
  createdAt: string;
};

export type MaskedMovementOffer = {
  movementOfferId: string;
  seatsOffered: number;
  estimatedArrivalMinutes: number | null;
  offerStatus: string;
  offerCreatedAt: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number | null;
  vehicleColor: string;
  vehicleSeatCapacity: number;
  age: number | null;
  commonMovementArea: string | null;
  identityVerified: boolean;
  profileMediaVerified: boolean;
  completedMovements: number;
  rating: number | null;
};

export type AcceptedAlignment = {
  alignmentId: string;
  alignmentStatus: string;
  movementNeedId: string;
  movementOfferId: string;
  createdAt: string;
};

export type AlignmentStatusSummary = {
  alignmentId: string;
  movementNeedId: string;
  movementOfferId: string;
  alignmentStatus: string;
  activationFeeMinor: number | null;
  activationCurrency: string;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
