# 0114J reconciled C1 renewed critical review

outcome: PLAN_CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_AUTHORIZATION

startingHead: `5ae6caaf9ab121aa2799b97565eba900ba67ffbd`

reviewedCommit: `5ae6caaf9ab121aa2799b97565eba900ba67ffbd`

branch: `feature/0092-shared-segment-suitability`

blockerCount: 1

nonblockingNoteCount: 1

RC1DesignPassed: true

RC2DesignPassed: false

RC3DesignPassed: true

separateImplementationAuthorizationMayBeRequested: false

implementationAuthorized: false

providerAuthorized: false

This is a fresh adversarial pass by the same Codex assistant that authored the plan,
reconciliation and prior reviews. It is not an independent-author review or human
approval. Local observations and source reasoning below distinguish what passed
from an unresolved signal-handling path; the earlier review is not rewritten.

## Repository and review evidence

Starting HEAD/branch match. Before review, status contained only the pre-existing
untracked `0102-remote-fixtures.capsule`; no tracked modifications. The commit delta
from a67e7db9417ed06f265772431e7826651044406a changes only the scope artifact,
implementation plan and readiness register. Capsule unread/untouched.

Compared the actual scope appendix and operative plan with the failed RC1/RC2/RC3
review, corrected-plan renewed review, executable-owner review, original plan review,
0114I design/B1 renewed review and readiness register. Inspected current authorization,
wrapper, identity, adapter, first-context wrapper, worker entry/package, current v2
input/evidence and relevant 0110-0114 fixture/test contracts. No project module was
executed or imported by the probes and no source hashes were calculated.

Inspected installed Node v24.13.1 embedded `repl`, `vm`, `internal/repl/utils` and
readline behavior. Eight isolated built-in-only child probes used empty environments,
bounded observation windows, no project imports, temporary files, sockets, provider,
credential reads or external/loopback network. No project tests/typechecks/security
scan ran. Synthetic terminal:true streams establish native branches, not real PTY
or external OS-signal delivery.

## Blocking RS1: synchronous VM SIGINT interruption has no guaranteed terminal bridge

Plan locations: A2, particularly the selected true option and its synchronous VM
consequences (lines 319-338), terminal source/exit table, and future C1 acceptance
requirements. Scope appendix RC2 similarly accepts VM interruption but specifies
only REPL SIGINT/process SIGINT notification to trigger revocation.

The corrected true option resolves the previously buffered Ctrl+C key during await.
However, it also sets native VM breakOnSigint for synchronous evaluation. It is not
sufficient to install a process SIGINT listener and replace REPL SIGINT listeners:

1. Embedded `vm` runInContext/runInThisContext at lines 132-151 uses
   sigintHandlersWrap when breakOnSigint is true and a process listener exists.
2. sigintHandlersWrap at lines 272-289 saves raw process SIGINT listeners, removes
   them during the synchronous VM call, then restores them in finally. Restoration
   does not itself notify the host of an interrupt consumed by VM.
3. Embedded `repl` at lines 545-553 passes breakOnSigint:true into that call.
   Its finally block at 555-564 re-emits REPL SIGINT only when stopSigintWatchdog
   reports a pending signal. The embedded comment explicitly describes signals
   pending after script termination WITHOUT the script having been interrupted.
   This is not an unconditional forwarding of every consumed VM interrupt.
4. An interrupted VM evaluation instead takes the exception path at 567-575,
   assigning err and emitting the REPL domain error. Native error handling at
   624-738 renders it and displays another prompt if the server is not closed.
   The fallback finishExecution path at 617-618 also routes errors to native
   rendering. Neither specified host signal handler is guaranteed to run.
5. The planned constant writer only renders a marker. The plan specifies no fixed
   private observation of native evaluation interruption that latches revocation
   before another prompt, operation or result release.

A completed local probe installed one process SIGINT listener, started the selected
native REPL with breakEvalOnSigint:true, and evaluated a harmless function measuring
listener count. Observed:

```text
before synchronous evaluation: 1
inside synchronous evaluation: 0
after synchronous evaluation: 1
terminal latch: false
```

This directly verifies temporary listener removal; it does NOT reproduce an actual
OS-delivered synchronous VM interrupt on Windows. The unhandled branch is established
by the embedded JS source/control flow and the lack of a specified bridge. This
review does not claim real TTY or external signal proof that was not obtained.

The unresolved scenario is an active original graph plus Ctrl+C/SIGINT consumed by
native VM evaluation, yielding an interruption error and then a live console while
host revocation remains unset. This is different from demanding impossible real-time
callback delivery during a blocked event loop: after interruption returns control,
the plan must not silently continue with live authority. It also does not require
malicious trusted-operator mutation of Node internals. The task expressly requires
checking synchronous-eval interruption and terminal process SIGINT semantics.

The reconciliation's limitation to the first delivered HOST notification does not
close this gap: VM can consume the interrupt without delivering that notification.
Acknowledging that evaluation may be interrupted is not a revocation mechanism.
Therefore RC2 passes the idle/multiline/await key-path subcases but does not pass
the complete terminal-signal design review. Do not approve with this blocker noted.

Required next correction: select and justify a fixed private fail-closed path from
native synchronous-evaluation interruption to the SAME host terminal latch, or
reconcile the native interrupt arrangement through narrow scope/plan review. Specify
how it prevents a prompt/authority continuation before revocation, preserves constant
non-inspecting output, original-owner cleanup and signal exit policy, and introduces
no custom parser, public callback or second owner. Do not silently defer the choice
to implementation. Add future proof for actual synchronous VM interruption with an
active synthetic graph, no re-enabled prompt/authority/result, one cleanup and proper
exit 130, separately from idle/await key and independently delivered process-signal
cases. If it cannot fit reviewed scope, stop for explicit scope review. No runtime
implementation or alternative architecture is selected by this review.

## RC1 design passes: independent EOF and first-latch cleanup

Direct stdin end/close listeners are outside native REPL's paused close-to-exit
queue. Native top-level-await pause stores input keys/REPL exit notifications, not
all EventEmitter input listeners. A direct prependListener registered before native
input processing runs before the REPL's own end/close listener in ordinary supported
startup; no competing later trusted-internal mutation is assumed. The additional
REPL close/exit sources provide a fallback without becoming the sole EOF path.

Re-tested with actual child process.stdin, pipe input containing unresolved
top-level await followed by EOF, an independent guard timer, and the selected direct
first-latch handler. It latched stdin-end, revoked/cleaned once and exited 0 before
the guard timer/evaluator success. Recursive cleanup-induced notification was ignored.
No native REPL unpause or deferred exit was required. The probe used only stand-in
state, not an application graph; real implementation must still prove all graph
closures and late-result suppression.

Check-after-listener-install for readableEnded/destroyed/closed input is coherent:
listener setup and state check are synchronous before yielding input, so either the
state check or an observed event reaches the latch. Partial bootstrap cannot enable
after a terminal cause. End and close may both occur; first cause is retained.
Cleanup-induced close/exit cannot re-enter because the latch precedes close/cleanup.
The handler synchronously closes original graphs before process termination, so no
async exit handler or pending evaluator completion is needed. Every later authority/
result path is specified to observe host revocation and closed state, not only a timer.

Actual raw TTY Ctrl+D is a key path, not necessarily a process.stdin end event;
do not use a synthetic raw key as proof of descriptor EOF. Native physical disconnect/
EOF and REPL-close behavior require future real TTY validation under the stated gap.
This does not reopen the descriptor-EOF fix or claim Ctrl+D can cancel every paused
native input sequence. The explicit guaranteed pending-await cancellation key is
Ctrl+C, whose asynchronous branch passed below.

First-cause exit policy is coherent/testable: clean EOF/close/.exit 0 after successful
cleanup, first SIGINT 130, first SIGTERM 143, bootstrap/stream failure 1. Cleanup
failure escalates a clean 0 to 1 while preserving already-latched 130/143. Later
equivalent events/signals do not alter cause or repeat cleanup. Known stream errors
are not clean EOF. No failure is authorized to release success. This is a design
conclusion, not a claim that every future race test has run.

## RC2 partial pass: native idle/multiline/await key paths

Embedded `_ttyWrite` allows Ctrl+C through the paused buffer when true; native
readline emits SIGINT when a listener exists. Replacing the default REPL SIGINT
listeners on the fresh server leaves this native event path intact, removes default
double-press/clear and prioritized-await-resume behavior, and routes it to the host.
The internal await interrupt promise can remain pending, but host cleanup/process
exit need not await it. No custom input parser or public handler is required.

Three completed synthetic terminal:true probes, each using only native key processing,
sent one Ctrl+C at idle, multiline input and unresolved await. Each entered the
replacement terminal handler, latched/revoked/cleaned once and exited 130, ignoring
recursive terminal notification. They prove the local key branch only. Process/OS
SIGINT remains a distinct source/test; the plan correctly requires separate coverage.
RS1 concerns synchronous native evaluation and is not disproved by those successes.

## RC3 design passes: disabled preview and constant completed rendering

Embedded `repl` selects preview only when terminal and options.preview is true (or
defaulted on). Explicit preview:false makes internal/repl/utils setupPreview return
inactive show/clear operations before inspection. Empty completion is not relied on.
No inspector listener/socket is needed; native useGlobal:false context machinery
may use in-process inspector APIs, which is not an opened listener.

Re-tested object, string and error variables separately, typing each without Enter,
then completing evaluation. Object/error cases carried synthetic custom inspectors.
All three observations: before Enter, custom-inspector count 0, writer calls 0 and
no sentinel value output; after Enter, custom-inspector count remained 0, writer
calls became 1 and no sentinel value appeared. Native terminal echoes the typed
variable name as normal line editing; that is not value preview. Completed values
flow through the configured constant writer. Source inspection confirms native
error rendering uses it as well; this does not claim general JS getter/side-effect
containment or replace future thrown-error/automatic-output tests.

Explicit console.log/util.inspect, imports/file/environment access remain trusted
operator actions, outside the automatic-output guarantee. The facade still must
return no secrets/private owner state. Native _/_error retention is acknowledged.
The plan does not falsely claim a sandbox. The original RC3 automatic preview/
custom-inspection path is closed in design.

## Nonblocking N1: real TTY proof remains future acceptance work

No real PTY was used. Limited local command inventory again found no winpty/script/
conpty command or node_modules/node-pty package. This does not establish that native
Windows ConPTY or another already-available facility is impossible. Current absence
of proof is a future acceptance gap, not by itself an architectural plan blocker:
the plan requires real TTY proof and stops acceptance if unavailable. Do not install
dependencies or equate terminal:true streams/process signal tests with that proof.

## Frozen architecture, inventories and sequence

The original scope's false option and acquireContext label remain only in the
explicitly superseded historical text. The operative plan has no false option or
acquireContext reference. The appended scope specifically supersedes those choices.
No contradictory operative false/true or preview instruction was found.

Request 1 is correctly named acquireServices -> identity.contextTransfer.preparePermit
-> adapter.bindContextResultTransfer -> adapter.executeHandoff -> fixedContextRequest
-> contextValidator.buildRequest -> shared post. The wrapper first acquires context
then services; it does not define acquireContext. Current adapter/buildRequest
hash/validation paths remain the evidence for C2, not claimed implementation.

C2 stays frozen: exactly five runtime files and five canonical immutable bindings,
adapter fifth, authorization sole lifecycle-policy owner, one fixed private
revocation-aware adapter fence after all phase-1 work and immediately before native
construction for requests 1/2/3. No public hook/sixth helper, context-only acquisition
downgrade, provider-boundary/document-builder edit or worker/package change is needed.
No new post-fence work is introduced by C1. Pending evaluators cannot bypass closed/
revoked graph checks once a terminal latch has actually occurred; RS1 is about
ensuring that latch is reached for a consumed synchronous interrupt.

The actual table has numbers 1 through 21, each exactly once. Rows 14 and 15 are
distinct source lines (546/547 at reviewed commit); 10/12/16 remain dispatch and 21
post-cleanup validity-only release. No conceptual transition was added. B1 canonical
C(R), strict parsing, private unseen/claimed/closed states, passive validation then
atomic claim before capability, collision/reference consistency, CLOSED first,
UTC marker/index retention, retained high-water/original monotonic deadline, 64
entries/16 KiB bounds and fresh review/authorization after restart remain unchanged.
No durable/global cross-process coordination is introduced.

Current SOURCE_HASHES has exactly twelve expected roles. Future thirteen are those
twelve plus host. Changed old values: wrapper, identity, HTTPS adapter (three).
Unchanged old: first-context wrapper, provider boundary, context review, introspection
preflight, project-token context, transport contract, introspection target/request/
plan (nine). Authorization self-hash is separate; policy digest is a document binding.
Authorization may pin host without reciprocal embedded authorization self hash;
no digest cycle or fourteenth source role. No hash values calculated here.

### Exact focused inventory verification

Counted the isolated inventory section, not filename mentions across the plan:
fourteen entries, fourteen unique paths, numbers 1..14 each once, exactly:

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
12. supabase/tests/0114j_lifecycle_authorization.test.cjs
13. supabase/tests/0114j_executable_owner_host.test.cjs
14. supabase/tests/0114j_native_dispatch_fence.test.cjs

Regression has nineteen paths with exact membership AND order unchanged from
a67e7db9417ed06f265772431e7826651044406a. Three future installed TypeScript checks
remain repository --noEmit, supabase/functions/tsconfig.json and worker tsconfig.
None run. Existing isolated fixtures substitute native transport/clocks/built-ins;
no production test injection is necessary. RC1/RC3 and the asynchronous RC2 claims
are testable; RS1 needs additional explicit synchronous-interrupt proof, not a new
suite or a live provider. Real graph/binding proof still needs genuine main children.

The 25-step construction/validation sequence remains coherent in dependency order:
private graph/adapter connector before final exports/sealing/enablement; runtime
REPL after enablement with handlers/options before yielding; claim before capability;
original session/context association before adapter final fence; pins after source
stabilizes, templates after pins; deterministic suites/typechecks/protected checks,
security gate and independent implementation review. It cannot be accepted until
RS1's terminal interruption path is specified/proven. No other sequence blocker found.

The future security gate is intact and now includes corrected EOF/Ctrl+C await,
preview, event reentrancy and revoked evaluator cases. Exact implementation commit/
base/diff, mandatory semantic review/fallback, Codex Security when available,
supplemental-only static scans, high/critical/invariant blockers, architectural
return-to-plan and re-review after changes remain required. No scan was run.
A later security gate cannot substitute for closing this known design blocker now.

Current input is v2/incomplete with false executable/live flags and lifecycle null.
Its v2 schema lacks lifecycleReview rather than carrying an executable activation
descriptor. Evidence remains incomplete/unauthorized. No package, lifecycle,
provider/Railway, live qualification, deployment or loopback authority is inferred.

## Disposition checklist

| Area | Review result |
| --- | --- |
| A Git boundary/delta | YES: exact HEAD/branch; only capsule initially; three-doc commit delta. |
| B Historical vs operative | YES: rejected values/label superseded; current plan unambiguous. |
| C RC1 EOF | YES for direct EOF notifications independent of paused REPL exit. |
| D First-cause exit policy | YES: cleanup failure cannot turn into clean success. |
| E RC2 native feasibility | NEEDS_CHANGE RS1; idle/multiline/await key branches passed, synchronous VM interruption lacks terminal bridge. |
| F Signal/key distinction | YES: separate test cases, no substitution claim. |
| G RC3 preview | YES: disabled automatic value preview/custom inspection; fixed completed writer. |
| H Trusted operator boundary | YES: no sandbox claim. |
| I Handler ownership | YES: one private latch/handler, no public shutdown capability. |
| J Pending evaluator | YES after latch; RS1 may prevent reaching the latch. |
| K Request-1 label/path | YES: actual acquireServices path. |
| L C2 freeze | YES: five files/bindings, private post-preparation fence unchanged. |
| M Twenty-one transitions | YES: distinct 1..21 including separate rows 14/15. |
| N B1 | YES: policy/admission/retention preserved. |
| O Pins | YES: 12 current, 13 future, three changed/nine unchanged, self separate, no cycle. |
| P Focused inventory | YES: exact fourteen paths/numbers, unique. |
| Q C1 testability | YES structurally; add RS1 cases after design correction; no production injection. |
| R Real PTY | Future acceptance gap N1, not supplied here. |
| S Security gate | YES: unchanged principle/authority separation; corrected C1 cases included. |
| T Package/authority | YES: current package/evidence untouched/null/false. |
| U Sequence | Dependencies sound; acceptance blocked by RS1. |
| V Overall | PLAN_CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_AUTHORIZATION. |

## Preservation, validation and next milestone

Only this new review artifact and readiness-register append change. Scope, plan,
failed/prior reviews, policy docs, runtime, tests, migrations and package/evidence
remain unchanged. Git whitespace checks pass, including the new artifact; protected
diffs and index diff empty. HEAD remains 5ae6caaf9ab121aa2799b97565eba900ba67ffbd.
Actual status is modified register, untracked review and pre-existing untracked
capsule. No staged A/M status is created because staging is forbidden.

No provider/Railway/external/loopback network, credentials, capsule, scanner,
plugin/dependency installation, runtime implementation, project tests/typechecks,
migrations, staging, commit or push. Only permitted local native-source inspection,
eight isolated offline Node probes and read-only Git/text checks ran; no temporary
probe files were created.

Exact next milestone: narrow C1 scope/plan correction for RS1 synchronous native VM
interrupt-to-terminal revocation, retaining the passed direct EOF and disabled
preview design and frozen C2/B1/inventories, then renewed critical review. Separate
implementation authorization may NOT yet be requested; implementation remains
unauthorized. Provider/live/package/lifecycle/deployment authority unchanged. No
execution, promotion, activation or implementation authority is granted here.
