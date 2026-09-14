import { supabase } from '../lib/supabase';
import type { AlignmentFaceVerificationStatus, ProfilePhotoSubmissionStatus } from '../types/faceVerification';

export async function getMyProfilePhotoSubmissionStatus(): Promise<ProfilePhotoSubmissionStatus | null> {
  const { data, error } = await supabase.rpc('get_my_profile_photo_submission_status');
  if (error) throw new Error('Photo submission status unavailable');
  const row = data?.[0];
  if (!row) return null;
  return {
    status: row.status,
    submittedAt: row.submitted_at,
    processedAt: row.processed_at,
    currentPhotoVerified: row.current_photo_verified,
  };
}

export async function getMyAlignmentFaceVerificationStatus(
  movementNeedId: string,
): Promise<AlignmentFaceVerificationStatus | null> {
  const { data, error } = await supabase.rpc('get_my_alignment_face_verification_status', {
    p_movement_need_id: movementNeedId,
  });
  if (error) throw new Error('Face verification status unavailable');
  const row = data?.[0];
  if (!row) return null;
  return {
    status: row.status,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    readyForActivation: row.ready_for_activation,
  };
}

// Upload/initiation will use authenticated server endpoints once a provider is
// chosen. Never call trusted result/processing RPCs from a member client.
