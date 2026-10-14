# 0114D acquisition wrapper, lifetime owner and explicit authorization

Local implementation and synthetic validation only. No real Railway/provider
request, real credential/provider-environment read, deployment or restart occurred.
Safe templates remain PRELIVE_NOT_AUTHORIZED with unresolved actual IDs.
Schema qualification, job execution, restart attribution and production/live
invocation remain outside this milestone.

## Scope and architecture

Changed production: scripts/assessment-worker/qualification-railway-live-authorization.cjs.
Added production: scripts/assessment-worker/qualification-railway-acquisition-wrapper.cjs.
Identity owner, provider boundary, HTTPS adapter, context-review and 0113 wrapper
are unchanged. All 0114A service/target review, 0112 P/B/R/T and 0114B/C transport
semantics remain frozen. No supporting adapter change was necessary.

The wrapper is a synchronous begin API with an in-process asynchronous provider
flow. It owns one fresh S and C, using only retained private capabilities. There
is no subprocess, callback installation, generic provider injection, request
construction, background process, external queue or crash-persistence mechanism.
No caller can provide S/C, target, credential, transport, timer, timeout, request,
invocation or provider evidence.

## Separate authorization namespaces

movement_railway_identity_acquisition_auth_v1 and its original planning APIs remain
planning-only. Old movement_railway_live_auth_v1 authority remains context-only.
Neither a planning draft nor an approved local package is executable.

New movement_railway_identity_acquisition_auth_v2 uses independent executableDrafts,
executableReviews and acquisitionTickets WeakMaps. APIs:
- createExecutableAcquisitionDraft(originalBinding, fullForbiddenInventory, reviewedCode)
- reviewExecutableAcquisitionPackage(originalDraft)
- approveExecutableAcquisitionPackageReview(originalReview, originalBinding, acknowledgement)
- authorizeAcquisition(originalDraft, originalBinding, finalAcknowledgement)
- executableAcquisitionReviewTemplate()

Full forbidden inventory uses the unchanged identity owner's exact review schema:
basis/provenance, reviewed category IDs/labels and completeness acknowledgements.
The original inventory review is retained privately for final target approval.
No policy or inventory completeness claim is invented by the wrapper.

The v2 manifest binds exact reviewed HEAD/branch, all twelve pinned sources and
authorization self hash, original target constraints and expectations, reviewed
forbidden inventory, fixed operation names/hashes/order, three maximum provider
requests (one each), both human gates and executionPolicy:
humanWaitMs=300000; sameSessionContextLifetime=true; closeOnEveryTerminalExit=true;
crashResumeSupported=false; retries=0; fallbackAllowed=false; redirectPolicy=reject.
Schema remains unauthorized.

Local approval requires exact manifest/manifestSha256, original context review
metadata and the established exact host checklist. It produces a frozen
PRELIVE_NOT_AUTHORIZED review artifact with an unauthorized final template.
Final acknowledgement has exactly manualLiveAuthorization, version, operationKind,
manifestSha256, reviewedHead, reviewedBranch, codeIdentitySha256, hostReviewSha256.
Only manualLiveAuthorization=true with every other exact retained value can
issue one opaque ticket. Code identity is rechecked at draft/review/approval,
ticket issuance and private ticket redemption. An authentic original ticket burns
before arity/code checks and cannot be copied, serialized or replayed.

The acquisition wrapper is the exclusive execution consumer. authorizeAcquisition
returns only an opaque frozen ticket. Neither consumeAcquisitionTicket nor
takeAcquisitionExecutionAuthority is exported. No replacement public extractor,
consumer getter, installer, callback registration or raw capability factory exists.

During synchronous CommonJS initialization, authorization requires the literal pinned
wrapper and passes its private redemption closure through a temporary non-enumerable
connector. The wrapper deletes that connector immediately and freezes its exports.
Both modules use null-prototype export objects so either import order completes
without an alternate circular-require export object. Authorization exports are frozen
before linkage. Only the wrapper retains the redemption closure. Redemption burns
the original ticket, rechecks code identity, and checks the literal wrapper module
identity before returning execution material solely inside the private boundary.
Post-initialization wrapper replacement fails closed; public property replacement
and arbitrary consumer registration fail. Host/module-loader/built-in integrity
during trusted initialization remains an assumption, as with the existing linker.

Legacy context-only APIs remain unchanged and cannot redeem acquisition tickets.
Their pre-existing context extraction contract is separate; the exclusive boundary
here applies to executable acquisition material. Human target prompts contain a
descriptive inventory view, never the original inventory-review capability.
No normal actual-target ticket was issued during this work.

## Wrapper public API and ownership

Public exports are exactly:
- beginAuthorizedAcquisition(ticket)
- takePendingHumanReview(handle)
- submitServiceReview(handle, originalReview, exactAcknowledgement)
- submitTargetReview(handle, originalReview, exactAcknowledgement)
- cancelAcquisition(handle)

Begin privately burns the ticket before validating arity. It creates S through
identity.startTargetIdentitySession(originalTarget), then C through the existing
adapter.openExecutionContext(originalTarget). These are the sole fresh resources.
One ticket cannot begin twice, fork, survive failed setup or resume after disposal.

A private runs WeakMap binds an opaque frozen handle to original target, S, C,
context handoff, inventory review, provider count, phase, monotonic deadline and
pending review. Separate serviceGates and targetGates WeakMaps bind original
reviews to their owning acquisition. No review bytes, IDs or hashes substitute
for original capability ownership.

Before a prompt is ready, takePendingHumanReview returns only stage and review=null.
At a human gate it returns the original frozen descriptive review, stage,
humanWaitMs and, for target review, a descriptive inventory/sha view. Each prompt
can be taken once. Repeated take or malformed calls with a located handle are
terminal. A copied/serialized handle cannot locate or mutate an original run.
This API polls local state only; it never polls the provider.

## Frozen execution sequence

1. Context: original retained fixed context handoff; identity context-transfer permit
   P; adapter binding B; executeHandoff produces genuine R; prepareContextResultTransfer
   produces T; original S accepts T. Ordinary hashed summaries are not used.
2. Services: fixed request review/permit/H from original S; bindProjectServicesTransfer,
   executeProjectServices, prepareProjectServicesResult, acceptIdentityObservation.
   Independently inspect service_review and count=2, then issue the original
   descriptive human service review and start its finite wait.
3. Human service: submission calls the unchanged approveObservedServiceCandidate
   with original review/S and the caller's exact acknowledgement. Only successful
   exact approval passes service_instance; technical provider continuation then
   uses the original S/C.
4. Instance: fixed review/permit/H; bindServiceInstanceTransfer, executeServiceInstance,
   prepareServiceInstanceResult, acceptIdentityObservation. Independently inspect
   candidate and count=3, then issue the original descriptive target prompt.
5. Human target: submission calls unchanged approveTargetCandidate with original
   review and retained original forbidden-inventory review, using the exact caller
   acknowledgement. Only this approval moves candidate to reviewed.

Technical fixed provider-request reviews are consumed under the exact reviewed
authorization plan. Human service/target decisions are never generated by code.
Issuing descriptive review prompts is not human approval. No service equality,
reviewed=true shortcut, copied JSON or automatic business decision advances a gate.

Provider order is exactly Movement0108ProjectTokenContext,
Movement0111ProjectServices, Movement0111ServiceInstance, with human service
review between requests two/three and target review after request three.
There is no fourth provider call, schema request, duplicate, retry, fallback,
redirect following, pagination, alternate provider path, reopen or session replacement.

## Five-minute bounded human waits

Both service and target waits have a fixed 300000 ms (five-minute) limit, reviewed
in code and manifest. This permits comparing already-retained IDs, expected facts
and inventory without keeping the credential lifetime open indefinitely. Metadata
discovery or a longer decision is not an implicit extension: obtain new separate
authorization and start a new acquisition.

The timer begins when the original prompt is issued after provider acceptance,
not when the caller retrieves it. A monotonic performance.now deadline is checked
on take/submit as well as by the fixed timer, so a delayed timer callback cannot
permit an expired decision. Caller timeout/timer values are not accepted.
Tests isolate timers/clock only within VM fixtures.

Timeout burns the run and pending wrapper/owner review, closes C and prevents
stale submit, result issuance, retry or reopen. Pending owner reviews are revoked
using their established burn-before-arity-validation consumers, without changing
identity APIs or semantics. Copied/serialized reviews fail. Wrong-acquisition
genuine reviews burn both located acquisitions and dispose both contexts.
Wrong-gate inputs and invalid human acknowledgements terminate the located run.
A human reviewed=false acknowledgement is a terminal rejection.

## Cancellation, disposal and success

Cancellation consumes the original running handle once, invalidates pending
human reviews, clears timer and invokes existing context close, which cancels
in-flight HTTPS and deletes outstanding adapter state. Copies cannot cancel the
original; repeated cancellation fails. Async continuations check terminal state
and cannot issue later evidence/results.

The common terminal function deletes running/gate/result ownership, burns any
pending original review, clears timer, closes C once if it exists, and clears
retained S/C/target/context handoff/inventory references. Every provider error,
timeout, cancellation, wrong resume, invalid final acknowledgement and internal
exception uses this path. Adapter invalidation and wrapper lifetime disposal remain
distinct: public close is still attempted after adapter failures. Close errors
prevent successful result issuance; correctness assumes the frozen reviewed adapter
and host/built-in integrity. No memory-zeroization claim is made.

After exact final target approval, the original final target handoff is consumed
through takeReviewedTargetFor0110 only to obtain already-reviewed descriptive
facts; the returned private target is discarded and never executed. C is closed
before one-use private issuedResults issuance/consumption returns:
outcome=TARGET_IDENTITY_REVIEWED; stage=reviewed; reviewedTarget=the existing frozen
reviewedCandidate facts; providerRequests=3; manualLiveAuthorizationConsumed=true;
liveAuthorized=false. Copies of this result grant no execution authority.

No credential, S/C, raw adapter result, provider receipt, internal pool or reusable
authority escapes. The final record contains validated/reviewed IDs, names,
corroborating root/region and evidence/status, not arbitrary provider response bodies.
Global provider/project-env/service/schema/target flags stay false and global
identity/causality/restart/platform authority stays null.

No crash resume exists. Serialized running state, prompts or process-restart
objects cannot recreate WeakMap ownership. Process death abandons the acquisition;
a later run needs new separately reviewed authorization and fresh S/C.

## Pins, templates and exact file changes

Pin count is exactly twelve: new acquisition wrapper pin plus the unchanged eleven.
- Acquisition wrapper: 0dc8a07daace32d4984f3edf73301e4143cd2cb2de6232d5880bec33485b103e
- Adapter: 6c25068a45e7ffe98f9db8bd1efe20e0bebad5140f740ea20725785af6361d6b
- Provider boundary: cf22b4ce9d68b36fa6c325f289661528fcfb6ec8e75d6acad9af5429be53e1df
- Identity: 1dce76ecf7657f40d6ad98a7347eecff868772c5812eeadf025165c80ebfcb47
- First-context wrapper: 7c3a376d1f7a1b733f3be90a3b7d43fb4aa2fd5256c5638a13e6301a3d78cf94
- authorizationBoundarySha256: 601a71a287a07c439bd4b3a136a64773ca709ee8d3b86414b4e2cedb2a6f3bd4

The old eleven pins do not change. Wrapper is never hidden outside code identity.
Canonical source rules remain UTF-8, CRLF-to-LF only, preserving other bytes/EOF.

Both existing safe templates regenerate exactly. The acquisition template retains
the v1 planning manifest (transportSupported=false) and adds a separate
executableAuthorization v2 safe view. V2 transportSupported=true means implemented
local wrapper/transport availability, never permission or live readiness.
Both views retain PRELIVE_NOT_AUTHORIZED, liveAuthorized=false,
manualLiveAuthorization=false, null actual IDs/HEAD/branch and unreviewed inventory.

Tests added:
- supabase/tests/0114d_acquisition_wrapper.test.cjs
- supabase/tests/fixtures/0114d-acquisition-wrapper.cjs
- supabase/tests/fixtures/0114d-authorization-loader.cjs

Regression tests updated only to recognize deliberate pin 12 and the separately
owned private v2 wrapper link while proving old planning artifacts cannot execute:
0110_railway_first_live_preflight, 0113_first_context_wrapper,
0114a_service_review_authorization_foundation, 0114b_project_services_transport,
0114c_service_instance_transport (all under supabase/tests with .test.cjs suffix).
The 0113 and 0114A fixtures now load the sealed initialization graph; no production
fixture hook was added.

Docs updated: 0110 preflight, 0111 identity acquisition, 0114A foundation,
0114B services transport, 0114C instance transport and launch readiness register.
Added: this document. Regenerated: 0110-live-review-template.json and
0114a-acquisition-review-template.json.

## Validation and remaining work

Focused: 0114D 141/141; 0114C 96/96; 0114B 72/72; 0114A 63/63;
0113 63/63; 0112 62/62; 0111 101/101; 0110 63/63; 0109 78/78.
Total 739 PASS, zero failures/skips. The extra 0114A case covers wrapper-source drift.
App, Edge and worker typechecks PASS.

Tests use coherent isolated VM owners, synthetic credential/env/HTTPS, fake
monotonic clock/timers and mocked local Git/source drift. Normal network guards
assert zero real calls. No normal real execution context is opened. Test subprocesses
inherit no provider credentials; regression uses only explicit Git trust variables.
No production callback/transport/timer injection is added.

The first focused run exposed a wrong-acquisition target-review disposal defect;
it was corrected so both located owners close, matching the service path.
Correction adds both ordinary import orders, exact public exports, connector
removal/frozen exports, arbitrary wrapper replacement, ticket opacity, copy/replay
and context/services/instance namespace isolation. Existing cases now redeem
only through beginAuthorizedAcquisition(ticket).
Success, provider errors/redirects, human timeout/rejection, cancellation across
all phases, code drift, wrong resume, setup/internal errors and post-close failure
are tested directly. No real provider execution was needed.

Final serialized regression: 1,117 total, 1,114 PASS, zero failures, three existing
OS-specific skips. Same 19-file serialized chain as 0114C: 0099, 0101, all three
0102 suites, 0103, both 0104 suites, 0105 through 0113, worker-process and migration
integrity, with --test-concurrency=1. Focused 0114A/B/C/D suites run separately.

All 99 migrations match existing index Git blob IDs through checkout filtering:
99 files, zero changes. Historical integrity passes in regression.
Frozen adapter, provider boundary, identity, context-review and first-context wrapper
paths have no diff. No pricing/matching/application source changed.
git diff --check PASS; new files also pass trailing-whitespace/final-newline checks.
HEAD remains 7f1582bb3eaf244394e91da24909473fc38569fc on
feature/0092-shared-segment-suitability. Index remains empty; no staging occurred.
The protected capsule remains unread, untouched and already untracked.
No temporary file remains in the repository; verification scripts/logs are in OS temp.
No live provider/network request, Railway CLI, Supabase/GitHub API, real credential/
provider-environment read, stage, commit, push, deploy or restart occurred.

Remaining post-0114D: independently review actual expected target IDs, forbidden
inventory/provenance, current committed code and trusted host/credential handling;
provide explicit manual authorization in a later separately authorized live run.
Deployment/host/UI integration and schema/qualification execution remain separate
future milestones. This work performs no live invocation and makes no global
qualification/restart claim. No STOP condition was encountered.

## Exact final git status

     M docs/0110-live-review-template.json
     M docs/0110-railway-first-live-context-preflight.md
     M docs/0111-railway-target-identity-acquisition.md
     M docs/0114a-acquisition-review-template.json
     M docs/0114a-railway-service-review-authorization-foundation.md
     M docs/0114b-railway-project-services-transport.md
     M docs/0114c-railway-service-instance-transport.md
     M docs/MOVEMENT_LAUNCH_READINESS_REGISTER.md
     M scripts/assessment-worker/qualification-railway-live-authorization.cjs
     M supabase/tests/0110_railway_first_live_preflight.test.cjs
     M supabase/tests/0113_first_context_wrapper.test.cjs
     M supabase/tests/0114a_service_review_authorization_foundation.test.cjs
     M supabase/tests/0114b_project_services_transport.test.cjs
     M supabase/tests/0114c_service_instance_transport.test.cjs
     M supabase/tests/fixtures/0113-first-context-wrapper.cjs
     M supabase/tests/fixtures/0114a-foundation.cjs
    ?? 0102-remote-fixtures.capsule
    ?? docs/0114d-railway-acquisition-wrapper.md
    ?? scripts/assessment-worker/qualification-railway-acquisition-wrapper.cjs
    ?? supabase/tests/0114d_acquisition_wrapper.test.cjs
    ?? supabase/tests/fixtures/0114d-acquisition-wrapper.cjs
    ?? supabase/tests/fixtures/0114d-authorization-loader.cjs

## 0114E offline acquisition input review

[0114E input review](0114e-railway-acquisition-input-review.md) adds an offline
worksheet and independent operator review procedure, exercised by synthetic tests
using existing APIs. Actual Railway IDs remain null; historical labels are not IDs.
Forbidden inventory requires explicit provenance and completeness acknowledgements.
Host/checklist presence grants no execution authority. No sealed executable package,
ticket, identity session, execution context, credential read or provider request is
created by this workflow. All 12 pins and runtime modules remain unchanged.
0114D acquisition still requires a later separately reviewed and manually authorized
execution; the safe outcome remains PRELIVE_NOT_AUTHORIZED.
