# 0114J C1/C2 and security-gate renewed critical review

outcome: PLAN_CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_AUTHORIZATION

startingHead: `53bf49ca424fef6c5bb03461c55b66b1b8f78a3a`

reviewedCommit: `53bf49ca424fef6c5bb03461c55b66b1b8f78a3a`

branch: `feature/0092-shared-segment-suitability`

reviewedArtifact: [Implementation plan](0114j-qualification-lifecycle-implementation-plan.md)

blockerCount: 3

nonblockingNoteCount: 2

separateImplementationAuthorizationMayBeRequested: false

implementationAuthorized: false

providerAuthorized: false

This is a fresh adversarial pass by the same Codex assistant that authored the
plan/corrections and prior reviews. It is not independent human approval or an
independent author/reviewer attestation. Conclusions below challenge actual local
Node behavior, rather than treating the approved scope wording as sufficient proof.

## Repository boundary and evidence

Starting HEAD and branch match exactly. Initial status contained only the pre-existing
untracked `0102-remote-fixtures.capsule`; no tracked changes. The commit delta from
89674362ac952ad991199a774c6084f194479e89 to the reviewed commit changes only the
implementation plan and readiness register. The capsule was not opened or touched.

Compared the actual plan and C1/C2 scope review with the prior corrected-plan renewed
review, executable-owner scope review, original plan review, corrected 0114I policy
and renewed B1 review, and readiness register. Inspected authorization, acquisition
wrapper, identity, adapter, first-context wrapper, worker entry/package, context
document builder, relevant 0110-0114 test/fixture contracts and inventories, current
input package and qualification evidence. No project module was imported/executed
by the offline probes. No source hashes were calculated.

Installed Node is v24.13.1. Read its embedded `repl`, `internal/repl/utils` and
CommonJS loader source. Ran isolated built-in-only Node child behavior probes with
empty child environments, bounded observation timers and no sockets, provider,
credential reads, application imports or temporary files. These are offline Node
behavior probes expressly permitted by the review, not project tests/typechecks or
a security scanner. Two initial child invocations failed at parsing due to control-
character argument encoding; corrected invocations used String.fromCharCode and
completed. Only completed observations substantiate the findings.

## Blocking RC1: EOF does not necessarily reach the selected terminal handler during await

Plan locations: A1, lines 274-280; A2, lines 284-295; C1 real-child acceptance,
lines 850 onward. The plan promises cancellation/revocation on EOF during pending
asynchronous evaluation but wires its handler to console exit, stream errors and
signals. It does not specify an independent stdin end/close or immediate REPL close
termination source.

Node embedded `repl` lines 578-611 pause native input processing for top-level await.
Its close listener at lines 796-801 queues `close` while paused and emits `exit`
only after unpause. Unpause at lines 368-384 may never occur for an unresolved await.
Thus the chosen console-exit notification is not an immediate EOF notification.

Completed probe: native nonterminal REPL, selected history/writer/breakEval settings,
stdin containing `await new Promise(()=>{})` followed by EOF. A harmless independent
180 ms observation timer kept the child available long enough to observe:

```text
ended=true; closed=true; exited=false
```

The stdin-end diagnostic listener did not perform cleanup; it only measured EOF.
The REPL had closed, but its `exit` handler had not run. Without another handle Node
can instead exit without the promised handler; with active transport/gate/timers,
authority cleanup can be deferred until await settles or some other event closes it.
Waiting for the lifecycle timer is not the promised EOF revocation.

Required correction: specify a terminal notification path independent of deferred
native REPL `exit` for input end/close, including pending await and incomplete input.
It must latch revocation and run the same private idempotent cleanup before any
pending evaluation can release a result or continue authority. Specify reentrancy/
event ordering and late-result suppression, then prove it in real child processes
with an unresolved await and a live owned-resource stand-in. Do not implement here.
This can plausibly remain in the host, but the current plan cannot leave this
lifetime decision to the implementation agent. Reconcile the scope's same assumption.

## Blocking RC2: selected Ctrl+C mode buffers the interrupt before the handler

Plan locations: A2, lines 284-293, and C1 real TTY acceptance. The plan expressly
selects breakEvalOnSigint:false and replaces the REPL SIGINT listener, claiming a
single delivered Ctrl+C terminates even during supported asynchronous work.

Embedded `repl` lines 970-978 wrap `_ttyWrite`: while top-level await is paused,
keys are buffered unless breakEvalOnSigint is true AND the key is Ctrl+C. With the
selected false value, the Ctrl+C key never reaches readline's SIGINT event at that
time. Replacing its SIGINT listener cannot fix an upstream event that is not emitted.
In raw TTY mode the key is not equivalent to an independently sent process SIGINT.

Completed synthetic terminal-path probe: native terminal:true REPL on in-memory
streams, selected breakEvalOnSigint:false, default SIGINT listener replaced with a
counter, unresolved top-level await entered, then byte 0x03 written after 30 ms.
At 180 ms:

```text
interrupts=0
```

This exercises the native key-processing branch, not a real PTY or OS signal proof.
The embedded source establishes the reason. A process SIGINT test alone would miss
the defect. This is asynchronous waiting, not the plan's explicitly accepted
event-loop-blocking limitation.

Required correction: review/select a native REPL interrupt/lifecycle arrangement
that actually delivers one Ctrl+C to terminal revocation during await. The approved
scope explicitly chose false, so reconcile that choice in scope/plan review rather
than silently toggling it during implementation. Keep native evaluation, no resume/
second owner, one cleanup handler, correct exit 130, and no custom listener/service.
Prove idle, multiline and pending-await Ctrl+C separately from process SIGINT, with
real TTY/PTY acceptance after local branch feasibility is established.

## Blocking RC3: native TTY preview bypasses the fixed non-inspecting writer

Plan locations: A1 options/output promises, lines 244-270, and output/inspection
acceptance around lines 865-868. The plan enables terminal mode with native eval,
an empty completer and a constant writer, but does not disable previews.

Embedded `repl` lines 265-266 default preview on for terminal mode with native eval.
`internal/repl/utils` setupPreview performs inspector Runtime.evaluate and, for
objects, Runtime.callFunctionOn invoking util.inspect. It does not route the value
through the constant writer. Empty completion does not disable this value preview.
Inspector sessions here are in-process; the probe opened no listener/socket.

Completed synthetic terminal-path probe: constant writer returning `<suppressed>`,
empty completer, historySize:0, native eval and terminal:true. Place a synthetic
candidate object in the REPL context with a harmless custom inspection method
returning a sentinel. Type the variable name without Enter. Observation:

```text
customInspectCalls=1; sentinelPrinted=true
```

No explicit console.log, deliberate Node-internal mutation or real secret is needed.
Native preview automatically inspects/prints the value and can invoke custom code.
The plan's output guarantee therefore fails in the supported TTY path despite the
writer working for ordinary completed evaluation results.

Required correction: explicitly disable native previews (review the native
preview:false option) or otherwise select/prove an equally narrow non-inspecting
TTY output policy. Reconcile scope and plan. Include pre-Enter object/string/error
preview and custom-inspection sentinels in future acceptance, not only expression
return output. This does not require a sixth runtime file or a provider action.

## Nonblocking notes

N1 — Real PTY acceptance remains an explicit environment gap. No winpty/script/conpty
command or installed node_modules/node-pty package was found by the limited local
inventory. This does not prove Windows lacks ConPTY or that no PTY facility can be
provided. Synthetic terminal:true streams prove native branches only. The plan
already correctly requires real TTY proof and stops acceptance if unavailable;
no installation/dependency is authorized. Confirm an available facility at future
validation rather than claim this review supplied real TTY proof.

N2 — The actual wrapper function issuing request 1 is `acquireServices`, which first
executes context acquisition and then ProjectServices. There is no current
`acquireContext` function. The plan/scope's label describes a phase but is presented
as a source path; correct that label during plan correction. The actual adapter
path and C2 boundary selection are otherwise identifiable and feasible.

## C2 source trace and native boundary assessment

Request 1 currently follows acquisition wrapper acquireServices (lines 62-67) ->
identity.contextTransfer.preparePermit -> adapter.bindContextResultTransfer ->
adapter.executeHandoff (line 137) -> reviews.takeAdapterHandoff -> kind/transfer
checks -> fixedContextRequest (line 206) -> contextValidator.buildRequest (fixed
context-document SHA-256) -> requireOwner(...).contextTransfer.assertSlot -> post.
Ordinary executeHandoff without transfer is a separate existing context/schema
path; the future acquisition association/downgrade checks must prevent using it
to omit request-1 lifecycle coverage.

Request 2: executeProjectServices (line 323) burns its binding ->
assertServicesAttempt (298) -> requireServicesOwner -> fixedProjectServicesRequest
(290) -> plain-key/document/variable checks and hash(query + LF); update dispatch
bookkeeping; post. Request 3 similarly uses executeServiceInstance (425) ->
assertInstanceAttempt (393) -> requireInstanceOwner -> fixedServiceInstanceRequest
(381), including hashing/describeTarget/history checks; bookkeeping; post.

Shared post (78-135) currently constructs its Promise executor/stop callback,
records cancel, sets timeout, checks requireQuietDiagnostics, creates native request
with inline options/secret header/response callback, attaches error handler and
JSON-serializes at req.end. Its response callback has separate later validation.
The plan correctly moves all local preparation, including serialization, before
the final fence. Response checks remain response checks, not dispatch freshness.

There is no demonstrated obstacle to preparing bounded primitive/plain-data body,
headers/options and callback, capturing the trusted native request function, resolving
the original private association and invoking that function immediately after the
fixed pure fence in the same synchronous executor. Avoid proxy/getter arguments,
late property/function lookup, coercion, inline callback/option creation and timer
creation between fence and native call. Internal Node work after entering that
function is outside the claimed local adjacency; the plan honestly disclaims
hard real-time wire delivery. No hidden post-fence local work is required by the
selected future design. Current source still has it because implementation has not
occurred; that is not an additional plan blocker.

One adapter connector, consumed synchronously by authorization with disabled
linkage and original Module/export/host checks, can fit inside the five selected
files. Existing wrapper/identity temporary connectors and cyclic imports provide
the linkage pattern; the adapter's current frozen-export assignment must change
within its approved scope. Link original S/C privately through identity's permit
path, not a public callback/Boolean/getter or carrier return. Seal after final
exports, reject preloads, never upgrade disabled ordinary imports, and retain one
revocation-aware authorization-owned fence. No new provider-boundary/document
builder, public hook, second lifecycle owner or sixth production file is required.

## Review disposition A-T

YES denotes design feasibility/preservation, not implemented behavior or acceptance.

| Area | Disposition and basis |
| --- | --- |
| A Git/scope | YES: exact HEAD/branch, clean tracked start; prior commit delta only two permitted docs. |
| B Five-file scope | YES: all selected responsibilities fit host/auth/wrapper/identity/adapter; worker/package/target/provider boundary/builders can stay unchanged. |
| C Plain main/native console | Main/bootstrap/open-pipe/evaluation feasible; required complete lifetime is NEEDS_CHANGE under RC1/RC2. |
| D REPL security | Bounded frozen same-facade/reset, disabled .load/.save and no history feasible; trusted JS correctly scoped. Automatic-output guarantee NEEDS_CHANGE under RC3. |
| E Cleanup/signals | Mark-first revocation/closure, cleanup-only calls after expiry, result suppression, exit codes/idempotence and abrupt-death limitation sound once handler runs. Notification delivery NEEDS_CHANGE RC1/RC2. |
| F Five immutable bindings | YES: harden final exports/cache properties, not full Modules/cache; finalize cycles first. Loaded CJS cache returns exports and loader may still set module.loaded; prior real-main descriptor evidence remains relevant. Partial bootstrap errors stay permanently disabled. |
| G Adapter connector | YES as a private one-use synchronous handshake, not surviving public authority. Original capture/preload denial prevent upgrade; implementation must prove import-order failures. |
| H Three paths | YES: actual source verified; N2 corrects wrapper function label only. Request 1 includes context-builder hashing. |
| I Native final fence | YES: all local work can precede captured native construction; no required local post-fence work found. |
| J Lifecycle owner | YES: authorization owns maps/clocks/deadline/high-water/fault/closed state; adapter invokes one fixed revocation-aware closure. |
| K Twenty-one transitions | YES: rows 1..21 present; 10/12/16 adapter-local, not three added rows; #21 validity-only release after cleanup preserved. |
| L B1 | YES: canonical C(R), collision/reference checks, claim before capability, CLOSED first, UTC retention, 64 entries/16 KiB, retained high-water/original mono deadline and fresh-review restart unchanged. |
| M Pins | YES: current twelve expected roles; future thirteen, three changed old/nine unchanged, separate auth self and policy binding; no mutual digest cycle required. |
| N C1 testability | Tests can expose the defects (local probes already do). Current assertions cannot truthfully pass as specified without correcting RC1/RC2/RC3; real TTY remains N1 gap. |
| O C2 testability | YES: isolated loaders already substitute native transport/crypto/clocks; future coherent five-module fixture can inject phase-1 time changes without production API injection. Count at fake native constructor entry, not only req.end. |
| P Security gate | YES: deterministic validation first, exact commit/base/diff, semantic review, Codex Security when available/fallback mandatory, supplemental static scans, blockers regardless of invariant-breaking severity, architectural return and re-review after changes. |
| Q Authority separation | YES: no provider/Railway/live/activation/promotion/deployment/loopback implied. Current actual v2 input incomplete, expectedTarget.lifecycle null, flags false; v2 has no lifecycleReview descriptor, rather than an executable activation. |
| R Inventories | YES: 5 runtime/5 immutable/21 transitions/13 future roles/3 changed old/9 unchanged/14 focused/19 regression/3 TypeScript checks. |
| S Sequence | YES in dependency structure: construction steps are distinct from runtime order; graph link/connector before final seal/enable, claim before capabilities, final pins/templates before validation, security then independent review. Console implementation must first resolve RC1/RC2/RC3. |
| T Overall acceptance | BLOCK: three unresolved Node-native lifecycle/output requirements; do not approve with blockers. |

### Successful local feasibility observation

A separate built-in-only native REPL probe bound a frozen facade as a non-writable,
non-configurable context property, rebound it on reset, removed commands.load/save,
and evaluated `.clear`. Observation: same facade true, load absent true, save absent
true. This supports those local API choices only; it is not host/main/private graph
or real TTY proof. CommonJS loader inspection confirmed loaded cached exports are
returned directly; no global loader patching or production cache mutations occurred.

### Source-pin arithmetic

Actual current SOURCE_HASHES contains exactly these twelve roles under
scripts/assessment-worker, all qualification-railway-*.cjs:

| Future treatment | Existing suffixes |
| --- | --- |
| Change three old values | acquisition-wrapper, target-identity, https-adapter |
| Keep nine old values | first-context-wrapper, target-identity-provider-boundary, context-review, introspection-preflight, project-token-context, transport-contract, introspection-target, introspection-request, introspection-plan |

Add acquisition-owner-host as role thirteen. Four pinned values new/different;
authorization self-hash changes separately, giving five changed/new runtime-source
identities. Authorization may pin host source without host embedding generated
authorization self hash. Policy digest remains separate document binding. No
fourteenth source role or hash calculation is necessary; historical evidence intact.

### Exact focused and regression inventories

Verified fourteen unique focused paths specified by plan:

1. supabase/tests/0110_railway_first_live_preflight.test.cjs
2. supabase/tests/0111_railway_target_identity.test.cjs
3. supabase/tests/0112_context_result_transfer.test.cjs
4. supabase/tests/0113_first_context_wrapper.test.cjs
5. supabase/tests/0114a_service_review_authorization_foundation.test.cjs
6. supabase/tests/0114b_project_services_transport.test.cjs
7. supabase/tests/0114c_service_instance_transport.test.cjs
8. supabase/tests/0114d_acquisition_wrapper.test.cjs
9. supabase/tests/0114e_acquisition_input_review.test.cjs
10. supabase/tests/0114f_target_metadata_evidence.test.cjs
11. supabase/tests/0114h_service_name_compatibility.test.cjs
12. supabase/tests/0114j_lifecycle_authorization.test.cjs (future new)
13. supabase/tests/0114j_executable_owner_host.test.cjs (future new)
14. supabase/tests/0114j_native_dispatch_fence.test.cjs (future new)

Regression has nineteen exact paths, membership and order unchanged from the
89674362 baseline:

1. supabase/tests/0099_shared_segment_assessment_job_foundation.test.cjs
2. supabase/tests/0101_worker_host_qualification.test.cjs
3. supabase/tests/0102_disposable_remote_qualification.test.cjs
4. supabase/tests/0102_operator_evidence.test.cjs
5. supabase/tests/0102_railway_evidence.test.cjs
6. supabase/tests/0103_qualification_supervisor.test.cjs
7. supabase/tests/0104_qualification_execution_reader.test.cjs
8. supabase/tests/0104_qualification_child_adapter.test.cjs
9. supabase/tests/0105_schema_and_topology.test.cjs
10. supabase/tests/0106_railway_introspection_plan.test.cjs
11. supabase/tests/0107_railway_introspection_preflight.test.cjs
12. supabase/tests/0108_railway_transport_contract.test.cjs
13. supabase/tests/0109_railway_private_https_adapter.test.cjs
14. supabase/tests/0110_railway_first_live_preflight.test.cjs
15. supabase/tests/0111_railway_target_identity.test.cjs
16. supabase/tests/0112_context_result_transfer.test.cjs
17. supabase/tests/0113_first_context_wrapper.test.cjs
18. tests/assessmentWorkerProcess.test.cjs
19. tests/migrationNumbering.test.cjs

Three future installed TypeScript checks are repository --noEmit,
supabase/functions/tsconfig.json and scripts/assessment-worker/tsconfig.json using
node_modules/typescript/bin/tsc. None run here. Future loopback regression still
requires explicit authorization; fake native construction tests need no network.

### Security acceptance gate assessment

The gate has the nineteen requested semantic threat categories and no obvious
missing independent critical category was found beyond the concrete console design
defects above, which fall within lifecycle/cleanup/output threats already listed.
Future semantic security review should explicitly exercise these cases after a
correction. A later scan cannot defer resolution of known plan blockers. Exact
implementation commit/base/diff evidence, mandatory unavailability fallback,
supplemental-only static/CodeQL/dependency scans, residual-risk triage, architectural
return-to-plan rule and independent implementation review remain coherent. No Codex
Security availability lookup, scan, plugin installation or configuration occurred.

## Preservation, validation and next milestone

Implementation plan, approved scope and all prior review/policy documents remain
unchanged. Only this new review and a readiness-register append are written.
Runtime/tests, migrations, current package, evidence and templates remain unchanged.
No credentials/secrets/capsule, provider/Railway, external/loopback network, security
scanner, installation, project tests/typechecks, staging, commit or push occurred.
Offline native-source inspection and isolated Node probes are the only execution
beyond read-only Git/text validation. No temporary probe files remain because none
were created.

Git whitespace checks pass, including this untracked artifact. Protected-path diffs
and index diff are empty. HEAD remains 53bf49ca424fef6c5bb03461c55b66b1b8f78a3a.
Expected actual short status is modified readiness register, untracked review and
pre-existing untracked capsule. The request's staged A/M notation cannot be produced
without staging, which is forbidden; this artifact remains `??`, with index untouched.

Exact next milestone: narrow C1 scope/plan reconciliation and correction for
independent EOF notification during await, actual single-Ctrl+C delivery during
await, and disabled automatic TTY preview/inspection, followed by renewed critical
review. Resolve N2 labeling and retain N1 real-TTY acceptance gap. Keep the five-file
architecture, C2 native boundary, B1 policy and all inventories unless a separately
reviewed scope change proves necessary. Separate implementation authorization may
NOT yet be requested. No implementation, provider/live/package promotion, lifecycle
activation, deployment or execution authority is granted by this review.
