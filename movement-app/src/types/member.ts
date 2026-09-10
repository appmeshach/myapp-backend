export type Member = {
  id: string;
  firstName: string;
  age: number;
  identityVerified: boolean;
  profileMediaVerified: boolean;
  commonMovementArea?: string;
  completedMovements: number;
  createdAt: string;
};

export type MaskedMemberProfile = {
  memberId: string;
  alias: string;
  age: number;
  commonMovementArea?: string;
  identityVerified: boolean;
  profileMediaVerified: boolean;
  completedMovements: number;
  rating?: number;
  languages?: string[];
  avatarKey?: string;
};

export type RevealedMemberProfile = {
  memberId: string;
  firstName: string;
  age: number;
  profilePhotoUrl?: string;
  profileVideoUrl?: string;
  identityVerified: boolean;
  completedMovements: number;
  rating?: number;
  languages?: string[];
};
