import { supabase } from '../lib/supabase';

// Returns in-memory image bytes for later UI integration. The token is temporary,
// not a URL. Do not persist this Blob or the token; discard on sign-out/unmount.
export async function getPostActivationProfilePhoto(profilePhotoToken: string): Promise<Blob | null> {
  if (!/^[a-f0-9]{64}$/.test(profilePhotoToken)) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Authentication required');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error('Missing Supabase environment configuration');

  // functions.invoke in the installed SDK parses image/* as text. Fetch the
  // binary response directly; only the normal user JWT and public API key leave
  // the app. No bucket/object path or service-role key is used here.
  const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/post-activation-photo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ profilePhotoToken }),
    cache: 'no-store',
    redirect: 'error',
  });

  if (response.redirected) throw new Error('Photo unavailable');
  if (response.status === 404 || response.status === 403) return null;
  if (response.status === 401) throw new Error('Authentication required');
  if (!response.ok) throw new Error('Photo unavailable');
  const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
    throw new Error('Photo unavailable');
  }
  return response.blob();
}
