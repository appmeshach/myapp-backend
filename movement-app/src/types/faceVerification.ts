// Private session, member, media and provider identifiers never belong here.
export type PhotoSubmissionReceipt = { status: 'pending' | 'ready' };
export type FaceVerificationReceipt = { status: 'pending'; expiresAt: string };
export type FaceVerificationStartResult = FaceVerificationReceipt | { status: 'provider_unavailable' };
export type ProfilePhotoSubmissionStatus = {
  status: 'pending' | 'ready' | 'failed' | 'superseded';
  submittedAt: string;
  processedAt: string | null;
  currentPhotoVerified: boolean;
};

export type AlignmentFaceVerificationStatus = {
  status: 'not_started' | 'pending' | 'succeeded' | 'failed' | 'expired' | 'superseded';
  completedAt: string | null;
  expiresAt: string | null;
  // Own readiness only, not a second badge or whole-group payment authorization.
  readyForActivation: boolean;
};
