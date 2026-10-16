# 0114J corrected implementation-plan renewed review

reviewerReference: Codex-0114J-corrected-plan-renewed-review

reviewedCommit: `e0da80028b857b5dbb8f59f448dccc5981df2753`

reviewedBranch: `feature/0092-shared-segment-suitability`

reviewedArtifact: [Corrected plan](0114j-qualification-lifecycle-implementation-plan.md)

priorFailedReview: [Original plan review](0114j-qualification-lifecycle-implementation-plan-review.md)

ownerScopeDecision: [Owner scope review](0114j-executable-owner-scope-review.md),
SCOPE_APPROVED_ADD_SINGLE_OWNER_HOST

outcome: PLAN_CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_AUTHORIZATION

separateImplementationAuthorizationMayBeRequested: false

implementationAuthorized: false

This is a renewed critical pass by the same Codex assistant that authored the plan
and earlier scope/reviews. It is not independent human approval or independence
from the author. Findings challenge the plan against local source and observed Node
behavior. No implementation, policy redesign or target eligibility is recorded.

## Evidence and disposition

Reviewed the corrected plan, historical failed review, owner scope decision, corrected
0114I design/renewed B1 review, 0114D/0114H records, readiness register, worker package/
entry, authorization/wrapper/identity/adapter and relevant 0110-0114 tests/fixtures.
Two blockers remain: the assumed native console lifetime is not established (C1),
and unchanged adapter validation runs after the proposed dispatch fence (C2).

The task expressly permits offline Node help/version/source-behavior inspection.
Installed Node is v24.13.1. Inspected its embedded CommonJS loader and main/REPL
source. Ran two isolated local behavior probes with temporary non-project scripts,
sanitized child environments and no application imports. The interactive probe
disabled REPL history/external-module settings. Temporary scripts/directories were
removed. No project test suite, provider operation, credential read or network/
loopback activity occurred. The probes did not create the planned owner host.

## Blocking C1: main script runs, but the assumed post-script console is absent

Exact plan sections: A, the ONLY supported command, its real-child proof requirement
and startup bootstrap; implementation sequence step 2.

Local probe used the exact structural mode: node --interactive TEMP/main-probe.cjs.
The harmless script printed require.main === module and cache presence. Stdin then
contained a console.log command followed by .exit. Node returned:

```text
exit: 0
stdout: SCRIPT_RAN true true
stderr: empty
```

The queued REPL_MAIN console.log command was not evaluated. Thus this mode did run
the CJS script as genuine cached main, but exited without the assumed post-script
native operator console in the redirected-stdin case. This is a concrete supported-
version/lifetime counterexample, not a claim that require.main is false or that all
TTY modes were tested. Embedded internal/main/run_main_module executes the script;
internal/main/repl is a separate entry implementation. The plan cannot rely on
--interactive alone to supply the later console and defer verification until coding.

Smallest correction: explicitly define and verify the operator-console lifecycle
inside the named host, or select a revised deterministic launch contract through
scope/plan review. If using Node's built-in REPL explicitly, specify ownership,
startup after successful graph sealing, EOF/error/cancellation cleanup and history/
credential-output boundaries; do not silently invent a custom driver or listener.
Prove actual operator command evaluation after bootstrap, persistent availability
until explicit exit/EOF, and the chosen redirected-stdin versus TTY support policy
with offline real child-process checks. Mere script execution/main equality is
insufficient. Leave package/run changes forbidden unless separately reviewed.

## Blocking C2: adapter hashes after the last proposed dispatch fence

Exact plan sections: Exact future file scope (adapter preserved), C's phase-1/phase-2
rule, final-fence rows 10/12/16 and the paragraph invoking existing adapter operations,
ordered sequence 11-13.

The plan requires hashing/expensive validation before the final fence, yet fixes the
last dispatch fence at the wrapper's adapter invocation. In the current adapter:

- executeProjectServices calls assertServicesAttempt, which calls
  fixedProjectServicesRequest and hashes request.query before post/https.request.
- executeServiceInstance calls assertInstanceAttempt, which calls
  fixedServiceInstanceRequest and hashes its query before post/https.request.
- post creates the native request after those checks. There is no existing final
  lifecycle-fence invocation after this hashing at the native dispatch point.

Replacing the wrapper/identity checks cannot move those adapter-local hashes before
the wrapper's final fence. A deliberately withheld timer plus time crossing expiry
during that validation can still reach native request creation without another
sample. These are bounded fixed-query hashes, but the corrected plan explicitly
places hashing in phase 1 and claims dispatch follows a final fence after validation.
The contradiction cannot be closed by naming adapter API entry the wire side effect.

Smallest correction: obtain narrow scope approval for the adapter as a fifth changed
runtime source and specify a private original-graph pure-fence hook after its dispatch
validation, immediately before native request creation. Preserve transport/queries,
credential ownership and three-request ceiling. Do not implement or expose a caller
hook. Update pin accounting: total may remain thirteen, but adapter becomes another
changed existing pin, leaving nine rather than ten old pin values unchanged. Add
withheld-timer tests advancing time inside adapter validation/hash and asserting
zero subsequent native request. If another four-file solution is proposed, it must
demonstrate the actual post-validation dispatch fence without getters, caller hooks
or weakening the reviewed no-hash-after-fence guarantee; none is specified now.

This is the fifth-runtime-file stop condition for the present plan, not authorization
to expand its scope. No adapter or other production file is changed by this review.

## Mandatory 86-point checklist

YES accepts the stated requirement/direction, not implemented behavior. NO or
NEEDS_CHANGE entries map to C1/C2 and the corrections above.

| # | Point | Result |
| --- | --- | --- |
| 1 | Four-file runtime scope sufficient | NEEDS_CHANGE (C2) |
| 2 | run.cjs unchanged safe | YES |
| 3 | package.json unchanged safe | YES |
| 4 | Adapter unchanged safe | NEEDS_CHANGE (C2) |
| 5 | Introspection-target unchanged safe | YES |
| 6 | Documented host command coherent as complete operator lifecycle | NEEDS_CHANGE (C1) |
| 7 | require.main contract established for CJS main execution | YES |
| 8 | Main-thread contract established | YES |
| 9 | Canonical host realpath/cache contract established | YES |
| 10 | Imported host inert | YES |
| 11 | Copied host child inert | YES |
| 12 | node-e bootstrap blocked | YES |
| 13 | ESM-main bootstrap blocked | YES |
| 14 | Independent VM bootstrap blocked | YES |
| 15 | Worker bootstrap blocked | YES |
| 16 | Startup seal unexposed | YES |
| 17 | Temporary connector ordering safe in principle | YES |
| 18 | Preloaded owner modules fail closed | YES |
| 19 | No reinitialize path | YES |
| 20 | Four require.cache bindings implementable | YES |
| 21 | Cache hardening safe in stated unhooked host scope | YES |
| 22 | Delete/reassign semantics correct | YES |
| 23 | Four Module.exports bindings implementable | YES |
| 24 | Exports locked after final assignment | YES |
| 25 | Exports locking compatible with completed circular linking | YES |
| 26 | Original graph survives rejected duplicate | YES |
| 27 | Copied authorization cannot execute | YES |
| 28 | Copied full graph cannot execute | YES |
| 29 | Stale connector cannot execute | YES |
| 30 | Host association before claim | YES |
| 31 | No earlier acquisition-authority bypass identified | YES |
| 32 | R2 two-phase model complete as a rule | YES |
| 33 | Pure-fence definition pure | YES |
| 34 | Pre-claim fence correct | YES |
| 35 | Draft publication fence correct | YES |
| 36 | Approval fence correct | YES |
| 37 | Manual authorization fence correct | YES |
| 38 | Ticket issuance fence correct | YES |
| 39 | Ticket burn ordering preserved | YES |
| 40 | Wrapper setup fence correct | YES |
| 41 | Permit burn ordering preserved | YES |
| 42 | Context-open fence specified correctly | YES |
| 43 | Request-1 native dispatch fence established | NEEDS_CHANGE (C2: specify common actual dispatch boundary) |
| 44 | Response-1 identity acceptance fence correct | YES |
| 45 | Request-2 native dispatch fence correct | NEEDS_CHANGE (C2) |
| 46 | Response-2 identity acceptance fence correct | YES |
| 47 | Gate-1 issue fence correct | YES |
| 48 | Gate-1 acceptance fence correct | YES |
| 49 | Request-3 native dispatch fence correct | NEEDS_CHANGE (C2) |
| 50 | Response-3 identity acceptance fence correct | YES |
| 51 | Gate-2 issue fence correct | YES |
| 52 | Gate-2 acceptance fence correct | YES |
| 53 | Private result-construction fence correct | YES |
| 54 | Post-cleanup validity-only release fence correct | YES |
| 55 | Cleanup crossing expiry suppresses result | YES |
| 56 | Timer-only freshness rejected | YES |
| 57 | monoDeadline arithmetic cannot extend lifecycle | YES |
| 58 | High-water fail-closed | YES |
| 59 | Rollback latch process-lifetime | YES |
| 60 | UTC-only marker removal consistent | YES |
| 61 | Capacity limits unchanged/coherent | YES |
| 62 | Schema versions unchanged/coherent | YES |
| 63 | Array cardinalities unambiguous | YES |
| 64 | Combined reference cap unambiguous | YES |
| 65 | Path rejection rules testable | YES |
| 66 | Thirteen-pin architecture coherent | YES |
| 67 | No digest/self-hash cycle | YES |
| 68 | Other ten existing pins can remain unchanged | NEEDS_CHANGE (C2: adapter pin impact) |
| 69 | Historical twelve-pin preservation | YES |
| 70 | Current package unchanged | YES |
| 71 | Inert templates remain inert | YES |
| 72 | Exact thirteen focused suites coherent | YES |
| 73 | Real child-process host proof sufficient as specified | NEEDS_CHANGE (C1: prove command evaluation/lifetime, not only bootstrap) |
| 74 | R2 blocking-work tests sufficient | NEEDS_CHANGE (C2: adapter-local validation before native request) |
| 75 | Nineteen-file regression coherent | YES |
| 76 | Loopback boundary explicit | YES |
| 77 | No external/provider network required | YES |
| 78 | Legacy v3 bypass blocked by cutover requirement | YES |
| 79 | Current v2 package rejected | YES |
| 80 | 0113 remains non-continuable | YES |
| 81 | No alternate bootstrap permitted | YES |
| 82 | No durable coordination required | YES |
| 83 | No migration required | YES |
| 84 | No provider access required | YES |
| 85 | Agent has no unresolved security architecture | NEEDS_CHANGE (C1/C2) |
| 86 | May proceed to separate implementation authorization | NO (C1/C2) |

## Findings A-V

| Area | Finding |
| --- | --- |
| A. Scope | Not accepted: C2 requires dispatch-boundary correction/scope review. No run/package or target-binder change established necessary. |
| B. Host lifecycle | C1 blocks. Script main equality is proven locally; a persistent post-script console is not. Redirected stdin exited without evaluating queued operator commands. |
| C. Main/cache identity | Real CJS main can have require.main === module and a canonical cache entry. Validate realpaths before enablement; alias/case behavior must be included in future supported-platform tests. |
| D. Cache descriptors | Accepted in unhooked Node v24.13.1: actual cache object has ordinary configurable/writable data entries; tightening preserves cached require. Strict delete throws, non-strict delete returns false. No automatic unload requirement found on successful load. |
| E. Exports descriptors | Accepted after final assignments and linking. Loader uses cached exports after load. Do not lock partial circular placeholders or freeze full Module objects. Exceptional loader cleanup may attempt deletion of pinned entries and mask an original error; bootstrap must remain disabled on such failure. |
| F. Private linkage | Feasible as a synchronous host-first cycle with disabled enablement until all checks pass. Pre-imported inert modules must not be upgraded; an unconsumed/missing host handshake must fail, not merely be deleted. Add explicit genuine preloading cases as a nonblocking test clarification. |
| G. First gate | Original host association precedes claim and review publication. Existing context/planning APIs cannot provide the private acquisition permit. No additional acquisition-authority bypass identified. |
| H. Duplicates | Immutable canonical bindings plus original host seal address supported reload/replacement. Copies/independent realms have no seal. This is not a sandbox against trusted code deliberately delegating original facade calls. |
| I. Pure model | Definition is pure: expensive work is phase 1 and failed-fence cleanup occurs outside it. C2 contradicts realization at actual dispatch, not the model's wording. |
| J. Twenty-one locations | All rows are present; dispatch rows do not prove a native request fence after adapter validation. Other state/burn/acceptance and result-release modes are specified coherently. |
| K. Claim arithmetic | Final pre-claim sample derives remaining and monoDeadline after cleanup/index work, stores once and rejects nonfinite/lost-positive-increment values. No phase-1 candidate is reused to extend time. |
| L. Clock latch | UTC high-water survives empty maps; rollback/invalid samples latch and close graphs. Subsequent pure fences observe it. Timers do not establish freshness. |
| M. Retention | UTC-only removal is explicit, with no operative OR-monotonic-removal rule remaining. Monotonic expiry can close early but not delete a UTC-valid marker. |
| N. Result release | Private bounded result has no outward publication before cleanup; closed-by-success validity-only release resamples after blocking cleanup. Failure/expiry/fault suppresses it, without reopening or caching. |
| O. Schema/paths | Four arrays minimum one plus observations minimum zero, all with one combined cap sixteen, is implementable. Strict Boolean/reference keys and Windows/POSIX rejection cases are clear; reject dangerous lexical forms rather than normalize them into another path. |
| P. Pins | Thirteen roles and separate authorization self hash are coherent. Host imports authorization without embedding its generated self hash: no mutual digest cycle. C2 requires another changed old pin, not automatically a fourteenth role. |
| Q. Inert data | Current v2/null package and historical records unchanged. Future templates' null/unreviewed/false defaults cannot satisfy executable v3/v4 intake. |
| R. Focused tests | Eleven existing plus lifecycle/host new suites equals thirteen. Tests need C1 real console-lifetime assertions and C2 adapter-local pre-native-dispatch expiry injections, not fixture-only or wrapper-only success. |
| S. Regression | Nineteen distinct path items remain coherent; no 0109/0110 concatenation. Focused host suite plus full existing regression is sufficient inventory structure; corrections need not append a duplicate host run to regression. |
| T. Network | Bootstrap/focused proof needs no provider/external access. Future loopback regression needs separate permission; otherwise full acceptance stops. None granted now. |
| U. Cutover | v4-only private acquisition path, v2 input rejection, separate old pools, inert planning and context-only 0113 are sound requirements; implementation must prove them. |
| V. Determinism | Not sufficient yet: actual console lifecycle and native dispatch-fence ownership remain security-sensitive choices. Stop for scope/plan correction. |

## Local descriptor evidence and nonblocking notes

A second isolated probe on Node v24.13.1 loaded a temporary CJS main, completed its
exports assignment, tightened its own cache/exports descriptors, and required it
again after loading. Observed:

```text
before cache/exports: writable=true, configurable=true
after cache/exports: writable=false, configurable=false
module.loaded=true; cached require returned same exports
strict deletion threw; non-strict deletion returned false; exit=0
```

Together with embedded loader inspection, this supports descriptor feasibility;
it does not substitute for future four-module circular/bootstrap/failure tests.
No global loader patching or production cache modification occurred.

Nonblocking notes: explicitly cover inert preloads before host startup, pinning
failure after partial descriptor changes, Windows alias/case paths, and unexpected
EOF/console shutdown cleanup in the corrected host tests. These do not authorize
broader policy changes. Descriptor tests must remain child-isolated; immutable
entries cannot be undone inside a shared test process.

## Preservation and next milestone

The corrected plan, failed review, scope review and lifecycle design are unchanged.
Only this renewed review and readiness outcome are written in the repository.
Current package lifecycle stays null. Runtime/tests, qualification evidence and
migrations remain unchanged; no host was created. Local temporary Node behavior
probes were removed, and no project suites/typechecks were run. Index/HEAD unchanged.

Next milestone: narrow scope/plan correction for C1 console lifetime and C2 actual
post-validation native dispatch fencing, including explicit adapter scope/pin impact,
then renewed plan review. Separate implementation authorization may NOT yet be
requested. No implementation, provider/live execution, lifecycle activation, input
promotion, 0114D preparation, deployment, staging, commit or push authority is granted.
No credentials/secrets, capsule, provider, external or loopback network was accessed.
