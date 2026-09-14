BEGIN;

-- Only trusted media infrastructure uploads reviewed profile images here.
-- member_media.storage_path is the object key RELATIVE to this fixed bucket,
-- never a URL or a bucket-prefixed path. No changes to 0014's RPCs or permissions.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('verified-profile-photos', 'verified-profile-photos', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Restrictive policies cannot grant access. They prevent an unrelated broad
-- permissive policy from allowing client downloads, signing, listing or writes
-- for this bucket. service_role retains its server-only RLS bypass.
CREATE POLICY verified_profile_photos_no_direct_client_objects
  ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'verified-profile-photos')
  WITH CHECK (bucket_id <> 'verified-profile-photos');

CREATE POLICY verified_profile_photos_no_direct_client_bucket
  ON storage.buckets AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (id <> 'verified-profile-photos')
  WITH CHECK (id <> 'verified-profile-photos');

COMMIT;
