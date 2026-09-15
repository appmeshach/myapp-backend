import { supabase } from '../lib/supabase';
import type { FaceVerificationReceipt, PhotoSubmissionReceipt } from '../types/faceVerification';

// Existing getMyProfilePhotoSubmissionStatus and
// getMyAlignmentFaceVerificationStatus remain in faceVerificationService.
async function post(endpoint: string, body: BodyInit, contentType: string): Promise<Record<string, unknown>> {
  try {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('authentication_required');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('request_unavailable');
  const r = await fetch(`${url.replace(/\/$/, '')}/functions/v1/${endpoint}`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: key, 'Content-Type': contentType },
    body, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  if (r.status === 401) throw new Error('authentication_required');
  if (!r.ok || r.redirected) throw new Error('request_unavailable');
  const result: unknown = await r.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('request_unavailable');
  return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'authentication_required') throw error;
    throw new Error('request_unavailable');
  }
}
export async function submitMovementIdentityPhoto(photo: Blob): Promise<PhotoSubmissionReceipt> {
  if (!['image/jpeg','image/png','image/webp'].includes(photo.type) || photo.size < 1 || photo.size > 5 * 1024 * 1024) {
    throw new Error('invalid_photo');
  }
  const row = await post('submit-profile-photo', photo, photo.type);
  if (row.status !== 'pending' && row.status !== 'ready') throw new Error('request_unavailable');
  return { status: row.status }; // Processing is not verification.
}
export async function startMyMovementFaceVerification(movementNeedId: string): Promise<FaceVerificationReceipt> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(movementNeedId)) throw new Error('request_unavailable');
  const row = await post('start-face-verification', JSON.stringify({ movementNeedId }), 'application/json');
  if (row.status !== 'pending' || typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt))) throw new Error('request_unavailable');
  return { status: row.status, expiresAt: row.expiresAt };
}
