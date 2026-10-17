# 0114J RS1 writer-boundary bridge renewed critical review

reviewerReference: Codex-RS1-writer-bridge-renewed-review

reviewedCommit: `3b5a9a3526e1e0ac595f001df90b3b46e5655ba4`

reviewedBranch: `feature/0092-shared-segment-suitability`

reviewedCorrectionBase: `c089d1222d2cd5d009b2233e7024e4f325516926`

outcome: PLAN_APPROVED_FOR_SEPARATE_IMPLEMENTATION_AUTHORIZATION_REQUEST

blockerCount: 0

nonblockingNoteCount: 3

rs1WriterBridgePassed: true

implementationAuthorized: false

providerAuthorized: false

This is a fresh adversarial review by the same Codex assistant that performed prior
planning/review work. It is not independent human approval and is not implementation
acceptance. Approval means only that a separate implementation-authorization
milestone may now be requested. Runtime implementation remains unauthorized.

## Boundary and evidence

The review began at the exact required HEAD and branch. The tracked tree and index
were clean; the only initial status entry was the pre-existing untracked
`0102-remote-fixtures.capsule`, which remained unread. The correction delta from
`c089d1222d2cd5d009b2233e7024e4f325516926` changes only the C1/C2 scope artifact,
the operative implementation plan and readiness register.

Read the required scope, plan, prior reviews, lifecycle/B1 policy, current runtime
sources and current package/evidence. Inspected installed Node v24.13.1 embedded
`repl`, `vm`, `internal/errors`, `internal/repl/utils` and `internal/util/types`
source. Used isolated built-in-only offline Node probes for native-branding,
descriptor, proxy, cross-context, evaluator-compatibility and native-REPL writer
ordering. No project test, typecheck, provider/network/loopback action, security
scan, package operation or runtime implementation occurred.

## Disposition

No blocker remains in the selected design. The supported `writer` option is a
synchronous observation point shared by native error rendering and completed-value
rendering. The fixed classifier is narrow, hook-free for the considered inputs and
fail-closed for deliberately forged reserved-code native Errors. A match reaches
the existing private terminal owner synchronously; that owner must latch revocation,
mark claimed graphs CLOSED, clean once and terminate with 130 without returning to
native rendering or prompt continuation.

Three nonblocking acceptance notes remain:

1. **N1 — actual VM-consumed SIGINT proof remains future.** Embedded source and the
   internal constructor/error route establish a supported, plausible path and exact
   expected object shape. This review did not perform an actual OS SIGINT consumed
   during synchronous VM evaluation. Future acceptance must stop for plan/scope
   review if the real error shape or ordering differs.
2. **N2 — real PTY proof remains future.** Idle, multiline and unresolved-await
   single-key Ctrl+C behavior still requires a real supported TTY/PTY. Synthetic
   input is not equivalent.
3. **N3 — native error preparation precedes the writer.** The REPL domain path may
   decorate/read `stack`, `name` and `message`, including `Error.prepareStackTrace`,
   before invoking the writer. The bridge itself invokes none of those hooks. This
   is compatible with the documented trusted-operator/non-sandbox boundary and
   does not permit an authority continuation or prompt before writer control.

## Native RS1 path and ordering

The prior RS1 blocker is genuine. In Node v24.13.1, default REPL evaluation passes
`breakOnSigint: self.breakEvalOnSigint` to VM execution. VM wraps synchronous
execution when a SIGINT listener exists, saves those listeners, removes them for the
native execution, and restores them in `finally`. A VM-consumed interrupt can
therefore become an evaluation error while the host process listener is absent.
The prior listener-only design did not guarantee terminal revocation on that path.

The corrected plan retains `repl.start`, default native evaluation and
`breakEvalOnSigint:true`. It supplies no `eval` option, does not replace
`server.eval`, modify `server._domain` or patch Node internals. Node v24.13.1 rejects
an `eval` option together with `breakEvalOnSigint:true` using
`ERR_INVALID_REPL_EVAL_CONFIG`; the local compatibility probe confirmed that result.
Native parsing, context, multiline, top-level-await and key semantics therefore stay
on the supported implementation.

For a synchronous execution error, default evaluation catches the original error
and emits it to the native REPL domain. The domain handler receives that object,
performs native stack/error preparation, and calls `self.writer(e)` at the native
error boundary before its `output.write` and before `displayPrompt`. No REPL command,
acquisition callback, result-release step or usable prompt occurs between VM return
and writer invocation. The call is synchronous in the same error-handling turn.
For a completed value, the native result path likewise calls `self.writer(ret)`
inside `output.write(...)` and then considers the next prompt. A synthetic internal-
constructor probe confirmed that both a thrown and returned reserved-code Error reach
the supplied writer first. A test stand-in that deliberately returned from its
terminal callback then allowed native output/prompt, confirming why production's
specified terminal call must terminate and never return.

## Interruption shape and classifier

Node's internal error registry defines `ERR_SCRIPT_EXECUTION_INTERRUPTED` as an
`Error`. Its generated zero-argument NodeError class initializes `code = key` as an
instance class field. The locally constructed Node internal interruption Error was
native-branded and had an own data descriptor whose primitive value was exactly
`ERR_SCRIPT_EXECUTION_INTERRUPTED` (writable, enumerable and configurable). This is
source-established constructor/shape evidence plus a synthetic internal-constructor
route proof; it is not an actual VM-consumed signal proof.

The selected writer captures `node:util.types.isNativeError`,
`Object.getOwnPropertyDescriptor` and `Object.hasOwn` before yielding operator input.
The exact classification is sound:

- `isNativeError(value)` accepts native Errors from another VM context.
- It rejects ordinary non-Errors, live Error proxies and revoked Error proxies. The
  proxy probe invoked no `get`, `getPrototypeOf` or descriptor trap.
- Only after that brand check does the bridge request the own `code` descriptor.
- `Object.hasOwn(descriptor, 'value')` distinguishes a data descriptor from an
  accessor descriptor. `getOwnPropertyDescriptor` already establishes that the
  original `code` property is own; the additional `hasOwn` is still useful and safe
  for descriptor-kind testing.
- Exact primitive equality performs no coercion. Inherited and accessor-backed codes
  do not match; the accessor getter was never called.
- The bridge reads no name, message or stack, performs no serialization or
  `util.inspect`, and invokes no custom inspector or caller hook.

This is a reserved-signature policy, not cryptographic provenance. A trusted operator
can create a real Error, define the same own data code, and throw or return it. That
case intentionally terminates the attempt. It can only reduce authority: it reaches
the same one-use terminal latch, cannot convert another cause into success, cannot
mint/reuse lifecycle authority, and requires fresh review/authorization after process
termination. Repeated notifications cannot rearm or run cleanup twice.

Ordinary `SyntaxError`, `ReferenceError`, `TypeError`, thrown Error and returned Error
without the exact signature remain nonterminal at this bridge. The same interruption
message without code, inherited code, accessor code, non-Error records and proxy
lookalikes also remain nonterminal. They receive the existing constant marker and
retain independent acquisition-operation failure rules. Installed source exposes
the reserved code only for script execution interrupted by SIGINT; no unrelated
ordinary-error collision was found.

## Terminal ownership, races and preserved C1 behavior

The writer is neither a second authority owner nor a second exit owner. It closes
over and synchronously calls the same private idempotent terminal handler used by
stdin, REPL and process terminal sources. On the first match, that handler records
`VM_SIGINT_INTERRUPTION`/130, revokes host and acquisition authority, shuts down the
authorization owner, marks original claimed graphs CLOSED before resource cleanup,
burns remaining gates/tickets/permits, clears owned timers, publishes no result and
terminates the dedicated host process. No `await`, Promise hop, timer or queued
callback precedes revocation. Cleanup failure retains the already-latched signal
exit code 130.

First cause still wins across VM interruption, process SIGINT, REPL SIGINT, stdin
end/close, REPL close/exit, SIGTERM, stream failure and cleanup-induced events. A
prior terminal cause cannot be overwritten; a later writer match or real signal
cannot relatch, repeat cleanup, restore authority or open another process-exit path.

The correction does not change RC1 direct stdin end/close `prependListener`
observation, already-ended/closed checks, unresolved-await EOF behavior, clean-EOF
policy or post-latch pending-evaluator denial. It does not change the passed RC2 key
design: `breakEvalOnSigint:true`, host replacement of the default REPL SIGINT
listener, one idle/multiline/unresolved-await Ctrl+C as terminal, and distinct process
SIGINT. It does not change RC3's `preview:false` plus constant automatic output.
Node's pre-writer stack preparation is explicitly within the trusted operator
boundary; the bridge adds no automatic inspection surface.

## Frozen architecture and accounting

The RS1 correction is confined to the already selected owner-host file. It preserves
exactly five future production runtime files and five immutable canonical bindings,
including the HTTPS adapter as the fifth file. Authorization remains sole lifecycle
owner. All three requests retain phase-1 preparation followed by an adapter-local
final pure fence and immediate native request construction. No public fence, sixth
helper, retry, redirect, fallback or fourth request is introduced. B1 canonical
assertion identity, atomic claim, unseen/claimed/closed states, high-water/deadline,
retention, size/capacity and same-process trust rules remain unchanged.

The plan retains exactly 21 conceptual transitions, including separate rows 14 and
15 and adapter-local final fences at rows 10, 12 and 16. Pin arithmetic remains 12
current roles and 13 future roles: three changed old values, nine unchanged old
values, one new host role, with authorization self-hash separate and no reciprocal
digest cycle. The focused inventory is exactly 14 unique paths, the regression
inventory remains exactly the same 19 paths, and future installed TypeScript checks
remain exactly three.

## Future acceptance, security gate and package authority

The existing owner-host/lifecycle coverage now explicitly requires genuine native
synchronous evaluation with active synthetic authority; a real supported SIGINT
consumed by VM while the process listener may be absent; the writer seeing the
actual native-branded own-data-code Error; one same-latch revocation; graph CLOSED;
no prompt, result, draft, ticket, permit, reopened transport, facade or rearm; one
cleanup; and exit 130. It also covers thrown and returned forged reserved-code Errors,
ordinary and same-message errors, inherited/accessor code, non-Error/proxy lookalikes,
cross-context Errors, custom-inspection sentinels, the existing key paths, distinct
process SIGINT and mandatory real PTY proof. These cases require no production
injection surface. Any actual shape/order mismatch returns to scope/plan review.

The future security gate remains after deterministic validation and before independent
implementation acceptance. Its existing and RS1-specific cases cover VM-consumed
SIGINT bypass, interruption misclassification, ordinary/reserved-code confusion,
forged reserved-code Errors, prompt resurrection, terminal-latch and exit-code bypass,
second cleanup/rearm, and writer/custom-inspection leakage. A scan cannot grant live,
provider, package or deployment authority.

The future implementation sequence is coherent: link the five-module graph; create
the private terminal handler and capture trusted classifier built-ins; create the
fixed writer and REPL configuration; finalize/seal/enable the one graph before actual
REPL creation and before yielding input; install terminal handlers; claim lifecycle
before capability; install adapter associations/fences; stabilize sources and pins;
regenerate inert templates; complete deterministic, real-signal and real-PTY proof;
then perform the security gate and independent implementation review.

Current package/evidence remains v2 and incomplete, with executable flags false,
source configuration unpromoted, expected-target/eligibility lifecycle null, and no
`lifecycleReview` promotion. No provider, live, package, deployment or activation
authority changed.

## Review checklist A–W

| Area | Result |
| --- | --- |
| A Git/review boundary | PASS: exact HEAD/branch; clean tracked tree/index; exact three-file correction delta; capsule unread. |
| B RS1 root cause | PASS: VM break-on-SIGINT and temporary listener removal reconfirm the listener-only gap. |
| C Default evaluator | PASS: native `repl.start`, no custom eval/domain/internal patch; incompatible option pair confirmed. |
| D Writer ordering | PASS: same-turn writer before native output/prompt; no authority-bearing continuation before it. |
| E Error object shape | PASS in source/design: native Error with own data primitive code; actual signal proof remains N1. |
| F `isNativeError` | PASS: cross-context accepted; non-Errors/proxies rejected without observed hooks. |
| G Own-data descriptor | PASS: no accessor/prototype/coercion; `Object.hasOwn` safely tests descriptor kind. |
| H Forged-code policy | PASS: deliberate false positive only terminates/reduces authority. |
| I Returned Error values | PASS: native result writer sees the value before output/prompt. |
| J Ordinary errors | PASS: nonmatching ordinary errors remain nonterminal at this bridge. |
| K RC3 | PASS: constant non-inspecting bridge; native pre-writer formatting accepted per N3. |
| L Terminal ordering | PASS: same synchronous private latch; revoke/CLOSED/cleanup/no result/termination. |
| M Process termination | PASS: existing owner terminates once; 130 survives cleanup failure. |
| N First-cause races | PASS: one latch, one cleanup, no overwrite or rearm. |
| O Await/key regression | PASS in design; actual PTY proof remains N2. |
| P RC1 freeze | PASS: no change. |
| Q C2/B1/five-file freeze | PASS: no change. |
| R Counts/inventories | PASS: 21; 12/13 pins; 3/9; 14/19/3. |
| S RS1 future acceptance | PASS: all required cases explicit; no production injection. |
| T PTY/actual signal gaps | PASS as mandatory future acceptance gaps; no architecture choice deferred. |
| U Security gate | PASS: structure/order/authority unchanged; RS1 attack cases included. |
| V Current package/authority | PASS: incomplete/null/false and unpromoted. |
| W Sequence | PASS: supported initialization and validation order is implementable. |

## Authority and next milestone

Exact next milestone: a separate implementation-authorization request for the
reviewed RS1-corrected five-file plan. This review grants no implementation,
test/typecheck, migration, provider/Railway/network/loopback, package, activation,
deployment, security-scan, staging, commit or push authority. Future implementation
acceptance still requires actual VM-consumed SIGINT and real PTY proof, deterministic
validation, the semantic security gate and independent implementation review.
