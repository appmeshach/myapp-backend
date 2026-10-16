# 0114J C1/C2 narrow scope review

outcome: C1_C2_SCOPE_APPROVED

startingHead: `2905ec01b54ecd300891c82615e6bbf8a26d8f25`

branch: `feature/0092-shared-segment-suitability`

C1: C1_NATIVE_REPL_HOST_LIFECYCLE_APPROVED

C2: C2_ADAPTER_FIFTH_RUNTIME_FILE_APPROVED

implementationAuthorized: false

providerAuthorized: false

separateImplementationAuthorizationMayBeRequested: false

This approves a future scope for plan correction. It establishes the required
architecture and acceptance contract, not implemented or tested host behavior.
This is a Codex review, not independent human approval. The corrected plan and all
earlier reviews remain unchanged historical records. Current package lifecycle
remains null. No source hashes were calculated.

## Evidence and blockers

Inspected the implementation plan, corrected-plan renewed review, executable-owner
scope review, original plan review, corrected 0114I design and renewed B1 review;
the readiness register; worker package/entry; authorization, wrapper, identity and
HTTPS adapter; relevant 0110-0114 tests and fixture loaders. Existing real imports,
VM transport fixtures, import-order children and synthetic request counts are useful
precedents, not proof of the future host or post-hash native fence.

The [renewed review](0114j-qualification-lifecycle-corrected-plan-renewed-review.md)
records C1: `node --interactive HOST` ran genuine CommonJS main but failed to evaluate
queued operator commands with redirected stdin. C2: unchanged adapter validation
and hashing followed the wrapper-side purported final dispatch fence.

Offline inspection in this review used installed Node v24.13.1 and its embedded
`repl`, `internal/main/repl`, `internal/readline/interface` and
`internal/repl/history` sources. `repl.start(options)` explicitly constructs a
REPLServer; its readline close emits `exit`; native `.exit` calls `close()`.
The CLI-only `internal/main/repl` separately handles NODE_REPL_EXTERNAL_MODULE and
CLI history initialization. Those are not needed to start an API-owned console.
The embedded source also shows context reset, default SIGINT double-press behavior,
result/error writer use, file `.load`/`.save`, and zero-size history behavior.
No behavior probe or project test was run here. No app module was executed/imported
by Node, and no temporary probe file was created. No external documentation/network
was accessed; no Expo or other runtime code is being written.

## C1 options and selected lifecycle

| Option | Scope decision |
| --- | --- |
| A: host-owned native REPL | Select. Explicit stdin ownership establishes persistence and evaluation using built-in Node machinery in the already trusted operator process. |
| B: finite stdin driver | Reject. Package/review/acknowledgement/opaque-handle operations would need command syntax, handle storage and error/ordering rules. That is additional protocol design without a demonstrated safety benefit here. |
| C: another local lifecycle | Reject. No narrower established interaction mechanism was found; no GUI, listener, service, plugin or launcher change is needed. |

Exact future command, from the reviewed worktree:

`node scripts/assessment-worker/qualification-railway-acquisition-owner-host.cjs`

Remove `--interactive`; do not retain it as a supported alternate. No custom host
arguments, preload, eval launcher, package script or run.cjs change. The host stays
the genuine cached CommonJS main, on the main thread, with `require.main === module`.
The REPL's own context Module is not the host main and need not equal it.

Required future lifecycle:

1. Validate canonical main/thread/realpath/Module identity and reject inert preloads
   of any of the five executable graph modules. Link the original private graph,
   finish exports, install the adapter association, seal five cache/exports bindings,
   remove all initialization connectors and verify immutable identities. Enable the
   graph only after these succeed. No input admission, credential read, context open
   or provider request occurs during this work.
2. The host explicitly calls built-in `require('node:repl').start(options)` once
   after successful enablement. It owns the resulting REPLServer and its shutdown
   handler privately. Use `input: process.stdin`, `output: process.stdout`, a fixed
   non-secret prompt, `useGlobal: false`, `ignoreUndefined: true`, `useColors: false`,
   `historySize: 0`, native evaluation and a fixed non-inspecting writer. Set
   `terminal` true only when both input and output are TTYs; otherwise false.
   Use a fixed empty completer to avoid filesystem/module completion discovery.
   Do not call setupHistory or CLI/internal REPL creation/history helpers.
3. Before yielding to stdin, bind the same frozen bounded host operation facade to
   a non-writable, non-configurable `movement` property on `server.context`.
   Reapply that binding on native context `reset` (including `.clear`); reset never
   bootstraps or enables another graph. Exporting/requiring the canonical host returns
   the same frozen facade. Neither context nor facade contains the seal, admission
   maps, installer, lifecycle carrier or a generic owner/capability getter.
4. The resumed stdin/readline handle keeps the process available after bootstrap;
   there is no artificial keepalive interval. Operator JavaScript is evaluated by
   the native REPL only after the complete bootstrap/configuration turn. Pending
   bootstrap failure must close any partially created console and permanently disable
   the graph. No failure path opens a usable console or retries initialization.
5. Install one private idempotent terminal handler for console `exit`, stream errors,
   process SIGINT and SIGTERM, and the REPL SIGINT event. Replace the REPL's default
   SIGINT listener so a single delivered Ctrl+C terminates rather than clearing input
   or waiting for a second press. Select `breakEvalOnSigint: false`: this is a
   termination policy, not native expression-interrupt-and-resume. No new eval engine
   or signal-driven continuation is introduced.

TTY input is supported with native line editing, a fixed prompt, no history and
the single-Ctrl+C terminal policy. Redirected stdin is also supported in nonterminal
mode: complete JavaScript lines are evaluated in native order, with native
multiline/await behavior, until `.exit`, EOF, signal or failure. Keeping the pipe
open keeps the console alive. This is trusted local input, not a batch transaction
or unattended acquisition command. EOF with incomplete input or an outstanding
asynchronous operation cancels the graph; it does not wait for acquisition success.
Do not promise that a pipeline followed immediately by EOF completes an acquisition.

EOF and `.exit` both run terminal cleanup, including when stdin closes during a
pending await/request or a human wait. SIGINT terminates with exit code 130; SIGTERM
uses 143. Clean EOF/`.exit` uses 0. Bootstrap/stream/cleanup failure uses a nonzero
failure code (1 unless a signal code already applies). All paths first latch host
revocation, disable authority and close the console/input, then ask authorization's
privately captured fixed shutdown continuation to close every claimed graph,
including pre-ticket drafts. Authorization marks each CLOSED before invoking its
existing carrier/wrapper resource cleanup; preserve UTC retention and high-water
rules. Destroy in-flight transport, burn gates/permits, clear owned timers and drop
private console references. No result is released by termination. Already terminal
entries never reopen. Shutdown needs no valid lifecycle to reduce authority.

Cleanup is synchronous under the existing close/stop contract; after it, terminate
the dedicated host process so residual promises/handles cannot keep it alive. On a
cleanup exception, keep the revocation latch set and exit nonzero, with no resume,
retry or success publication. Do not depend on async work in process `exit` handlers.
A second signal cannot reopen or repeat authority. JS signal handling cannot give
hard real-time cleanup while the event loop is blocked, nor can SIGKILL/process.exit
typed by the trusted operator promise cleanup. Such abrupt death is terminal under
the existing crash policy; no automatic restart/replay is authorized.

### Output, history and trust boundary

The fixed writer must return only a constant status marker for automatic value and
error display, without util.inspect, coercion, getters or custom inspection. Thus
typing a result expression cannot accidentally dump its contents via the default
writer. Use bounded, intentionally selected descriptive review fields for explicit
operator display; the facade never returns credentials or private cleanup state.
Explicit console.log/process.stdout writes and typed environment/module access can
still reveal data: arbitrary trusted-operator JavaScript is inside the existing
trusted-process boundary. This is not a JavaScript sandbox, and possession of the
facade is never manual acquisition approval.

Disable `.load` and `.save` on this REPL before yielding to input, so built-in file
script loading and session transcript writing are not accidental convenience paths.
No history file is opened, setupHistory is never invoked, and historySize=0 disables
recall. Native REPL command/source buffers and `_`/`_error` may still retain values
in memory during the session; do not claim that disabling history erases memory.
Discard them with the console at shutdown. No credentials should be pasted into
the console. No external module/config/history autoload is added; do not consult
NODE_REPL_EXTERNAL_MODULE or CLI REPL history settings. Native lazy built-in bindings
and explicit trusted require/import remain possible, as does deliberate JS file I/O.
No public API option makes this a sandbox. Node startup/preload/loader integrity
remains trusted; host code cannot undo arbitrary code already executed before main.

Only the original host graph owns acquisition authority. The native REPL's separate
JS context and deliberately passed facade do not create a second owner domain.
Ordinary canonical import/reload returns the pinned original facade; copies/VMs/
workers cannot get a seal. Deliberate mutation of Node internals by the trusted
operator after startup remains outside the threat model.

### Required future C1 child-process proof

Owned by `supabase/tests/0114j_executable_owner_host.test.cjs`:

- Launch the exact plain-node command; verify genuine cached main/main-thread identity
  and require.main equality in the host, five sealed bindings and a ready console.
- Keep redirected stdin open after readiness; show the child remains alive and a
  later harmless command executes. Check native multiline/await ordering. Then test
  EOF, `.exit`, trailing input after termination, incomplete input and pending await.
- Exercise real TTY/pseudoterminal line input and Ctrl+C on the supported Node/OS;
  prove signal cleanup and no double-press/resume. A pipe is not TTY proof. No new
  dependency/install is authorized: if the implementation environment lacks a PTY
  facility, record that acceptance gap and stop acceptance until real TTY proof.
- Test process SIGINT with open pipe, SIGTERM and repeated signals, idle and during
  supported asynchronous operations; check specified exit codes and cleanup once.
- Inject bootstrap/link/seal/console-start failures in child-isolated test loaders;
  no usable console, credential read or native request. Partial sealing stays disabled.
- Trap credential reads and native network constructors at startup; both counts zero.
  Verify facade usability with synthetic review inputs and fake transport only.
- Enumerate facade/context/export descriptors: no raw seal, maps, carrier or surviving
  connector. Check `.clear` keeps the same operation facade; no new host domain.
- Cover EOF/exit/signal with pre-ticket draft, issued ticket, in-flight request and
  both human waits: all become terminal, requests cancel, late results are suppressed,
  markers cannot rearm, and cleanup exceptions fail closed.
- Check automatic result/error output never inspects sentinel secrets/custom inspectors;
  history and external-module/config autoload perform no file/module startup action.
- Attempt canonical delete/replace/reload and copied complete five-file graphs from
  the console; original graph remains usable after rejected duplicates.

These are future real-child acceptance requirements, not tests run in this review.

## C2 actual adapter path and selected scope

Evidence locations in `scripts/assessment-worker/qualification-railway-https-adapter.cjs`:

| Request | Current validation path before shared post |
| --- | --- |
| 1: ProjectTokenContext | Wrapper acquireContext -> bindContextResultTransfer -> executeHandoff. executeHandoff takes reviews.takeAdapterHandoff; checks kind/attestation and transfer/handoff; calls fixedContextRequest then requireOwner(e.owner).contextTransfer.assertSlot(e.slot); calls post(record, invocation.request). |
| 2: ProjectServices | executeProjectServices burns binding, calls assertServicesAttempt -> requireServicesOwner -> fixedProjectServicesRequest -> plainKeys, exact document/variables, hash(query + LF). It updates dispatch bookkeeping then calls post(e.record, e.request). |
| 3: ServiceInstance | executeServiceInstance burns binding, calls assertInstanceAttempt -> requireInstanceOwner -> fixedServiceInstanceRequest -> plainKeys, exact document/variables, hash(query + LF), targets.describeTarget. It updates bookkeeping then calls post(e.record, e.request). |

Request 1 does not use executeProjectServices/assertServicesAttempt. Its
fixedContextRequest JSON-compares with contextValidator.buildRequest(), which
hashes the fixed document in qualification-railway-project-token-context.cjs.
Thus it too performs adapter-invoked query hashing before dispatch.

Shared `post` enters a synchronous Promise executor, creates stop/cancellation state,
installs record.cancel and a timeout, then calls requireQuietDiagnostics() inside
try, followed by `https.request`. The diagnostics check is the last explicit current
validation before native creation, after the operation-specific checks. The current
request expression also constructs options/headers and reads record.secret there.
`req.end(JSON.stringify(request))` currently serializes after native creation.
Post-response assert...Attempt repeats remain response validation, not pre-dispatch
proof. All this ordering must be considered; a wrapper-entry fence alone is inadequate.

| Candidate | Decision |
| --- | --- |
| A: fifth changed runtime file, private adapter fence | Select. Shared post can put the fixed original-graph fence after all phase-1 work and immediately before native construction, covering all three call sites. |
| B: four files with adapter unchanged | Reject. Public execute functions necessarily run the above internal validation/hash and post diagnostics after wrapper entry; no existing split validate/dispatch operation or private post entry is exported. Earlier duplicate validation cannot eliminate that later work. |
| C: another minimal solution | Reject. Wrapping/patching https.request globally changes unrelated transport/loader trust; an outer callback cannot prove post-validation ordering. No sixth file or public hook is justified. |

### Exact future five-file runtime scope

All under `scripts/assessment-worker/`:

1. `qualification-railway-acquisition-owner-host.cjs` (new).
2. `qualification-railway-live-authorization.cjs` (changed).
3. `qualification-railway-acquisition-wrapper.cjs` (changed).
4. `qualification-railway-target-identity.cjs` (changed).
5. `qualification-railway-https-adapter.cjs` (changed).

No sixth production file. Preserve package.json, run.cjs, introspection target,
provider boundary, context document builder and all query/document bytes. No token
ownership, schema/version, policy, request ceiling, retry/fallback or durable-state
change is selected.

### Private ownership, initialization and duplicate behavior

Authorization owns the pure lifecycle state, captured clocks, high-water/fault latch,
claim/closed/revocation state and original deadline. Identity retains original
session/stage association; adapter retains transport context/attempt state. Host owns
the original association/enablement latch, not another admission table.

Select ONE new adapter initialization-only connector, following the existing
synchronous temporary-link pattern, within the adapter file. Authorization is the
installer. During original graph initialization it captures that connector, installs
one fixed dispatch-check closure over its own state, and receives the adapter's
fixed private session/context association continuation. Route that continuation
through the existing private authorization-to-identity setup link. Only identity's
original acquisition-permit/session path can use it to associate the original S/C
with its original lifecycle obligation. No public transfer record or return value
may contain the carrier/check closure or associator. No runtime caller supplies a
callback, clock, fence, issuer or replacement continuation.

The connector is provisional initialization plumbing, never an API available after
ordinary require returns. Consume/delete it and freeze final exports synchronously.
It installs disabled original linkage first: only the main host's later private
enablement, after all five identities are sealed, permits acquisition dispatch.
An inert ordinary import may finish disabled linkage for context-only uses; it cannot
later upgrade itself. A failed/spent installation never reinstalls or resets.

The host must reject any preloaded adapter (also other executable owner modules)
before enabling its graph. It captures canonical realpath/cache Module and final
exports identities for all five; authorization verifies the adapter it links is that
same captured original instance. Its install closure is associated with the private
host startup, not an adapter-supplied claim of identity. Finish cyclic module
evaluation/final exports before tightening descriptors. No connector escapes a
completed import; all import orders/partial-cycle failures require future proof.

Expand the immutable canonical binding set FOUR -> FIVE: host + authorization +
wrapper + identity + adapter. For each, the canonical require.cache property and
original Module.exports property become non-writable/non-configurable and the
final exports object is frozen. Verify all before private enablement. Do not freeze
the entire cache/Modules or add a public owner registry. Adapter becomes host-associated
before enablement. No descriptor/hash/source validation runs inside the final fence.

A copied adapter/graph has no original association and cannot bind or dispatch an
original acquisition session, even if its bytes match. Reject before native creation;
do not close or steal the legitimate original graph on a rejected duplicate attempt.
Canonical deletion/reassignment fails; canonical require returns the same original.
Copied initialization cannot replace/reinstall the original closure. On shutdown
the closure may remain captured by pinned code but observes permanently revoked
state; drop per-session/context association with existing terminal cleanup. No
unpinning, hot reload, shutdown reset or second owner domain is allowed.

Preserve separate context-only 0113/legacy transport behavior. Classify and bind
acquisition versus context-only provenance privately before dispatch; no caller
Boolean selects fence bypass. An acquisition-owned context or original session
cannot be downgraded to the ordinary executeHandoff path by omitting a transfer or
calling another public adapter export. Missing association on an acquisition path
fails closed. The unchanged context-only path gains no services/instance authority.

### Required final native boundary

For requests 1, 2 and 3, prepare in phase 1: all request/document hashing and exact
validation, owner/session/attempt checks, bookkeeping, diagnostics, bounded body
serialization, cancellation/timeout setup, fixed plain-data options including secret
header, and response callback. Resolve the privately associated original graph and
expected operation/stage here. Keep the actual native request function and prepared
plain arguments captured from trusted initialization/private state, without getters.

Inside post's synchronous try/executor, the success sequence is then:

ALL phase-1 work -> fixed private PURE lifecycle fence -> immediate native request
construction with the prepared options/callback.

There is no filesystem I/O, hash, serialization, await, dynamic require, validation,
timer setup, caller getter/hook or option construction between the successful fence
and native call. The only call at the fence is the fixed privately installed pure
check, not a caller callback. It samples trusted clocks and checks captured original
graph/session/deadline/stage/revocation state; high-water update/fault latching follow
the reviewed rules. No cleanup callback is invoked inside it. Failure throws/denies
before construction; the outer failure path performs normal mark-first closure,
clears timer/cancel state and invalidates transport. A valid path constructs exactly
one native request, then attaches handlers and sends the already serialized fixed
body. No extra request, retry, redirect or fallback is added. Fence validity is at
native construction in the same synchronous turn, not a claim of hard real-time
wire delivery inside the Node networking implementation.

This is the required realization for request 1 executeHandoff as well as request 2
executeProjectServices and request 3 executeServiceInstance. A missing request-1
association/fence is an implementation acceptance failure.

## Pin arithmetic and R2 consequences

Current SOURCE_HASHES has TWELVE roles: wrapper, first-context wrapper, adapter,
identity, provider boundary, context review, introspection preflight, project-token
context, transport contract, introspection target, introspection request and
introspection plan. Authorization self-hash is already separate.

Future arithmetic: 12 old roles + 1 new host = 13 source-pin roles. Of the old twelve,
THREE pin values change (wrapper, identity, adapter) and NINE remain unchanged
(first-context wrapper, provider boundary, context review, introspection preflight,
project-token context, transport contract, introspection target, introspection
request, introspection plan). There are FOUR new/different source-pin values when
the new host is included. Authorization's changed self-hash is separate, making
five changed/new runtime-source identities overall, not fourteen source-pin roles.
No digest is calculated here. Preserve historical twelve-pin evidence unchanged.
The compiled policy document digest remains a document binding, not another source
role. No fourteenth role is necessary; needing one would stop for broader review.

Keep the conceptual TWENTY-ONE sensitive transitions. Rows 10/12/16 must identify
the adapter-local final pure fence after hashing/validation, immediately before
native construction. Existing wrapper/identity pre-adapter checks remain preliminary
authority/state checks and phase-1 preparation; they cannot be described as the
final wire boundary. This replaces the realization of three existing dispatch
transitions, not adding three new transitions to make twenty-four. There may be more
check invocations than conceptual rows; the plan already separately requires prompt
retrieval checks. All other fences, especially post-cleanup validity-only result
release (#21), remain required unchanged.

## Future test inventory and C2 proof

Select a dedicated adapter-fence suite: real adapter post/hash/native ordering is
distinct from authorization admission and host child-process lifecycle. Do not hide
these assertions behind a mocked wrapper execute method. Exact focused count is
FOURTEEN (eleven existing, three new), with paths:

1. `supabase/tests/0110_railway_first_live_preflight.test.cjs`
2. `supabase/tests/0111_railway_target_identity.test.cjs`
3. `supabase/tests/0112_context_result_transfer.test.cjs`
4. `supabase/tests/0113_first_context_wrapper.test.cjs`
5. `supabase/tests/0114a_service_review_authorization_foundation.test.cjs`
6. `supabase/tests/0114b_project_services_transport.test.cjs`
7. `supabase/tests/0114c_service_instance_transport.test.cjs`
8. `supabase/tests/0114d_acquisition_wrapper.test.cjs`
9. `supabase/tests/0114e_acquisition_input_review.test.cjs`
10. `supabase/tests/0114f_target_metadata_evidence.test.cjs`
11. `supabase/tests/0114h_service_name_compatibility.test.cjs`
12. `supabase/tests/0114j_lifecycle_authorization.test.cjs` (new in plan).
13. `supabase/tests/0114j_executable_owner_host.test.cjs` (new in plan).
14. `supabase/tests/0114j_native_dispatch_fence.test.cjs` (additional new suite).

Host suite owns C1 and five immutable bindings/duplicate/preload child proof.
Lifecycle suite owns state/clock/carrier admission and terminal integration.
New native-dispatch suite owns all three real adapter validation -> fence -> native
construction paths using isolated test loaders, fake clocks/timers/crypto and a fake
native https.request object; it never binds a socket. Existing 0112, 0114b/c/d and
their fixtures need current linkage/provenance integration, preserving their earlier
burn/order/response/ceiling cases. The already planned test-only
`supabase/tests/fixtures/0114j-module-domain.cjs` can model five-module linkage and
built-in substitution. No extra production helper or test-only production switch.

Required dedicated C2 cases:

- For EACH request, withhold lifecycle/transport timer callbacks; advance UTC to
  expiry during its actual adapter-invoked validation/hash and require zero NEW
  native requests. At request 2/3 the earlier cumulative count remains 1/2, rather
  than pretending the entire acquisition made zero requests.
- Independently inject monotonic expiry and UTC rollback during each phase-1 path,
  including diagnostics/options/body preparation; reject before native construction.
  Invalid clock samples also deny; retained fault latches remain authoritative.
- Trace the last document hash/validation, final clock/fence and fake native
  construction; every hash/phase-1 check precedes the final fence and native is next.
  Detect any hash/validation/getter/hook between the successful fence and construction.
- For valid time/state create exactly one fake native request per dispatch and
  preserve fixed documents, headers, body, timeout and total acquisition <=3 requests.
  Keep both human gates; test pending cancellation and late response rejection.
- Missing/wrong acquisition association, public import/forged records, copied adapter
  and copied complete graph cannot obtain/use the original fence. No caller callback
  is accepted. Rejected duplicate attempts leave the original adapter/session usable.
- Preloaded adapter causes host bootstrap denial; normal canonical re-require cannot
  reload it. Closure replacement/reinstall is impossible after initialization.
- Preserve context-only behavior without permitting acquisition downgrade/bypass;
  check request 1 cannot evade its fence via direct executeHandoff/omitted transfer.

The regression inventory stays NINETEEN with the exact unchanged nineteen paths in
the plan's acceptance gate 13. There is no new unrelated regression owner; the new
suite belongs to focused acceptance. Its fake constructor needs no loopback or
provider access. Existing broader loopback regression still needs separate future
authorization. No suites/typechecks run in this scope review.

## Plan correction, authority and validation

Exact next milestone: a documentation-only C1/C2 correction of the 0114J
implementation plan incorporating this plain-node, host-owned native REPL lifecycle;
five runtime files/five immutable bindings; private all-three-request post-validation
adapter fence; 13-role pin arithmetic (3 changed old, 1 new, 9 unchanged, separate
self-hash); fourteen focused suites and unchanged nineteen regression paths;
then renewed critical review of that corrected plan. Implementation authorization
may be requested only after that review passes, and remains separate from provider
or package/lifecycle authority. This task does not perform the plan correction.

No stop condition was encountered: no package/run change, listener/custom service,
sixth runtime file, public lifecycle hook, fourteenth source role, schema/policy/B1
change or durable coordination is required. Approval concerns scope only; required
child/adapter acceptance proofs remain future work.

Only this scope artifact and the readiness register are written. Runtime/tests,
all three protected plan/review files, current package, qualification evidence and
migrations remain unchanged. No credentials/secrets/environment file/capsule access,
Railway/provider, external/loopback network, staging, commit or push occurred.
The pre-existing untracked `0102-remote-fixtures.capsule` remains unread/untouched.

Validation: `git diff --check` passed. Requested protected-path diffs are empty;
index diff is empty. HEAD remains the starting HEAD. Final short status contains
the modified readiness register, this untracked scope artifact and the pre-existing
untracked capsule only. No implementation, execution, input promotion, target
eligibility, independent human approval or live authority is granted.

## Narrow C1 reconciliation after RC1/RC2/RC3 renewed review

reconciliationStartingHead: `a67e7db9417ed06f265772431e7826651044406a`

reconciliationOutcome: C1_RECONCILED_RENEWED_CRITICAL_REVIEW_REQUIRED

implementationAuthorized: false

providerAuthorized: false

The [failed renewed review](0114j-c1-c2-security-gate-renewed-critical-review.md)
found actual Node-native lifetime/output defects in the original C1 assumptions.
The original decision above is preserved as historical evidence. THIS appended
section supersedes it only for EOF notification, breakEvalOnSigint/interrupt
arrangement, automatic preview and N2 request-1 naming. In particular, its earlier
breakEvalOnSigint:false choice and console-exit-only EOF assumption are historical/
rejected, not supported operative alternatives. C1 still selects one host-owned
native REPL with the same plain-node command and trusted-operator boundary.

### RC1: direct input termination and first-latch shutdown

The host owns ONE private idempotent terminal handler with multiple fixed event
sources. Before REPL creation/input processing register direct process.stdin end
AND close observation using prependListener, input/output stream errors and process
SIGINT/SIGTERM. After REPL creation, before yielding input, directly observe REPL
close (prependListener), REPL exit and REPL SIGINT. Bootstrap/console failures use
the same terminal latch; absent server/shutdown links must be handled fail-closed.
Observe/check already-ended or closed stdin after installing listeners so it cannot
leave a ready console or enablement alive. Known stream errors are failures, not
clean EOF. No public/caller-supplied terminal callback or generic shutdown export.

The direct input notifications do not depend on native REPL exit, which is deferred
while top-level await is paused. On the FIRST delivered terminal notification,
synchronously latch cause and host revocation, disable authority, then close/disable
input and invoke authorization's fixed shutdown continuation. Mark every claimed
graph CLOSED before resource cleanup; destroy transport, burn tickets/permits/human
gates, clear timers, suppress pending/late results, drop private console/session
associations and terminate the dedicated host. No await, evaluator completion,
native unpause, timer expiry or async process-exit handler is required for revocation.
Immediate means within delivery of that notification, not hard real-time interruption
of a blocked JavaScript event loop.

End then close, later REPL exit, signal-vs-EOF and cleanup-induced events cannot
re-enter cleanup. First cause wins and no later notification changes it. Clean
EOF/close/.exit exits 0 only after successful cleanup; first SIGINT uses 130,
SIGTERM 143, failure 1. Cleanup failure alone escalates clean 0 to 1, preserving an
already-latched 130/143 or failure 1. No later signal upgrades an EOF cause. There
is no authority restoration, reset/retry or success publication on cleanup failure.

Pending native evaluation is NOT another authority owner. Its continuation may
remain ordinary doomed JS in the terminating trusted process, but all original
authority checks observe permanent revocation. It cannot mint draft/ticket/permit,
publish an acquisition result, restore enablement, rebind a second movement facade,
reopen acquisition transport or repeat cleanup. Process exit before evaluator
completion is acceptable after synchronous revocation/closure. No promise of
magically cancelling all JS; abrupt process death remains under the existing policy.

### RC2: native interrupt mode and replacement SIGINT listener

Select breakEvalOnSigint:true. Installed Node v24.13.1 source shows that this allows
the native _ttyWrite Ctrl+C exception to the pending-await key buffer. On the fresh
host-owned REPL, remove its default SIGINT listeners and install only the fixed
host terminal SIGINT handler before yielding input. This avoids default double-press,
clear/resume and prioritized-await interrupt/resume behavior. Native Ctrl+C enters
terminal revocation at idle, multiline input and unresolved await; process SIGINT
is independently observed and uses that SAME handler. Clean signal cleanup exits 130.
No custom TTY parser, evaluator, Node-internal patch or listener service is introduced.

The true option also enables Node's VM interrupt watchdog/break-on-SIGINT and
temporary raw-mode changes during synchronous evaluation. Native JS evaluation can
be interrupted; it is not guaranteed that arbitrary JS can always be cancelled or
that an event-loop stall delivers a host callback in real time. Native await internals
may create an interrupt race, but the replaced REPL listener terminates the host,
not resumes acquisition or relies on that race to reject an outstanding promise.
These are accepted native consequences within the existing trusted-operator model;
the security guarantee is revocation at the first delivered host terminal source,
with no subsequent authority/result path. Future acceptance must distinguish real
TTY key delivery/raw mode from independently delivered process SIGINT.

### RC3: explicitly disable native preview

Select preview:false in addition to the constant non-inspecting writer and empty
completer. Node's native preview setup returns inactive operations for this choice;
typing pre-Enter expression/string/error/object values must not preview them or
invoke custom inspection. Completed values/errors still use the fixed constant
writer without util.inspect, coercion, getters or custom inspectors. Preserve
native evaluation/line editing, historySize:0, useGlobal:false, ignoreUndefined:true,
useColors:false, both-TTY terminal selection, process.stdin/stdout, no setupHistory,
and disabled .load/.save. No inspector listener/socket or custom engine is added.
Explicit trusted console.log/util.inspect, require/import and file/environment I/O
remain within the trusted process; the REPL is not a sandbox.

### Offline evidence, future proof and unchanged boundaries

Read the installed Node v24.13.1 embedded REPL/preview source and ran five isolated
built-in-only child probes with empty child environments, no project imports, no
temp files, sockets, credentials or network. Direct stdin EOF during unresolved
await entered the first-latch handler, revoked and cleaned once, exiting 0. Native
terminal:true key-path probes at idle, multiline and unresolved await each delivered
one Ctrl+C to the replacement handler and exited 130, cleanup once. Cleanup-induced/
recursive terminal notifications were ignored. preview:false probe typed a custom-
inspection object variable without Enter: inspection calls 0, no sentinel output,
writer calls 0; after Enter inspection calls stayed 0, writer calls became 1 and
only the constant rendered value marker appeared. These are local feasibility
observations, not production implementation, project tests or real PTY acceptance.

Future owner-host suite must cover direct EOF during unresolved await/incomplete
input, end/close/REPL-exit ordering, already-ended input, event reentrancy and late
result denial; real idle/multiline/await Ctrl+C separately from process SIGINT;
and pre-Enter object/string/error/custom-inspection sentinels plus completed fixed
writer behavior. Real TTY/PTY proof remains mandatory; synthetic terminal:true
streams do not satisfy it. Acceptance stops if a facility is unavailable; no
dependency/install is authorized. Future security review includes these cases and
pending evaluator behavior after revocation without adding a new suite.

N2 correction: actual request 1 starts in wrapper acquireServices, whose first
phase is context acquisition: identity.contextTransfer.preparePermit ->
adapter.bindContextResultTransfer -> adapter.executeHandoff -> fixedContextRequest
-> contextValidator.buildRequest -> adapter post. The earlier acquireContext label
above is historical phase shorthand, not the current function name. C2's selected
private all-three-request native fence and context-only downgrade prohibition do
not change.

Exactly five runtime files, five immutable bindings, 21 conceptual transitions,
13 source-pin roles (three changed old/nine unchanged, auth self separate), fourteen
focused suites, nineteen unchanged regression paths and three installed TypeScript
checks remain frozen. B1, schemas, package/evidence preservation and the dedicated
future security gate remain unchanged in principle. No sixth file, public hook,
second authority owner, runtime/package/worker/dependency/provider change or other
stop condition is required. No source hashes calculated. Only this scope append,
operative plan correction and readiness append are changed in this milestone.
Implementation remains unauthorized and current lifecycle remains null. The exact
next milestone is renewed critical review of reconciled C1 scope and plan; separate
implementation authorization may not yet be requested. The failed review and all
other prior reviews/policy docs remain unchanged; no staging/commit/push authority.
