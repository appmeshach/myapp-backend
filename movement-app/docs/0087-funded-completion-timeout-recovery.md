# 0087 funded completion timeout recovery

0087 binds each offerer completion request to an immutable twelve-hour requester response window. The primary requester can confirm completion or explicitly dispute it. After expiry, a principal's completion-state access lazily constructs truthful timeout completion and the existing atomic settlement. An admitted requester dispute freezes disposition for separate 0088 adjudication; silence creates no review case or penalty.

## Audited baseline

Branch: `feature/0087-completion-timeout-recovery`. HEAD: `05ed8c5938dc7941f050c5709bd6f0e3b01d546c`, the merged 0086 baseline. The read-only audit verified **25 relevant installed function bodies** against their latest source replacements, including completion, coordination, settlement, pre-start dispute, and rating functions. Exact installed signatures, full definitions, owners, ACLs, search-path settings, table columns, constraints, triggers and migration history are in `0087-installed-baseline-audit.json`. Source/database fingerprint equality was checked around the audit. All 86 historical normalized migration byte sequences matched HEAD.

The important installed signatures are `private.assert_funded_completion(uuid)`, `private.assert_funded_coordination_entry(uuid)`, `private.require_funded_completion_actor()`, `private.require_funded_settlement_transaction()`, and the public completion status/request/confirm RPCs taking only a movement-need UUID. 0085 replaced coordination and settlement guards; 0086 added separate pre-start dispute gates and scoped graph selectors. The audit uses those installed definitions, rather than assuming 0083 is still installed verbatim.

## Architecture and historical compatibility

Two private immutable tables extend the graph:

- `funded_completion_response_windows`: one per exact completion request, with a composite foreign key binding alignment, agreement, journey and the request's observed timestamp. Its deadline is exactly `requested_at + interval '12 hours'`. An AFTER INSERT trigger binds new requests in the same transaction and statement-end graph validation sees the full request/window/journey state.
- `funded_completion_disputes`: one requester review receipt per window, with composite window identity, primary-requester identity, backend opening observation and a bounded category. It has no mutable status or resolution authority.

Both enable RLS, revoke all PUBLIC/anon/authenticated/service_role direct rights, and reject UPDATE/DELETE/TRUNCATE including no-op mutations. New private functions have no application-role execution. Existing private replacement owners/ACLs are retained; four user-facing RPCs are authenticated-only, with exact principal checks and safe errors.

`funded_movement_completions.completion_method` distinguishes `requester_confirmed` and `response_timeout`. Its default truthfully classifies historical rows: the audited previous actor gate allowed only the primary requester's confirmation. ADD COLUMN supplies that default without UPDATE, trigger disabling or historical ledger rewriting. Existing requests receive deterministic windows from their original observed timestamp, including already-settled requests. Disposable upgrade tests construct real pending and settled 0086 graphs before applying 0087 and check original receipt fields remain exact.

The three existing public RPCs are explicitly recreated because their return type grows by four fields. A new `dispute_my_funded_movement_completion(uuid,text)` performs only requester review intake. Both confirmation and lazy timeout call one private `finalize_funded_completion(uuid,text)` whose financial construction is copied from the audited 0083 confirmation body. There is one economics engine and one component/ledger/lifecycle CTE.

0086's table, APIs, categories, either-principal pre-start authority and freeze triggers remain separate and unchanged. Started movement cannot enter that pre-start route. 0087's review is available only after authoritative start and an offerer completion request, only to the primary requester, and only before its immutable deadline.

## Deadline and temporal reasoning

Request metadata is sampled on the server after agreement/alignment/journey and sorted principal construction gates. The window derives from that exact sample; no client can supply request/deadline time, identities, completion method, settlement time or amounts. The client validates the deterministic twelve-hour pair, including fractional precision, and may display the deadline. It never consults the device clock for eligibility.

The sole new live time policy is whether the response window has expired. Review admission samples on the server after canonical gates and rejects `observed_at >= deadline`, even when no timeout has yet been materialized. Completion receipt construction samples once after construction, member, account, provisioning and revenue waits. The trigger selects the exact window by alignment/agreement/journey and paired request metadata. An authenticated requester confirmation admitted before its deadline remains `requester_confirmed`; at or after the deadline the same construction becomes `response_timeout`, even for a stale direct confirmation RPC before any lazy timeout receipt exists. A timeout attempt before the deadline fails closed. The trigger overrides supplied completion metadata and returns its sole server observation to all ledger postings and lifecycle fields. Existing terminal receipts replay unchanged before account waits, and an admitted dispute is checked before money construction; neither is reclassified by later samples. Historical evidence remains immutable and is never revalidated against a new clock reading.

The audit found unsafe independent request/start/completion comparisons and historical upper bounds against later clocks. 0087 replaces them with finite metadata and exact graph/stamp equality in the completion actor, completion graph and coordination graph. Existing authoritative start, matching identities, immutable receipt relationships and lock order establish causality. No tolerance, retry loop, timestamp adjustment or monotonic clock is introduced.

It also found 0001's unconditional `journeys_check` (`completed_at >= started_at`) and 0084's rating admission timestamp ordering. The journey CHECK is replaced by a private BEFORE trigger preserving its exact legacy rejection while allowing regressed completion metadata only when an exact funded receipt binds the alignment, journey and finite completion stamp. All existing financial lifecycle and complete-ledger validators remain active. The rating guard retains exact human reviewer/target and real completion eligibility, using finite observation metadata rather than clock order. Ratings remain explicit actions.

Cancelled/no-travel historical routes retain their existing separately audited 0085 construction; 0087 adds no disposition rule there. Equal/regressed observations in the funded completion path, later regressed samples after timeout, exact deadline boundaries, future timestamp forgery and preserved legacy chronology receive explicit PostgreSQL coverage.

## Locks, financial invariants and review boundary

Canonical order remains agreement SHARE, alignment UPDATE, compatible offer/materialization checks, journey UPDATE, then both principal members UPDATE in UUID order. Settlement alone proceeds to sorted member wallet-account UPDATE locks, provisioning and platform revenue UPDATE. Review intake never acquires wallet-account locks. Direct trusted completion and financial-disposition inserts acquire the same parent gates and reject active requester review, including component-key paths whose supplied alignment is forged.

Confirm/review/timeout and status refreshes serialize on the parent graph. A still-eligible decisive operation that commits first selects the terminal branch. Rollback permits the waiting operation to reevaluate against committed state and live deadline policy. Confirmation cannot acquire requester-confirmed truth after expiry merely because it wins the parent lock: the post-wait receipt sample selects timeout. The finalizer passes no timestamp and does not branch into a second settlement call, preserving the existing canonical lock order and single atomic economics construction. Duplicate timeout/confirmation calls replay the same immutable receipt; duplicate exact reviews write nothing. A review and completion/settlement cannot coexist.

Stored components retain the exact existing economics: `G=S*N`; `F=30% of G` rounded HALF-UP once; `O=floor(F/2)`; `R=F-O`; `C=G-R`; `NET=C-O=G-F`. No independent 15/15/70/85 calculation is introduced. Settlement debits requester held by R+C, credits offerer withdrawable by C-O, and credits platform revenue by R+O, using the existing three exact transaction/posting topologies and component idempotency keys. Positive components settle once; zero components create no postings. Existing wallet status, overflow, balance and provenance checks remain intact.

Timeout sets the funded journey/alignment completed and counts the two immutable completion principals under unchanged 0084 reputation construction. It creates no rating. Requester review changes no wallet, settlement, completion, member count or rating. Neither review intake nor 0087 selects a winner, refunds, imposes a fee/penalty, adjusts an account or grants admin wallet authority. Resolution belongs to 0088.

## Public/client contract and cost

All completion projections contain exactly `journey_state`, `completion_requested_at`, `completed_at`, `can_request_completion`, `can_confirm_completion`, `settlement_state`, `response_deadline_at`, `completion_method`, `can_dispute_completion`, `dispute_active`. No private identifiers, internal category, amounts or provider/admin data are exposed. `under_review` is a settlement-state projection, not a mutable status column.

The requester sees **Confirm completed** and **Dispute** as the only substantive actions after a request, together with the server deadline and disclosure of passive completion after expiry. There is no later/do-nothing/accept-timeout action. Refresh is an operational status access. Offerers see waiting, completed or neutral review state and cannot open requester review. Client services reject malformed projections, unsupported fields and selectors; errors are generic. Controller mutations require authoritative capability, guard duplicate taps, and wait for a fresh status read. Account/background/unmount invalidation, abort and timeout protections remain active. Focus/foreground access invokes only the status RPC; timeout correctness resides on the server.

No paid dependency, scheduler, provider integration, worker, notification or startup money action is added. Existing Supabase suffices. Incremental cost is indexed window/review lookups, one immutable window per request, and existing settlement work when an eligible principal accesses expired completion state. Scheduling and notifications can be added later; correctness does not depend on them.

## Verification

PostgreSQL tests run only in regex-validated disposable schema clones, preserve production predicates/triggers and verify persistent application data/catalog/ACL/RLS/history fingerprints before and after cleanup. Unchanged 0086 programs compose unchanged 0085, 0083 settlement, 0084 reputation and legacy suites with only their disposable harness dependency replaced. Historical exact-body probes are not run against the persistent database after later legitimate replacements. Ordinary Node module compilation preserves strict object prototypes for the unchanged assertions; no assertion is weakened or removed.

0087 behavior passed **235 PostgreSQL assertions**; temporal coverage passed **70 assertions**. Concurrency passed **33 scenarios**, **32 actual `pg_blocking_pids` proofs** with recorded backend PIDs, **zero deadlocks**, and a separate wallet-account gate bypass proof. This includes both decisive orders and rollback for confirmation/review/timeout, duplicate timeout/review, principal refresh races, shared principal gates and wallet-account contention. New boundary cases cover confirmation one microsecond before, exactly at and one microsecond after the deadline without prior lazy materialization; late direct confirmation with ordinary/zero contribution; near-deadline confirm/review races; in-window confirm versus timeout and late confirm versus timeout in both lock orders and rollback variants. Two measured wallet-wait scenarios advance the clone-only controlled live sample from one microsecond before the deadline to the deadline while confirmation is actually blocked. Both return timeout after the wait. Every new successful race verifies exact R/C/O balance deltas and one settlement per positive component; winning reviews preserve all money, and terminal replays preserve the full graph without duplicate writes.

Unchanged prior suites passed against disposable 0087: 0086 behavior **558 assertions**, temporal **118 assertions**, and concurrency **20 scenarios / 19 actual blocking proofs / zero deadlocks**; 0085 behavior **420 assertions** and concurrency **13 scenarios / 13 actual blocking proofs / zero deadlocks**; 0083 settlement **149 checks**, 0084 reputation **34 checks**, and legacy behavior **203 checks**. Only disposable harness dependencies were composed; original assertions and fixtures were retained. Every PostgreSQL run cleaned up its clone and verified the persistent application fingerprint unchanged.

Focused Node passed **161/161**, including **48 new 0087 tests**. Full Node passed **1,797 total: 1,796 passed, zero failed, one existing opt-in DuckDB skip**. TypeScript exited **0**. Exact final outputs and PostgreSQL count/PID JSON artifacts accompany this document.

Migration normalized SHA-256 (LF): `8fc27b609f944d690add84f6866a2528a45ba46b488d7eb3a162b54230c65f8e`.

Reproduction:

```text
node supabase/tests/0087_funded_completion_behavior.cjs
node supabase/tests/0087_funded_completion_temporal.cjs
node supabase/tests/0087_funded_completion_concurrency.cjs
node supabase/tests/0087_funded_completion_regression.cjs
node --test tests/fundedCompletionTimeout.test.cjs tests/financialMovementCompletion.test.cjs tests/fundedDisputeFreeze.test.cjs tests/fundedNoTravelRelease.test.cjs tests/trustedTemporalEvidenceHardening.test.cjs tests/migrationNumbering.test.cjs
node --test
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

## Exact file manifest

The server-authority review correction changes six implementation/test files: the 0087 migration, `0087_funded_completion_behavior.cjs`, `0087_funded_completion_temporal.cjs`, `0087_funded_completion_concurrency.cjs`, `0087_funded_completion_test_support.cjs`, and `tests/fundedCompletionTimeout.test.cjs`. It updates this document and regenerates the thirteen existing behavior/temporal/concurrency/regression/focused/full/TypeScript, migration-integrity, diff and Git-status evidence files listed below. Installed-baseline evidence, historical migrations, prior milestone tests and client source are unchanged by this correction.

Modified:

- `src/components/FundedCompletion.tsx`
- `src/hooks/useFundedCompletion.ts`
- `src/services/fundedCompletionService.ts`
- `src/state/fundedCompletionController.ts`
- `supabase/tests/financial_agreement.test.cjs`
- `supabase/tests/financial_proposal.test.cjs`
- `tests/financialMovementCompletion.test.cjs`
- `tests/migrationNumbering.test.cjs`
- `tests/temporalClientCompatibility.test.cjs`

Created implementation/tests:

- `supabase/migrations/0087_funded_completion_timeout_recovery.sql`
- `supabase/tests/0087_funded_completion_harness.cjs`
- `supabase/tests/0087_funded_completion_test_support.cjs`
- `supabase/tests/0087_funded_completion_behavior.cjs`
- `supabase/tests/0087_funded_completion_temporal.cjs`
- `supabase/tests/0087_funded_completion_concurrency.cjs`
- `supabase/tests/0087_funded_completion_regression.cjs`
- `tests/fundedCompletionTimeout.test.cjs`

Created documentation/evidence:

- `docs/0087-funded-completion-timeout-recovery.md`
- `docs/0087-installed-baseline-audit.json`
- `docs/0087-migration-integrity.json`
- `docs/0087-behavior-results.txt`
- `docs/0087-behavior-results.json`
- `docs/0087-temporal-results.txt`
- `docs/0087-temporal-results.json`
- `docs/0087-concurrency-results.txt`
- `docs/0087-concurrency-results.json`
- `docs/0087-regression-results.txt`
- `docs/0087-focused-results.txt`
- `docs/0087-full-results.txt`
- `docs/0087-types-results.txt`
- `docs/0087-diff-results.txt`
- `docs/0087-git-status.txt`

Temporary runners and unsuccessful intermediate test logs are not delivered as final evidence. Unrelated existing untracked files are untouched. Nothing is staged, committed, pushed, merged or deployed remotely. Migration 0087 has been intentionally applied only to the local Supabase development database for installed-state verification; production remains unchanged.
