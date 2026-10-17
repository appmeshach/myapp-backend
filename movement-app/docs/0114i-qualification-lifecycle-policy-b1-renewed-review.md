# 0114I renewed B1 design review

reviewerReference: Codex-B1-renewed-review

reviewedCommit: `30bf97347fa0e88272bdf02c973949349ca61f74`

reviewedBranch: `feature/0092-shared-segment-suitability`

reviewedArtifact: [Corrected 0114I design](0114i-qualification-lifecycle-policy-design.md)

priorReview: [Historical design review](0114i-qualification-lifecycle-policy-independent-review.md),
reviewing commit `09c2f7e8cb6592f2595d75228577a570d3dd7c12`

outcome: B1_CLOSED_WITH_NONBLOCKING_NOTES

B1ClosedByDesign: true

implementationPlanningMayProceed: true

implementationAuthorized: false

This is a renewed critical review pass by the same Codex assistant that authored
the design/correction and performed the prior review. It does not claim independent
human approval or independence from the author. The reference identifies this review
pass, not AT or a human lifecycle reviewer. Approval here is limited to B1 design
sufficiency for separate implementation planning and review under the stated trust
model. It is not proof of implemented enforcement or actual target eligibility.

## Review basis and invariant

Read the corrected design, prior review and readiness register, and inspected the
existing authorization owner, wrapper and relevant authorization/wrapper tests.
Current v3 stores ticketIssued per draft and burns original tickets/permits. The
corrected future design adds the previously missing assertion-level owner table;
existing source/tests are evidence of architecture, not evidence that this table
or new expiry semantics already exist. No test execution was needed for this review.

The corrected design establishes: within one trusted process, one canonical
activation record may be admitted into at most one acquisition authority graph.
Every admissible route must reach one synchronous owner check/insert before any
context-review capability or published draft. The first inserts claimed; another
route sees claimed/closed and cannot publish a second graph. The original claim
alone progresses through existing private authorities. Terminal closure cannot
release its key before expiry. After cleanup, strict expiry and retained clock
high-water checks prevent admission. This addresses the two-draft counterexample
in the prior review without requiring durable coordination.

## Mandatory 45-point checklist

YES evaluates the corrected design requirement, not implementation completion.
There are no NO or NEEDS_CHANGE answers and no blocking corrections requested.

| # | Review point | Result |
| --- | --- | --- |
| 1 | Sole admission owner explicit | YES |
| 2 | All executable same-process routes share that owner | YES |
| 3 | Canonical identity independent of path/object identity | YES |
| 4 | Owner recomputes assertionKey | YES |
| 5 | Canonical bytes and subject/attempt bindings checked on key match | YES |
| 6 | Collision/consistency mismatch fails closed | YES |
| 7 | attemptReference non-authoritative | YES |
| 8 | Reverse-index semantics coherent | YES |
| 9 | unseen/claimed/closed sufficient | YES |
| 10 | Admission bookkeeping is not executable authority | YES |
| 11 | Atomic claim precedes review capability/ticket issuance | YES |
| 12 | Synchronous non-reentrant claim prevents duplicate admission | YES |
| 13 | Claim bound to original private draft/graph | YES |
| 14 | Second draft cannot attach | YES |
| 15 | Duplicate rejection preserves legitimate first graph | YES |
| 16 | Post-claim exception closes original claim | YES |
| 17 | Cancellation before ticket issuance closes claim | YES |
| 18 | Cancellation before redemption closes claim | YES |
| 19 | Manual authorization rejection closes claim | YES |
| 20 | Post-claim validation/setup failure closes claim | YES |
| 21 | Provider/transport failure closes claim | YES |
| 22 | Human rejection closes claim | YES |
| 23 | Timeout closes claim | YES |
| 24 | Owner-handled crash/exception closes claim | YES |
| 25 | Successful completion closes claim | YES |
| 26 | Explicit revocation closes claim | YES |
| 27 | Expiry closes abandoned drafts/tickets/runs | YES |
| 28 | Closed markers non-rearmable through expiresAt | YES |
| 29 | Restoring bytes/path/wrapper cannot reopen | YES |
| 30 | Marker cleanup occurs only after expiry | YES |
| 31 | Cleanup cannot make expired assertions admissible | YES |
| 32 | Rollback fails closed after marker cleanup | YES |
| 33 | Capacity exhaustion rejects rather than evicts live markers | YES |
| 34 | Fresh attempt requires genuinely new independent record review | YES |
| 35 | Target not permanently consumed | YES |
| 36 | Cross-process limitation explicit | YES |
| 37 | No silent durable coordination/database | YES |
| 38 | No public admission registry/getter/reset | YES |
| 39 | Wrapper cannot mint/release/reassign claims | YES |
| 40 | Ticket/permit burn-before-validation preserved | YES |
| 41 | Three-request ceiling unchanged | YES |
| 42 | Thirty-minute rule unchanged | YES |
| 43 | Current package lifecycle remains null | YES |
| 44 | No production authority created | YES |
| 45 | Fail-closed requirements sufficient for B1 | YES |

## A. Owner domain

Accepted for the current trusted-process scope. "Sole owner and canonical identity"
explicitly requires every executable admission route to use the same trusted owner
instance and forbids reload/replacement from creating another admission domain.
Wrapper replacement cannot transfer a claim. The existing literal-owner linkage,
deleted initialization connectors and private graph checks are compatible with this
requirement. They do not by themselves prove that a newly implemented path cannot
instantiate a second owner; that must be demonstrated in implementation review.

The implementation plan must enumerate executable entry/import paths and specify
how unsupported alternate loads, duplicated owner instances and replacement pairs
fail closed. A fresh owner-wrapper pair with its own table must not be presented as
the same trusted admission domain. Other VM realms/worker isolates cannot silently
become alternate executable routes in that process. This is an explicit admission
boundary to preserve, not a demand for a public process-global registry. Arbitrary
host/module-loader compromise remains outside the existing trusted-host model.

## B. Atomicity

Accepted. In the existing single Node/CommonJS owner execution domain, synchronous
non-reentrant check/insert without await, callback, getter or caller hook prevents
another supported admission call from interleaving. The claim point is after passive
validation and before any review capability or published draft; it is earlier than
context approval and ticket issuance. No external lock or provider access is needed.
An exception immediately after insertion must close the claimed entry, as stated.
Do not extrapolate this reasoning to independent worker heaps with separate tables.

## C. Closure ownership and pre-handle failures

Accepted. The authorization owner alone updates admission state; the wrapper closes
execution resources and privately reports terminal exits. Marking closed precedes
cleanup that might throw, so cleanup failure cannot permit readmission. The original
draft supports cancellation before ticket issuance/redemption without a public
registry lookup. Copying a handle cannot cancel the genuine graph.

The required cleanup obligation exists before redemption/setup can throw, including
before run-handle creation and context opening. This covers the gap that relying
only on a populated wrapper run entry would leave. The future plan must identify
that obligation's exact private carrier and prove all early exception paths. Existing
v3 wrapper setup code is not claimed to provide the new obligation already.

Manual rejection, validation/setup error, provider/transport error, human rejection,
timeout, handled exception, completion, revocation and expiry all close the same
claim. Invalid pre-claim inputs and rejected duplicate drafts cannot destroy another
claim merely by naming its digest. These are coherent, distinct ownership cases.

## D. Expiry retention and cleanup

Accepted. Claimed entries expire even if abandoned; closed markers and reverse-index
entries survive at least through expiresAt. Removing them after expiry cannot renew
the record because admission first applies strict validity checks. The process-local
UTC high-water value survives per-entry cleanup and rejects rollback before lookup;
the monotonic deadline bounds the original graph. Therefore restoring bytes after
cleanup cannot make the same expired record valid again within the trusted process.

The design sufficiently specifies the required behavior for planning. The plan
should define high-water sampling/update order across owner entries and expiry
callbacks and cover cleanup followed by rollback. Trusted initial UTC remains a
host assumption; delayed callbacks cannot permit subsequent expired actions/results.
No numerical expiry change or additional provider observation is required.

## E. Capacity bound

Accepted without a fixed number at this design stage. The safety property is already
deterministic: exhaustion rejects new admission and never evicts unexpired markers
or releases their reference indexes. The exact finite capacity and serialized-record
size limits may be selected with a memory budget during implementation planning,
then reviewed and tested before implementation approval. No permanent record leak
or durable table is needed; expiry cleanup releases retained per-record data.

## F. Cross-process scope and copies

B1 is closed for the stated trusted same-process domain. Canonical record content,
not a file path, wrapper or draft identity, supplies the key. A path copy or equivalent
JSON formatting reaches the same key; a different subject fails binding checks.
Key collisions require canonical-byte/binding comparisons and fail closed rather
than creating another bucket. Reference conflicts fail consistency checks without
turning the reference into authority. Editing the reference is reviewed-content
mutation, not a valid renewal; a fresh review remains a human trust-model obligation,
not something proved by a digest or a different reference string.

Hard process death cannot persist a volatile marker. The design states that fact
and prohibits automatic resume. A new process needs fresh operator/reviewer
admission and separate manual authorization. This limitation remains acceptable
for the trusted-operator qualification workflow. No durable coordination is needed
to close B1, and no global cryptographic replay guarantee is claimed. The target
itself remains reusable under a genuinely new reviewed activation assertion.

## Findings and next milestone

Blocking findings: none for B1 within the stated scope.

Nonblocking planning notes:

1. Enumerate the supported owner-loading domain and prove that alternate executable
   paths/reloads/duplicate instances cannot create a second table-backed domain.
2. Specify the private pre-run cleanup carrier and exercise failures immediately
   after claim, during redemption, and before a wrapper handle exists.
3. Specify clock high-water update/cleanup order and a finite capacity/size budget;
   test rollback after cleanup and exhaustion without live-marker eviction.

These notes make existing corrected requirements concrete for planning; they do not
change the policy or reopen unrelated lifecycle decisions. The corrected future
test plan includes duplicate drafts, copies, conflicting references, terminal
closure, restored bytes, expiry cleanup and collision simulations. Tests are not
implemented or run in this documentation-only review.

Next milestone: a separate implementation plan and review for the corrected lifecycle
policy, including these notes. Planning may proceed; runtime implementation requires
separate explicit authorization after that plan is reviewed.

## Preservation and authority limits

The design and prior review remain unchanged. The current package retains lifecycle
null; qualification evidence is unchanged. Only this renewed review and the readiness
register are added/updated. Runtime/tests and all migrations remain unchanged. HEAD
and index remain unchanged. Git whitespace/status/HEAD checks and the requested
protected-path diffs validate this documentation-only scope.

This outcome permits implementation planning and review only. It grants no runtime
implementation, test changes, package promotion, active assertion, target-evidence
resolution, 0114D preparation, provider access/observation, configuration, deployment,
restart, teardown, live acquisition, staging, commit or push authority. No provider,
network, credential/secret or capsule access occurred. No independent human lifecycle
approval is recorded.
