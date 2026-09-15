import { supabase } from '../lib/supabase';
import type { AlignmentFaceVerificationStatus, ProfilePhotoSubmissionStatus } from '../types/faceVerification';

async function statusRow(name: string, args?: Record<string, string>, signal?: AbortSignal) {
  try {
    const request = args ? supabase.rpc(name, args) : supabase.rpc(name);
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error) throw new Error(error.code === 'PGRST301' ? 'authentication_required'
      : /fetch|network/i.test(error.message ?? '') ? 'network_unavailable' : 'verification_unavailable');
    if (data == null || (Array.isArray(data) && data.length === 0)) return null;
    if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') throw new Error('verification_unavailable');
    return data[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'authentication_required') throw new Error(message);
    if (message === 'network_unavailable' || (error instanceof Error && ['TypeError','AbortError','TimeoutError'].includes(error.name))) throw new Error('network_unavailable');
    throw new Error('verification_unavailable');
  }
}
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) => value === null || timestamp(value);

export async function getMyProfilePhotoSubmissionStatus(signal?: AbortSignal): Promise<ProfilePhotoSubmissionStatus | null> {
  const row = await statusRow('get_my_profile_photo_submission_status', undefined, signal);
  if (!row) return null;
  if (!['pending','ready','failed','superseded'].includes(row.status) || !timestamp(row.submitted_at)
    || !nullableTimestamp(row.processed_at) || typeof row.current_photo_verified !== 'boolean') throw new Error('verification_unavailable');
  return {
    status: row.status,
    submittedAt: row.submitted_at,
    processedAt: row.processed_at,
    currentPhotoVerified: row.current_photo_verified,
  };
}

export async function getMyAlignmentFaceVerificationStatus(
  movementNeedId: string,
  signal?: AbortSignal,
): Promise<AlignmentFaceVerificationStatus | null> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(movementNeedId)) throw new Error('verification_unavailable');
  const row = await statusRow('get_my_alignment_face_verification_status', {
    p_movement_need_id: movementNeedId,
  }, signal);
  if (!row) return null;
  if (!['not_started','pending','succeeded','failed','expired','superseded'].includes(row.status)
    || !nullableTimestamp(row.completed_at) || !nullableTimestamp(row.expires_at)
    || typeof row.ready_for_activation !== 'boolean'
    || (row.status !== 'not_started' && !timestamp(row.expires_at))
    || (row.status === 'succeeded' && !timestamp(row.completed_at))) throw new Error('verification_unavailable');
  return {
    status: row.status,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    readyForActivation: row.ready_for_activation,
  };
}

// Upload/initiation will use authenticated server endpoints once a provider is
// chosen. Never call trusted result/processing RPCs from a member client.
