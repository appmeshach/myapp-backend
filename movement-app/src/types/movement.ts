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
