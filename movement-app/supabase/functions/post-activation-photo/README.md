# Protected post-activation photos

This Edge Function implements the image-delivery contract from migration 0014.
It is not deployed by adding these files. Migration 0015 is also pending application.

## Request and response

`POST /functions/v1/post-activation-photo` accepts JSON containing exactly
`{"profilePhotoToken":"<opaque token from get_post_activation_people>"}` and the
normal user access JWT in `Authorization: Bearer ...`. The app also sends its
existing publishable API key in `apikey`. Tokens are never put in URLs.

The gateway JWT check stays enabled. The handler independently calls the project's
Auth `GET /auth/v1/user` endpoint with that JWT, then uses only the verified user
ID for `resolve_post_activation_photo_for_server`. It never accepts a viewer ID
from the client or duplicates movement eligibility rules.

Invalid authentication returns 401. An unavailable, expired, wrong-viewer or
otherwise unauthorized photo returns the same 404 text response. Upstream errors
are not echoed or logged. Successful responses contain image bytes only and
`Content-Type: image/jpeg`, `image/png` or `image/webp`, plus
`Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
Upstream redirects are rejected; Storage headers, paths and signed URLs are never
forwarded. Reads are bounded at 5 MiB, with a 15-second upstream deadline. The
handler buffers those bounded bytes before returning them so oversized or
nonimage responses can be rejected without partially delivering sensitive data.

## Storage contract

Migration 0015 creates `verified-profile-photos` as a private bucket, with a
5 MiB file limit and JPEG/PNG/WebP allowlist. Restrictive bucket/object RLS policies
deny direct `anon`/`authenticated` access even if another permissive policy exists.
The server-only service role can upload and download through Storage's API.
No client upload, listing, signing or download policy is added.

For verified photos, `member_media.storage_path` must be an object key relative
to this bucket, e.g. `<random-directory>/<random-image>.png`, not a URL or
`bucket/key`. Use keys without whitespace, percent encoding, traversal, query
strings or backslashes. Existing SQL test paths are synthetic: those tests do
not upload real objects, and cannot by themselves produce displayable images.

Trusted media ingestion still needs to upload/re-encode reviewed raster images,
strip embedded metadata, and register the relative key in `member_media` with
the correct `verified` and `is_current` flags. Objects should be immutable:
replacement photos get a new key and media row. Do not overwrite an already
verified object's bytes in place. No upload/verification workflow is built here.

## Client integration

`getPostActivationProfilePhoto(token)` in `src/services/profilePhotoService.ts`
returns an in-memory `Blob`, or `null` for unavailable photos. It uses the existing
Supabase session and public configuration, with no knowledge of the bucket or
object key. It uses `fetch` because the currently installed `functions.invoke`
implementation parses `image/*` as text.

No UI screen is included. Later UI work must consume the Blob without persisting
it, discard it on sign-out/unmount, and obtain a fresh reveal/token when needed.
A new people reveal rotates prior tokens for that viewer/alignment/subject;
tokens also expire after five minutes. Do not create Storage URLs from tokens.

## Environment and pending setup

- Server: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, provided by the hosted
  Supabase Edge runtime when legacy service-role keys are available. Verify those
  variables in the deployment environment; never put the service key in Expo
  public configuration or source files. Local runtime secrets belong in ignored
  `supabase/functions/.env` if local serving is later requested.
- Client: existing `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No additional client secret is required.
- The bucket ID is fixed server-side; no bucket name/key is sent by the client.

Before this can serve real photos, apply 0015, provision reviewed images using
the Storage contract above, deploy the function with JWT verification enabled,
and perform authenticated integration checks in the target environment. None of
those remote operations are performed by the local tests.

## Offline checks

Run from the project root with the installed Node 24 runtime and dependencies:

```
npm run typecheck
npm run typecheck:edge
npm run test:photos
```

Tests inject mocked Auth, RPC and Storage responses. They check authorization
failure handling, identity derivation, exact image bytes, restricted content
types, paths/redirect leakage, caching and client request shape. They do not
verify a live JWT signature or execute RLS: the existing rollback-only 0014 SQL
test covers database authorization, and deployed integration testing remains
necessary. The migration check in the Node suite is static only.

References: [Edge Function authentication](https://supabase.com/docs/guides/functions/auth),
[getUser server verification](https://supabase.com/docs/reference/javascript/auth-getuser),
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[Edge environment variables](https://supabase.com/docs/guides/functions/secrets).
