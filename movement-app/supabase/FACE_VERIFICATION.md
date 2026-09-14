# Installed 0016: rollback expiry-fixture correction

The reported 118/119 rollback result exposed a test-fixture defect, not a
production latest-attempt defect. The test backdated only the latest successful
attempt's `started_at`, promoting a preserved historical attempt above it.
Both production queries use `started_at DESC, id DESC` for the same member and
alignment. The corrected fixture translates all timestamps in that scoped
timeline by one interval and asserts that ordering and non-clock evidence remain
unchanged. It also tests newer pending/failed attempts blocking an older valid
success. Installed 0016 is unchanged; no 0017 is needed for this correction.

## Original foundation design

0016 replaces the earlier, unapplied manual-approval proposal. It does not change
migrations 0001–0015, the photo Edge Function, reveal fields, or the single badge:
`identity_verified AND profile_media_verified`. Face checks never set
`identity_verified` and are not a guarantee that a person is safe.

## Trusted workflow

1. A future authenticated upload endpoint verifies the member JWT, derives the
   member ID, bounds/validates image bytes, assigns a random immutable object key,
   and uploads to the private `profile-photo-submissions` bucket. It calls
   `create_profile_photo_submission_for_server`. No direct client Storage access.
2. A trusted image worker decodes/re-encodes the raster, strips metadata, enforces
   size/dimension limits, and uploads a new immutable key to the private
   `verified-profile-photos` bucket. It calls
   `prepare_profile_photo_submission_for_server`, which creates an **unverified**
   current media row. The bucket name is not a verification decision. Processing
   failures use `fail_profile_photo_submission_for_server`.
3. After offer acceptance, a future server endpoint creates a provider session
   and calls `start_alignment_face_verification_for_server`. It binds the exact
   current media, member, alignment and unique provider reference. Only offering
   member, primary requester and confirmed invited travellers qualify.
4. A trusted adapter authenticates the provider callback and validates its
   session/reference, capture freshness, liveness and match against the bound
   image. Only then does it call `complete_alignment_face_verification_for_server`.
   Both checks must pass before the exact current media and persistent media flag
   become verified. Wrong media, failed, expired and superseded sessions cannot
   establish verification. Clients never submit result booleans to this RPC.

Session creation and completion both require a matching private submission with
the same member ID and exact media ID, `status = 'ready'`, and a non-null processing
timestamp; the photo must still be current. Completion rechecks before callback
idempotency or verification writes and locks the provenance row during the call.
The payment-readiness predicate requires this provenance as well. Historical or
manually inserted current photos cannot acquire verification through these RPCs;
they must go through submission and preparation. Existing historical verified
photos also need preparation before they can satisfy a new alignment check.

Live verification does not consume or change the submission's `ready` status.
The same verified prepared current media can therefore serve later movements,
each with a fresh alignment-specific session and no new upload. Replacement
requires a newly prepared row; an old session never switches to a replacement.
These are trusted database provenance records, not independent proof that a
worker actually re-encoded the bytes: trusted workers must still implement that
processing and avoid direct record fabrication or Storage object overwrites.

Private tables store references/results, not biometric templates or arbitrary
provider payloads. A new session supersedes earlier pending sessions for that
member/alignment. Successful events remain historical evidence; readiness uses
only the latest attempt, so an old success cannot authorize a new pending attempt.
A provider reference cannot be reused. Session IDs/media IDs
remain server-only; future client initiation must return a provider-approved
opaque challenge contract, not these internal records.

Upload, processing, provider initiation/callback endpoints and a real provider
are **not implemented**. The client additions are safe own-status reads only.
There is no fake successful-verification endpoint. No new secret is required by
the status helpers; eventual server adapters require server credentials and the
chosen provider's credentials/webhook verification keys, never Expo public keys.

## Activation and payment

Acceptance still produces `awaiting_activation_payment`; that state alone does
not authorize initiating payment. 0016 replaces `create_alignment_activation_payment`
with the same service-only signature, validations and pending-payment idempotency,
adding a mandatory locked face gate before creating OR returning a pending payment.
Missing, failed, expired or superseded checks reject the call without creating a
payment row or setting a fee. A ledger INSERT trigger also prevents direct
trusted insertion from bypassing the check. Existing pending records are retained,
but reusing them through the creation RPC requires current verification.

The existing server-only `mark_alignment_activation_payment_succeeded` still
writes payment success and activation in one transaction. Its activation trigger
rechecks the same authoritative gate immediately before changing to `activated`.
Both gates require every physical participant to have:

- Successful session for **this alignment and member**.
- Liveness and face match passed.
- Exact bound photo remains current and verified; persistent media flag is true.
- Completion is not in the future, and the ten-minute deadline from session
  creation has not expired. Time is checked after waiting for locks.

A failure raises an exception, rolling back payment status, provider reference,
activation timestamps and journey creation. The unchanged 0008 trigger creates
one journey after successful activation; 0007 retains its payment retry behavior.
Existing activated movements can still progress/end without retroactive checks.
All future activations, including existing unpaid alignments, require checks.

The ten-minute window is an initial backend policy, not provider evidence of
freshness. The adapter must independently validate the live capture and handle
expiry/retries. Persistent profile verification never substitutes for a new
alignment check. Safe `ready_for_activation` is **own** readiness, not group
readiness or authorization to charge.

Future provider integration MUST call `create_alignment_activation_payment` and
wait for its successful transaction commit BEFORE making any external provider
initiation/charge call. A rejected RPC means do not call the provider. Use the
returned payment ID as the provider idempotency key; a retry is not a new charge.
Do not initiate from a cached payment ID, alignment state, client flag or the
advisory `get_alignment_face_readiness_for_server` result. This closes payment
creation before verification at the database boundary.

Readiness cannot be reserved across an external network call. Expiry/revocation
after valid initiation can still reject payment success. PostgreSQL cannot undo
that external charge: store/reconcile provider events durably outside the failed
success RPC, then retry after fresh checks or void/refund according to payment policy.
Do not acknowledge a lost payment event as processed. There is no live payment
provider integration here. This remains a prerequisite for real-money rollout.

## Concurrency and privacy

Accepted participant rosters are frozen, including if a requester reopens their
need. 0013 invitation/capacity and 0012 mutual-completion functions are preserved.
Declined/removed members do not require checks; pending invitations continue to
block acceptance under 0013. New unconfirmed entries cannot be added afterward.

Media processing/revocation takes a member row lock. Completion/start takes the
alignment then member lock; payment creation and activation lock the need and all required members
in UUID order. Replacement cannot race verification/activation unchecked. Need
locks serialize roster writes with acceptance. Existing cross-function lock
orders can still produce a PostgreSQL deadlock; transactions fail safely and
trusted orchestration must retry whole transactions on 40P01/40001, not ignore
errors. Runtime parallel-connection stress testing is still required.

A unique partial index enforces one current photo. If existing data contains
duplicates, migration application fails safely rather than choosing a face.
Review and repair such data before applying. New processed keys cannot reuse
known media paths; workers must also prevent Storage byte overwrites. SQL cannot
verify object existence/content or enforce provider honesty. Trusted services
must use the RPCs and immutable object uploads, not direct table manipulation.

### Required read-only preflight before applying 0016

Run as a database administrator, not through a client RPC (not run by this task):

```sql
SELECT member_id, count(*) AS current_photo_count
FROM public.member_media
WHERE media_type = 'photo' AND is_current
GROUP BY member_id
HAVING count(*) > 1;
```

Expected: zero rows. If rows exist, stop application and separately review which
photo should remain current. 0016 intentionally raises a clear preflight error;
it never silently retires, deletes or verifies existing photos. The unique index
also rejects duplicates introduced between preflight and index creation. Because
0016 is transactional, a failure rolls back its earlier changes too.

Replacement clears the persistent media flag, supersedes pending checks and
deletes issued photo tokens. Old tokens also fail 0014's current-media check.
Revocation similarly clears verification. New media needs a new live check.
Neither operation rewrites successful face-verification records, including those
for awaiting, activated, in-progress or completed alignments. Their full media
binding, provider reference, liveness/match results and completion time remain
private audit evidence. Those historical successes cannot authorize future
activation when the exact media is no longer current/verified, its provenance
is no longer ready, or the persistent media flag is false. This is invalidation
of authorization, not erasure of the past successful event.
The existing proxy still delivers only authorized verified current image bytes;
no paths, signed URLs or new reveal fields are added.

## Validation

Run locally: `npm run typecheck`, `npm run test:photos`, and
`node --test tests/faceVerificationService.test.cjs`.
The rollback SQL is `tests/0016_secure_profile_photo_submissions_test.sql`, for a
database administrator after 0001–0016. It uses disposable auth fixtures, actual
production RPCs and transaction-local role/JWT context, ending in ROLLBACK.
It changes clock fields only to exercise expiry without waiting. No triggers,
RLS or production functions are disabled/replaced. Existing 0014 rollback tests
target the pre-face-gate schema and cannot activate their old fixtures unchanged
after 0016; the new suite checks their relevant privacy contracts with live-check
fixtures. Neither SQL nor provider integration is validated by the mocked Node
tests. Do not interpret static checks as a passed database execution.
