# 0114J qualification lifecycle implementation plan

STATUS: PLAN_COMPLETE_IMPLEMENTATION_NOT_AUTHORIZED

Starting HEAD: `493d53d1f90cd35bf6ee33bf6c7c41db1a4f5a12`

Branch: `feature/0092-shared-segment-suitability`

This document specifies a future patch for plan review. It implements nothing and
does not complete or promote the current input package. The renewed review closed
B1 by design, not by implemented enforcement or independent human approval.

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

Only the following runtime files change; no new runtime module is needed:

| File under scripts/assessment-worker/ | Planned responsibility |
| --- | --- |
| qualification-railway-live-authorization.cjs | Strict v3 input/v1 activation intake; sole admission maps; module-domain checks; clocks/deadlines; private lifecycle carrier; pre-ticket cancellation; v4 manifest and cutover; two changed source pins/self identity. |
| qualification-railway-acquisition-wrapper.cjs | Private redemption/setup handshake; carry original lifecycle obligation; boundary checks, timers, terminal notification and existing resource cleanup. |
| qualification-railway-target-identity.cjs | Retain private lifecycle check from original target permit; apply it to acquisition-session operations/validators; discard on terminal cleanup. Context-only behavior unchanged. |

Explicitly preserve introspection-target.cjs: its exact disposable/active syntax,
nullable instance and opaque binding need no change. Preserve https-adapter.cjs:
wrapper dispatch and response checks plus identity-owned validation enforce the
new lifetime without adding transport operations or token-intake behavior. Native
request timeout remains 10000 ms; closing the existing execution context cancels
in-flight transport. No query/document hash changes are planned.

Planned test files, all under supabase/tests:

- Add `0114j_lifecycle_authorization.test.cjs`: strict schemas, admission, clocks,
  capacity, carrier failures and cutover matrix below.
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
- Add `0114j-module-domain.cjs`: test-only coherent Module/cache/children graph and
  clock/fault-injection support shared by those loaders. No production test hook.

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

Canonical executable owner is the authorization module above. Existing public
acquisition draft/review/approve/authorize APIs remain there; begin/submit/cancel
remain in the literal wrapper. No new CLI or executable entry module is added.
Relative and absolute imports resolving to the same real file must return the same
cached Module/exports. Admission is only supported in the main CommonJS execution
domain of one trusted Node process; worker-isolate/VM production acquisition is denied.

Implement a private `assertOwnerDomain` in authorization and call it before claim
and every subsequent authority/execution boundary. Capture the original Node Module
constructor, main module, require cache object and the original authorization,
wrapper and identity Module/exports identities during ordinary initialization.
Require main-thread execution; require.main must be a genuine cached Module, not
undefined. Read-only imports may occur from other hosts, but cannot admit there.
Reject module filename/id/realpath mismatches and a canonical cache entry that is
not the captured original module. No environment-driven override is allowed.

Before admitting, walk the existing require.main children graph and cached modules'
children with a visited set; inspect only Module identities/filenames, not exports'
arbitrary values. For each of the three canonical owner realpaths require that every
encountered Module reference equals the original cached instance, and every current
literal require returns the captured exports. Reject an additional instance, stale
child, noncanonical alias, replacement export, missing cache entry or changed main.
Node's parent.children retains the prior instance during ordinary cache deletion/
reload, so a replacement owner-wrapper pair cannot hide behind a fresh table.
Run the guard again after initialization, outside the circular partial-export phase.
An incomplete connector cycle cannot become executable.

Keep initialization-only connectors non-enumerable, one-use, deleted and exports
frozen before normal import returns. Reloading only one side also fails its original
counterpart/connector checks. No connector can reset maps or recreate admission.
Physical copied trees fail canonical reviewed-root/code checks. Add explicit tests
for authentic Module cache deletion/reload, a fresh replacement pair, stale children,
alternate entry path, duplicate require aliases and both import orders.

This relies on the reviewed trusted module-loader/host boundary. Arbitrarily editing
all cache entries AND the main/parent graph, replacing built-ins or evaluating patched
owner source is loader compromise, not a supported reload path. Independent VM
fixtures simulate the complete module graph; they do not create production admission
permission. Production has no public process-global registry, reset or test bypass.
If implementation cannot enforce this supported-domain rule, stop for plan review;
do not weaken it to mere path/hash equality or add durable coordination.

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

## C. Clock and expiry algorithm

Production clocks are captured Date.now and performance.now, never API arguments,
environment configuration or caller callbacks. Owner private `utcHighWater` starts
unset and survives entry cleanup. Use a domain-wide clock-fault latch on invalid
UTC/monotonic readings or detected rollback: close owned graphs, reject future
admissions in this process; do not recover by clearing the high-water value.

For every intake, claim recheck, review/approval, authorize, redemption, permit
consumption, outbound dispatch, response acceptance and human take/submit boundary:

1. Verify module domain and exact original ownership where applicable. Read UTC u
   and monotonic m; both must be finite, with UTC a safe integer millisecond value.
2. If high-water is set and u < high-water, latch clock fault and close/reject. Else
   set high-water=max(high-water,u) BEFORE any expiry cleanup or table lookup.
3. Strictly parse timestamps by exact UTC millisecond syntax and parse/serialize
   round trip. Require operator.assertedAt <= review.reviewedAt <= u, exact
   expiresAt=reviewedAt+1800000, and u < expiresAt. Never normalize a bad timestamp.
4. At initial passive validation calculate remaining=expiresAt-u. Immediately before
   claim repeat 1-3; capture monoDeadline=m+remaining using this latest remaining.
   Atomically check indexes/capacity and claim without any external call or await.
5. For an existing graph require m < its original monoDeadline and u < expiresAt;
   deadline never extends on later calls. Re-read bound code/input/record/evidence
   identities before further execution; do not refresh hashes. A failure closes.

After claim schedule an owner expiry timer using min(expiresAt-u,monoDeadline-m).
The same timer covers abandoned drafts and unredeemed tickets; wrapper does not
restart it. On callback, sample/update clocks first, close if either expiry reached,
and reschedule only if neither reached (early timer callback), using the smaller
remaining interval. Invalid/backward time closes rather than reschedules.

At dispatch, the lifecycle guard runs immediately before the synchronous adapter
execute call; native request construction has no intervening caller hook. Check
again before accepting its awaited result and before passing any observation to
identity. Identity validators also call the private guard for acquisition sessions.
The owner timer's close invokes existing context cancellation while a request waits.
Late responses/continuations check closed state before further requests/results.

The earliest of lifecycle UTC expiry, lifecycle monotonic deadline, existing 10000 ms
transport timeout and either 300000 ms human deadline wins. Human/wrapper timers
never extend lifecycle. On simultaneous events use one idempotent closure, no retry.
Forward UTC jump detected at a callback/boundary closes immediately; no hard real-time
claim during an event-loop stall. A delayed callback cannot permit an expired request,
human decision or result because boundary checks run independently.

Cleanup samples/updates the same high-water first, closes expired claimed entries,
then removes closed markers/indexes only at u >= expiresAt OR original monotonic
deadline reached. A monotonic-only early closure retains its marker until UTC
expiresAt; drop it only when UTC expiry also holds. Thus no UTC-valid record becomes
unseen early. After removal strict time checks precede admission lookup, and rollback
cannot erase high-water or reopen the expired record.

Tests replace built-ins only inside VM fixture loading: independent UTC and monotonic
values, synthetic timers with explicit delayed/early callbacks, and a captured
original-module graph. No injected clock, capacity, collision function or cleanup
callback is exported by production. Simulated hash collision/faults are fixture
source/builtin substitutions confined to the isolated test loader.

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
document binding, not a thirteenth source pin. Its value is not calculated now.

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

1. Receive original binding, complete inventory, reviewed code and exact input
   descriptor via existing four-argument draft API. Domain check and clock sampling.
2. Passively validate code/HEAD/branch/pins/self, target, inventory, full input schema
   and false authority flags; existing host/package review/provenance/evidence checks.
3. Resolve/read activation descriptor and all bounded non-secret references; validate
   schemas, human roles, exact predicate acknowledgements, policy/subject/record digests
   and target binding. Invalid real incomplete package rejects here, with zero claim.
4. Recheck time/domain, clean expired markers safely, check capacity and both indexes;
   synchronously insert claimed and its index, carrier and original private draft entry.
   No await/getter/hook/context-review capability intervenes. Any following exception
   closes the inserted assertion, even if draft was never returned.
5. Schedule lifetime obligations; create existing private context review; freeze full
   v4 manifest and publish original draft. No execution or credential access.
6. Review/approve exact package/context/host as before, checking original claim,
   time/domain and bound bytes at each boundary. Invalid located acknowledgement closes.
7. Manual authorization checks exact v4 acknowledgement and original graph; negative,
   malformed or stale acknowledgement closes. Create one opaque ticket; allocation
   failure closes. Draft cancellation before or after issuance closes its graph.
8. Public wrapper begin reaches private owner trampoline. Burn genuine ticket first,
   then check arity, domain, graph, time and bytes. Create original target permit with
   the same guard/carrier; call fixed wrapper setup inside owner cleanup protection.
9. Wrapper attaches stopRun before allocating/publishing run handle. Identity consumes
   original target permit BEFORE its validation, creates one guarded acquisition
   session. Guard runs again before adapter.openExecutionContext(originalBinding).
10. Only that adapter call may first inspect/read the actual Railway token environment;
    it opens the credential-bearing context. Tests supply synthetic private values
    solely in isolated fixtures. No real token is read in implementation validation.
11. Dispatch request 1, Movement0108ProjectTokenContext, after guard; await and guard
    before accepting same-context identity transfer. Dispatch request 2,
    Movement0111ProjectServices, after guard, in the same context/session.
12. Guard response acceptance and issue human service gate 1 with earlier-of timers.
    Exact machine ID/name checks must pass first. On take/submit recheck lifecycle;
    invalid/rejected/expired acknowledgement closes, never overrides mismatch.
13. After gate 1, guard then dispatch request 3, Movement0111ServiceInstance. Guard
    response acceptance, exact context/name/ID and nullable instance expectations.
14. Issue/submit human final target gate 2 with earlier-of timers and repeated guard.
    No fourth request or schema operation exists. Successful final evidence is descriptive.
15. Every terminal branch calls original carrier close; wrapper disposes context,
    session, gates and pending results. Completion returns the one descriptive result
    only after closure/cleanup succeeds and time checks passed. Failures return no
    credential/capability or reusable authority. Maintain global flags false/null.
16. Retain closed markers/indexes until expiry and clean under the algorithm above.
    Later target reuse requires a new independent activation record and authorization.

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
All new executable routes must pass the domain/claim guard; no alternate entry API.

Historical tests load complete source/template contexts from their existing archived
commits. Current fixture mode generates v3/v4 synthetic packages and references.
Do not change archived evidence/version strings to pretend old reviews cover v4.
Current real package stays byte-identical v2/incomplete and must be rejected by v4.
Its future migration is a separate evidence/package review, not this implementation.

## Pins and inert templates

Twelve source pins remain. Update exactly the wrapper and target-identity source
hashes in authorization; authorization's own source/self hash changes. The other ten
pinned sources, including introspection-target and https-adapter, remain unchanged.
Use the existing UTF-8 CRLF-to-LF-only source rule. Compute new values only after the
future implementation stabilizes, not now. Existing BASELINE_PARENT_HEAD remains
historical, never substituted for reviewed current HEAD.

Regenerate the five existing safe templates listed above for new source identity;
0114E template becomes v3 with null lifecycleReview descriptor. Planning template
0114A remains inert planning v1; 0110 remains context-only v1. New v4 executable safe
template uses existing executableAcquisitionReviewTemplate(), with null eligibility,
target/lifetime/record expectations and false authority. Activation safe template is
inert data with null reviewer/timestamps/facts, never admitted as reviewed. No
historical hash, actual evidence digest or current package pin is silently refreshed.

## Focused future test matrix

Each row is an acceptance obligation, not an implemented test. Use fake native
transport, zero real credentials, blocked external HTTP/HTTPS/fetch, and captured
private pools only inside fixtures. Estimate 140-180 new parameterized cases; exact
count is determined by matrix expansion, not a target to pad tests.

| Category | Cases and expected evidence |
| --- | --- |
| Schema (~30) | Missing/extra/duplicate root/nested keys; invalid versions/descriptor/record/path/size; same operator/reviewer; timestamp syntax/round-trip/order; wrong active/scope; digest/subject/policy/reference mismatch; false/missing acknowledgements; untouched current package rejected before claim/credential/context/request. |
| Admission (~20) | First claim only; two drafts before ticket and after claim; copied path/format/key order/wrapper; restored package; changed/conflicting attemptReference; wrong subject; simulated equal digest/unequal C(R); fresh reviewed record succeeds; invalid duplicate never kills first; entry state never capability. |
| Capacity (~8) | 64 claimed, 64 closed, mixed occupancy, 65th rejected; 16384/16385 raw/canonical byte boundaries; reference caps; expiry frees capacity; zero eviction of unexpired closed/claimed entries and indexes. |
| Timing (~20) | reviewedAt equality; exact expiresAt rejection; near-expiry start; separate UTC/mono advances; forward/backward jumps; invalid readings; delayed/early callbacks; high-water survives empty maps; cleanup then rollback replay; min lifecycle/transport/human/wrapper deadlines and no late result. |
| Closure (~35) | Cancel pre-ticket, post-ticket/pre-redemption; manual rejection; injected exceptions after insertion, timer/review/ticket creation, redemption/transfer, before handle/context, after context; request 1/2/3 errors; response after expiry; gate 1/2 rejection/timeouts; owner-handled crash; success; explicit revoke; abandoned draft, ticket and active run expiry; close throwing; repeated close and stale submit. |
| Owner domain (~12) | Relative/absolute canonical imports share; alternate physical path rejected; genuine cache reload, duplicate instance/stale children and fresh replacement pair rejected; missing/main/cache mismatch; both import orders; deleted connectors/frozen exports; unsupported VM/worker admission denied; no public registry/reset/test seam. |
| Cutover/preservation (~20) | v3 executable/v2 input cannot bypass; 0113 cannot continue; same session/context, successful count exactly 3 and failures <=3; both gates; nullable instance; exact service ID/name; no historical/default/alias fallback; genuine ticket/permit burns on invalid arity/expiry/binding; credential reads only after guards; all global flags false/null; no retry/fallback/resume/fork; no permanent target consumption. |

Keep existing success/negative coverage in the eleven relevant suites; add current
v4 integration there rather than duplicating all assertions in the new suite.
Historical suites test their archived contract; new suites never claim real target
identity from synthetic success.

## Implementation sequence and acceptance gates

After this plan passes review AND separate implementation authorization is supplied:

1. Capture protected-file/migration hashes without capsule access; implement schema,
   domain guard and owner table/carrier in authorization with isolated fixture tests.
2. Implement private setup trampoline/wrapper closure/timing; guarded identity context;
   preserve transport and target binder bytes. Prove early-failure and duplicate paths.
3. Cut current fixture/tests to v3/v4, complete matrix, update two pins/self hash,
   regenerate inert templates and write implementation evidence. Do not promote inputs.
4. Run all twelve focused suites serialized with `node --test --test-concurrency=1`
   and explicit file paths listed in this plan (new 0114J plus eleven updated suites).
5. Run the established nineteen-file serialized regression with the same node
   --test --test-concurrency=1 command and this exact path list:

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
6. Use installed local TypeScript only: node node_modules/typescript/bin/tsc --noEmit;
   the same binary with --project supabase/functions/tsconfig.json; and with --project
   scripts/assessment-worker/tsconfig.json. No npm/npx install or network fallback.
7. Require all focused tests pass, zero failures in full regression with only existing
   documented OS skips, all three typechecks pass, git diff --check clean, exactly
   twelve correct source pins/self hash, protected comparisons clean, no migration
   diff, no current-package promotion, no historical rewrite and no capsule/credential/
   provider/external-network access. Verify extra-request and legacy-bypass tests.
8. Complete independent implementation review before claiming implementation accepted.
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
own review, particularly domain graph enforcement, carrier initialization and clock
ordering. No architectural choices are deferred to the coding agent; the plan's
implementation permission and loopback validation permission remain pending.
No implementation or test/typecheck validation action is executed
now; current package remains lifecycle=null, evidence and historical reviews unchanged.

This document authorizes no runtime/test/template implementation, staging, commit,
push, credential/capsule access, provider/network service, lifecycle activation,
package completion, 0114D preparation, deployment, configuration, restart or live
acquisition. Next milestone is review of this implementation plan only.

## Plan review checklist

Answer YES/NO for: exact three-file runtime scope; protected-file list; sole owner
and supported loader domain; reload/duplicate-instance rejection; private pre-handle
carrier; atomic claim before capabilities; strict schemas and subject hashing;
64-entry/16-KiB limits; high-water/monotonic ordering; all terminals; cleanup with
rollback protection; v3/v4 cutover without bypass; unchanged transport/three requests;
both human gates/context-only separation; two changed pins/self hash and inert
templates; exhaustive matrix; exact regression inventory/loopback authorization;
typechecks; independent implementation review; no implementation authority.
