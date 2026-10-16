# 0114J separate implementation-authorization review

reviewerReference: Codex-0114J-implementation-authorization-review

startingHead: `58e4ebc031e9e138232e1ab970e13f122ec1b667`

reviewedBranch: `feature/0092-shared-segment-suitability`

outcome: IMPLEMENTATION_AUTHORIZED_FOR_FROZEN_0114J_SCOPE

blockerCount: 0

implementationAuthorized: true

providerAuthorized: false

This review authorizes a future implementation task only within the frozen 0114J
runtime, test, validation and evidence boundaries below. It grants no Railway,
provider, live, production, deployment, migration, package-promotion, activation,
credential, staging, commit or push authority.

This is a same-author Codex authorization review. It is not independent human
approval. Independent implementation review remains mandatory after implementation,
deterministic validation, real-signal/PTY acceptance and the semantic security gate.

## Repository boundary

The review began at the exact required HEAD and branch. The index and tracked tree
were clean. The only status entry was the pre-existing untracked
`0102-remote-fixtures.capsule`, which remained unread. Relative to
`3b5a9a3526e1e0ac595f001df90b3b46e5655ba4`, the starting checkpoint adds only the
RS1 writer-bridge renewed review and modifies the readiness register.

No runtime, test, migration, package or evidence file was changed or executed in
this review. No project tests, typechecks, provider/network/loopback operation,
security scan, credential read, staging, commit or push occurred.

## Review-chain reconciliation

Failed reviews remain immutable historical evidence. Later artifacts constrain and
correct the one operative implementation plan; they do not create a competing plan.

| Artifact | Disposition | Historical blocker | Explicit later resolution | Immutable history |
| --- | --- | --- | --- | --- |
| 0114I lifecycle policy design | PASS as corrected operative policy; SUPERSEDED-IN-PART for its original B1 gap | B1 duplicate assertion/authority graph | Corrected B1 section plus renewed B1 review | Yes |
| B1 renewed review | PASS | None; nonblocking planning notes only | Incorporated into operative 0114J plan | Yes |
| Initial 0114J implementation-plan review | FAILED | R1 executable-owner launch domain; R2 final temporal fence | Owner-scope decision plus corrected plan/final-fence design and later reviews | Yes |
| Executable owner-scope review | PASS | Prior narrow correction had required scope change | Approved one new owner-host and exact plain-Node main | Yes |
| Corrected-plan renewed review | FAILED | C1 redirected-stdin/native host behavior; C2 final fence remained outside adapter | C1/C2 scope review selected native REPL host and adapter as fifth file | Yes |
| C1/C2 scope review | PASS for scope; later SUPERSEDED-IN-PART for C1 details | No C2 blocker; later RC1/RC2/RC3 observations refined C1 | Narrow C1 reconciliation and operative plan corrections | Yes |
| C1/C2 security-gate renewed critical review | FAILED | RC1 EOF, RC2 Ctrl+C mode, RC3 preview | Direct stdin end/close; `breakEvalOnSigint:true` plus host handler; `preview:false` | Yes |
| Reconciled C1 renewed critical review | FAILED | RS1 VM-consumed synchronous interruption lacked terminal bridge | Fixed writer-boundary classifier in scope/plan and RS1 renewed review | Yes |
| RS1 writer-bridge renewed critical review | PASS | None; actual VM signal, PTY and native preparation are acceptance notes | Current frozen design; future proof explicitly mandatory | Yes |

No failed artifact is treated as if it passed at the time. Its finding remains valid
historical evidence and is closed only by the named later correction/review.

## Operative plan and exact file boundary

The sole operative implementation plan is
[0114j-qualification-lifecycle-implementation-plan.md](0114j-qualification-lifecycle-implementation-plan.md).
Later scope appendices and renewed reviews interpret, constrain and approve it. The
RS1 appendix explicitly supersedes only the old listener-only interruption assumption
and extends the existing constant writer. There are no two contradictory operative
designs.

Future production runtime changes are exactly:

1. `scripts/assessment-worker/qualification-railway-acquisition-owner-host.cjs` — NEW
2. `scripts/assessment-worker/qualification-railway-live-authorization.cjs` — MODIFY
3. `scripts/assessment-worker/qualification-railway-acquisition-wrapper.cjs` — MODIFY
4. `scripts/assessment-worker/qualification-railway-target-identity.cjs` — MODIFY
5. `scripts/assessment-worker/qualification-railway-https-adapter.cjs` — MODIFY

No sixth production runtime file is authorized. `run.cjs`, `package.json`, the
first-context wrapper, provider boundary, context review/builders, introspection
modules and migrations remain unchanged. If implementation requires otherwise, it
must stop for plan/scope review.

## Ownership and immutable bindings

Exactly five canonical realpath/cache/`Module.exports` bindings are finalized and
sealed before graph enablement. Authorization alone owns lifecycle state, trusted
clocks, high-water/fault state, claim/closed state and original deadlines. Identity
owns the original S/C association. The adapter owns transport attempt/context and
all three final native-dispatch fences. The host owns whole-graph association,
canonical binding verification and the enable/terminal latch. The adapter connector
is initialization-only, private, one-use and consumed/deleted.

No public callback, public lifecycle hook, mutable setter, replaceable fence or second
owner is needed or authorized. Copies, preloads, reloads, alternate mains, VMs and
workers cannot become another executable owner domain.

## B1 lifecycle foundation

B1 remains closed and sufficient for implementation. The authorization module is the
sole admission owner. It derives SHA-256(C(R)) from strict sorted canonical JSON,
rejects malformed/duplicate/extra fields and maintains private unseen/claimed/closed
state. Passive strict validation precedes one synchronous atomic claim; capability
publication follows the claim. Every terminal result closes idempotently before
resource cleanup. Expiry markers, process-local UTC high-water, original monotonic
deadlines, 64-entry capacity and 16-KiB raw/canonical bounds remain fail-closed. No
durable or cross-process coordination is introduced. Restart requires fresh review
and authorization.

## C1 and blocker resolution

The dedicated owner-host starts one deterministic host-owned native `repl.start`
console after the five-module graph is linked, finalized, sealed, verified and
enabled. It retains default native evaluation, `breakEvalOnSigint:true`,
`preview:false`, a fixed empty completer and one fixed non-inspecting writer.

- **RC1 — RESOLVED.** Direct `process.stdin` end and close `prependListener`
  observation is installed before input processing, with already-ended/closed checks.
  It invokes the same first-cause latch independently of deferred REPL exit during
  unresolved await. REPL close/exit remain additional sources. Pending evaluators
  cannot publish or regain authority after the latch.
- **RC2 — RESOLVED IN DESIGN.** Preserve `breakEvalOnSigint:true`; replace the fresh
  server's default REPL SIGINT handling with the host terminal handler before input.
  One idle, multiline or unresolved-await Ctrl+C is terminal; process SIGINT remains
  distinct. Real PTY proof remains mandatory acceptance, not an architecture choice.
- **RC3 — RESOLVED.** `preview:false` disables native pre-Enter preview and the fixed
  writer emits only a constant marker for ordinary automatic output. No automatic
  `util.inspect`, coercion, getter or custom-inspector surface is introduced by the
  bridge. Explicit trusted-operator inspection remains within the existing threat
  boundary.
- **RS1 — RESOLVED IN DESIGN.** The writer captures trusted
  `node:util.types.isNativeError`, `Object.getOwnPropertyDescriptor` and
  `Object.hasOwn`. A native Error with an own data `code` whose primitive value is
  exactly `ERR_SCRIPT_EXECUTION_INTERRUPTED` synchronously enters the SAME private
  terminal latch as `VM_SIGINT_INTERRUPTION`, revokes authority, marks original
  graphs CLOSED, cleans once, publishes no result or usable prompt and exits 130.
  There is no message fallback, custom evaluator, domain patch or Node-internal patch.
  A deliberately forged thrown or returned reserved-code native Error follows the
  same fail-closed path and can only reduce authority. Ordinary nonmatching errors
  remain nonterminal at this bridge.

The private terminal owner preserves first-cause precedence across VM interruption,
REPL/process signals, stdin end/close, REPL close/exit, SIGTERM, stream errors and
cleanup-induced events. It latches revocation first, disables acquisition, marks
graphs CLOSED before resource cleanup, cleans once, releases no result and terminates
with the latched code. Signal code 130 remains 130 if cleanup fails.

## C2 native-dispatch fence and request paths

All three HTTPS paths use one exact order:

`all phase-1 work -> fixed private PURE lifecycle fence -> immediate native request construction`

Phase 1 includes hashing, strict validation, owner/session/attempt bookkeeping,
diagnostics, bounded body serialization, cancellation/timeout setup, captured plain
options and secret header, response callback, graph-stage association and captured
trusted native request function. Between the successful final fence and native
request construction there is no filesystem work, hashing, serialization, await,
dynamic require, validation, timer creation, getter, hook, option construction or
mutation. Wrapper/identity checks are preliminary; the adapter-local check is the
final wire fence. Failure constructs zero new requests.

The corrected request-1 path is exact:

`acquireServices -> identity.contextTransfer.preparePermit -> adapter.bindContextResultTransfer -> adapter.executeHandoff -> fixedContextRequest -> contextValidator.buildRequest -> adapter shared post`

Older `acquireContext` shorthand is historical and non-operative. Request 2 and 3
retain their reviewed paths. The total successful native request count remains exactly
three, with no retry, redirect, fallback or fourth request.

## Transitions, pins and inventories

The conceptual transition count remains exactly 21. Rows 10, 12 and 16 are the three
adapter-local final native-dispatch realizations. Row 21 remains the validity-only
post-cleanup result-release check and never reopens authority.

Current `SOURCE_HASHES` contains 12 roles. Future source pins contain 13 roles: three
changed old values (wrapper, identity, adapter), nine unchanged old values
(first-context wrapper, provider boundary, context review, introspection preflight,
project-token context, transport contract, introspection target, introspection request,
introspection plan), and one new owner-host role. Authorization's self-hash changes
separately and is not a fourteenth role. Host-to-authorization imports do not create
a digest cycle; the host must not embed the generated authorization self-hash.

The focused inventory remains exactly 14 unique paths: the eleven existing 0110–0114H
suites and three approved 0114J suites (`0114j_lifecycle_authorization`,
`0114j_executable_owner_host`, `0114j_native_dispatch_fence`). RS1 coverage belongs
inside the owner-host/lifecycle suite and does not create a fifteenth focused suite.
The regression inventory remains exactly 19 unchanged paths. Installed TypeScript
validation remains exactly three commands.

## Mandatory implementation acceptance

Actual VM-consumed SIGINT remains mandatory implementation validation. It must use
genuine synchronous native evaluation with active synthetic acquisition authority
and a real supported SIGINT consumed by VM while the process listener may be absent.
The actual Error must reach the writer before a usable prompt with native branding,
own data code and exact primitive value. The same latch must revoke authority, close
graphs, clean once, publish nothing, prevent rearm/transport reopen and exit 130.

Real supported TTY/PTY validation remains mandatory for one idle, multiline and
unresolved-top-level-await Ctrl+C, distinct process SIGINT, no double-press clear or
resume, and no authority continuation. Both requirements are acceptance proofs for
the selected supported architecture. They do not prevent implementation from
beginning. A shape/order or PTY contradiction triggers the stop conditions below.
No production injection surface is authorized or required.

## Security and downstream acceptance

After runtime/source stabilization, pins, all 14 focused suites, the unchanged
19-path regression, three TypeScript checks, actual VM signal proof, real PTY proof
and protected diff/pin verification, perform the frozen semantic security gate.
Only after all blocking findings are resolved may independent implementation review
occur. Both remain future requirements.

The gate retains owner-host/copy/reload/preload/cache bypass, REPL/private leak and
second-authority, output/custom-inspection leakage, stale-capability, expiry/rollback,
TOCTOU, request-1/2/3 final-fence bypass, public hook, downgrade/provenance,
EOF/signal reuse, cleanup/result races, pin/self-hash bypass, credentials, retry/fourth
request, package/activation bypass, authority-outside-graph, VM-consumed SIGINT,
misclassification, ordinary/reserved Error confusion, prompt resurrection,
terminal-latch/exit-code bypass and second-cleanup/rearm cases. A clean review or
scan grants no provider/live/package/deployment authority.

## Authorized implementation scope

`IMPLEMENTATION_AUTHORIZED_FOR_FROZEN_0114J_SCOPE` permits a future implementation
task to:

- create the one approved owner-host runtime file and modify the four approved runtime
  files;
- create or modify the three approved 0114J focused suites and update existing
  relevant tests only as required by the plan;
- update source pins only after implementation sources stabilize;
- update inert templates/evidence references only where the operative plan explicitly
  requires it, without promoting the current package;
- run the exact approved focused, regression and TypeScript validation, including
  only the local loopback mechanics already inherent in that exact regression;
- run offline local real-signal and real-PTY acceptance; and
- prepare exact implementation-review and security evidence.

This authorization does not permit Railway/provider APIs, external network,
production, deployment, Supabase migration push, package promotion, lifecycle
activation, current acquisition-input promotion, credentials/capsule access,
Priority Engine or Movement product-semantic changes, runtime-file/request-count
expansion, invariant weakening, or staging/commit/push.

## Implementation stop conditions

Stop and return for plan/scope review if the actual VM Error shape differs; the
writer is reached after a usable prompt; default native evaluation cannot be kept;
a Node internal patch is needed; real PTY behavior contradicts the design; a sixth
runtime file, public callback/setter/fence or fifteenth focused suite is needed; the
adapter-local fence cannot be implemented as specified; requests would exceed three;
a pin dependency cycle appears; lifecycle ownership must move; package/run.cjs must
change unexpectedly; provider/external-network access becomes necessary; synchronous
revoke/CLOSED/cleanup or first-cause semantics cannot be preserved; or a security
invariant requires redesign.

## Current package and authority

The current acquisition package remains `movement_railway_acquisition_input_review_v2`,
incomplete and unreviewed, with executable preparation false and lifecycle null. The
qualification evidence retains deployment/live/manual-live false, lifecycle null and
pending source configuration. Nothing is promoted or activated by this authorization.

Exact next milestone: perform the frozen 0114J implementation in a separate task,
then complete all deterministic, actual-signal and real-PTY validation, followed by
the semantic security gate and independent implementation review. Downstream
provider/live/package/deployment authority remains a separate later decision.
