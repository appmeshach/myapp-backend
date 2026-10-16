# 0114J frozen implementation report

Date: 2026-10-16

Starting and current HEAD: `6b074843e6e3bd2ea853489f2a6e01a3a8b2327e`

Branch: `feature/0092-shared-segment-suitability`

Outcome: `INDEPENDENT_IMPLEMENTATION_REVIEW_PASS`

Real PTY acceptance result: `PASS_GIT_FOR_WINDOWS_WINPTY`

Provider/live/package/deployment authority: false

## Scope implemented

The patch implements the frozen B1 lifecycle owner in authorization, the five
immutable owner-host bindings, RC1/RC2/RC3, the RS1 constant writer bridge, private
wrapper and identity lifecycle carriage, and the C2 adapter-local final dispatch
fence for requests 1, 2 and 3. The request-1 path is the corrected
`acquireServices` path. No sixth production runtime file or fourth request was
introduced.

The production runtime boundary is exactly:

1. `scripts/assessment-worker/qualification-railway-acquisition-owner-host.cjs`
2. `scripts/assessment-worker/qualification-railway-live-authorization.cjs`
3. `scripts/assessment-worker/qualification-railway-acquisition-wrapper.cjs`
4. `scripts/assessment-worker/qualification-railway-target-identity.cjs`
5. `scripts/assessment-worker/qualification-railway-https-adapter.cjs`

Authorization owns strict v3 input/v1 activation validation, bounded evidence reads,
canonical assertion claims, the 64-entry admission cap, UTC high-water and monotonic
deadlines, clock-fault latching, closed-marker retention and the original lifecycle
carrier. The owner host validates genuine plain-Node main ownership, seals the five
canonical cache and `Module.exports` bindings, enables one original graph, exposes a
frozen bounded facade, starts the native REPL, and uses one first-cause terminal
latch. Wrapper, identity and adapter retain only their approved private associations.

The real current package and evidence remain unchanged:

- `docs/0114e-current-acquisition-input-review.json` remains v2, incomplete,
  unpromoted and lifecycle-null with its historical 12-pin identity.
- `docs/0114e-qualification-target-evidence.json` remains unchanged.
- Inert future templates use v3/v4 and the stabilized 13-pin identity.
- No activation record was created.

## Source identity

`SOURCE_HASHES` contains exactly 13 roles. Relative to the reviewed HEAD, the changed
old roles are acquisition wrapper, target identity and HTTPS adapter; the new role is
the acquisition owner host; the other nine old roles are unchanged.

- Owner-host SHA-256: `17b3a74ac9a421c783876f5255fc02d5bffe2299efb2a53495f07f263a663bea`
- Authorization self SHA-256 before remediation: `5a3d3c0d0ab393e5e34c3c39dc9c02ef35a3a8f54578f4cd356614119cabdec8`
- Authorization self SHA-256 after remediation: `a1da1eec17b431009e8b580fe0480884b73d4c05334ec860c19c66c46b53d178`
- Corrected policy SHA-256: `29a51ba9633c9b734e833b38b754e3d5000f9c76661a277f19093f22d5be12e5`

All 13 source pins matched canonical current bytes. All required inert templates
matched the separate authorization self hash. There is no host-to-authorization
digest cycle.

## Deterministic validation

The exact 14 focused suites passed in one serialized command with zero failures.
The post-remediation aggregate was 1,528 total, 1,528 passed, 0 failed and 0
skipped:

1. `0110_railway_first_live_preflight.test.cjs`
2. `0111_railway_target_identity.test.cjs`
3. `0112_context_result_transfer.test.cjs`
4. `0113_first_context_wrapper.test.cjs`
5. `0114a_service_review_authorization_foundation.test.cjs`
6. `0114b_project_services_transport.test.cjs`
7. `0114c_service_instance_transport.test.cjs`
8. `0114d_acquisition_wrapper.test.cjs`
9. `0114e_acquisition_input_review.test.cjs`
10. `0114f_target_metadata_evidence.test.cjs`
11. `0114h_service_name_compatibility.test.cjs`
12. `0114j_lifecycle_authorization.test.cjs`
13. `0114j_executable_owner_host.test.cjs`
14. `0114j_native_dispatch_fence.test.cjs`

The exact unchanged 19-path regression inventory passed in one serialized command,
with 1,117 total, 1,114 passed, 0 failed and three documented OS skips, including its
authorized loopback-only coverage. The three exact installed TypeScript checks passed
(3/3), covering the root, Supabase functions and assessment worker scopes:

- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/typescript/bin/tsc --project supabase/functions/tsconfig.json`
- `node node_modules/typescript/bin/tsc --project scripts/assessment-worker/tsconfig.json`

`git diff --check` passed. `package.json`, `scripts/assessment-worker/run.cjs`, all
migrations, the current package and the qualification evidence have no tracked diff.
The index remained empty.

## Native signal and PTY acceptance

### Initial unavailable attempt

The exact host booted in the available PTY and an original-graph synthetic lifecycle
package was supplied through process-local in-memory filesystem shims. It completed
strict review and manual authorization and produced an active original ticket before
entering genuine synchronous native evaluation.

The validation environment could not deliver a supported interrupt to that blocked
VM. Writing Ctrl+C bytes to the hidden Windows PTY did not interrupt synchronous
evaluation. A separate Windows console API helper successfully attached to the Node
console and reported successful `GenerateConsoleCtrlEvent(CTRL_C_EVENT)`, but the
blocked VM still received no observable interruption and the writer was not reached.
The process was then forcibly stopped solely to clean up the failed acceptance probe.

A separate idle-host PTY probe ended the command wrapper with exit code 1 when Ctrl+C
was injected; it did not produce the required host-owned exit 130 evidence. WSL did
not provide a usable installed Node PTY path. Consequently no valid idle, multiline,
unresolved-await or VM-consumed signal pass can be claimed in this environment.
No contrary VM Error shape or writer ordering was observed because the required
signal was never delivered.

That first environment result remains recorded as
`REAL_PTY_ACCEPTANCE_UNAVAILABLE`; it was not a runtime-design finding.

### Git-for-Windows WinPTY retry

The retry used `C:\Program Files\Git\usr\bin\winpty.exe` with
`C:\Program Files\Git\bin\bash.exe` and Windows Node v24.13.1 at
`/c/Program Files/nodejs/node.exe`. Git Bash reported stdin, stdout and stderr as
TTYs. The WinPTY-backed device was the verified `/dev/cons1` environment.

Fresh exact owner-host processes produced these results from one Ctrl+C each:

- Idle REPL: terminal, no second press, exit 130.
- Native multiline input: terminal, no clear/resume, exit 130.
- Unresolved top-level await: terminal, no evaluator result or resumed Node prompt,
  exit 130.
- A scheduled process `SIGINT`, delivered after native evaluation restored process
  listeners, independently reached terminal exit 130. A synchronous in-evaluation
  `process.emit('SIGINT')` did not impersonate that route, confirming the expected
  listener-removal distinction.

For the RS1 proof, the exact sealed owner host admitted an original-graph synthetic
lifecycle package through process-local in-memory file shims, completed both human
review gates and manual authorization, and issued an active original ticket. During
genuine native evaluation of `for(;;){}`, one WinPTY Ctrl+C was consumed by
`breakEvalOnSigint:true`. The process reached the fixed writer's only terminal branch
and exited 130. That branch is guarded by captured `util.types.isNativeError`, an own
property descriptor, a data `value`, and the exact primitive string
`ERR_SCRIPT_EXECUTION_INTERRUPTED`; therefore the observed exit establishes all four
actual interruption-shape predicates without constructing a synthetic Error.

No writer result marker or usable Node prompt was published after interruption. An
exit listener running after the host terminal latch reported
`CLOSED=true DRAFT_BURNED=true`: the original ticket could not begin acquisition and
the original draft could not issue another review. This proves shutdown marked the
graph closed before process cleanup, prevented transport reopen and authority rearm,
and suppressed surviving draft/ticket authority. The private first-cause latch ran
the single cleanup path once before exit 130; WinPTY duplicated some rendered console
lines, but the process emitted one exit event and returned one status.

Real PTY and actual VM-consumed SIGINT result: `PASS_GIT_FOR_WINDOWS_WINPTY`.

## Semantic security gate

Codex Security was not installed or available within the authorized offline tool
boundary, and installation was prohibited. The gate therefore used the frozen
adversarial-review fallback against HEAD
`6b074843e6e3bd2ea853489f2a6e01a3a8b2327e`, the exact five-file runtime diff,
the source-pinned current bytes, focused security tests and local structural probes.

Outcome: `SEMANTIC_SECURITY_GATE_PASS_NO_BLOCKING_FINDINGS`.

| Attack category | Disposition |
| --- | --- |
| Owner-host acquisition-authority bypass | PASS: executable claim requires the private enabled host association. |
| Copied/reloaded/preloaded graph | PASS: genuine main identity, preload rejection and sealed canonical cache entries deny upgrade/reload. |
| Cache/exports binding bypass | PASS: five captured Module/cache identities and final exports descriptors are immutable before enablement. |
| REPL/private capability leak | PASS: bounded frozen facade exposes no seal, maps, carrier, connector, fence or installer. |
| Reset/.clear second authority | PASS: reset rebinds the same facade and creates no owner or enable path. |
| Output/custom-inspection leakage | PASS: preview is false and the captured writer returns one constant without inspection/coercion hooks. |
| Stale capability reuse | PASS: original weak-map handles burn before validation and every lifecycle carrier operation fences closed/expired state. |
| Expiry/rollback/high-water bypass | PASS: captured UTC/monotonic clocks, high-water fault latch and original dual deadline fail closed. |
| Transition TOCTOU | PASS: lifecycle checks cover review, approval, authorization, redemption, session operations, human gates and result release. |
| Request 1/2/3 final-fence bypass | PASS: phase 1 completes before one adapter-private fence immediately adjacent to captured native request construction. |
| Public lifecycle hook | PASS: initialization connectors are one-use/deleted; no public setter, callback or replaceable fence remains. |
| Context downgrade/provenance confusion | PASS: acquisition requires its original permit/carrier; old context tickets cannot stretch to services or instance authority. |
| Terminal cleanup reuse | PASS: first cause latches, authorization revokes/closes first and carrier cleanup prevents EOF/signal continuation. |
| Cleanup/result race | PASS: successful release is close-first plus validity-only release; terminal paths publish no result. |
| Pin/self-hash bypass | PASS: 13 canonical pins and separate authorization self hash matched exact bytes; three/nine/one accounting is exact. |
| Credential exposure | PASS: host startup reads no credential; adapter reads only the fixed private source after lifecycle/context admission and never returns it. |
| Retry/fallback/fourth request | PASS: fixed policy remains three requests, zero retry, zero redirect and zero fallback. |
| Package/activation promotion bypass | PASS: strict v3/v1 intake is required; the real current v2 package remains rejected, unchanged and lifecycle-null. |
| Authority outside original graph | PASS: copies lack the main-host association and all executable carriers originate from authorization's private claim. |

RS1-specific review also passed: real VM interruption reached the captured native-
error/own-data-code classifier, terminal exit 130 suppressed prompt/result, the exit
audit proved closed/burned authority, and ordinary/reserved/accessor/inherited/proxy/
cross-context cases remain covered by the focused owner-host suite. No critical,
high, medium or low implementation finding remained open.

Approved design limitations remain: admission state is process-local rather than
durable across crashes; deliberate malicious mutation by the trusted local operator
is outside the reviewed threat model; native pre-writer stack preparation remains a
trusted Node behavior. WinPTY duplicated some rendered console lines but did not
duplicate process exit, cleanup or authority transitions.

At that checkpoint, independent implementation review had not occurred and was the
exact remaining gate. It was not claimed from the same-author implementation/security
pass.

## Post-remediation B1/B2/B3 checkpoint

A subsequent genuinely independent implementation review blocked acceptance on three
confirmed findings: `B1_FUTURE_REVIEWED_AT_ACCEPTED` (HIGH),
`B2_ATTEMPT_REFERENCE_BOUND_NOT_ENFORCED` (MEDIUM), and
`B3_MISSING_CLOSED_MARKER_OWNER_SWEEP_TIMER` (MEDIUM). Remediation was separately
reviewed and authorized. All three fixes are now implemented and the remediation
implementation outcome is `REMEDIATION_IMPLEMENTATION_ACCEPTED`.

### B1 trusted review time and final admission fence

The validated private lifecycle snapshot now retains `reviewedAtMs`. Initial claim
admission requires `reviewedAtMs <= u < expiresAtMs` using captured trusted clocks.
The original monotonic deadline is computed once from that valid sample and is never
extended or recomputed. Immediately before synchronous insertion, the final pure
pre-claim fence resamples trusted clocks and repeats the review-time, UTC-expiry,
original monotonic-deadline, host, revocation, index, clock-fault and capacity checks.

The equality boundary passed. A `reviewedAt` exactly one millisecond beyond trusted
UTC was rejected before claim, timer creation, credential access, context creation,
request construction, either human gate or result production.

### B2 attempt-reference bound

Authorization now uses a private attempt-reference-specific validator. It preserves
the approved ASCII character set and secret/token denial convention, accepts 1..128
characters, and applies only to `record.attemptReference`. General reference fields
remain 1..256. The 128-character boundary passed, the 129-character boundary was
rejected before claim, and reverse-index collision semantics remained unchanged.

### B3 closed-marker owner sweep

Authorization now privately owns one closed-marker sweep timer handle, its scheduled
UTC deadline and a generation identity. The earliest retained closed-marker expiry
owns the timer. An earlier deadline replaces the current timer; a later closure cannot
postpone it. An early callback deletes nothing and reschedules, a delayed callback
removes all UTC-due markers and matching indexes in one trusted sweep, and a stale
generation callback is inert.

Rollback or an invalid clock latches the process clock fault, cancels the owner timer,
closes live graphs through the no-reschedule path and retains all markers and indexes.
UTC high-water survives an empty table. Monotonic-only closure retains its marker
until UTC expiry. Sixty-four retained markers block a sixty-fifth claim; valid UTC
cleanup restores capacity and removes the matching reverse indexes. Repeated close
remains idempotent, claimed-entry timers coexist with the single closed-marker timer,
and cleanup cannot rearm authority.

### Post-remediation source identity and deterministic validation

The authorization self hash changed from
`5a3d3c0d0ab393e5e34c3c39dc9c02ef35a3a8f54578f4cd356614119cabdec8` to
`a1da1eec17b431009e8b580fe0480884b73d4c05334ec860c19c66c46b53d178`.
Exactly 13 runtime source roles remain. Independent verification returned
`roleCount = 13` and `bad = []`; every role hash is unchanged. The authorization
self hash remains separate, so no digest cycle exists. The protected current
historical v2/12-pin package and evidence remain unchanged.

Post-remediation validation passed in the frozen inventories: 14 focused suites
(1,528 total, 1,528 passed, 0 failed, 0 skipped), 19 regression paths (1,117 total,
1,114 passed, 0 failed, three documented OS skips), and all three TypeScript scopes
(root, Supabase functions and assessment worker). `git diff --check` passed. The
protected package, protected evidence, `package.json`, `run.cjs` and all migrations
remain unchanged.

### Post-remediation Git-for-Windows WinPTY replay

Because authorization bytes changed, the full PTY acceptance was rerun with Git Bash
at `C:\Program Files\Git\bin\bash.exe`, WinPTY at
`C:\Program Files\Git\usr\bin\winpty.exe`, and Node v24.13.1. The replay used the
exact sealed main host, original module graph, synthetic reviewed lifecycle bytes and
process-local read-only file shims. It used no provider credential, Railway request or
provider network.

One Ctrl+C produced exit 130 at idle, during multiline input and during unresolved
top-level await. Scheduled process `SIGINT` remained a distinct path and exited 130.
One Ctrl+C during synchronous native `for(;;){}` evaluation also exited 130. The
active lifecycle replay passed.

Runtime instrumentation observed `util.types.isNativeError` accept a native-branded
Error, an own `code` property with a DATA descriptor, and the exact primitive value
`ERR_SCRIPT_EXECUTION_INTERRUPTED`. The shutdown audit recorded `graphState: closed`,
`closeReason: host_shutdown`, `shutdownCalls: 1`, `exitCalls: 1`,
`resultObserved: false`, and `transportCalls: 0`. No usable `movement>` prompt followed
the interruption. A new draft was denied after shutdown; authority did not rearm and
transport did not reopen.

This post-remediation replay closed the previously open evidence gaps:

- `EVID_PTY_ACTIVE_GRAPH_TRANSCRIPT_MISSING`: `CLOSED`
- `EVID_PTY_ACTIVE_LIFECYCLE_REPLAY_NOT_RECONSTRUCTED`: `CLOSED`
- `EVID_VM_NATIVE_DESCRIPTOR_NOT_RUNTIME_INSTRUMENTED`: `CLOSED`

Their earlier open state remains part of the historical record above.

### Post-remediation semantic security gate

Only after runtime and self-hash stabilization, focused and regression validation,
all three TypeScript checks, protected-boundary checks, source-pin verification and
PTY/VM re-acceptance, the frozen semantic adversarial security gate was rerun. Its
outcome was `SEMANTIC_SECURITY_GATE_PASS_NO_BLOCKING_FINDINGS`, with zero CRITICAL,
zero HIGH and zero MEDIUM findings.

At the documentation checkpoint immediately before final independent review, the
status was `REMEDIATION_IMPLEMENTATION_ACCEPTED_INDEPENDENT_REVIEW_PENDING`. It
recorded the accepted B1/B2/B3 remediation and all passing validation without
preclaiming an independent verdict.

## Final post-remediation independent implementation review

The final genuinely independent reviewer did not author the original implementation,
the B1/B2/B3 remediation or the preceding documentation checkpoint. The reviewer
modified no files. The index remained empty, and the protected capsule remained
unread, unhashed, unmodified and unstaged.

Primary outcome: `INDEPENDENT_IMPLEMENTATION_REVIEW_PASS`.

The three blockers from the first independent review are independently verified
closed:

- `B1_FUTURE_REVIEWED_AT_ACCEPTED`: `CLOSED`
- `B2_ATTEMPT_REFERENCE_BOUND_NOT_ENFORCED`: `CLOSED`
- `B3_MISSING_CLOSED_MARKER_OWNER_SWEEP_TIMER`: `CLOSED`

### Final B1/B2/B3 results

B1 passed. `reviewedAt` equal to current trusted UTC passes; trusted UTC plus one
millisecond is rejected before claim, timer, credential access, context, request,
human gate or result. The final pre-claim clock resample passed, the monotonic deadline
is captured once, deadline extension is impossible, and high-water/rollback behavior
passed.

B2 passed. A 128-character `attemptReference` passes, 129 characters are rejected
before claim, general reference fields retain their 1..256 behavior, and reverse-index
semantics are preserved.

B3 passed. The reviewer verified the one private owner sweep timer, nearest-expiry
selection, earlier-deadline replacement, later-deadline non-postponement, early and
delayed callbacks, inert stale callbacks, fail-closed rollback and invalid clocks,
high-water persistence, monotonic-only marker retention, 64/65 capacity behavior,
matching reverse-index cleanup, idempotent repeated close, active per-entry timer
coexistence and absence of authority rearm.

### Final architecture, identity and validation results

The five immutable bindings, owner host, RC1, RC2, RC3, RS1 and C2 passed. The design
retains exactly 21 conceptual transitions. Rows 10/12/16 remain adapter-local final
native-dispatch fences; row 21 remains validity-only result release after cleanup;
transition 9 credential reading remains valid under the frozen design.

The final authorization self hash is
`a1da1eec17b431009e8b580fe0480884b73d4c05334ec860c19c66c46b53d178`.
All 13 source-role hashes are valid, the authorization self hash remains separate,
no digest cycle exists, the five inert templates are correct, and the protected
current historical v2/12-pin state remains preserved.

The exact 14-suite focused result remains 1,528 total, 1,528 passed, 0 failed and
0 skipped. The exact 19-path regression result remains 1,117 total, 1,114 passed,
0 failed and three documented OS skips. All three TypeScript scopes passed: root,
Supabase functions and assessment worker. `git diff --check` passed.

### Final PTY/VM and security results

The independent reviewer found the Git-for-Windows WinPTY to Git Bash to Node
v24.13.1 exact sealed-host evidence sufficient. The active-lifecycle replay was
sufficient and passed. Runtime evidence directly supports native Error branding, an
own DATA `code` descriptor and the exact primitive
`ERR_SCRIPT_EXECUTION_INTERRUPTED`. It supports an active graph before interruption,
a CLOSED graph before process cleanup, exactly one cleanup, result and prompt
suppression, no transport reopen, no authority rearm, and exit 130.

The prior evidence gaps remain closed:

- `EVID_PTY_ACTIVE_GRAPH_TRANSCRIPT_MISSING`: `CLOSED`
- `EVID_PTY_ACTIVE_LIFECYCLE_REPLAY_NOT_RECONSTRUCTED`: `CLOSED`
- `EVID_VM_NATIVE_DESCRIPTOR_NOT_RUNTIME_INSTRUMENTED`: `CLOSED`

The independent security review covered the original frozen categories and the
remediation-specific B1/B2/B3 threats. Findings were zero CRITICAL, zero HIGH, zero
MEDIUM and zero LOW. No authority or invariant blocker remains.

Current 0114J status: `INDEPENDENT_IMPLEMENTATION_REVIEW_PASS`, equivalently
`0114J IMPLEMENTATION ACCEPTED BY INDEPENDENT REVIEW`.

## Authority and repository state

No Railway, Supabase project API, provider API, production, deployment, migration,
package promotion, lifecycle activation, credential or secret access occurred. The
protected `0102-remote-fixtures.capsule` remained unread, unhashed, unmodified and
unstaged. No package was installed. Nothing was staged, committed or pushed.

This implementation supplies no provider, Railway, live, package-promotion,
deployment, production, migration or credential authority. It remains uncommitted
WIP; no staging, commit or push has occurred or been authorized by this review. The
exact next milestone is a separately authorized repository-integration decision.
Revalidate every changed runtime byte and dependent identity after any further
runtime change.
