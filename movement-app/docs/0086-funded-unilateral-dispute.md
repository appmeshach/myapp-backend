# 0086 funded unilateral dispute intake and freeze

0086 adds an explicit pre-start report by either movement principal. One immutable opening receipt makes the funded movement under review. Requester funds remain held; this milestone chooses no winner and performs no financial disposition.

## Audited baseline

The checkout is at `c1e39d205e8c76cd5b4f3bb1e217423760d91d93`, the 0085 merge. The installed local database contains 0085. All 13 function bodies defined by 0085 match the checked-in source after line-ending normalization. The persistent database has no 0086 receipt table. The exact audit is in `0086-installed-baseline-audit.json`.

0078 binds the immutable agreement/components to exact held ledger evidence. 0079 requires that evidence and face readiness before activation. 0080 explicitly materializes coordination for the already intended movement; the legacy UUID start/end/settlement APIs reject financial alignments. 0081 start **confirmation** is authoritative travel. Its pending request alone is not travel. 0083 requires that authoritative start and two completion actions before settlement. 0084 derives reputation only from exact completed evidence. 0085 requires two different principals to agree on pre-start no-travel and returns held R+C to requester available; offerer and platform receive nothing.

The canonical parent gate is agreement SHARE, alignment UPDATE, offer SHARE through materialization, journey UPDATE, then both principal members UPDATE in UUID order before receipt FKs. Wallet accounts follow those gates only for money movement. The sorted member gates prevent implicit member FK KEY SHARE locks from introducing later upgrades against 0083 settlement or 0084 reputation.

Historical migrations 0001–0085 are unchanged after CRLF normalization. The pinned 0085 normalized SHA-256 is 7dab4e1a78cb5066c69f57cd9362bf5ada64fd51e343edf7ac1538caa3756c27. No historical function is replaced by 0086. The additive triggers retain all existing validation and economics.

## Problem and evidence

Disagreement alone cannot establish who deserves money or whether physical travel occurred. A mutually declined end request is not a dispute opening. This milestone records only an authenticated human report and freezes the later authoritative travel/disposition paths.

`private.funded_movement_disputes` has one row per alignment, with unique agreement and journey bindings, opening principal, database opening instant, and one of two bounded categories: `unable_to_agree` or `movement_concern`. There is no redundant mutable status, duplicate active-state field, free text, resolution field, provider reference, or caller-supplied time/member ID. Foreign keys bind activation, funding hold, journey and member evidence. `clock_timestamp()` is sampled after parent and both member gates.

`opened_at` is immutable, finite, server-observed metadata. It is not a cross-transaction ordering authority. The public write samples it once after construction locks; clients cannot provide it. Equal or regressed database observations are valid metadata and later clock corrections cannot invalidate the receipt.

The temporal audit distinguishes 0082's same-sample external attestation admission and live expiry from historical provenance. Historical paired stamps retain exact equality; face attempts use immutable ordinals and activation validates its receipt-bound attempt. Dispute causality is established by the immutable funded graph, pre-start prerequisites and construction locks, so no new ordinal or clock mechanism is needed.

The audit found four invalid opening-time comparisons and an additional dependency on 0085's clock-sensitive graph/coordination checks. `assert_funded_dispute` now uses the scoped `assert_undisposed_funded_graph` and canonical `funded_dispute_alignment` selector. The scoped checker retains 0085's exact hold, materialization, activation, coordination, pending-start, ledger/component-key, completion, legacy closure and reputation checks. Independent coordination/request/decline observations require finite metadata rather than increasing timestamps or later-clock upper bounds; paired stamp equality remains intact. An early closure rejection restricts the helper to undisposed pre-start graphs. Active reads and exact replay use this selector; historical functions and terminal read routes remain unchanged. Forged bindings, actor evidence and partial funding still fail closed.

The table enables RLS, has no PUBLIC/anon/authenticated/service_role direct grants, and has statement guards against UPDATE, DELETE and TRUNCATE, including no-op writes. Six new private helpers are SECURITY DEFINER with empty search_path and have no application-role EXECUTE grants. Both public functions have authenticated-only execution. Authorization also checks `auth.uid()` against the exact offering member or primary requester; invited participants, unrelated members and absent identities are denied. Backend error details become only `Movement review unavailable` at public boundaries.

## Lifecycle and funds

Alignment remains `activated` and journey remains `not_started`. Opening does not update either row or fabricate travel timestamps. An existing pending start request is preserved. A subsequent pending start request, meeting coordination, no-travel request or decline can still record intent under the existing rules. These actions do not resolve the dispute.

Additive BEFORE INSERT guards reject authoritative funded starts, no-travel closures, completion requests, completion receipts, and release/settlement transactions when dispute evidence exists. Guards also cover trusted direct construction, rather than relying only on the public wrappers. New constraint triggers on receipt insertion and journey/alignment updates validate the frozen graph in immediate and deferred caller modes. Existing graph guards remain active.

No wallet-account row lock is acquired by dispute opening or its helpers. No account, wallet transaction, posting, balance, financial component, completion receipt, reputation count/rating, platform revenue or provider action changes. The historical funding assertion reads ledger evidence; current balance/status is not rewritten as historical truth. Other legitimate wallet operations retain their existing behavior.

Same-alignment operations serialize on the existing canonical parent gate. If start confirmation or mutual no-travel closure commits first, opening is rejected. If opening commits first, their confirmation is rejected. Rollback lets the waiting operation proceed under its unchanged eligibility rules. A reachable completion on a different already-started movement sharing the same two principals uses the same sorted member gates.

## Public and client contracts

Read: `get_my_funded_movement_dispute_status(p_movement_need_id uuid)`.

Explicit write: `open_my_funded_movement_dispute(p_movement_need_id uuid, p_reason_category text)`.

Both return exactly `dispute_active`, `can_open`, `opened_by_me`, `opened_at`. Eligible undisputed pre-start movements can open. Started/completed/released exact graphs project ineligibility. An active dispute projects the opening instant and actor-relative boolean, with no internal IDs, category/text, wallet amount, provider data or SQL details. Legacy and incomplete financial graphs cannot use this financial API.

Exact replay by the same authenticated opening principal with the same category validates the graph and writes nothing. Changed category or opening principal is rejected; a second principal can still read that the movement is under review. There is one receipt, even when both principals try simultaneously. This selects an opening event, never a financial winner.

The independent report UI appears on movement coordination alongside the existing end controls. It has explicit human reason buttons under “Report a problem with this movement”; it does not reinterpret “Not yet.” After an authoritative read, active review shows “This movement is under review. The held movement amount remains on hold.” Only refresh remains in the report component. Other lifecycle panels may have stale controls from independent reads; database gates always reject an ineligible confirmation. There is no refund or winner promise.

The strict service rejects unexpected fields, malformed booleans, inconsistent active/eligible states, invalid calendar instants, bad public selectors/categories and transport/backend errors. It verifies abort before and after transport. The controller requires an active owner and eligible authoritative status, synchronously guards duplicate taps, uses a shared generation and 30-second abort timeout, and ignores the mutation response until a fresh authoritative read succeeds. Failure clears controls. The focus hook invalidates state on account change, background, blur/unmount; queued post-cleanup callbacks cannot reactivate it. Reads on focus/foreground do not open anything automatically. No client money calculation or service-role authority is added.

## Cost and deferred policy

No dependency, paid service, provider integration, background worker, startup mutation or notification is added. Existing Expo/Supabase packages are reused. The report panel adds one bounded status RPC on authenticated coordination focus/foreground/account change and an indexed receipt lookup to guarded lifecycle paths. Explicit opening adds one receipt and a fresh read. Existing database hosting usage is the only incremental resource cost; no paid external startup cost is introduced.

Adjudication, winner selection, evidence beyond the bounded opening category, cancellation fees, penalties, partial refunds/travel, timeouts, automatic resolution, admin financial decisions, misconduct findings and provider refunds are deliberately deferred. Any future resolution needs a separately reviewed policy and authoritative evidence extension. 0086 has no way to clear a dispute. Existing 0071 positive-seat economics remain intact; fixtures cover the valid zero platform component case rather than manufacturing an invalid all-zero agreement.

## Temporal regression evidence

All **118 PostgreSQL temporal assertions** passed across four scenarios that construct receipts through the authenticated public write with owner-controlled producer observations in a disposable database: equal coordination time, regressed coordination time, opening above the later actual database clock, and later validation samples below coordination time. The last scenario demonstrates the unchanged 0085 historical checker rejects the controlled sample while the scoped 0086 checker, active read and exact replay remain valid. All production predicates, triggers and locks stay active. Equal and regressed observations retain the exact receipt; client timestamp injection, forged graph/actor evidence and started openings fail. Each scenario retains the start/no-travel/completion/settlement freeze and proves every wallet/component/member row unchanged. No tolerance, retry or production clock substitution is added.

Original 0082 behavior and concurrency programs are evaluated unchanged against exact source migrations 0001–0081 reconstructed only in disposable databases. Exact ordinary ACLs are restored from the audited through-0081 catalog because the archive excludes platform default ACLs; replacement owners, ACLs and security settings remain verified. Original result JSON is redirected to 0086 evidence files.

Original 0082 passed **256 persisted behavior checks**, **two compatibility checks**, and **10 concurrency scenarios with 10 actual blocking proofs and zero deadlocks**. The exact behavior and concurrency JSON evidence is in `0086-0082-temporal-behavior-results.json` and `0086-0082-temporal-concurrency-results.json`. The initial reconstruction omitted audited platform grants; its failure log is retained. Later combined runs encountered Docker restore timeouts before fixtures and one external timestamp-admission failure; final behavior and separately rerun concurrency passed without changing historical assertions or admission guards. Restore-timeout logs remain available. Expanded-migration development also caught and corrected a SQL delimiter and an ambiguous projection alias before final passing runs.

## Temporal regression evidence

Four PostgreSQL scenarios construct receipts through the authenticated public write with owner-controlled producer observations in a disposable database: equal coordination time, regressed coordination time, opening above the later actual database clock, and later validation samples below coordination time. The last scenario demonstrates the unchanged 0085 historical checker rejects the controlled sample while the scoped 0086 checker, active read and exact replay remain valid. All production predicates, triggers and locks stay active. Equal and regressed observations retain the exact receipt; client timestamp injection, forged graph/actor evidence and started openings fail. Each scenario retains the start/no-travel/completion/settlement freeze and proves every wallet/component/member row unchanged. No tolerance, retry or production clock substitution is added.

Original 0082 behavior and concurrency programs are evaluated unchanged against exact source migrations 0001–0081 reconstructed only in disposable databases. Exact ordinary ACLs are restored from the audited through-0081 catalog because the archive excludes platform default ACLs; replacement owners, ACLs and security settings remain verified. Original result JSON is redirected to 0086 evidence files.

## Verification

Tests create schema-only disposable databases from the installed 0085 source, apply 0086 there, build normal funded fixtures with all production guards enabled, then drop the clones. Persistent source/data/catalog/ACL/RLS/history fingerprints are checked before and after every suite. 0086 is not applied to the persistent local database or remotely.

Final behavior passed **558 PostgreSQL assertions**, including both principals, invited/unrelated/absent identity denial, category bounds, exact no-write replay, conflicting replay, pending start before/after opening, started/completed/released denial, blocked confirmations, no-money/full-row comparisons, trusted direct disposition denial, forged agreement/journey/principal/time/category construction, partial funding denial without repair, immediate/deferred constraints, ACL/RLS and immutable UPDATE/DELETE/TRUNCATE. Exact output is in `0086-behavior-results.txt`.

The completed 0086 concurrency run has 20 scenarios, 19 actual `pg_blocking_pids` relationships with backend PIDs, zero deadlocks, and a separate wallet-account gate bypass test. It covers both winning orders and rollback for start/no-travel confirmation, both orders for pending start/no-travel requests, exact duplicate opening commit/rollback, reciprocal principal openings, pre-start completion request/confirmation denial, and reachable completion confirmation sharing both principals in each lock order.

The 0086 compatibility runner evaluates the **unchanged** 0085 behavior, regression and concurrency source with only the disposable harness dependency replaced. It preserves all original assertions, including 0083's original settlement checks with the existing 0084 intentional reputation exclusions, 0084 rating/reputation checks, and legacy 0019 behavior. It does not apply historical migrations again over already-installed tables, disable triggers or weaken fixtures.

Final compatibility passed **420** unchanged 0085 behavioral assertions, **149** original 0083 settlement checks (75 ordinary and 74 valid zero-platform-component), **34** 0084 reputation checks, **203** legacy 0019 checks, and **13** unchanged 0085 concurrency scenarios with **13** actual blocking proofs and **zero deadlocks**. Exact output and all blocking PIDs are in `0086-regression-results.txt`. Combined with the dedicated dispute concurrency suite, this is 33 concurrency scenarios, 32 actual blocking proofs, and zero deadlocks; the remaining scenario proves opening does not wait on wallet-account row locks.

Focused Node verification passed **157/157** tests: 39 new dispute tests, seven 0085 client/integrity tests, 99 existing requester/end/recovery tests, the migration sequence test and 11 original 0082 temporal source tests. The full `node --test` run completed **1,749** tests: **1,748 passed, zero failed, one skipped**. The skip is the existing opt-in DuckDB transport-geography integration. The focused and full outputs are preserved verbatim in their respective result files. TypeScript `node node_modules/typescript/bin/tsc --noEmit` exited **0**. `git diff --check` exited **0**, and the additional owned-file whitespace/newline check passed. All 85 historical normalized migration byte sequences exactly match HEAD, including the pinned 0085 hash; the complete hashes are in `0086-migration-integrity.json`.

Reproduction commands (Docker access is needed only for the disposable PostgreSQL suites):

```text
node supabase/tests/0086_funded_dispute_behavior.cjs
node supabase/tests/0086_funded_dispute_temporal.cjs
node supabase/tests/0086_temporal_0082_regression.cjs
node supabase/tests/0086_funded_dispute_temporal.cjs
node supabase/tests/0086_temporal_0082_regression.cjs
node supabase/tests/0086_funded_dispute_concurrency.cjs
node supabase/tests/0086_funded_dispute_regression.cjs
node --test tests/fundedDisputeFreeze.test.cjs tests/fundedNoTravelRelease.test.cjs tests/requesterMovementInterest.test.cjs tests/migrationNumbering.test.cjs tests/trustedTemporalEvidenceHardening.test.cjs
node --test
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Migration: `0086_funded_unilateral_dispute_freeze.sql`.

Raw and normalized SHA-256 (the new file uses LF): `7902a653ef242a2a2e1ed74521c2ede66f9d1f53e4192a0cf4d86c8033957ef8`.

## File manifest

Modified:

- `src/components/MovementCoordination.tsx`: mount independent report component.
- `tests/coordination.test.cjs`: stub the newly mounted dispute hook while preserving every existing reveal assertion.
- `tests/migrationNumbering.test.cjs`: advance exact sequence to 0086, retaining historical integrity checks.
- `supabase/tests/financial_agreement.test.cjs`: explicitly allow this reviewed financial consumer; keep all other caller exclusions.

Created implementation and tests:

- `supabase/migrations/0086_funded_unilateral_dispute_freeze.sql`
- `src/services/movementDisputeService.ts`
- `src/state/movementDisputeController.ts`
- `src/hooks/useMovementDispute.ts`
- `src/components/MovementDispute.tsx`
- `tests/fundedDisputeFreeze.test.cjs`
- `supabase/tests/0086_funded_dispute_harness.cjs`
- `supabase/tests/0086_funded_dispute_behavior.cjs`
- `supabase/tests/0086_funded_dispute_concurrency.cjs`
- `supabase/tests/0086_funded_dispute_regression.cjs`
- `supabase/tests/0086_funded_dispute_temporal.cjs`
- `supabase/tests/0086_temporal_0082_regression.cjs`

Created documentation/evidence:

- `docs/0086-funded-unilateral-dispute.md`
- `docs/0086-installed-baseline-audit.json`
- `docs/0086-migration-integrity.json`
- `docs/0086-integrity-results.txt`
- `docs/0086-behavior-results.txt`
- `docs/0086-concurrency-results.txt`
- `docs/0086-regression-results.txt`
- `docs/0086-focused-results.txt`
- `docs/0086-full-results.txt`
- `docs/0086-types-results.txt`
- `docs/0086-temporal-results.txt`
- `docs/0086-0082-results.txt`
- `docs/0086-0082-concurrency-results.txt`
- `docs/0086-0082-temporal-behavior-results.json`
- `docs/0086-0082-temporal-concurrency-results.json`
- `docs/0086-0082-baseline-acl-failure.txt`
- `docs/0086-concurrency-restore-timeout.txt`
- `docs/0086-regression-restore-timeout.txt`
- `docs/0086-regression-retry-timeout.txt`
- `docs/0086-diff-results.txt`
- `docs/0086-git-status.txt`

No existing unrelated untracked file is changed. Temporary evidence orchestration scripts are removed before delivery. Nothing is staged, committed, pushed, merged or deployed.
