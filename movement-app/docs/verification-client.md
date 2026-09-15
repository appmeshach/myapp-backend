# Provider-neutral verification client

No migration, deployment, provider dependency, or secret is needed for this layer.
The existing safe status RPCs and authenticated binary upload service remain the
backend contract. Payment initiation and the final activation recheck remain
backend-authoritative; this client exposes only the current member's readiness.

## State and screens

`verificationState.ts` owns transitions. Photo phases are `none`, `submitting`,
`processing`, `prepared_unverified`, `verified`, and `failed`. Movement phases are
`not_required`, `required`, `starting`, `provider_unavailable`,
`provider_session_ready`, `pending`, `succeeded`, `failed`, and `expired`.
`not_required` represents no available safe status result, not permission to pay.

Photo upload receipts cannot mark a photo verified. The own-photo management
label "Verified photo" comes from safe backend status. Public Verified remains
the existing backend conjunction of identity verification and profile-media
verification. Replacement immediately hides the previous local verified label.
Only a safe backend success with readiness can mark the current member ready.
Provider capture submission alone means pending.

`identity-photo` hosts the reusable photo card. `movement-verification` accepts
a `movementNeedId` route parameter and hosts the movement card. The starter home
links to both; the movement route requires an actual movement before showing
the card. There is no aggregate participant readiness UI or payment action.

Safe state contains phases, timestamps, readiness and fixed error categories.
It does not hold media/member/alignment UUIDs, provider references, scores,
storage paths, or submission/session IDs. The movement need ID is passed to the
existing start/status helpers. Auth session handling stays in the Supabase client.

## Lifecycle and refreshing

Controllers invalidate stale results using operation generations and separate
latest-read counters. Status reads pass an AbortSignal into Supabase; replacement,
new reads, backgrounding and disposal cancel obsolete reads. Hooks pause on
background/blur and clean up on account change/unmount. Interrupted transient
operations return to refreshable states. Transport requests that cannot be
aborted may finish, but their invalidated results cannot change state. Uploads
retain their existing transport timeout; cancellation cannot undo a server upload.
An interrupted upload shows an unavailable state until a safe refresh confirms
submission, rather than asserting that submission succeeded. Foregrounding while
an operation settles triggers reconciliation after it finishes.

One poller per mounted controller schedules at 15-second intervals after reads,
with at most 20 automatic refreshes per foreground session. Pending processing
and verification poll; terminal states stop. Manual refresh remains available.
In-flight refresh requests coalesce, and foreground resumes refresh immediately.
Network failures remain distinct from biometric failures. A local deadline timer
removes expired readiness, with backend status still authoritative.

Expiry timestamps are the available safe attempt watermark; request generations
also reject responses initiated before a replacement/start. The current server
contract gives new attempts later expiry timestamps (started_at plus ten minutes).
Comparison retains PostgreSQL microseconds, including attempts within the same
millisecond. If that contract changes,
review this watermark before adapting providers; do not infer readiness from SDK
results or expose private session IDs to solve ordering.

## Remaining integrations

`MovementBiometricProvider` is the single SDK boundary. The shipped implementation
always reports unavailable. Tests inject adapters directly; there is no production
environment toggle for fake success. A future adapter can use the existing start
helper, keep any SDK handles privately, and present capture. Only server-verified
callbacks may establish success.

No picker is installed. `MovementPhotoPicker` is the isolated Blob selection hook;
the default screen disables selection with explanatory text. Upload already uses
normal authenticated JWT plus raw image bytes, never a storage URL. Selecting a
picker, configuring trusted photo processing, and implementing the provider SDK
and authenticated callback contract are separate work. Provider choice affects
native SDK/build support, session handoff, cancellation, callback authentication,
and expiry behavior. None blocks this client foundation.

Tests use the existing Node/TypeScript VM approach, including lightweight rendered
component assertions. They do not replace native device/camera integration tests.

The client audit adds regressions for out-of-order reads, cancellation, interrupted
operations, microsecond ordering, malformed route inputs, late picker completion,
and unexpected provider results. Safe status services validate enum, timestamp and
boolean fields and reject ambiguous multiple rows. Both returned and thrown errors
are sanitized. An HTTP rejection of face-check initiation is never labeled a photo
format error. Navigation carries only the movement need ID; backend eligibility
still determines access. Supabase Auth retains its normal private session identity
for account changes; no identity is added to verification state or request bodies.
