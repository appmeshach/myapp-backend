# 0114H local service-name compatibility implementation

Starting HEAD: 53ba9a2fbea1c727ab062893608d7c005c4300ef.
Branch: feature/0092-shared-segment-suitability.

The independently reviewed design remains unchanged in
[the design record](0114h-railway-service-name-compatibility-design.md).
This implementation is local only. No provider observation, live acquisition,
0114D use, Railway change, deployment, restart, staging, commit or push occurred.

## Implemented contract

The executable acquisition contract is
movement_railway_identity_acquisition_auth_v3. Its only authoritative name field is
manifest.expectedTarget.serviceName. The non-name expectations retain their prior
rules; expectations.serviceName is absent. There is no compiled qualification-name
default, historical-name fallback or dual-version execution fallback.

createExecutableAcquisitionDraft now requires four arguments: the original opaque
ID binding, full reviewed forbidden inventory, reviewed code identity and an input
descriptor containing exactly path and sha256. The descriptor can reference only
docs/0114e-current-acquisition-input-review.json. That separate current package is
not created by this milestone: the actual input review remains incomplete.

The current safe 0114E worksheet is version
movement_railway_acquisition_input_review_v2. A separately completed and independently
reviewed copy must bind its exact serviceName/ID association, target eligibility,
name/ID provenance, reviewed code identity, full inventory, host attestation and
independent package review. It must retain PRELIVE_NOT_AUTHORIZED and false live,
manual, executable and provider/identity flags. Its evidenceBinding references only
docs/0114e-qualification-target-evidence.json#qualificationReview.reviewedContext
and that artifact's canonical text digest. The scoped evidence is never directly
executable and is not a substitute for a completed input package.

The authorization owner validates the package, exact target linkage, source/input
identity and scoped evidence association, then makes a fresh deeply frozen snapshot
before issuing review. JSON duplicate keys, duplicate name locations and malformed
or extra fields fail. Caller descriptors reject getters, symbols and hidden fields.
Name labels are bounded and compared without trimming, case folding, aliases or
wildcard semantics. Tracked text hashes normalize CRLF to LF only, preserving all
other text bytes/BOM/EOF; this introduces no competing raw-byte evidence convention.
Hash equality does not establish that human review occurred.

Review, approval, authorization, ticket redemption and target-permit consumption
recheck the retained code/input/evidence identities. Changed inputs need a new
draft and independent review. Package approval binds the exact retained manifest,
context review and reviewed host checklist. Final manual authorization is separate.

## Runtime ownership

Only four runtime files changed, under scripts/assessment-worker/:

| File | Implemented boundary |
| --- | --- |
| qualification-railway-live-authorization.cjs | v3 reviewed-input intake, frozen context/manifest, repeated identity checks and private one-use acquisition-target permit. |
| qualification-railway-target-identity.cjs | Private permit consumption before session creation; session-owned exact name/ID validation; manifest-bound human service and final candidate review. Context-only sessions cannot issue services/instance requests. |
| qualification-railway-https-adapter.cjs | Early services/instance validation receives the retained original session. Final identity acceptance independently repeats validation. Fixed ID-only queries and transport/provenance rules remain intact. |
| qualification-railway-acquisition-wrapper.cjs | Passes only the privately redeemed permit into fresh session creation before context open; clears its reference and preserves lifecycle, both human gates and terminal cleanup. |

The authorization owner stores opaque target permits privately and supplies a
consume closure only to the literal identity owner through a temporary initialization
connector. The connector is deleted and exports frozen before ordinary import
returns. Permit consumption burns before arity/binding/code/input checks. Module
replacement fails closed. Copies, JSON, replay and plain name objects grant nothing.
No public permit issuer, getter, extraction or consumer API is added.

Services still require a complete bounded connection, unique IDs/names, exact name
selection and exact service ID equality before the human service gate. Instance
responses require that same expected name and preserve nullable instance-ID,
root/region and same-session/context rules. Final candidates include expected and
observed IDs/names and the acquisition manifest digest. Human acknowledgement
cannot override machine mismatch. The wrapper still uses one fresh session/context,
three fixed provider operations, finite monotonic human waits and no retry, fallback,
fork or resume. Local synthetic success establishes none of these as real provider
facts.

## Source identity and preserved evidence

Pin inventory remains twelve. Only identity, adapter and acquisition-wrapper pins
change; the other nine remain unchanged. Authorization logic/pin changes produce
a new canonical authorization self hash. Current safe 0110, 0111 and 0114A templates
are regenerated; the 0114E safe worksheet is versioned; the current 0114F safe
template's code identity is refreshed. All current authority defaults remain false.

The historical actual 0114E assessment, reviewed 0114F metadata, qualification
evidence and reviewed 0114H design remain byte-identical. Historical conformance
tests use their archived source/template context rather than claiming old reviews
approved changed current source. All 99 migrations and other runtime/preflight
files are unchanged. No completed current input package or fabricated lifecycle
attestation is supplied. The capsule remains unread, untouched and untracked.

## Validation and remaining gates

The new 0114H suite exercises separately reviewed names, exact machine rejection,
input/evidence drift, immutable snapshots, canonical text hashes, permit misuse,
context-only isolation, both initialization orders and owner replacement. Existing
focused suites retain their provenance, human-review and lifecycle rejection tests.
Final focused validation passed 1,503/1,503 tests with zero failures/skips:
0109 78; 0110 63; 0111 101; 0112 62; 0113 63; 0114A 63; 0114B 72;
0114C 96; 0114D 141; 0114E 459; 0114F 240; new 0114H 65.
App, Edge and worker typechecks passed. All twelve pins match final source bytes;
authorization self hash is
05a8ef85b6e07f6ff7b54270f67e45d2c6fb47966c3d779e3191f4965b04192c.

The initial 19-file regression encountered a failure in the unchanged 0099
malformed-IPC child test (about 5.13 seconds versus its five-second timeout). That
partial run was stopped when inspection established that remaining worker-process
coverage uses real loopback HTTP. The user then explicitly authorized loopback-only
regression coverage while keeping all external/provider network access prohibited.

The entire 19-file chain was rerun with --test-concurrency=1 and no intervening
runtime/test changes. It passed: 1,117 tests, 1,114 passed, zero failures, three
existing OS-specific skips, approximately 659.38 seconds. The malformed-IPC test
passed on this rerun. Worker-process HTTP servers bind only to 127.0.0.1 and use
synthetic test data. The Windows POSIX-only 0102 loopback case remains skipped.
git diff --check passed. This completes local implementation validation; independent
implementation review and actual acquisition-input completion remain separate gates.

Actual serviceInstanceId and lifecycle remain unresolved/null. inputReviewComplete,
readyFor0114DPreparation, deploymentAuthorized, liveAuthorized,
manualLiveAuthorization, providerObservationOccurred and targetIdentityProven
remain false. Independent review of the exact implementation and a regenerated
current 0114E package remain required, including eligibility, inventory and host
attestations. No later real acquisition or Railway action follows automatically.

External network activity was limited to one direct documentation-tool read of
https://docs.expo.dev/versions/v57.0.0/, explicitly permitted for AGENTS.md before
writing code. That request supplied only the public URL and response-length setting;
it sent no repository contents, target IDs, credentials, environment, source or user
data. No link was followed. The separately authorized regression used loopback-only
HTTP test traffic; no Railway, Supabase, GitHub, registry or external provider/API
access occurred.

## Independent implementation review

- reviewerReference: AT
- independentlyReviewed: true
- result: NO_MISMATCH
- reviewedExactImplementationFiles: true
- comparedAgainstReviewed0114HDesign: true
- confirmedAll50ImplementationPoints: true
- designDeviationFound: false
- reviewedAtLocal: 2026-10-15 22:13:35 WAT
- reviewedAt: 2026-10-15T21:13:35.000Z

The independent reviewer confirmed:

- Runtime semantic changes are limited to the four approved runtime files.
- Executable contract is movement_railway_identity_acquisition_auth_v3.
- manifest.expectedTarget.serviceName is the sole executable service-name authority.
- Exact serviceName and serviceId equality remain mandatory.
- There is no myapp-backend fallback.
- movement-qualification is not a compiled trusted default.
- No fuzzy, alias, case-folded, wildcard or first-service fallback exists.
- Reviewed name and ID remain bound in one reviewed context.
- The private acquisition-target permit is one-use and burns before validation.
- No public permit mint/getter/extractor survives initialization.
- Permit consumption precedes credential-bearing context opening.
- Context-only 0113 sessions cannot continue to ProjectServices or ServiceInstance.
- Both human review gates remain mandatory.
- Machine mismatch cannot be overridden by human approval.
- One session/context and the three-request ceiling remain.
- No retry/fallback/resume/fork authority was introduced.
- serviceInstanceId and lifecycle remain unresolved/null.
- providerObservationOccurred, targetIdentityProven, inputReviewComplete,
  readyFor0114DPreparation, deploymentAuthorized, liveAuthorized and
  manualLiveAuthorization remain false.
- Safe templates remain fail-closed.
- Historical 0114F evidence, historical actual 0114E assessment,
  qualification-target evidence and reviewed 0114H design remain unchanged.
- Pin count remains exactly 12.
- The three changed runtime pins match their reviewed source bytes.
- Authorization self hash is exactly:
  05a8ef85b6e07f6ff7b54270f67e45d2c6fb47966c3d779e3191f4965b04192c.
- All 99 migrations remain unchanged.
- The protected capsule remains unread/untracked.
- The review grants no Railway access, deployment, live acquisition or 0114D authority.

This independent implementation review records conformance only. It does not itself authorize
staging, commit, push, deployment, Railway configuration changes, provider observation,
completion of the current 0114E package, or live acquisition.
