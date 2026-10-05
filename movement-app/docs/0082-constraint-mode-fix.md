# 0082 caller constraint-mode preservation

Production source SHA-256 after this architectural fix:
`c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976`.
Historical migrations 0001–0081 are unchanged. 0082 remains uninstalled in the
application database; source verification uses rollback transactions or isolated
disposable clones. Nothing was staged, committed, pushed or changed remotely.

## Root cause and exact change

The former request/confirmation writers temporarily changed transaction-level
constraint modes and then assigned fixed final modes. That restored defaults,
not explicitly chosen caller modes. Successful subtransactions do not isolate
those mode changes. Replays already avoided the construction branch.

Both writers now execute **no SET CONSTRAINTS**. Request receipt insertion and
the matching journey timestamp update occur in one writable-CTE statement.
Confirmation receipt, positive component transactions, exact postings and both
completed lifecycle rows likewise occur in one statement. No historical wallet
trigger, constraint, privilege, role or timestamp rule was weakened or removed.

## Exact construction order and visibility

The existing agreement/alignment/accepted-offer/journey/member/account lock order,
wallet-shape and numeric balance preflight, rollback subtransaction and post-wait
completion timestamp are retained. Provisioning and system revenue setup remain
inside that rollback boundary and precede the completion timestamp.

Confirmation's single statement contains:

1. `evidence`: insert exact final receipt and return its identities/timestamp.
2. `components`: materialize positive stored components from that returned
   agreement identity; derive kinds and ordinal R, C, O without recomputation.
3. `transactions`: insert deterministic kind/component transactions from those
   components, returning their IDs and creation timestamps.
4. `postings`: consume returned transaction IDs and insert exact debit/credit
   pairs ordered by component ordinal, then debit/credit ordinal.
5. `completed_journey`: consume receipt values and exhaust the postings result
   through an aggregate, then complete the exact journey. The aggregate also
   produces a row when no postings exist, so zero components do not skip lifecycle.
6. The main UPDATE consumes `completed_journey` RETURNING to complete alignment.
7. A separate explicit `assert_funded_coordination_entry` validates the complete
   graph and, through the completion validator, each historical wallet transaction.
8. Return the authoritative persisted projection under retained locks.

RETURNING carries identities between writable CTEs; the implementation does not
assume ordinary sibling SELECTs see each other's table mutations. BEFORE actor,
transaction, posting and lifecycle triggers still enforce their stage-specific
prerequisites. Real PostgreSQL tests proved their visibility, including all
relevant constraints IMMEDIATE. Immediate constraint triggers fire at the end of
the whole SQL statement and see the complete graph. DEFERRED triggers retain
the caller's timing, while the explicit full graph assertion still runs before
return. Any failure rolls back setup, receipt, ledger and lifecycle writes.

Arithmetic and topology remain unchanged: held decreases R+C, offerer
withdrawable increases C−O and system revenue increases R+O. Contribution is
credited before the offering share debit; preflight also checks intermediate
credit overflow. Each positive component has one transaction and two exact
postings; zero components have neither. No legacy settlement is created.

## Behavior-based preservation oracle

The strengthened explicit mode runner creates rollback-only mirror constraint
triggers with the same names and schemas as eight relevant production triggers.
Schema-qualified SET CONSTRAINTS selects all matching names. Controlled later
inserts raise at statement end in IMMEDIATE mode or reach an intentional rollback
in DEFERRED mode. This measures transaction behavior rather than catalog defaults.
Additional probes against real historical wallet transaction/posting rows agree
with the mirrors. Probe rows and temporary mode changes are always rolled back.

Profiles: default, all IMMEDIATE, all DEFERRED, wallet IMMEDIATE, wallet DEFERRED,
completion/start IMMEDIATE, completion/start DEFERRED, and mixed independent modes.
Both normal and zero-component variants run each profile. Nine phases cover
pre-state, premature confirmation failure, request authorization failure, request
success/replay, late confirmation failure including provisioning rollback,
successful confirmation deliberately rolled back, confirmation success and
completed replays. Result: **16 cases, 1,152 behavior-based assertions passed**,
plus real-wallet timing checks. Application fingerprint restoration passed.

The inherited multi-statement top-up producer still requires its normal wallet
DEFERRED mode. Completion works with wallet IMMEDIATE and preserves that mode;
it does not silently change it to accommodate a subsequent unrelated writer.
Concurrency tests retain real top-up/provisioning races and add a same-transaction
normal top-up under explicitly DEFERRED mode plus a duplicate-confirmation race
under explicitly IMMEDIATE mode.

## Timestamp evidence and failure-only diagnostics

The earlier provider-resolution failure remains a reproduced historical harness
failure with cause unproven and no demonstrated 0082 settlement relationship.
No production timestamp policy was changed.

Test-only instrumentation uses the exact installed historical definitions. In
rollback tests it is reverted; in concurrency it exists only in the disposable
clone. On provider-resolution rejection it prints selected creation, supplied
resolution/expiry and the producer's actual `v_now`, current clock, transaction
and statement timestamps, isolation and fixture/scenario identity. For the
generic creation guard, a wrapper returns each actual clock argument unchanged
and records it; failure diagnostics print the row/table and precise predicate
clocks. A skipped expiry check is explicitly represented as empty, not a stale
prior sample. Instrumentation is idempotent across fresh clone fixture schemas.

Intentional future-resolution and future-creation diagnostic tests retained the
original 23514 errors and proved these fields are captured. Application
data/catalog/ACL/RLS/history restoration passed. These intentional rejections are
diagnostic tests, not reproductions of the unknown earlier cause.

## Post-fix validation and remaining clearance blocker

- Complete behavioral stress: **50 executions**, both variants every execution,
  **7,450 checks passed**, no retries; application fingerprint unchanged.
- Dedicated normal settlement stress: **9 fresh paths passed**; fresh fixture
  setup for path 10 failed before completion logic with:

  ```
  0072 offering intent fixture failed:
  {"ok":false,"state":"23514",
   "message":"Movement context creation time or expiry is invalid"}
  inline_code_block line 159
  fixture/scenario: focused-10-zero-false
  ```

  The run stopped without retry; rollback/fingerprint verification passed.
  Rejected row timestamps were not logged at that point. The generic creation
  diagnostic was added afterward for subsequent occurrences. No clock-jump cause
  is claimed without those values. No financial materialization graph existed
  yet for that fresh scenario.
- Separate remaining zero-component stress: **30 fresh paths passed**, alternating
  wallet IMMEDIATE/DEFERRED, exact ledger/lifecycle/balance/replay checks and
  unchanged application fingerprint. This does not replace the failed normal run.
- An initial dedicated-run harness SQL alias ambiguity (42702) was corrected
  before the recorded normal stress execution; production source was unchanged.

Final verification:

- Concurrency run 1: 25/25 scenarios, 27 actual blocking proofs, no deadlock,
  disposable cleanup and unchanged application fingerprint.
- Concurrency run 2: 25/25 scenarios, 27 actual blocking proofs, no deadlock,
  disposable cleanup and unchanged application fingerprint.
- Concurrency run 3: 25/25 scenarios, 27 actual blocking proofs, no deadlock,
  disposable cleanup and unchanged application fingerprint.
- Targeted portable: 256 passed, none failed or skipped.
- Full Node: 1,601 total, 1,600 passed, none failed, one skipped.
- TypeScript: passed. Tracked and all nine fix/review-file whitespace checks:
  passed.
- 0082 contains zero SET CONSTRAINTS occurrences; SHA-256 matches the header.
- Historical normalized hash (81 files):
  `488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223`.

All previous pre-fix results remain
historical evidence only. The caller-mode defect is fixed, but the required
dedicated 50-normal-path stress clearance remains incomplete. Classification:
**B — NOT CLEARED**. Persistent installation is not performed.
