# 0114J qualification lifecycle implementation plan

STATUS: PLAN_COMPLETE_IMPLEMENTATION_NOT_AUTHORIZED

Starting HEAD: `493d53d1f90cd35bf6ee33bf6c7c41db1a4f5a12`

Branch: `feature/0092-shared-segment-suitability`

This document specifies a future patch for plan review. It implements nothing and
does not complete or promote the current input package. The renewed review closed
B1 by design, not by implemented enforcement or independent human approval.

## Correction after executable-owner scope review

correctionStartingHead: `a70b1824c3fd61ba4e86f06dfd4da5dc1725fdd5`

priorReviewOutcome: PLAN_CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_AUTHORIZATION

scopeReviewOutcome: SCOPE_APPROVED_ADD_SINGLE_OWNER_HOST

R1 is resolved in this plan by the dedicated main-only owner host: future runtime
scope expands 3 -> 4 files and source pins expand 12 -> 13. R2 is addressed by the
two-phase validation/final pure-fence model at every sensitive transition below.
The prior failed review and owner scope review remain unchanged historical evidence.
Renewed plan review is required; implementation authorization is still unavailable.

The earlier version had no verified acquisition launcher, incorrectly rooted its
guard in arbitrary require.main/children topology, and checked time before blocking
revalidation without a final fence. Those obsolete operative rules are replaced,
not treated as a supported fallback. This correction implements no runtime behavior.

## Reviewed inputs and preserved policy

Inputs inspected: [corrected 0114I design](0114i-qualification-lifecycle-policy-design.md),
[renewed B1 review](0114i-qualification-lifecycle-policy-b1-renewed-review.md),
[historical review](0114i-qualification-lifecycle-policy-independent-review.md),
current/safe 0114E input JSON, 0114E procedure, 0114D wrapper description, reviewed
0114H design/implementation, readiness register, authorization/wrapper/identity/target
sources, and directly relevant 0110-0114 tests and their VM loaders.

Preserve the reviewed active predicate, exact disposable/name/ID binding, reviewed
complete forbidden inventory, nullable instance expectation, separate source,
deployment, health and host gates, thirty-minute absolute lifetime, no renewal,
one session/context, three requests, both human gates and burn-before-validation.
No retry/fallback/resume/fork, automatic provider lookup, production authority or
permanent target consumption. Fresh attempts require fresh operator/independent
review and separate manual authorization. Human reference strings are not proof of
independence. The cross-process trusted-operator limitation remains unchanged.

## Exact future file scope

Exactly four future production runtime files change. No fifth runtime file is
permitted without another review; no runtime file is changed by this document.

| File under scripts/assessment-worker/ | Planned responsibility |
| --- | --- |
| qualification-railway-acquisition-owner-host.cjs (NEW) | Dedicated main-only bootstrap; private seal/association; immutable four-module cache/exports bindings; frozen operation facade, never raw owner capability. |
| qualification-railway-live-authorization.cjs | Strict v3 input/v1 activation intake; sole admission maps; original host association; two-phase validation/final pure fences; private carrier; pre-ticket cancellation; v4 cutover; new host pin, two changed pins and separate self hash. |
| qualification-railway-acquisition-wrapper.cjs | Private redemption/setup handshake; carry original lifecycle obligation; boundary checks, timers, terminal notification and existing resource cleanup. |
| qualification-railway-target-identity.cjs | Retain private lifecycle check from original target permit; apply it to acquisition-session operations/validators; discard on terminal cleanup. Context-only behavior unchanged. |

Explicitly preserve introspection-target.cjs: its exact disposable/active syntax,
nullable instance and opaque binding need no change. Preserve https-adapter.cjs:
wrapper dispatch and response checks plus identity-owned validation enforce the
new lifetime without adding transport operations or token-intake behavior. Native
request timeout remains 10000 ms; closing the existing execution context cancels
in-flight transport. No query/document hash changes are planned.

Also preserve scripts/assessment-worker/run.cjs and package.json. Assessment polling
is not the acquisition host. No package command, listener or custom CLI is added.

Planned test files, all under supabase/tests:

- Add `0114j_lifecycle_authorization.test.cjs`: strict schemas, admission, clocks,
  capacity, carrier failures and cutover matrix below.
- Add `0114j_executable_owner_host.test.cjs`: genuine child-process main bootstrap,
  immutable bindings and duplicate/unsupported-host denial. This is the thirteenth
  focused suite, not a replacement for lifecycle tests or VM coverage.
- Update `0114d_acquisition_wrapper.test.cjs`, `0114e_acquisition_input_review.test.cjs`
  and `0114h_service_name_compatibility.test.cjs`: current v4/v3 synthetic inputs,
  changed terminal semantics, integration with lifecycle ownership and negative tests.
- Update `0110_railway_first_live_preflight.test.cjs`,
  `0111_railway_target_identity.test.cjs`, `0112_context_result_transfer.test.cjs`,
  `0113_first_context_wrapper.test.cjs`,
  `0114a_service_review_authorization_foundation.test.cjs`,
  `0114b_project_services_transport.test.cjs`,
  `0114c_service_instance_transport.test.cjs`,
  `0114f_target_metadata_evidence.test.cjs`: current pin/template/schema expectations
  and unchanged context/planning boundaries; keep historical comparisons archived.

Planned fixture files under supabase/tests/fixtures:

- Update `0114d-acquisition-wrapper.cjs` and `0114d-authorization-loader.cjs` for
  private setup linkage, v3 synthetic records, deterministic clocks and module metadata.
- Update `0111-target-identity.cjs`, `0112-context-transfer.cjs`,
  `0113-first-context-wrapper.cjs`, `0114a-foundation.cjs`,
  `0114b-project-services.cjs`, `0114c-service-instance.cjs`,
  `0114h-reviewed-context.cjs` only for their loader/current-source integration with
  the new guard and synthetic lifecycle input; historical mode stays archived.
- Add `0114j-module-domain.cjs`: test-only coherent original Module/cache/host-link
  model and clock/fault-injection support. Genuine host behavior is additionally
  tested in real children; no children-graph security-root emulation or production hook.

Planned docs/template files:

- Regenerate inert `0110-live-review-template.json`,
  `0111-target-identity-review-template.json`, `0114a-acquisition-review-template.json`,
  `0114e-acquisition-input-review-template.json`, and
  `0114f-target-metadata-evidence-template.json` for current source identities.
- Add `0114i-lifecycle-review-template.json` and
  `0114i-executable-acquisition-review-template.json`: inert v1 activation and v4
  executable review examples, respectively. All review/authority defaults false,
  target/lifetime/evidence unresolved; never an actual activation record.
- Add `0114j-qualification-lifecycle-implementation.md` with final patch/validation
  evidence; append implementation status to MOVEMENT_LAUNCH_READINESS_REGISTER.md.

No other files change without stopping for revised scope. In particular preserve
the real current package, qualification evidence, historical actual 0114E/0114F
artifacts, project/lifecycle evidence reviews, corrected design, both review records,
this reviewed plan, all 99 migrations, app/Edge code, config, dependencies/lockfiles
and the protected capsule. Historical source/evidence digests must not be refreshed.

## A. Production owner-loading domain

Use the approved scope in [the owner review](0114j-executable-owner-scope-review.md).
The ONLY supported executable acquisition bootstrap is:

`node --interactive scripts/assessment-worker/qualification-railway-acquisition-owner-host.cjs`

The named host must be the genuine CommonJS main Module on the main Node thread,
with require.main === module, canonical reviewed realpath and matching original
require.cache entry. This main requirement belongs to that named host, not arbitrary
callers. No module.children traversal is a security root. Real child-process tests
must prove this exact startup/console contract on the supported Node version; if it
fails, stop for review without a substitute launcher, preload or environment override.

Require the documented --interactive startup flag and no custom host arguments;
plain node HOST is not an enabled acquisition bootstrap under this corrected plan.
No package/run.cjs change, injected driver or alternate startup mode is permitted.

Bootstrap sequence:

1. Validate genuine host main/thread/Module/cache/realpath identity. Non-main import
   is inert: frozen availability information only, no bootstrap or credential read.
2. Create one private nonserializable startup seal and host-validity closure. Expose
   one non-enumerable initialization-only connector for the original graph's
   synchronous initialization, never on globalThis/process.
3. Require canonical authorization/wrapper/identity. Authorization consumes the host
   connector, binds original authorization/wrapper/identity Module/exports identities,
   private host association and disabled enablement state. Host supplies seal/guard
   only to authorization's private install closure. Wrapper/identity receive association
   only through existing private authorization-owned links. Maps stay in authorization.
4. Complete final exports assignments. Resolve exactly four canonical realpath/cache
   keys: host, authorization, wrapper and identity. Verify each existing value is its
   captured original Module. Redefine each cache property with that original value,
   writable=false/configurable=false. Redefine each final Module.exports property
   non-writable/non-configurable and freeze its exported facade/object. Do not freeze
   full Modules/the cache or touch unrelated entries.
5. Verify all descriptors/identities, consume/delete every temporary connector and
   seal exports, then privately enable the one graph. Any link/descriptor/verification
   failure leaves acquisition disabled permanently in that process, including after
   partial pinning. No retry/reset/reinitialize/installer survives. Restart requires
   fresh review and manual authorization; partial immutable bindings are fail-closed.

The host performs local linkage only: no token read, context opening, listener,
provider requests or automatic acquisition. Its frozen operation facade routes
explicit trusted-operator calls through the original graph and all existing gates;
it exposes no raw seal, maps or generic capability factory. Normal import cannot
later be publicly upgraded. Host association is necessary, never manual authorization.

A second complete authorization/wrapper/identity graph may create its OWN local
connectors and Maps, but cannot become executable without the original main-host
seal/private association. Cache pinning prevents ordinary canonical reload and is
not the sole authority anchor. Copies at other paths lack the seal. Fixed immutable
bindings in Node's existing cache are not an added public mutable owner registry.

| Mode | Rule |
| --- | --- |
| Exact documented main command | One original enabled graph only, with later explicit reviews/manual authorization. |
| Same canonical require/relative or absolute canonical alias | Same frozen facade; no rebootstrap. |
| Cache delete/reassign/reload | Strict deletion/replacement throws, non-strict deletion fails; original entry remains, no new graph. |
| Copied authorization or whole owner set | Inert/rejected; no original association, claim or ticket. |
| Copied host imported as child | Inert; cannot mint seal. |
| Copied host as main in another process | New process requiring fresh review/manual authorization, not a global replay guarantee. |
| Replacement wrapper/identity or stale connector | Cannot replace pinned bindings or enable another graph. |
| Independent VM/worker/isolated realm | No independent production acquisition bootstrap. |
| node -e / ESM-main importing CJS | Import-only/inert; cannot bootstrap. |
| ESM/VM bridge deliberately given original enabled facade | Routes only the same original graph; no new seal/domain. No caller-realm sandbox claim. |

First host gate is createExecutableAcquisitionDraft BEFORE assertion claim and
review-capability publication. Require original graph association also at
reviewExecutableAcquisitionPackage, approveExecutableAcquisitionPackageReview,
authorizeAcquisition, beginAuthorizedAcquisition, takePendingHumanReview,
submitServiceReview and submitTargetReview. Cancellation APIs require genuine
original graph objects, but must not require valid lifecycle/host enablement merely
to reduce authority and close resources. Planning/inert APIs cannot bootstrap;
0113 remains context-only and cannot enter acquisition.

Trust genuine Node startup, built-ins, reviewed source/filesystem and loader integrity.
Forging main identity, replacing all loader objects or arbitrary pre-start injection
is outside the existing trusted-host boundary. No public global registry or durable
coordination is added.

## B. Exact pre-run cleanup carrier

At the atomic claim, create the original private graph entry and a frozen private
carrier closing over it. Carrier operations are `check`, `close(reason)` and
`attachRun(stopRun)`. They are never exported/returned by a public API or serialized.
The entry owns the timer/cleanup obligation from that point, including before any
draft/context-review publication can throw. Check all operations against original
owner/claimed state. attachRun is one-use, accepts only the privately linked pinned
wrapper's fixed stop closure, and cannot replace an existing binding.

Use the existing temporary wrapper initialization connector as a two-way private
handshake: authorization supplies its redemption trampoline; the literal wrapper
returns its fixed setup continuation once. Authorization retains that continuation.
Public beginAuthorizedAcquisition delegates arguments to the trampoline; callers
cannot supply a continuation. The trampoline burns the original ticket, locates its
existing carrier, validates again, and calls the fixed wrapper continuation INSIDE
the owner's try/catch/finally obligation. It closes the carrier if validation,
payload construction, transfer or wrapper setup throws. It never constructs another
claim/carrier to recover. A successfully published run takes cleanup responsibility
but the owner retains its independent expiry obligation.

The wrapper setup continuation receives the frozen verified payload/carrier privately,
attaches its idempotent stop closure before allocating a public handle, consumes the
target permit, checks lifetime/domain again, then opens context. It records any context
immediately for cleanup. Stop marks the graph closed before adapter close can throw,
burns outstanding gates, cancels context and drops session/run references. Carrier
close marks closed first and invokes stopRun at most once; recursive notification
is a no-op. A completion close must return successfully before issuing the sole result.

Add public cancellation-only `cancelExecutableAcquisitionDraft(originalDraft)` to
authorization: exact arity, original located draft only; closes pre-ticket or issued-
ticket graphs; never returns carrier/state or accepts a digest/path. Ordinary run
cancellation remains in the wrapper. Invalid/negative manual acknowledgement on a
located graph closes it. Error before claim does not affect another graph. Errors
after claim, including during timer/context-review/ticket allocation, close it.
Ticket/target-permit consumers still delete their genuine object BEFORE validating
arity, owner, code, expiry or claim state. No credential read occurs in this carrier.

All carrier check/publication/continuation boundaries follow section C's two-phase
model. Expensive checks finish before its final pure fence. close marks state first
and invokes cleanup outside the fence; cancellation never needs valid lifecycle
merely to close. Successful cleanup is followed by the separate validity-only
release fence; expired/faulted/failed cleanup releases no result and never rearms.

## C. Clock, final pure fences and expiry

Capture trusted Date.now and performance.now, never caller clocks or environment
configuration. Private utcHighWater starts unset, survives marker cleanup and is
updated before lifecycle decisions. Invalid samples/rollback latch a process-lifetime
clock fault, close owned graphs and deny later admission; never reset high-water.

Every sensitive boundary has TWO ordered phases:

- Phase 1 performs ALL potentially blocking/expensive validation: host/cache descriptor
  inspection, Git subprocesses, file reads, realpath/stat, hashing, code/package/
  evidence/record revalidation, semantic response/human checks and eligible cleanup.
  Build/freeze already-validated private bindings and any bounded action payload here.
- Phase 2 is the FINAL PURE deadline/state fence immediately before the transition.
  No file I/O, subprocess, await, hashing, realpath/stat, callback or caller getter/hook.
  Read only captured frozen/private data and trusted clocks. Sample UTC u (finite
  safe-integer milliseconds) and monotonic m (finite, nonnegative). If u is below
  utcHighWater, latch fault; otherwise update high-water BEFORE lifecycle decision.
  Require original host/graph/object association, no fault/revocation, correct claimed
  ownership, u < expiresAt and m < original monoDeadline. On failure do not perform
  the action: mark/close the owned graph and run cleanup outside the pure fence.
  The fence itself invokes no cleanup callback. The action follows immediately in
  the same synchronous turn, with no intervening expensive validation/caller code.

Pre-claim mode instead checks the frozen proposed subject/host and still-unseen
key/reference/capacity, since no claim exists yet. It computes remaining=expiresAt-u,
requires finite integer remaining > 0, computes monoDeadline=m+remaining and requires
finite monoDeadline >= m (also reject loss of a positive deadline increment).
Capture this deadline ONCE with insertion, never recompute or extend after claim.
Strict timestamp syntax and parse/serialize round trip, operator.assertedAt <=
review.reviewedAt, exact expiresAt=reviewedAt+1800000 and initial validity are checked
in phase 1 and its initial clock check; the final fence resamples after all that work.

Exact claim ordering is: receive input/original binding; validate original host
association; perform blocking package/code/evidence/activation validation; initial
clock/high-water checks; cleanup UTC-expired eligible markers; check capacity/indexes
and canonical-byte collision consistency; FINAL PURE PRE-CLAIM FENCE; synchronous
insertion into admissionByAssertionKey and attemptReferenceIndex; create carrier/
original private graph. No await/external call/hook between fence and insertion.
Any exception after either insertion closes the original assertion and retains a
consistent non-rearmable marker/index; it cannot leave half a claim reusable.
Rejected duplicates never close the legitimate original graph.

### Exact final-fence locations

Each row follows phase 1. It is not sufficient that an earlier phase-1 time check passed.

| # | Immediately before action (or after specified burn) | Fence mode |
| --- | --- | --- |
| 1 | Atomic assertion/index claim insertion after host/code/package/evidence checks and cleanup | Pre-claim unseen/original subject |
| 2 | Publishing/returning draft or review capability after payload construction | Claimed original graph |
| 3 | Review approval state transition | Claimed original graph |
| 4 | Manual authorization state transition | Claimed original graph |
| 5 | Ticket issuance after all validation/allocation preparation | Claimed original graph |
| 6 | Target-permit creation AFTER genuine ticket burn and subsequent validation | Claimed original graph |
| 7 | Invoking fixed private wrapper setup continuation | Claimed original graph |
| 8 | Target-permit transfer/use; genuine permit still burns before its validation, with final fence after validation before accepting its use | Claimed original graph |
| 9 | Credential-bearing adapter.openExecutionContext after all host/module/code/lifecycle checks | Claimed original graph |
| 10 | Request 1 adapter dispatch | Claimed original graph |
| 11 | Accepting response 1/context observation into identity state | Claimed original graph |
| 12 | Request 2 adapter dispatch | Claimed original graph |
| 13 | Accepting response 2/ProjectServices observation | Claimed original graph |
| 14 | Issuing human service gate 1 | Claimed original graph |
| 15 | Accepting human gate 1 submission | Claimed original graph |
| 16 | Request 3 adapter dispatch | Claimed original graph |
| 17 | Accepting response 3/ServiceInstance observation | Claimed original graph |
| 18 | Issuing human target gate 2 | Claimed original graph |
| 19 | Accepting human gate 2 submission | Claimed original graph |
| 20 | Successful descriptive result construction/private publication after semantic checks | Claimed original graph |
| 21 | Returning success AFTER terminal cleanup succeeds | Validity-only original completed graph |

Also fence human prompt retrieval/other authority publication, not just submissions.
Identity acquisition validators must not hide blocking phase-1 checks after the
wrapper's final dispatch fence: perform needed revalidation before dispatch and
use captured session bindings/pure lifecycle checks on the immediate operation path.
No transport source change is selected; invoke existing bounded adapter operations
immediately after the fence. No added file/Git/hash/descriptor work may intervene.
If this ordering cannot be achieved within the four runtime files, stop for review.

For #20 construct the bounded private descriptive result, never return it yet.
Mark assertion CLOSED first, perform resource cleanup (which may block), then #21
resamples clocks/high-water and verifies original host/completed-run binding, no
clock fault/revocation, UTC and original monotonic validity. It does NOT require
claimed state; require closed-by-success and cleanup success, never reopen/rearm.
If cleanup fails or expiry/rollback/fault occurs during cleanup, suppress/discard
the result. Do not cache it for later release. Cleanup success is not freshness proof.

### Timers and marker retention

Timers are backup closure mechanisms, NOT freshness proof. After claim schedule
the absolute owner timer using the smaller UTC/monotonic remaining interval. It
covers abandoned drafts, unredeemed tickets and runs; wrapper never restarts it.
Early callback resamples and reschedules only while both deadlines remain valid.
Delayed/withheld callbacks cannot permit later authority, credential, request,
observation, human acceptance or result: final pure fences resample time.

The earliest lifecycle UTC expiry, original monotonic deadline, existing 10000 ms
transport limit or 300000 ms human-gate limit closes idempotently. No extension,
retry or fallback. Forward jumps close on detection; rollback faults latch. There
is no hard real-time claim during an event-loop stall, but no next sensitive action
can rely on the stale pre-stall sample. A late provider response is rejected.

Monotonic expiry may close a live graph early, but markers/indexes remain while
UTC u < expiresAt. Remove them ONLY when UTC u >= expiresAt, after high-water/time
checks and after closing any live graph. Monotonic expiry alone NEVER permits
marker removal. Cleanup never resets high-water; strict time/fault checks precede
future admission lookup, so cleanup plus rollback cannot reopen the record.

Tests replace clocks/timers/built-ins solely inside isolated fixtures/children:
independent UTC/monotonic values, withheld/delayed/early callbacks and fault-injected
blocking work. No production clock/capacity/collision/callback override is exported.

## D. Fixed finite resource limits

Choose 64 total retained entries, claimed AND closed equally. Choose 16384 bytes
maximum raw UTF-8 activation-record file AND maximum C(R). At most 16 reference
objects across operator/evidence arrays; each reference text field at most 256
ASCII characters using the existing non-secret reference character convention.
Use attemptReference length 1-128, identity/reference strings 1-256, digests exactly
64 lowercase hex characters. Path length at most 256; no URLs, absolute paths,
backslashes, NUL, empty/dot/dot-dot segments or symlink escape.

64 x 16 KiB is at most 1 MiB of retained canonical record payload, plus bounded
metadata/active graph overhead; this is not a total heap/RSS promise. Qualification
is manually reviewed and serialized by workflow, so 64 assertions within thirty
minutes is conservative headroom, not a claim of measured concurrency. These are
constants, not configuration/environment options. No startup scan/database needed.

Before insertion clean expired eligible markers, then reject at count 64. Never
evict an unexpired marker, including closed ones. Oversize fails passively before
claim; bounded reads reject after at most limit+1 bytes rather than reading an
unbounded file. Close drops capabilities/large derived graphs, keeps C(R)/bindings/
expiry until cleanup. Per-entry timers clear on closure as appropriate; cleanup of
closed markers uses one owner sweep timer for nearest expiresAt plus lazy sweep on
owner entry. Keep domain clock high-water even when table becomes empty.

## Strict schemas and immutable binding

Versions remain the reviewed choices:

- Input: `movement_railway_acquisition_input_review_v3`.
- Executable: `movement_railway_identity_acquisition_auth_v4`.
- Activation: `movement_railway_qualification_lifecycle_review_v1`.

Input strict top-level keys are the existing v2 set plus lifecycleReview, unchanged
otherwise: version,outcome,reviewed,inputReviewComplete,liveAuthorized,
manualLiveAuthorization,reviewedHead,reviewedBranch,requiredCodeReview,expectedTarget,
historicalLabels,targetInputSources,forbiddenRailwayInventory,hostReview,codeIdentity,
crossSystemForbidden,independentReview,executableAcquisitionPrepared,
providerObservationOccurred,targetIdentityProven,serviceIdentityProven,
serviceInstanceIdentityProven,evidenceBinding,lifecycleReview.

lifecycleReview has exactly `{path,sha256}`. Runtime accepts only files under
`docs/0114i-lifecycle-reviews/` with one basename ending .json, actual regular files
whose resolved realpath stays under that directory; read-only, bounded, no directory
discovery or automatic record selection. Arbitrary copies within that permitted
directory are allowed inputs but never bypass assertion deduplication. The current
input path remains fixed. Template descriptor is `{path:null,sha256:null}` and fails
executable intake. No actual record is created by the implementation milestone.

Activation exact keys and nested key sets:

| Object | Exact keys / values |
| --- | --- |
| Root | version,policy,attemptReference,subjectSha256,target,operator,evidence,review,validity |
| policy | path,sha256; fixed corrected design path and independently approved canonical text digest |
| target | projectId,environmentId,serviceId,serviceName,serviceInstanceId,environmentKind; exact package equality, kind disposable |
| operator | reference,assertedAt,allocationEvidence,acknowledgements |
| operator.acknowledgements | hasAllocationAuthority,targetCreated,currentlyAllocated,reservedForAttempt,notProduction,notRetired,notDecommissioned,notKnownDeleted,noIncompatibleUse,noUnresolvedTeardown,notConsumedUnderApplicablePolicy,noKnownRelevantChange; all exact true |
| evidence | identity,disposable,inventory,observations,newProviderObservationOccurred; first three nonempty reference arrays, observations array may be empty, boolean accurately states whether separately authorized new observation supports this review |
| review | reviewerReference,independentlyReviewed,result,reviewedAt,evidenceReference,acceptance; true,NO_MISMATCH and reviewer distinct from operator.reference |
| review.acceptance | factsAccepted,identityBindingAccepted,inventoryAccepted,policyMappingAccepted; all true |
| validity | expiresAt,value,scope; exact active and one_package_one_attempt |
| Reference object | path,sha256,record; non-secret repository path, canonical text digest and precise record/section reference |

operator.allocationEvidence and evidence arrays share the sixteen-reference cap.
review.evidenceReference is one bounded descriptive local reference string. The
operator/reviewer record attests facts; runtime validates structure, distinct exact
references and bindings, not the truth of human independence. No name normalization
or aliasing is introduced. Missing/extra/duplicate keys, accessors/symbols/hidden fields
in API descriptors and invalid JSON fail closed.

Exact array/types: operator.allocationEvidence, evidence.identity,
evidence.disposable and evidence.inventory are arrays of 1..16 Reference objects
EACH; evidence.observations is an array of 0..16 Reference objects. The SINGLE
combined cap across all five arrays is 16, not 16 per array in aggregate. No null,
scalar, sparse-array or non-Reference members. newProviderObservationOccurred is
a strict Boolean. All acknowledgement/acceptance fields and independentlyReviewed
are strict Boolean true, not truthy values. Operator/reviewer references are strings
of 1..256 ASCII characters under the existing reference rules; exact distinct values
are necessary but do not prove two humans. Reference objects have exactly string
path/sha256/record fields with the existing path/digest/reference limits.

Future path rejection tests include Windows/POSIX drive-relative paths, colon/ADS,
reserved device names, trailing dots/spaces, backslashes, absolute paths, NUL,
dot/dot-dot, outside-subtree paths and symlink/junction/realpath escapes. Preserve
the approved regular-file/allowlist/no-escape rules, not a new discovery mechanism.

Passive validator recomputes referenced text digests (bounded at the existing 1 MiB
text limit), policy digest, exact scope/code/inventory/host/evidence bindings and the
canonical subject. Subject is canonical sorted-object JSON of the full parsed package
excluding ONLY top-level lifecycleReview; include review flags and every other field.
C(R) uses the same canonical sorted-object JSON function; assertionKey=SHA256(C(R)).
Text descriptors keep existing UTF-8 CRLF-to-LF-only normalization, preserving BOM,
all other bytes and EOF. Do not confuse text digest with admission key or introduce
a self-hash cycle. No future digest is calculated in this planning task.

Authorization compiles APPROVED_LIFECYCLE_POLICY_SHA256 from the unchanged reviewed
design at commit 30bf97347fa0e88272bdf02c973949349ca61f74 during the future patch.
Require the record's policy digest AND current policy bytes to equal that constant;
an edited policy file plus self-consistent record is insufficient. This is a reviewed
document binding, not one of the thirteen runtime source pins. Its value is not
calculated now.

Evidence-file reads are confined to docs/0114e-qualification-target-evidence.json,
docs/0114e-qualification-project-id-review.md,
docs/0114e-qualification-lifecycle-review.md and regular non-secret evidence files
under docs/0114i-lifecycle-reviews/, with the same realpath/no-escape rule. The fixed
policy file is read separately. No current-package self-reference, capsule, hidden
config, environment file, token store, URL or arbitrary source path is accepted.
Additional factual evidence outside that scope requires plan review, not discovery.

The v4 manifest retains current expectedTarget as sole name/lifecycle authority and
adds `expectedTarget.lifecycleEligibility` with assertionKey,activationRecordSha256,
subjectSha256,attemptReference,reviewedAt,expiresAt,scope,policySha256. It also retains
the full input descriptor/hash and record descriptor. No duplicate serviceName or
executable lifecycle value in expectations. Freeze snapshot before first review.

## Exact private state representations

`admissionByAssertionKey: Map<string,Entry>` belongs solely to authorization.
Entry contains state claimed|closed, canonicalRecord, subjectSha256,attemptReference,
expiresAtMs,monoDeadline, originalDraftEntry while live, carrier, closeReason,
expiryTimer, stopRun while attached, and private sets of original issued review,
ticket and target-permit handles for invalidation. unseen means no map entry.
No entry is a ticket.
`attemptReferenceIndex: Map<string,string>` maps reference to assertionKey and lives
exactly as long as its corresponding retained marker. No public export or inspection.

On key match compare C(R), subject and reference before rejecting duplicate; mismatch
is collision/consistency failure, never an alternate bucket. Reverse-index conflict
also rejects. Do not cancel the first graph when rejecting incoming duplicates.
Claimed -> closed is irreversible. Close marks state first, burns/invalidates the
original draft/review/ticket/permit graph, invokes stopRun once, clears authority
references and leaves only canonical record/bindings, expiry/monotonic metadata and
closed reason needed for retention. No table entry reconstructs an opaque capability.
Timers expire even an otherwise unreachable draft. Removing a closed marker after
expiry is memory cleanup, not permission to reuse the old record.

## Ordered end-to-end sequence

Every numbered action below uses section C's phase 1 followed by the specified
final pure fence; an old time check or timer is never a substitute.

1. Start only the named main host via the exact --interactive command. Complete
   private linkage and four immutable cache/exports bindings before enablement.
   Bootstrap performs no claim, token read, context open or provider operation.
2. Receive original binding, inventory, reviewed code and exact input descriptor.
   Require original host association BEFORE any claim/review-capability publication.
3. Passively validate full strict package/record schemas, code/HEAD/branch/thirteen
   pins/self, policy/subject/reference/evidence hashes, target, inventory and host/
   package/provenance reviews. The real incomplete v2 package rejects before claim.
4. Apply the exact claim A-J ordering in section C: initial clock checks, eligible
   cleanup, capacity/index checks, final PURE pre-claim fence, synchronous map/index
   insertion, then carrier/private graph. Any post-insertion exception closes it.
5. Prepare timer/context-review/manifest/draft payloads under cleanup protection.
   Fence immediately before publishing/returning draft or each review capability.
6. Validate exact original package/context/host approval, then final fence before
   approval transition. Negative/invalid located acknowledgement closes the graph.
7. Validate exact v4 manual acknowledgement, final fence before authorization
   transition, and another immediately before ticket issuance. Failure closes;
   original-draft cancellation works before or after ticket without minting authority.
8. Wrapper begin reaches the private owner trampoline. Burn genuine ticket FIRST.
   Perform blocking validation, final fence before target-permit creation, then a
   final fence before invoking fixed private wrapper setup within owner protection.
9. Wrapper attaches stopRun before public run-handle allocation. Fence before permit
   transfer; identity burns genuine permit before validation, then final fence before
   accepting its use/creating guarded session. All exceptions retain owner cleanup.
10. Finish all host/module/code/lifecycle checks, PURE fence, then immediately call
    adapter.openExecutionContext(originalBinding). Only this existing call may first
    inspect/read the Railway token environment and open the credential-bearing context.
    No real credential is read in implementation validation; fixtures use synthetic data.
11. Final fence then request 1 Movement0108ProjectTokenContext in original session/
    context. On response, finish validation then fence before identity observation.
    Prepare request 2 Movement0111ProjectServices, finish validation, fence and dispatch.
12. Validate response 2 then fence before ProjectServices observation; exact machine
    name/ID checks remain mandatory. Fence before issuing gate 1 and before accepting
    its validated submission. Earlier lifecycle/transport/human deadline wins.
13. After gate 1, prepare/validate request 3 Movement0111ServiceInstance, final fence
    and dispatch in the same C/S. Validate response then fence before instance
    observation; retain exact name/ID/null-instance semantics.
14. Final fence before issuing gate 2 and before accepting its validated submission.
    Human approval cannot override machine mismatch. No fourth/schema request exists.
15. Validate successful facts, fence before private result construction/publication,
    mark closed FIRST and perform cleanup. Cleanup may block/throw: failure means
    no result. After successful cleanup run the PURE validity-only original-completed-
    graph fence immediately before returning success; no claimed-state requirement,
    no expiry/fault/revocation tolerated, no result cache or reopening.
16. Every other terminal closes idempotently and cleans original resources; retain
    markers/indexes until UTC expiry only. New target use needs a fresh reviewed
    activation and separate authorization. Global authority flags stay false/null.

## Legacy cutover and preserved namespaces

The only supported acquisition path is existing draft -> review -> approve ->
authorizeAcquisition -> wrapper begin -> services/final submissions. Those functions
now produce/accept v4 only and require v3 input plus valid lifecycle descriptor.
Reject v2 input, v3 executable acknowledgements, old manifest copies, stale private
objects and aliases without fallback; version-bound private pools are not shared.
There is no separate old executable implementation kept reachable.

Keep createAcquisitionDraft/reviewAcquisitionPackage/approveAcquisitionPackageReview
planning-only. Keep movement_railway_live_auth_v1/0113 context-only behavior; their
one-argument identity sessions have no acquisition guard/name authority and cannot
continue into services/instance. Original target bindings, arbitrary name objects,
adapter imports and public validators cannot mint acquisition-target permits.
Only privately redeemed v4 material can create an executable acquisition session.
All new executable routes must use the named enabled host/original association and
pass the two-phase guards/final pure fences; no alternate bootstrap/entry API.

Historical tests load complete source/template contexts from their existing archived
commits. Current fixture mode generates v3/v4 synthetic packages and references.
Do not change archived evidence/version strings to pretend old reviews cover v4.
Current real package stays byte-identical v2/incomplete and must be rejected by v4.
Its future migration is a separate evidence/package review, not this implementation.

## Pins and inert templates

Future source-pin count is exactly THIRTEEN. Add the new owner-host source hash to
authorization SOURCE_HASHES/approved identities; update wrapper and target-identity
pins. Authorization's own source/self hash changes SEPARATELY, outside the thirteen.
The other ten existing pins, including introspection-target and https-adapter, remain
unchanged. Do not remove/replace a safety pin or hide host identity as a doc/fixture
hash. Historical twelve-pin evidence remains immutable twelve-pin evidence.
Use the existing UTF-8 CRLF-to-LF-only source rule. Compute new values only after the
future implementation stabilizes, not now. Existing BASELINE_PARENT_HEAD remains
historical, never substituted for reviewed current HEAD.

Regenerate the five existing safe templates listed above with thirteen source pins;
0114E template becomes v3 with null lifecycleReview descriptor. Planning template
0114A remains inert planning v1; 0110 remains context-only v1. New v4 executable safe
template uses existing executableAcquisitionReviewTemplate(), with null eligibility,
target/lifetime/record expectations and false authority. Activation safe template is
inert data with null reviewer/timestamps/facts, never admitted as reviewed. No
historical hash, actual evidence digest or current package pin is silently refreshed.

## Focused future test matrix

Each row is an acceptance obligation, not an implemented test. Use fake native
transport, zero real credentials, blocked external HTTP/HTTPS/fetch, and captured
private pools only inside fixtures. Estimate 170-220 new parameterized cases; exact
count is determined by matrix expansion, not a target to pad tests.

| Category | Cases and expected evidence |
| --- | --- |
| Schema (~30) | Missing/extra/duplicate root/nested keys; invalid versions/descriptor/record/path/size; same operator/reviewer; timestamp syntax/round-trip/order; wrong active/scope; digest/subject/policy/reference mismatch; false/missing acknowledgements; untouched current package rejected before claim/credential/context/request. |
| Admission (~20) | First claim only; two drafts before ticket and after claim; copied path/format/key order/wrapper; restored package; changed/conflicting attemptReference; wrong subject; simulated equal digest/unequal C(R); fresh reviewed record succeeds; invalid duplicate never kills first; entry state never capability. |
| Capacity (~8) | 64 claimed, 64 closed, mixed occupancy, 65th rejected; 16384/16385 raw/canonical byte boundaries; reference caps; expiry frees capacity; zero eviction of unexpired closed/claimed entries and indexes. |
| Timing (~20) | reviewedAt equality; exact expiresAt rejection; near-expiry start; separate UTC/mono advances; forward/backward jumps; invalid readings; delayed/early callbacks; high-water survives empty maps; cleanup then rollback replay; min lifecycle/transport/human/wrapper deadlines and no late result. |
| Closure (~35) | Cancel pre-ticket, post-ticket/pre-redemption; manual rejection; injected exceptions after insertion, timer/review/ticket creation, redemption/transfer, before handle/context, after context; request 1/2/3 errors; response after expiry; gate 1/2 rejection/timeouts; owner-handled crash; success; explicit revoke; abandoned draft, ticket and active run expiry; close throwing; repeated close and stale submit. |
| Owner host (~24, genuine children plus fixtures) | Exact documented --interactive startup and require.main === module; canonical main/cache/realpath identities; zero bootstrap credential/network/provider activity; same canonical Module/facade; all four cache and Module.exports descriptors; strict/non-strict delete/reassign failures; original graph continues; copied authorization/full graph/host-child, wrapper/identity replacement and stale connector denial; node -e/ESM-main/VM/worker inertness; early bootstrap failure cannot retry; no public seal/getter/reset/reinitialize/installer. |
| R2 blocking work (~25) | With timers deliberately withheld, advance UTC/mono during Git before claim, evidence/hash before ticket, host/cache/realpath checks before claim/context, context checks before open, validation before requests 1/2/3, each response validation, gate 1/2 validation and cleanup before return. Rollback/nonfinite/overflow and monotonic expiry reject at final fence. Assert zero next claim/authority/credential/request/observation/human acceptance/result as applicable. |
| Pins | Exactly thirteen source entries including new host; all twelve old roles retained, only wrapper/identity old values change; authorization self hash separate; future inert identities regenerate; historical twelve-pin artifacts remain byte-identical. |
| Cutover/preservation (~20) | v3 executable/v2 input cannot bypass; 0113 cannot continue; same session/context, successful count exactly 3 and failures <=3; both gates; nullable instance; exact service ID/name; no historical/default/alias fallback; genuine ticket/permit burns on invalid arity/expiry/binding; credential reads only after guards; all global flags false/null; no retry/fallback/resume/fork; no permanent target consumption. |

Keep existing success/negative coverage in the eleven relevant suites; add current
v4 integration there rather than duplicating all assertions in the new suite.
Historical suites test their archived contract; new suites never claim real target
identity from synthetic success.

Owner-host proof must include REAL Node child processes running the exact main
command, not only VM emulation. Keep synthetic fixtures/fake native transport/clock
substitutions wholly test-local; no production host/token/clock/driver injection.
Bootstrap synthetic tests perform no real credential/provider/network operation.
Withheld-timer R2 cases are mandatory even if ordinary timeout tests already pass.

Exact focused inventory is THIRTEEN suites (eleven existing, two new), all under
supabase/tests/:

1. 0110_railway_first_live_preflight.test.cjs
2. 0111_railway_target_identity.test.cjs
3. 0112_context_result_transfer.test.cjs
4. 0113_first_context_wrapper.test.cjs
5. 0114a_service_review_authorization_foundation.test.cjs
6. 0114b_project_services_transport.test.cjs
7. 0114c_service_instance_transport.test.cjs
8. 0114d_acquisition_wrapper.test.cjs
9. 0114e_acquisition_input_review.test.cjs
10. 0114f_target_metadata_evidence.test.cjs
11. 0114h_service_name_compatibility.test.cjs
12. 0114j_lifecycle_authorization.test.cjs (NEW)
13. 0114j_executable_owner_host.test.cjs (NEW)

The nineteen-file regression below is unchanged. The new host proof already runs
in the focused child-process suite; no additional repository-level process suite
is needed in that established list. Both focused and regression runs are required.

## Implementation sequence and acceptance gates

After this plan passes review AND separate implementation authorization is supplied:

1. Capture protected-file/migration hashes without capsule access. Add owner-host
   source and synthetic test scaffolding within the exact four-file runtime scope.
2. Establish genuine documented main-host bootstrap/private linkage; prove startup.
3. Pin the four canonical cache/exports bindings and verify descriptors before enablement.
4. Gate createExecutableAcquisitionDraft with original host association before claim.
5. Implement schemas, admission maps and private carrier in authorization.
6. Implement wrapper/identity private setup continuation and original graph cleanup.
7. Implement phase-1 validation and phase-2 pure-fence helpers/order at all listed points.
8. Implement closure, absolute expiry, UTC-only marker removal and post-cleanup
   validity-only result-release fence. Preserve transport/target/run/package bytes.
9. Migrate current synthetic fixtures/executable tests to input v3/executable v4.
10. Add host pin, update wrapper/identity pins and separate authorization self hash:
    exactly thirteen source pins, other ten existing values unchanged.
11. Regenerate inert templates and implementation evidence without actual package promotion.
12. Run all thirteen exact focused suites above with node --test --test-concurrency=1,
    including real child-process host proof and VM/unit R2 tests.
13. Run the established nineteen-file serialized regression, with separately authorized
    loopback only, using node --test --test-concurrency=1 and this unchanged path list:

    - supabase/tests/0099_shared_segment_assessment_job_foundation.test.cjs
    - supabase/tests/0101_worker_host_qualification.test.cjs
    - supabase/tests/0102_disposable_remote_qualification.test.cjs
    - supabase/tests/0102_operator_evidence.test.cjs
    - supabase/tests/0102_railway_evidence.test.cjs
    - supabase/tests/0103_qualification_supervisor.test.cjs
    - supabase/tests/0104_qualification_execution_reader.test.cjs
    - supabase/tests/0104_qualification_child_adapter.test.cjs
    - supabase/tests/0105_schema_and_topology.test.cjs
    - supabase/tests/0106_railway_introspection_plan.test.cjs
    - supabase/tests/0107_railway_introspection_preflight.test.cjs
    - supabase/tests/0108_railway_transport_contract.test.cjs
    - supabase/tests/0109_railway_private_https_adapter.test.cjs
    - supabase/tests/0110_railway_first_live_preflight.test.cjs
    - supabase/tests/0111_railway_target_identity.test.cjs
    - supabase/tests/0112_context_result_transfer.test.cjs
    - supabase/tests/0113_first_context_wrapper.test.cjs
    - tests/assessmentWorkerProcess.test.cjs
    - tests/migrationNumbering.test.cjs
14. Use installed local TypeScript only: node node_modules/typescript/bin/tsc --noEmit;
    the same binary with --project supabase/functions/tsconfig.json; and with --project
    scripts/assessment-worker/tsconfig.json. No npm/npx install or network fallback.
    Require all focused tests pass, zero failures in full regression with only existing
    documented OS skips, all three typechecks pass, git diff --check clean, exactly
    thirteen correct source pins plus separate self hash, protected comparisons clean,
    no migration diff, no current-package promotion, no historical rewrite and no
    capsule/credential/provider/external-network access. Verify legacy/extra-request tests.
15. Complete independent implementation review before claiming implementation accepted.
    Implementation completion itself still grants no provider/live/package authority.

Validation constraint: the established regression includes loopback HTTP test servers.
This planning task authorizes no network/tests. A later implementation milestone
must explicitly permit loopback-only regression coverage; external/provider network
remains forbidden. If its authorization retains absolute zero network, stop at that
validation boundary and report regression not completed; do not silently skip tests,
claim acceptance, or infer permission from older milestones.

## Recovery, remaining review items and authority limits

On failure, close owned authority and retain assertion markers; fix code through a
new reviewed patch, never retry the existing graph. A process restart loses volatile
markers and requires fresh operator/reviewer admission and manual authorization.
Rollback must leave executable acquisition disabled, not re-enable unguarded v3.
No provider configuration rollback/deployment/teardown is part of this patch.

No reviewed-policy change or durable coordination is needed. This plan needs its
renewed review, particularly named-host linkage/immutable bindings, thirteen-pin
architecture, carrier initialization and final-pure-fence ordering. No architectural
choices are deferred to the coding agent; the plan's
implementation permission and loopback validation permission remain pending.
No implementation or test/typecheck validation action is executed
now; current package remains lifecycle=null, evidence and historical reviews unchanged.

This document authorizes no runtime/test/template implementation, staging, commit,
push, credential/capsule access, provider/network service, lifecycle activation,
package completion, 0114D preparation, deployment, configuration, restart or live
acquisition. Next milestone is review of this implementation plan only.

## Plan review checklist

Answer YES/NO for: exact four-file runtime scope; protected-file list; sole owner
and supported loader domain; reload/duplicate-instance rejection; private pre-handle
carrier; atomic claim before capabilities; strict schemas and subject hashing;
64-entry/16-KiB limits; high-water/monotonic ordering; all terminals; cleanup with
rollback protection; v3/v4 cutover without bypass; unchanged transport/three requests;
both human gates/context-only separation; new host pin, two changed pins, thirteen
total source pins and separate self hash; inert templates; all twenty-one pure
fences; thirteen focused suites; exact regression inventory/loopback authorization;
typechecks; independent implementation review; no implementation authority.
