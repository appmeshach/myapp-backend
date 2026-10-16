# 0114J qualification lifecycle implementation plan

STATUS: PLAN_COMPLETE_IMPLEMENTATION_NOT_AUTHORIZED

Starting HEAD: `493d53d1f90cd35bf6ee33bf6c7c41db1a4f5a12`

Branch: `feature/0092-shared-segment-suitability`

This document specifies a future patch for plan review. It implements nothing and
does not complete or promote the current input package. The renewed review closed
B1 by design, not by implemented enforcement or independent human approval.

## Historical correction after executable-owner scope review

correctionStartingHead: `a70b1824c3fd61ba4e86f06dfd4da5dc1725fdd5`

priorReviewOutcome: PLAN_CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_AUTHORIZATION

scopeReviewOutcome: SCOPE_APPROVED_ADD_SINGLE_OWNER_HOST

That earlier correction selected a dedicated main-only owner host, expanded the
then-proposed runtime scope 3 -> 4 and source-pin roles 12 -> 13, and specified a
two-phase validation/final pure-fence model. The renewed review found C1 console
lifetime and C2 actual native-dispatch ordering unresolved. This paragraph records
history; the current operative scope and lifecycle are the C1/C2 correction below.
The prior failed review and owner scope review remain unchanged historical evidence.

The earlier version had no verified acquisition launcher, incorrectly rooted its
guard in arbitrary require.main/children topology, and checked time before blocking
revalidation without a final fence. Those obsolete operative rules are replaced,
not treated as a supported fallback. This correction implements no runtime behavior.

## Current correction after approved C1/C2 scope review

c1c2CorrectionStartingHead: `89674362ac952ad991199a774c6084f194479e89`

c1c2ScopeOutcome: C1_C2_SCOPE_APPROVED

implementationAuthorized: false

providerAuthorized: false

separateImplementationAuthorizationMayBeRequested: false

Incorporate [approved C1/C2 scope](0114j-c1-c2-scope-review.md): plain-node genuine
main with a host-owned native REPL; exactly five future runtime files and five
immutable canonical bindings; adapter-local post-validation final pure fences for
all three native request constructions. Keep thirteen source-pin roles, with three
changed old values, one new host and nine unchanged old values; authorization self
hash stays separate. Focused suites become fourteen; regression remains nineteen.
The conceptual twenty-one sensitive transitions and reviewed lifecycle/B1 policy
are unchanged. Earlier command/four-file assumptions are superseded, not fallback.
This documentation correction requires renewed critical review before separate
implementation authorization may be requested. It supplies no implemented proof.

### Narrow C1 reconciliation after RC1/RC2/RC3 review

c1ReconciliationStartingHead: `a67e7db9417ed06f265772431e7826651044406a`

The [failed renewed review](0114j-c1-c2-security-gate-renewed-critical-review.md)
remains immutable evidence. Incorporate the appended C1 reconciliation in the
[scope artifact](0114j-c1-c2-scope-review.md): direct stdin end/close observation,
breakEvalOnSigint:true with host terminal SIGINT handling, and preview:false.
Correct the request-1 wrapper label to acquireServices. These resolve RC1/RC2/RC3
in the selected design only; renewed critical review and future real-child/TTY
acceptance are still required. C2, B1, five files/bindings, thirteen source-pin roles,
fourteen focused suites, nineteen regression paths, three TypeScript checks and
the future security gate remain unchanged. No implementation authority is supplied.

## Reviewed inputs and preserved policy

Inputs inspected: [corrected 0114I design](0114i-qualification-lifecycle-policy-design.md),
[renewed B1 review](0114i-qualification-lifecycle-policy-b1-renewed-review.md),
[historical review](0114i-qualification-lifecycle-policy-independent-review.md),
current/safe 0114E input JSON, 0114E procedure, 0114D wrapper description, reviewed
0114H design/implementation, readiness register, authorization/wrapper/identity/target
and HTTPS adapter sources, worker run.cjs/package.json, and directly relevant
0110-0114 tests/fixtures for naming and inventories. Reconcile the original plan
review, owner scope review, corrected-plan renewed review and approved C1/C2 review;
preserve those reviews and both 0114I policy records unchanged.

Preserve the reviewed active predicate, exact disposable/name/ID binding, reviewed
complete forbidden inventory, nullable instance expectation, separate source,
deployment, health and host gates, thirty-minute absolute lifetime, no renewal,
one session/context, three requests, both human gates and burn-before-validation.
No retry/fallback/resume/fork, automatic provider lookup, production authority or
permanent target consumption. Fresh attempts require fresh operator/independent
review and separate manual authorization. Human reference strings are not proof of
independence. The cross-process trusted-operator limitation remains unchanged.

## Exact future file scope

Exactly FIVE future production runtime files change. No sixth production runtime
file is permitted. No runtime file is changed by this document.

| File under scripts/assessment-worker/ | Planned responsibility |
| --- | --- |
| qualification-railway-acquisition-owner-host.cjs (NEW) | Plain-node main-only bootstrap; private seal/association; five immutable cache/exports bindings; host-owned native REPL, frozen operation facade and terminal revocation/cleanup. |
| qualification-railway-live-authorization.cjs | Strict v3 input/v1 activation intake; sole admission maps/clocks/fault state; original host association; private adapter-fence installation; pure fences/carrier/shutdown continuation; v4 cutover; new host pin, three changed old pins and separate self hash. |
| qualification-railway-acquisition-wrapper.cjs | Private redemption/setup handshake; carry original lifecycle obligation; boundary checks, timers, terminal notification and existing resource cleanup. |
| qualification-railway-target-identity.cjs | Retain private lifecycle check from original target permit; apply it to acquisition-session operations/validators; discard on terminal cleanup. Context-only behavior unchanged. |
| qualification-railway-https-adapter.cjs | Private original-graph session/context association; all phase-1 validation/hash/preparation before final pure fence and immediate native request construction for requests 1/2/3; fifth immutable binding. |

Explicitly preserve qualification-railway-introspection-target.cjs: its exact
disposable/active syntax, nullable instance and opaque binding need no change.
Provider boundary and query/document builders outside the five selected files stay
unchanged. Adapter source changes only within approved C2 linkage/dispatch ordering;
query/document bytes, credential ownership and three-request ceiling stay unchanged.
Native timeout remains 10000 ms; closing execution context cancels in-flight transport.

Also preserve scripts/assessment-worker/run.cjs and package.json. Assessment polling
is not the acquisition host. No package command, listener or custom CLI is added.

Planned test files, all under supabase/tests:

- Add `0114j_lifecycle_authorization.test.cjs`: strict schemas, admission, clocks,
  capacity, carrier failures and cutover matrix below.
- Add `0114j_executable_owner_host.test.cjs`: genuine child-process main bootstrap,
  native console lifetime/termination, five immutable bindings and duplicate/
  unsupported-host denial; includes required real TTY proof.
- Add `0114j_native_dispatch_fence.test.cjs`: all three real adapter validation/hash
  paths, final fence/native construction ordering and private association denial.
  These three new suites plus eleven existing suites make fourteen focused suites.
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
  five-module model and clock/fault-injection support. Genuine host behavior is additionally
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

Use the owner architecture as narrowed/corrected by
[approved C1/C2 scope](0114j-c1-c2-scope-review.md).
The ONLY supported executable acquisition bootstrap is:

`node scripts/assessment-worker/qualification-railway-acquisition-owner-host.cjs`

The named host must be the genuine CommonJS main Module on the main Node thread,
with require.main === module, canonical reviewed realpath and matching original
require.cache entry. This main requirement belongs to that named host, not arbitrary
callers. No module.children traversal is a security root. Real child-process tests
must prove this exact startup/console contract on the supported Node version; if it
fails, stop for review without a substitute launcher, preload or environment override.

Use plain node HOST with no custom host arguments or alternate console startup flag.
No package/run.cjs change, injected driver or alternate startup mode is permitted.

Bootstrap sequence:

1. Validate genuine host main/thread/Module/cache/realpath identity. Non-main import
   is inert: frozen availability information only, no bootstrap or credential read.
   Reject preloaded canonical authorization/wrapper/identity/adapter before linkage;
   never upgrade an already imported disabled graph.
2. Create one private nonserializable startup seal and host-validity closure. Expose
   one non-enumerable initialization-only connector for the original graph's
   synchronous initialization, never on globalThis/process.
3. Link canonical authorization/wrapper/identity/adapter. Authorization consumes the host
   connector, binds original authorization/wrapper/identity/adapter Module/exports identities,
   private host association and disabled enablement state. Host supplies seal/guard
   only to authorization's private install closure. Wrapper/identity receive association
   only through existing private authorization-owned links. Install the adapter's
   fixed private dispatch check and session/context association as specified below,
   while linkage remains disabled. Maps stay in authorization.
4. Complete cyclic evaluation and final exports assignments. Resolve exactly five canonical realpath/cache
   keys: host, authorization, wrapper, identity and HTTPS adapter. Verify each existing value is its
   captured original Module. Redefine each cache property with that original value,
   writable=false/configurable=false. Redefine each final Module.exports property
   non-writable/non-configurable and freeze its exported facade/object. Do not freeze
   full Modules/the cache or touch unrelated entries.
5. Verify all descriptors/identities, consume/delete every temporary connector and
   seal exports, then privately enable the one graph. Any link/descriptor/verification
   failure leaves acquisition disabled permanently in that process, including after
   partial pinning. No retry/reset/reinitialize/installer survives. Restart requires
   fresh review and manual authorization; partial immutable bindings are fail-closed.
6. Only after enablement create exactly one host-owned native REPL, configure its
   facade/termination policy before yielding input, and keep it available through
   its stdin handle. Console-start failure permanently revokes and closes the graph.

The host performs local linkage/console startup only: no token read, context opening, listener,
provider requests or automatic acquisition. Its frozen operation facade routes
explicit trusted-operator calls through the original graph and all existing gates;
it exposes no raw seal, maps or generic capability factory. Normal import cannot
later be publicly upgraded. Host association is necessary, never manual authorization.

A second complete authorization/wrapper/identity/adapter graph may create its OWN local
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
| Replacement wrapper/identity/adapter or stale connector | Cannot replace pinned bindings or enable another graph; rejected duplicates do not damage the original. |
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

### A1. Host-owned native console and bounded facade

After successful bootstrap/sealing/enablement, call exactly
`require('node:repl').start(options)`. The REPL is an interaction surface, not the
authority owner. Required options are input: process.stdin, output: process.stdout,
a fixed non-secret prompt, useGlobal: false, ignoreUndefined: true, useColors: false,
historySize: 0, native evaluation, a fixed non-inspecting writer and fixed empty
completer, breakEvalOnSigint: true and preview: false. Set terminal: true only when BOTH stdin and stdout are TTYs; otherwise
terminal: false. Do not call setupHistory, CLI/internal REPL bootstrap helpers or
implement NODE_REPL_EXTERNAL_MODULE/config/history autoload behavior. Disable native
`.load` and `.save` before yielding input. No custom protocol/eval engine is added.

Bind the same frozen bounded host operation facade to `server.context.movement`
as non-writable/non-configurable before yielding input. Native context reset and
`.clear` re-establish that SAME facade, never bootstrap/enable a second graph.
After terminal revocation the reset binding must deny/no-op, never rebind or enable
another facade/owner. Canonical imports cannot restore the disabled host latch.
Canonical require(host) returns the same frozen facade. Neither context nor facade
exposes host seal, admission maps, lifecycle carrier, adapter installer, initialization
connector, raw fence closure or generic capability/owner getter. The REPL's context
Module is not the genuine host main; host require.main equality remains mandatory.

preview:false disables native pre-Enter expression/string/error/object previews;
the empty completer alone is not this protection. Completed evaluation values and
errors still use the fixed writer, which returns only a constant marker: no
util.inspect, coercion, getter or custom inspector. Automatic preview must not invoke
custom inspection. Native evaluation and TTY line editing remain; no inspector
listener/socket or custom engine is introduced. Intentional display uses bounded
selected descriptive review fields. Native `_`/`_error` and command/source buffers
may retain values in memory; historySize=0 disables recall, not all memory retention.
No history file is opened; discard console references at shutdown. The facade never
returns credentials. Explicit operator console.log/util.inspect/stdout, require/import,
direct file I/O and environment/module access
can still reveal data. Arbitrary trusted-operator JavaScript remains inside the
existing trusted-process boundary; this is not a sandbox. Native lazy built-in
bindings and explicit require/import remain possible. Malicious mutation of Node
internals and pre-start injection are outside that boundary. No console operation
replaces separate reviews/manual authorization.

Support real TTY/native line input and redirected stdin in nonterminal mode. An open
stdin pipe/readline handle keeps the host available after bootstrap without an
artificial keepalive timer. Complete JS lines execute in native order, including
native multiline/await behavior, until `.exit`, EOF, signal or failure. Do not
promise that a batch pipeline immediately followed by EOF completes an acquisition.
EOF with incomplete input or a pending asynchronous operation cancels/revokes;
it never waits for successful acquisition or releases a pending result. Direct
stdin end/close observation below bypasses deferred native REPL exit during await.

### A2. Console termination and host shutdown

The host owns exactly ONE private idempotent terminal handler, never exported or
supplied by a caller. Register direct process.stdin end AND close listeners, input/
output stream error listeners, and process SIGINT/SIGTERM listeners before native
REPL creation/input processing can begin. Use direct prependListener observation
on stdin end/close so native REPL's own listener cannot be the sole notification
path. After REPL creation, before yielding input, also observe its close directly
(prependListener) and exit; both call the same handler. Do not wait for exit: native
REPL queues that event during top-level await. Check already-ended/closed input
after listener installation; treat readableEnded as EOF and destroyed/closed input
as terminal closure (or failure if a known error), never announce a ready console
or continue bootstrap after a terminal latch. Handlers tolerate a not-yet-assigned
server or shutdown continuation during bootstrap; failures leave enablement disabled.

Select breakEvalOnSigint:true. In Node v24 this permits the native Ctrl+C key path
through _ttyWrite while top-level await pauses other input. Remove the REPL's
default SIGINT listeners on this freshly created host-owned server and install only
the fixed host handler for REPL SIGINT before yielding input. Do not retain the
default prioritized-await interruption or double-press/clear/resume handler. No
custom key parser, evaluator, patched Node internal or second handler is added.
The delivered REPL SIGINT enters terminal revocation synchronously, including during
unresolved await. An independently delivered process SIGINT uses its own registered
event source and the SAME terminal handler. These are distinct acceptance cases.

The true option also enables Node's native VM SIGINT watchdog/break-on-interrupt
behavior and temporary raw-mode changes during synchronous evaluation; Node may
interrupt that evaluation rather than merely clear a line. Native await internals
can allocate an interruption race, but replacing the default REPL SIGINT listener
means the host terminates, rather than relying on that race to reject/resume await.
These native consequences are acceptable inside the trusted-operator process; no
claim is made that arbitrary JavaScript always can be synchronously cancelled.
Signal JS handlers still cannot promise hard real-time cleanup during an event-loop
stall. Authority protection is synchronous revocation on the first delivered host
terminal notification, with subsequent owner checks and result release denied.

First terminal source wins: set the private latch/cause and host revocation before
closing streams/console or invoking cleanup. No await or queued callback precedes
that latch. Direct EOF handling during unresolved await does not wait for REPL
unpause, evaluator success or timer expiry. End then close, later REPL close/exit,
signal-vs-EOF races and cleanup-induced events cannot re-enter cleanup, change cause,
re-enable authority or repeat shutdown. Ignore later notifications after the first
latch; no later signal upgrades a clean EOF cause. The only exit-code escalation
is cleanup failure as specified below.

| Event | Required terminal behavior and exit code |
| --- | --- |
| Direct stdin end/close, or clean REPL close/exit including `.exit` | First latch revokes, closes all claimed graphs/resources and suppresses pending result; exit 0 only after clean cleanup. A known stream error is failure, not clean EOF. |
| REPL SIGINT / TTY Ctrl+C or process SIGINT | One delivered interrupt terminates with cleanup; exit 130. |
| SIGTERM | Terminal cleanup; exit 143. |
| Bootstrap/stream/cleanup failure | Fail closed; nonzero, normally 1 unless signal code applies; no usable console on bootstrap failure. |

Exact authority-reducing order:

1. Latch first terminal cause and host revocation, with no re-entry.
2. Disable further acquisition authority.
3. Close/disable REPL input without waiting for native exit/unpause; the latched
   handler ignores any induced close/exit/end events.
4. Invoke authorization-owned fixed private shutdown continuation captured at bootstrap.
5. Authorization marks each claimed graph CLOSED before resource cleanup, including
   pre-ticket drafts and issued-ticket graphs; retain UTC marker/high-water rules.
6. Close carrier/wrapper resources.
7. Destroy in-flight transport.
8. Burn outstanding gates/tickets/permits.
9. Clear owned timers.
10. Drop private console/session/context associations.
11. Release NO result.
12. Terminate the dedicated host process, preventing residual handles/promises from
    keeping it alive.

Already terminal entries never reopen. Lifecycle validity is not required to reduce
authority. Cleanup uses the existing synchronous close/stop contract; do not rely
on asynchronous process exit handlers. On cleanup exception keep revocation latched,
release no result, never retry/resume, and exit nonzero: escalate a clean cause's
0 to 1, retain 130/143 for an already-latched signal, and retain failure code 1.
Later equivalent/error/signal events do not otherwise alter the first cause or code.
Repeated signals are idempotent. SIGKILL or trusted explicit process.exit() cannot promise graceful
cleanup: process death is terminal under existing crash/no-replay semantics.

A pending native evaluator is NOT an authority owner. After the latch, every
original graph observes permanent host revocation, and authorization closes its
claimed entries before cleanup. Any evaluator continuation that runs is ordinary
doomed JavaScript in the terminating process: it cannot mint draft/ticket/permit,
publish an acquisition result, restore enablement, rebind a second movement facade,
reopen acquisition transport or run cleanup twice. Do not promise generic JavaScript
cancellation; it is acceptable for the process to exit before evaluator completion
once revocation/closure occurred synchronously. No pending/late success release is
permitted, including after a cleanup exception. Explicit malicious trusted-process
mutation remains outside the existing threat model.

### A3. Private adapter installation and immutable ownership

Authorization remains sole owner of lifecycle clocks, high-water/fault latch,
claim/closed/revocation state, deadline and pure lifecycle semantics. Identity owns
original session/stage association; adapter owns transport context/attempt state.
Host owns association/enablement, not another admission table.

Add ONE adapter initialization-only private connector within the selected adapter
file. During original synchronous graph initialization authorization captures/
consumes it, installs exactly one fixed pure dispatch-check closure over its own
state and obtains the adapter's original fixed private session/context association
continuation. Route that continuation through the existing private authorization-to-
identity setup link; associate acquisition S/C only from the original identity
permit/session path and original lifecycle obligation. No public transfer record or
return value contains the carrier/check/associator. No public setter/getter/callback/
hook, clock injection, environment option, fence object or lifecycle carrier.

Install disabled linkage first. Only the genuine host's later private enablement
after five-module sealing permits acquisition dispatch. Consume/delete the temporary
connector and freeze final exports synchronously before completed ordinary require
returns. Inert imports may finish disabled context-only linkage; they cannot later
upgrade. No replacement/reinstallation after bootstrap, shutdown reset or hot reload.

Host captures canonical realpaths, exact cache Module identities and final exports
for host, authorization, wrapper, identity and adapter. Authorization verifies its
linked adapter is that original host-captured Module/exports, and installation is
associated with original private host startup, not adapter self-attestation. Finish
cycles/final exports first; seal all five cache and Module.exports properties
non-writable/non-configurable, freeze final exports, remove connectors and verify
all descriptors/identities before enablement. Never freeze full Modules/cache.
Any preloaded canonical adapter or other executable graph module denies bootstrap.

Copied adapter/full graph lacks original seal/association and cannot obtain the
original closure or dispatch an original acquisition session. Canonical require
returns the pinned original; deletion/reassignment fails. Duplicate initialization
cannot replace/reinstall its closure. Rejection must not close or damage the
legitimate original graph/session. Shutdown never unpins/resets adapter ownership;
the retained fixed closure observes permanently revoked state while per-session
associations are dropped. Test all cyclic import/partial-failure cases in isolation.

Classify acquisition versus context-only provenance privately before dispatch;
no caller Boolean selects bypass. Acquisition context/session cannot be downgraded
by direct executeHandoff or omitted transfer. Missing acquisition association fails
closed. Separate context-only 0113 behavior remains unable to continue into services/
instance; public adapter imports cannot mint acquisition authority.

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
| 10 | Request 1 adapter-local final pure fence AFTER all phase-1 validation/hash/preparation, immediately before native request construction | Claimed original graph |
| 11 | Accepting response 1/context observation into identity state | Claimed original graph |
| 12 | Request 2 adapter-local final pure fence AFTER all phase-1 validation/hash/preparation, immediately before native request construction | Claimed original graph |
| 13 | Accepting response 2/ProjectServices observation | Claimed original graph |
| 14 | Issuing human service gate 1 | Claimed original graph |
| 15 | Accepting human gate 1 submission | Claimed original graph |
| 16 | Request 3 adapter-local final pure fence AFTER all phase-1 validation/hash/preparation, immediately before native request construction | Claimed original graph |
| 17 | Accepting response 3/ServiceInstance observation | Claimed original graph |
| 18 | Issuing human target gate 2 | Claimed original graph |
| 19 | Accepting human gate 2 submission | Claimed original graph |
| 20 | Successful descriptive result construction/private publication after semantic checks | Claimed original graph |
| 21 | Returning success AFTER terminal cleanup succeeds | Validity-only original completed graph |

Also fence human prompt retrieval/other authority publication, not just submissions.
Wrapper/identity checks before adapter entry are preliminary lifecycle/authority
checks and phase-1 preparation, NOT the final wire-boundary fence. Actual dispatch
fences for rows 10/12/16 occur inside the adapter as specified below. This replaces
three fence realizations while preserving EXACTLY 21 conceptual sensitive
transitions; it does not create 24. Additional check invocations do not change that
conceptual model. All burns/acceptances/human gates and result fences remain intact.
If implementation needs more than the five selected runtime files, stop for review.

### C.1. All-three-request adapter-local native dispatch

Current source paths establish the work that must precede the final native fence:

| Request | Adapter validation path |
| --- | --- |
| 1 ProjectTokenContext | Wrapper acquireServices -> identity.contextTransfer.preparePermit -> adapter.bindContextResultTransfer -> adapter.executeHandoff -> fixedContextRequest -> contextValidator.buildRequest -> adapter shared post. executeHandoff also consumes reviews.takeAdapterHandoff, checks kind/attestation/transfer/handoff and requireOwner(...).contextTransfer.assertSlot. buildRequest hashes the fixed context document. acquireServices is the actual function name; context acquisition is its first phase before ProjectServices. |
| 2 ProjectServices | executeProjectServices -> assertServicesAttempt -> requireServicesOwner -> fixedProjectServicesRequest -> exact request/document/variables validation and hash(query + LF) -> dispatch bookkeeping -> shared post. |
| 3 ServiceInstance | executeServiceInstance -> assertInstanceAttempt -> requireInstanceOwner -> fixedServiceInstanceRequest -> exact validation/hash and describeTarget -> dispatch bookkeeping -> shared post. |

Request 1 uses executeHandoff, not the request-2/3 helpers, and MUST receive the same
acquisition-owned final fence. Existing post sets cancel/timeout, checks diagnostics
then creates https.request; it currently serializes at req.end after construction.
All those preparation operations belong before the new fence. Response-side
assert...Attempt revalidation is separate, not pre-dispatch freshness proof.

Adapter phase 1 completes ALL request/document hashing, exact request validation,
owner/session/attempt/stage checks, diagnostics, bookkeeping, bounded body
serialization, cancellation/timeout setup, fixed plain-data native options/secret
header and response callback preparation. Resolve original private lifecycle/session
association and expected operation/stage here. Preserve query/document bytes,
credential ownership, headers/body semantics, timeout and total ceiling of three;
no new request/retry/redirect/fallback. Capture trusted native request function and
prepared plain arguments with no caller getter/hook.

Inside shared post's synchronous try/Promise executor, success is:

ALL adapter-local phase-1 work -> fixed private PURE lifecycle fence -> immediate
native https.request construction using prepared options/callback.

Between successful fence and native construction: NO hashing, serialization, file
operation, realpath/stat, dynamic require, await, timer creation, validation,
diagnostics, caller getter/callback, option creation or policy work. The fixed
private fence samples trusted UTC/monotonic clocks, updates/observes high-water and
fault latch under reviewed rules, and validates captured original graph/session/
deadline/stage/revocation state. It performs no blocking work or cleanup callback.
Failure creates zero NEW native requests; the outer terminal path marks closed,
cleans cancel/timer state and invalidates transport normally. Success constructs
exactly one native request in the same synchronous turn, attaches handlers and
sends the already serialized body. Freshness is at native construction, not a
hard real-time wire-delivery guarantee inside Node's networking implementation.

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

1. Start only the named main host via the exact plain-node command. Complete
   private five-module linkage/adapter association and five immutable cache/exports
   bindings before enablement, then explicitly start/configure the native REPL.
   Bootstrap/console startup performs no claim, token read, context open or request.
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
11. Prepare request 1 Movement0108ProjectTokenContext in original session/context;
    adapter finishes all phase-1 work, final pure fence, immediate native construction.
    On response, finish validation then fence before identity observation. Prepare
    request 2 Movement0111ProjectServices; adapter phase 1, final pure fence, native
    construction. Wrapper/identity entry checks are preliminary, not final dispatch.
12. Validate response 2 then fence before ProjectServices observation; exact machine
    name/ID checks remain mandatory. Fence before issuing gate 1 and before accepting
    its validated submission. Earlier lifecycle/transport/human deadline wins.
13. After gate 1, prepare request 3 Movement0111ServiceInstance in the same C/S;
    adapter completes phase 1, final pure fence and immediate native construction.
    Validate response then fence before instance
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
authorization SOURCE_HASHES/approved identities; update wrapper, target-identity
and HTTPS adapter pins. Authorization's own source/self hash changes SEPARATELY,
outside the thirteen. Arithmetic: 12 existing roles + 1 new host = 13; THREE changed
old values + NINE unchanged old values = 12. Four pinned values are new/different
including host; with authorization self-hash, five runtime-source identities change.
Authorization self-hash is not a fourteenth source-pin role.

The nine unchanged old pin values are first-context wrapper, provider boundary,
context review, introspection preflight, project-token context, transport contract,
introspection target, introspection request and introspection plan. These names map
to the existing qualification-railway-*.cjs roles in SOURCE_HASHES. Do not
remove/replace a safety pin or hide host identity as a doc/fixture
hash. Historical twelve-pin evidence remains immutable twelve-pin evidence.
Use the existing UTF-8 CRLF-to-LF-only source rule. Compute new values only after the
future implementation stabilizes, not now. Existing BASELINE_PARENT_HEAD remains
historical, never substituted for reviewed current HEAD.

Authorization may pin host source while host imports/links authorization: imports
alone create no digest cycle. Host must not embed authorization's generated self
hash in a reciprocal digest requirement. The compiled policy digest remains a
document binding, not another runtime source-pin role. No source hash is calculated
in this documentation correction; historical twelve-pin evidence stays immutable.

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
private pools only inside fixtures. Exact case count follows required matrix
coverage, including C1/C2 additions; do not preserve an earlier estimate as a cap
or pad tests to a numeric target.

| Category | Cases and expected evidence |
| --- | --- |
| Schema (~30) | Missing/extra/duplicate root/nested keys; invalid versions/descriptor/record/path/size; same operator/reviewer; timestamp syntax/round-trip/order; wrong active/scope; digest/subject/policy/reference mismatch; false/missing acknowledgements; untouched current package rejected before claim/credential/context/request. |
| Admission (~20) | First claim only; two drafts before ticket and after claim; copied path/format/key order/wrapper; restored package; changed/conflicting attemptReference; wrong subject; simulated equal digest/unequal C(R); fresh reviewed record succeeds; invalid duplicate never kills first; entry state never capability. |
| Capacity (~8) | 64 claimed, 64 closed, mixed occupancy, 65th rejected; 16384/16385 raw/canonical byte boundaries; reference caps; expiry frees capacity; zero eviction of unexpired closed/claimed entries and indexes. |
| Timing (~20) | reviewedAt equality; exact expiresAt rejection; near-expiry start; separate UTC/mono advances; forward/backward jumps; invalid readings; delayed/early callbacks; high-water survives empty maps; cleanup then rollback replay; min lifecycle/transport/human/wrapper deadlines and no late result. |
| Closure (~35) | Cancel pre-ticket, post-ticket/pre-redemption; manual rejection; injected exceptions after insertion, timer/review/ticket creation, redemption/transfer, before handle/context, after context; request 1/2/3 errors; response after expiry; gate 1/2 rejection/timeouts; owner-handled crash; success; explicit revoke; abandoned draft, ticket and active run expiry; close throwing; repeated close and stale submit. |
| Owner host (genuine children plus fixtures) | Exact plain-node startup and require.main === module/main-thread/cache/realpath identities; native REPL readiness/lifetime/evaluation/termination; zero bootstrap credential/network activity; same facade through context reset; all five sealed cache/Module.exports bindings; copied/reloaded five-file graph, replacements and stale connectors denied without damaging original; node -e/ESM-main/VM/worker inertness; early failure cannot retry; no public seal/maps/carrier/getter/reset/installer. |
| Native dispatch (dedicated suite) | Each request's actual adapter validation/hash/preparation before final pure fence and immediate fake native construction; withheld timers, UTC/mono expiry, rollback/invalid samples; duplicate/preload/reinstall/bypass denial and original session preservation, as detailed below. |
| R2 blocking work (~25) | With timers deliberately withheld, advance UTC/mono during Git before claim, evidence/hash before ticket, host/cache/realpath checks before claim/context, context checks before open, validation before requests 1/2/3, each response validation, gate 1/2 validation and cleanup before return. Rollback/nonfinite/overflow and monotonic expiry reject at final fence. Assert zero next claim/authority/credential/request/observation/human acceptance/result as applicable. |
| Pins | Exactly thirteen roles including new host; twelve old roles retained, wrapper/identity/adapter values change, nine old values unchanged; authorization self hash separate; no digest cycle; inert identities regenerate only during authorized implementation; historical evidence byte-identical. |
| Cutover/preservation (~20) | v3 executable/v2 input cannot bypass; 0113 cannot continue; same session/context, successful count exactly 3 and failures <=3; both gates; nullable instance; exact service ID/name; no historical/default/alias fallback; genuine ticket/permit burns on invalid arity/expiry/binding; credential reads only after guards; all global flags false/null; no retry/fallback/resume/fork; no permanent target consumption. |

Keep existing success/negative coverage in the eleven relevant suites; add current
v4 integration there rather than duplicating all assertions in the new suites.
Historical suites test their archived contract; new suites never claim real target
identity from synthetic success.

Owner-host proof must include REAL Node child processes running the exact main
command, not only VM emulation. Keep synthetic fixtures/fake native transport/clock
substitutions wholly test-local; no production host/token/clock/driver injection.
Bootstrap synthetic tests perform no real credential/provider/network operation.
Withheld-timer R2 cases are mandatory even if ordinary timeout tests already pass.

### C1 real-child host/console acceptance

`0114j_executable_owner_host.test.cjs` owns exact plain-node command execution;
genuine main/thread/cache identity; five sealed bindings; ready console; open pipe
persistence and later harmless command execution; native multiline/await order;
EOF, `.exit`, trailing input, incomplete input and pending-await termination;
process SIGINT/SIGTERM and repeated signal idempotence with specified exit codes.
Prove bootstrap/link/seal/console-start failures leave no usable console or retry.
Trap credential reads and native network constructors: startup counts both zero.

RC1 acceptance must observe direct stdin end/close with an unresolved top-level
await and a live resource stand-in; prove revocation/closure without REPL exit,
unpause or evaluator completion. Cover normal EOF, end then close, close then later
REPL exit, incomplete input + EOF, already-ended/closed input, signal-vs-EOF races,
cleanup-induced event reentrancy and first-cause exit-code policy. Cleanup occurs
once; a late pending evaluator cannot publish success or restore acquisition
authority. Keep open-pipe persistence/later evaluation proof as a separate case.

RC2 acceptance must prove ONE real TTY Ctrl+C at idle, multiline input and unresolved
top-level await, each reaching the private terminal handler with exit 130 after
cleanup. Test process SIGINT separately, plus SIGTERM and repeated/racing notifications.
No second-press requirement, native clear-and-resume or surviving authority. Verify
breakEvalOnSigint:true and replacement of the default REPL SIGINT handling; do not
equate synthetic key-path proof with actual OS/raw-mode behavior. Document native
synchronous-evaluation interrupt effects without claiming universal cancellation.

RC3 acceptance must prove preview:false: typing object, string and error variables
without Enter causes no value preview; an object's custom-inspection sentinel is
never invoked automatically. Completed value/error rendering still uses only the
constant non-inspecting writer, with no custom-inspection call. Explicit trusted
console.log/util.inspect remains outside the automatic-output guarantee. No inspector
listener/socket, new dependency or replacement REPL is permitted.

Test usable synthetic facade, private seal/maps/carrier/connectors/fence/installer
absence, `.clear` binding the same facade and no second host domain. Terminate with
pre-ticket draft, issued ticket, in-flight request, gate 1 and gate 2 waits; prove
mark-first closure, transport cancellation, no rearm, pending/late result suppression
and cleanup-failure fail-closed exit. Verify automatic output cannot invoke
util.inspect/custom inspection or leak sentinel secrets; no history file/autoload,
`.load`/`.save` disabled. Console import/copy/reload of five-file graphs cannot gain
another authority; original graph remains usable after rejected duplicate attempts.

REAL TTY/pseudoterminal proof is required, including native line input and single
Ctrl+C cleanup in all three cases above. Synthetic terminal:true streams establish
local Node branches only and are NOT final TTY acceptance. A pipe is not TTY proof.
No dependency/install is authorized; if the
future validation environment lacks a PTY facility, stop acceptance and record the
gap until real TTY proof is available. VM fixtures alone cannot satisfy C1.

### C2 dedicated native-dispatch acceptance

`0114j_native_dispatch_fence.test.cjs` uses the real adapter through isolated test
loaders, substituted clocks/timers/crypto and fake native request objects only;
no socket/provider/external network or production injection switch. For EACH of
requests 1/2/3 require:

- Deliberately withhold lifecycle/transport timer callbacks. Cross UTC expiry during
  actual adapter validation/hash; zero NEW native requests. Earlier cumulative
  requests remain 1 before request 2 or 2 before request 3.
- Independently cross monotonic expiry or UTC rollback, or inject invalid clock
  readings during phase 1, including diagnostics/options/body preparation; deny
  construction and preserve fault latching.
- Trace last hash/validation -> final pure fence -> native construction as next
  sensitive operation; no getter/hook/hash/validation or other forbidden work between.
- Valid state constructs exactly one native request; fixed document/header/body/
  timeout semantics and total <=3 preserved, with both human gates and late-result denial.
- Copied adapter/full graph cannot obtain original fence/association; public imports
  cannot mint authority. Rejected duplicates do not damage original adapter/session.
- Preloaded adapter denies host bootstrap; canonical re-require returns original;
  closure reinstall/replacement impossible.
- Request 1 direct executeHandoff/omitted-transfer cannot bypass association/fence;
  context-only 0113 remains non-continuable into services/instance.

Host suite owns five-binding/preload child proof; lifecycle suite owns admission,
clock/carrier/terminal integration; dedicated suite owns actual adapter ordering.
Existing transport/wrapper suites retain earlier burn/response/count coverage with
current private-linkage fixtures. Test-only 0114j-module-domain.cjs models five
modules; no sixth production helper.

Exact focused inventory is FOURTEEN suites (eleven existing, three new):

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
12. `supabase/tests/0114j_lifecycle_authorization.test.cjs` (NEW)
13. `supabase/tests/0114j_executable_owner_host.test.cjs` (NEW)
14. `supabase/tests/0114j_native_dispatch_fence.test.cjs` (NEW)

The nineteen-file regression below is unchanged. The new host proof already runs
in the focused child-process suite; no additional repository-level process suite
is needed in that established list. Both focused and regression runs are required.

## Implementation sequence and acceptance gates

After this plan passes review AND separate implementation authorization is supplied:

The following is a construction/validation order for a future authorized patch,
not permission to execute it now. Establish console lifecycle code in step 4, but
its runtime creation remains strictly AFTER step 10 enablement under section A.
No intermediate unfinished graph may be used for acquisition.

1. Capture protected-file/migration hashes without capsule access.
2. Add owner-host source and test-local scaffolding within exactly five runtime files.
3. Establish exact plain-node genuine-main bootstrap on the main thread.
4. Establish host-owned native REPL lifecycle, facade and required child/TTY proof.
5. Establish private five-module linkage with disabled enablement.
6. Install original private adapter dispatch-check/session-context association.
7. Finish cyclic evaluation and finalize exports.
8. Pin/seal all five canonical cache/Module.exports bindings; freeze final exports.
9. Remove temporary connectors and verify descriptors/identities.
10. Enable the one original graph only after successful verification; runtime REPL
    creation/configuration then follows, before yielding input.
11. Gate createExecutableAcquisitionDraft before claim/capability publication.
12. Implement strict lifecycle schemas, admission maps and pre-run carrier.
13. Implement wrapper/identity private setup linkage and cleanup obligation.
14. Implement all phase-1/final-pure fences, especially adapter-local validation/hash/
    preparation -> final fence -> native construction for requests 1/2/3.
15. Implement terminal host cleanup/revocation and specified exit behavior.
16. Implement expiry/high-water/fault latch, UTC-only marker retention/removal and
    post-cleanup validity-only result release. Preserve target/run/package bytes,
    fixed request semantics and reviewed policy.
17. Migrate synthetic fixtures to input v3/executable v4, preserving archived modes.
18. Add host pin; change wrapper/identity/adapter pins; nine old values unchanged;
    authorization self-hash separate. Exactly thirteen roles, no digest cycle.
19. Regenerate inert templates/implementation evidence without actual package promotion.
20. Run all fourteen exact focused suites with node --test --test-concurrency=1,
    including real child/TTY host proof and dedicated native-dispatch ordering tests.
21. Run the established nineteen-file serialized regression, with separately authorized
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

22. Use installed local TypeScript only: node node_modules/typescript/bin/tsc --noEmit;
    the same binary with --project supabase/functions/tsconfig.json; and with --project
    scripts/assessment-worker/tsconfig.json. No npm/npx install or network fallback.
23. Validate protected comparisons/diffs and pin accounting. Require all fourteen
    focused suites pass, real TTY proof complete, zero failures in full regression with only existing
    documented OS skips, all three typechecks pass, git diff --check clean, exactly
    thirteen correct source pins plus separate self hash, protected comparisons clean,
    no migration diff, no current-package promotion, no historical rewrite and no
    capsule/credential/provider/external-network access. Verify legacy/extra-request tests.
24. After deterministic focused/regression/typecheck validation and protected diff/pin
    checks pass, complete the dedicated adversarial security acceptance gate below
    against the exact implementation commit/diff and repository context. Run Codex
    Security against that commit/PR when available; otherwise use the required
    adversarial-review fallback. Retain findings and resolve all blocking findings.
25. Complete independent implementation review before claiming implementation accepted.
    Implementation completion itself still grants no provider/live/package authority.

Validation constraint: the established regression includes loopback HTTP test servers.
This planning task authorizes no network/tests. A later implementation milestone
must explicitly permit loopback-only regression coverage; external/provider network
remains forbidden. If its authorization retains absolute zero network, stop at that
validation boundary and report regression not completed; do not silently skip tests,
claim acceptance, or infer permission from older milestones.

### Dedicated adversarial implementation-security acceptance gate

This is a FUTURE acceptance requirement, after an implementation exists and after
all fourteen focused suites, the unchanged nineteen-file regression with separately
authorized loopback, three installed TypeScript checks and protected diff/pin checks
pass. It supplements every existing gate and precedes independent implementation
review/final acceptance. No security review or scanner is executed by this
documentation amendment, and implementation remains unauthorized.

Review the exact implementation commit and its exact diff against the reviewed
base, using repository context and the approved plan/invariants. Record commit/base
identities, PR reference when applicable, review scope/workflow, findings, severity,
disposition, remediation and any explicitly reviewed residual risk as security
evidence. Acceptance must refer to the implementation actually reviewed; subsequent
implementation changes require review of the changed commit/diff and confirmation
that the security evidence and deterministic validation still apply.

The dedicated semantic adversarial review must cover at least:

1. Owner-host acquisition-authority bypass.
2. Copied/reloaded/preloaded five-module graph authority.
3. require.cache / Module.exports immutable-binding bypass.
4. REPL facade exposure or accidental private-capability leakage.
5. Native REPL reset/.clear creating another authority path.
6. REPL output/custom-inspection secret leakage.
7. Stale ticket/permit/review-capability reuse.
8. Lifecycle expiry/rollback/high-water bypass.
9. TOCTOU between validation and each sensitive transition.
10. Adapter request-1/request-2/request-3 final native-dispatch fence bypass.
11. Caller-supplied/public lifecycle hook introduction.
12. Acquisition/context-only downgrade or provenance confusion.
13. Cancellation/EOF/SIGINT/SIGTERM cleanup leaving reusable authority.
14. Cleanup failure/result-release race.
15. Source-pin/self-hash identity bypass or incorrect pin accounting.
16. Credential/environment exposure.
17. Retry/fallback/fourth-request introduction.
18. Package/lifecycle activation or promotion-authorization bypass.
19. Any path creating executable acquisition authority outside the reviewed original
    graph.

Within those existing threat categories, explicitly review EOF during unresolved
await, single TTY Ctrl+C during unresolved await, native preview/custom inspection,
terminal-event reentrancy and pending evaluator continuations after authority
revocation. These are required C1 cases, not a new suite or a changed security gate.

If Codex Security is available for the repository/account at that future milestone,
run it against the exact reviewed implementation commit/PR and retain its findings
as security evidence. Product availability is not the sole acceptance condition,
and a clean scan does not replace the dedicated semantic adversarial review or
deterministic tests. If unavailable, the gate still requires dedicated adversarial
security review using the strongest available Codex/security-review workflow on the
exact implementation diff and repository context. Record that fallback and its
findings; unavailability does not waive the gate.

Conventional static/security tooling, including repository CodeQL or dependency
scanning, may supplement evidence only when already available/authorized. Such
scans do not replace semantic review or deterministic tests. This documentation
task installs, enables, configures or purchases no product and authorizes no
scanner execution, plugin installation or network access.

Acceptance MUST STOP for any unresolved critical/high severity issue, acquisition-
authority bypass, lifecycle freshness bypass, credential exposure, native-dispatch
fence bypass, reusable stale capability, duplicate owner-domain path, package/
promotion authorization bypass, or any security finding contradicting a reviewed
invariant regardless of severity label. Lower-severity findings must be triaged
and recorded; accepting residual risk requires explicit review, never silent
dismissal. Architectural findings return work to plan/scope review; the implementation
agent must not improvise an architectural change. Resolve blocking findings and
review the resulting exact implementation before acceptance can proceed.

A clean security scan/review grants NO provider/Railway access, package promotion,
lifecycle activation, deployment or live qualification authority. Those remain
separate authorization milestones. It also does not waive independent implementation
review or any existing validation requirement.

## Recovery, remaining review items and authority limits

On failure, close owned authority and retain assertion markers; fix code through a
new reviewed patch, never retry the existing graph. A process restart loses volatile
markers and requires fresh operator/reviewer admission and manual authorization.
Rollback must leave executable acquisition disabled, not re-enable unguarded v3.
No provider configuration rollback/deployment/teardown is part of this patch.

No reviewed-policy change or durable coordination is needed. This plan needs its
renewed critical review, particularly plain-node native console/termination,
five-module linkage/immutable bindings, private adapter association and all-three-
request final native fence, thirteen-role pins and fourteen focused suites.
No architectural choices are deferred to the coding agent; the plan's
implementation permission and loopback validation permission remain pending.
No implementation or test/typecheck validation action is executed
now; current package remains lifecycle=null, evidence and historical reviews unchanged.

Stop and report PLAN_SCOPE_CONFLICT rather than improvise if correction or future
implementation requires more than five runtime files/five bindings/thirteen source
roles, package.json or run.cjs edits, a public adapter fence callback, network
listener/custom service, a schema-version change beyond planned v3/v4 (activation
v1 unchanged), lifecycle/B1 redesign, durable coordination/database, changed
regression membership or an architectural choice not resolved by approved C1/C2 scope.

Current real package remains byte-identical v2/incomplete, lifecycleReview/lifecycle
null and executable flags false. No actual lifecycle activation record is created.
Safe templates change only during separately authorized implementation, not now.

This documentation change does NOT authorize runtime/test/template implementation,
tests/typechecks, provider/Railway access, external network or loopback, package
completion/promotion, lifecycle activation, deployment/restart/configuration,
0114D preparation, staging/commit/push, credentials/secrets or capsule access.
Exact next milestone: renewed critical review of this C1/C2-corrected implementation
plan. Only if that review passes may a separate implementation-authorization
milestone be requested. implementationAuthorized=false; providerAuthorized=false.

## Plan review checklist

Renewed reviewer must answer YES/NO/NEEDS_CHANGE for each item below; these are
review prompts, not a self-issued passing review:

- Exact five-file runtime scope and no sixth file; protected run.cjs/package.json,
  target/provider boundary/document builders and all protected reviews unchanged.
- Exact plain-node main command; genuine main/thread/cache/realpath identity.
- Host-owned native node:repl created only after linkage/sealing/verification/enablement.
- Deterministic redirected-stdin persistence/evaluation; direct stdin end/close
  observation before input processing, independent of deferred REPL exit during await.
- Real TTY/pseudoterminal proof mandatory; missing PTY stops acceptance.
- EOF/.exit/SIGINT/SIGTERM cleanup, specified exit codes, repeated-signal idempotence
  and fail-closed bootstrap/stream/cleanup failure; first cause wins, reentrancy denied,
  clean 0 escalates only for cleanup failure, signal codes retained.
- breakEvalOnSigint:true; default REPL SIGINT listener replaced by fixed host terminal
  handler; idle/multiline/unresolved-await real TTY Ctrl+C distinct from process SIGINT.
- preview:false and fixed non-inspecting writer; no pre-Enter object/string/error
  preview, automatic custom inspection or completed-value/error rendering leak.
- Pending evaluator is no authority owner; post-revocation continuations cannot mint,
  reopen, re-enable, rebind another facade, publish a result or repeat cleanup.
- No REPL history file/recall, setupHistory/autoload or .load/.save convenience path.
- Fixed frozen movement facade, reset rebinds same facade; raw seal/maps/carrier/
  installer/connector/fence/generic owner-capability getters excluded.
- Arbitrary operator JS stays within trusted process; no sandbox claim.
- Five immutable cache/Module.exports bindings verified before enablement; adapter
  included in original host association; no full Module/cache freeze.
- Preloaded adapter fails closed; disabled graph never upgrades; duplicate rejection
  preserves original graph; no closure replacement/reinstall or shutdown ownership reset.
- Request 1 executeHandoff/context builder hash path covered by final adapter fence.
- Request 2 ProjectServices validation/hash path covered by final adapter fence.
- Request 3 ServiceInstance validation/hash/describeTarget covered by final adapter fence.
- All adapter phase-1 work complete before fence, including diagnostics, serialization,
  options/secret header/callback, cancel/timer and association preparation.
- Immediate native request construction after successful fixed private pure fence;
  no hash/validation/getter/hook/other forbidden work between; failure means no NEW request.
- Exactly 21 conceptual transitions; rows 10/12/16 realized adapter-locally, preliminary
  wrapper/identity checks not mislabeled as final wire fence.
- Private pre-handle carrier; atomic claim before capabilities; burn-before-validation;
  strict schemas/subject hashing and 64-entry/16-KiB limits unchanged.
- High-water/monotonic ordering, all terminal closure, UTC-only marker removal,
  rollback protection and #21 post-cleanup validity-only release preserved.
- Strict v3 input/v4 executable cutover; no acquisition downgrade via context-only path;
  both human gates, same session/context, exact fixed transport semantics/three requests.
- Thirteen source-pin roles; host new; THREE changed old values (wrapper, identity,
  adapter); NINE unchanged old values; authorization self-hash separate.
- Historical twelve-pin evidence immutable; policy digest separate; no digest cycle.
- Fourteen exact focused suites, including dedicated native-dispatch suite and real
  child/TTY host suite; test-local substitutions only, no production injection.
- Nineteen regression paths unchanged; loopback still requires separate authorization.
- Three installed TypeScript checks and independent implementation review required
  in future authorized validation; no install/network fallback.
- Dedicated adversarial implementation-security acceptance gate after deterministic
  validation and protected diff/pin checks, before independent review/acceptance.
- Exact implementation commit/base/diff and repository context reviewed; security
  evidence identifies the actual reviewed implementation and later changes.
- Semantic authority/lifecycle/TOCTOU/native-dispatch threats, including all nineteen
  listed attack categories, covered explicitly; include corrected EOF/Ctrl+C during
  await, preview/custom inspection, terminal reentrancy and revoked evaluator behavior.
- Codex Security used against exact commit/PR when available; unavailable product
  triggers dedicated strongest-available adversarial review, never waiver or sole proof.
- Static/CodeQL/dependency scans supplemental only, already available/authorized;
  no substitute for semantic review or deterministic tests.
- Unresolved high/critical or invariant-breaking findings block acceptance; listed
  authority/freshness/credential/dispatch/stale-capability/duplicate-domain/package
  bypasses block regardless of severity; lower findings triaged and residual risk
  explicitly reviewed.
- Architectural security findings return to plan/scope review; no agent improvisation.
- Security approval grants no provider/live/package-promotion/lifecycle-activation/
  deployment authority and does not waive independent implementation review.
- Current package/evidence unchanged, lifecycle null, no real activation record;
  future templates inert and unmodified now.
- Implementation remains unauthorized; renewed review required before separate
  implementation authorization may be requested.

No implementation, tests/typechecks, provider/Railway/external/loopback network,
package promotion, activation, deployment/restart/configuration, staging/commit/push
or capsule access is authorized by this plan correction.
