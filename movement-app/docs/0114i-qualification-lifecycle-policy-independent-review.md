# 0114I qualification lifecycle policy design review

reviewerReference: Codex-critical-review-0114I

reviewedCommit: `09c2f7e8cb6592f2595d75228577a570d3dd7c12`

reviewedBranch: `feature/0092-shared-segment-suitability`

reviewedArtifact: [0114I lifecycle policy design](0114i-qualification-lifecycle-policy-design.md)

overallOutcome: CHANGES_REQUIRED_BEFORE_IMPLEMENTATION_PLANNING

implementationPlanningMayProceed: false

implementationAuthorized: false

This is a separate critical review pass by Codex. The same assistant drafted the
design earlier in this conversation; this is not an independent human review or
proof of reviewer independence from the design's author. The reference identifies
this review pass only. It is not AT, a fabricated human approval or a lifecycle
operator/reviewer attestation. Findings below assess the committed artifact against
the source rather than treating the author's claims as established guarantees.

## Scope and source basis

Reviewed the design's predicate, evidence/record model, timing, terminal rules,
reuse, future cutover and test plan against the prior policy analysis, pending
lifecycle review, current input package, qualification evidence, 0114E procedure,
0114D wrapper description, reviewed 0114H design/implementation and readiness
register. Examined the target binder, authorization owner, identity owner and wrapper
sources and relevant 0107-0114 test cases. The current implemented contract is v3;
historical v2 descriptions do not override it.

The current package remains incomplete with lifecycle and instance expectation null.
Existing project provenance and disposable review do not establish active. No new
policy, runtime semantics or target evidence is implemented by this review.

## Mandatory 25-point review

YES means the design states an acceptable rule; it does not certify implemented
behavior or actual target eligibility. NEEDS_CHANGE identifies a blocking design
gap explained in B1. No checklist answers are copied into the design itself.

| # | Review point | Result | Basis |
| --- | --- | --- | --- |
| 1 | Active meaning unambiguous | YES | Exact administrative eligibility predicate and package/attempt scope. |
| 2 | Distinct from provider service status | YES | No running/healthy/provider-identity implication. |
| 3 | Not implied by disposable alone | YES | Explicitly necessary but insufficient. |
| 4 | Exact identity binding preserved | YES | Scope, name/ID association, nullable expectation and package digest remain bound. |
| 5 | Inventory relationship explicit | YES | Complete reviewed inventory and exact exclusions required. |
| 6 | Source configuration relationship explicit | YES | Applied settings unnecessary; known contextual drift revokes. |
| 7 | Deployment relationship explicit | YES | Separate authority, not an eligibility status. |
| 8 | Service health relationship explicit | YES | Health alone does not define lifecycle; acquisition error remains terminal. |
| 9 | Host relationship explicit | YES | Separate mandatory execution gate; bound-review drift invalidates. |
| 10 | Provider observation relationship explicit | YES | Existing evidence may support review; insufficient knowledge blocks, no automatic lookup. |
| 11 | Activation event explicit | YES | Distinct reviewer finalizes exact subject at reviewedAt. |
| 12 | Expiry/freshness explicit | YES | Thirty-minute absolute ceiling plus UTC/monotonic checks and terminal timer. |
| 13 | Revocation events explicit | YES | Withdrawal, disqualification, drift and teardown/deletion specified. |
| 14 | Cancellation semantics explicit | YES | Closes assertion even before redemption; B1 addresses ownership needed to enforce it. |
| 15 | Failure semantics explicit | YES | Terminal, including failed start/crash, without retry/resume. |
| 16 | Completion semantics explicit | YES | Closes assertion, grants no further authority. |
| 17 | Teardown/deletion semantics explicit | YES | Known obligation/event disqualifies; no teardown authority. |
| 18 | Code/source drift semantics explicit | YES | Invalidates bound review; no silent hash refresh. |
| 19 | Reinstatement rules explicit | YES | New assertion/reference/review and separate authorization. |
| 20 | Consumption/reuse semantics explicit | NEEDS_CHANGE | Intended rule is explicit, but assertion-level closure across multiple drafts lacks an owner/state rule: B1. |
| 21 | Hidden global mutable state unnecessary | YES | An explicitly documented private per-owner admission table can close B1; no durable global registry is necessary. |
| 22 | One-shot authorization architecture preserved | NEEDS_CHANGE | Existing capabilities stay one-use, but that does not enforce one activation record/one attempt across drafts: B1. |
| 23 | Production authority excluded | YES | Disposable requirement and forbidden-scope gates preserved. |
| 24 | Design requires no provider access | YES | Can design and test locally; new observations separately authorized. |
| 25 | Fail-closed behavior preserved | NEEDS_CHANGE | Duplicate or restored activation records must be rejected at the assertion level, not merely when replaying one ticket: B1. |

## Blocking finding B1: one-use capability is not one-use activation record

Severity: blocking before implementation planning.

Exact locations in the reviewed design:

- "Selected semantics and exact active predicate", lines 66-96: one exact package
  and one intended attempt; assertion must not be closed or replaced.
- "Revocation, terminal events and reuse", lines 205-207 and 222-237: no reuse
  after cancellation/failure/completion, redemption reserves the assertion, while
  the stated runtime guarantee covers the original capability graph.
- "Future implementation and compatibility", lines 259-263: lists new checks and
  owners but does not assign assertion-level admission/deduplication state.

In the current authorization source, createExecutableAcquisitionDraft creates a
fresh entry every call. authorizeAcquisition checks ticketIssued on that entry;
ticket redemption and target-permit consumption burn their respective original
objects. There is no activation-record identity because v3 predates this policy.
The existing wrapper tests prove the same ticket cannot fork/replay; they do not
prove that the same reviewed inputs cannot create separately reviewed drafts.
This is a gap in the proposed extension, not a regression allegation against v3.

A future implementation could follow all specified digest/expiry checks yet create
drafts D1 and D2 from the same valid P/R before expiry. Separate package approvals
and matching manual acknowledgements could then issue T1 and T2. Both tickets
are genuinely one-use, but R has authorized two attempts. Copying R to another path
does not change this semantic problem. Likewise, withdrawing and restoring old
package bytes after a terminal event could satisfy the same digest checks again.
No forged permit or provider access is needed to expose this design omission.

Smallest required correction, to be made in a separate design-correction milestone:

1. Name one existing private authorization owner as the sole admission owner for
   an activation record/attempt within that trusted process. Define explicit state
   keyed by canonical activation-record identity, with collision checks for the
   attemptReference and bound subject. File paths and opaque draft identities alone
   must not distinguish copies of the same assertion.
2. Define the atomic claim point no later than first authority issuance. Before
   any second ticket can be issued, all drafts referencing the same assertion must
   encounter the same claimed/closed state. Bind the claim to the original private
   draft/run; preserve existing ticket/permit burn-before-validation behavior.
3. Define how pre-redemption cancellation/revocation and every terminal exit mark
   that assertion closed, including failed setup. Retain a non-rearmable closed
   marker through its validity window. Restoring bytes, changing paths or making a
   new draft must not release that marker. State must never be exposed as authority.
4. Add acceptance cases to the future test plan for two drafts before redemption,
   copies at different paths, conflicting reuse of an attemptReference, and fresh
   draft creation after cancellation/failure/completion or withdrawal/restoration.

This is an explicit private per-process ownership extension, not hidden global
mutable state or a new provider/durable coordination service. It does not strengthen
cross-process claims. If a different mechanism is chosen, the corrected design
must demonstrate the same invariant before planning is approved. No correction is
implemented or silently inserted into the design by this review.

## Special-question findings

### A. Thirty-minute bound

Accepted as a reasonable proposed upper bound; no numerical change requested. It
allows the two existing five-minute human waits plus execution margin, while the
absolute ceiling prevents those waits from extending eligibility indefinitely.
This is a safety/architecture judgment, not a measured availability guarantee.

Starting near expiry is acceptable: it deliberately risks an incomplete attempt,
never an extension. The earlier of absolute expiry, monotonic remaining lifetime,
transport timeout and human-gate deadline must apply. Expiry during a request/wait
must close the context, reject late continuations and suppress result issuance.
Those are explicit design requirements, not current runtime behavior.

UTC validates the external review window; monotonic time prevents extending a run
after admission. A trusted host clock at initial admission remains necessary.
Timers are not hard real-time guarantees: an event-loop stall or UTC jump must not
permit a later request, decision or result after the next validity check. The plan
should make that timing assumption explicit and test delayed callbacks; no additional
provider observation is needed to do so.

### B. Review independence

Same-person operator/reviewer is prohibited by the proposed policy and is not
acceptable. The operator asserts allocation authority/current knowledge; a distinct
human independently reviews the evidence and mapping. Real independence is reviewed
evidence, not cryptographically established by a reference string. Runtime should
reject identical identity references and missing attestations; different aliases
alone must never be claimed to prove distinct people. No new identity provider or
provider request is needed. Record this distinction in the implementation plan.

### C. Attempt binding

attemptReference is acceptable as a non-secret audit association, not a capability
or source of authority. It is insufficient for deduplication by itself. One-package/
one-attempt behavior is feasible within the trusted process model, but the proposed
checks do not yet adequately prevent duplicate admission through new drafts or
copied records. B1 is required; one-use ticket tests alone cannot close it.

### D. Cross-process replay

The limitation is honestly stated and acceptable for this trusted-operator read-only
qualification workflow, conditional on fresh human admission and separate manual
authorization for a new process. No automatic restart or replay is allowed. Durable
coordination is not required now. If unattended/multi-process hostile replay becomes
part of the threat model, stop for a separate coordination design. B1 is an
in-process omission and cannot be excused by this cross-process limitation.

### E. Audit records

Explicit operator-maintained append-only local records are sufficient at this scope,
subject to B1. The immutable activation record is normative reviewed eligibility
evidence bound by digest; it is never executable authority. Attempt-event history
is descriptive execution history and also a deny-only input to the operator's
required new-process admission check. A prior event can prevent reuse; no event
can mint permission. This distinction should be explicit in the later plan.

No hidden state is introduced by this review. An explicit private owner table for
B1 is permissible. Runtime should not treat a missing event as proof an attempt
never happened. Unknown, conflicting or incomplete required history must block
human readmission. Preserve immutable records and terminal events under the existing
trusted local-host/operator model. Hashes detect changes relative to reviewed
bindings; they do not prove append-only history or protect against a malicious host.
A cryptographic ledger/signing service is not required for this scope.

### F. Legacy bypass

Accepted at the design-requirement level: new v3 input/v4 executable versions,
strict rejection without fallback, and an explicit prohibition on an executable
legacy acquisition bypass. The implementation plan must enumerate all executable
entry paths and test that older acquisition routes cannot reach context opening or
services/instance requests without the new checks. Retain historical conformance
as archived evidence, not a live bypass. Planning/context-only namespaces must not
gain continuation. No concrete cutover is implemented or certified by this review.

## Nonblocking notes and implementation direction

- Accept thirty minutes unchanged; document trusted initial UTC and delayed-timer
  behavior as described in A.
- Reject identical operator/reviewer references structurally, while retaining human
  responsibility for actual identity/independence as described in B.
- Clarify the normative activation record versus descriptive/deny-only event history
  and fail closed on unknown required readmission history as described in E.
- Versioned package/manifest binding, current canonical hashing and existing owners
  are reasonable directions. No new provider operation or database migration is
  needed. Three requests, both human gates, nullable instance handling, exact name/ID
  checks and credential ordering must remain explicit acceptance criteria.

## Disposition, preservation and authority limits

Implementation planning may not proceed on this unchanged design until B1 is
corrected and the correction reviewed. Next milestone: separately authorized narrow
0114I design correction plus renewed review. This review does not authorize that
edit automatically, and it does not authorize implementation.

The committed design is unchanged. Only this review artifact and the register entry
are added/updated. No tests are required or run; runtime/tests/current package,
fixtures/templates, historical/qualification evidence and all 99 migrations remain
unchanged. Git whitespace/status/HEAD checks validate this documentation-only scope.
HEAD and index remain unchanged. The existing untracked capsule remains unread and
untouched. No credentials, secrets, provider or network services were accessed.

No staging, commit, push, implementation, lifecycle promotion, package completion,
0114D preparation, provider observation, configuration, deployment, restart, teardown
or live acquisition authority is granted. This review records findings only and
does not resolve actual target evidence or assert independent human approval.
