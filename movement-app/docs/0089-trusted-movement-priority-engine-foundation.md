# 0089 — Trusted Movement Priority Engine Foundation

We do not create journeys. We connect journeys that were already going to happen.

The server chooses who to show first; people choose who to proceed with. A higher priority is opportunity context, not entitlement. This migration reads existing eligible requester interests and changes their inbox order. It does not create offers, accept offers, match people, create alignments or journeys, reserve capacity, activate movements, charge money or reveal controlled media.

## Eligibility first

Route/corridor fit is a gate, not a dominant score. The existing authoritative interest assertion still verifies need lifecycle, active interest and availability, timing, vehicle/access, enough places, exact current route evidence and same-state support. A stale, expired, superseded or invalid candidate cannot rank into the result. The limit applies after all eligible candidates are collected and sorted. Expected eligibility exceptions remain narrowly scoped; cancellation, deadlock and unexpected errors propagate.

The replacement preserves READ COMMITTED, authenticated membership, caller-owned availability, indistinguishable foreign/missing availability, SECURITY DEFINER, empty search_path, authenticated-only execution and exactly the existing ten safe fields. The client preserves server order; its parser, movement types and offer screen are unchanged. No score, component, policy weights, rating count, member identity or private ranking metadata is returned.

## Trusted policy movement_priority_v1

History counts only private.completed_movement_principals, including both offering_member and primary_requester. Generic completed journeys, public.members.completed_movements and journey_reviews contribute nothing. H=100*n/(n+3): zero gives 0, one 25, two 40, three 50, five 62.5. The first successes matter much more than the fortieth or fiftieth.

Reputation uses only private.completed_movement_ratings stars and observation count. The adjusted rating is (20+sum(stars))/(5+count). This is the exact average-times-count formula without intermediate average rounding. A newcomer has a neutral 4.0, not a bad rating. R is 100*(adjusted-3)/2, clamped to 0–100. One five-star vote has little confidence; many strong observations approach their observed average. All arithmetic is PostgreSQL numeric, with no binary floating-point score or premature rounding.

| Context | History | Reputation | Waiting | Waiting tau, minutes |
|---|---:|---:|---:|---:|
| offerer_initiated_1_seat_v1 | 0.40 | 0.35 | 0.25 | 135 |
| offerer_initiated_2_seat_v1 | 0.30 | 0.25 | 0.45 | 75 |
| offerer_initiated_3_seat_v1 | 0.22 | 0.18 | 0.60 | 45 |
| offerer_initiated_4_seat_v1 | 0.15 | 0.10 | 0.75 | 20 |
| requester_initiated_v1 | 0.35 | 0.40 | 0.25 | 60 |

The original immutable offering_movement_availability.total_places selects the offerer context. remaining_places is only eligibility state. A four-place availability with one place remaining retains the four-seat policy. The schema also permits capacities above four: v1 uses the four-seat tier for those opportunities, without excluding them or inventing new weights. One-seat context emphasizes trust early; three/four-seat context gives long-waiting newcomers a stronger opportunity.

Waiting starts at immutable server-written requester_movement_interests.created_at. The call takes one database ranking-time sample for every candidate, and W=100*t/(t+tau), with t=max(0,elapsed minutes). A regressed clock contributes zero elapsed waiting; it does not falsify historical evidence. Existing live eligibility assertions retain their own established clock checks. No client duration or timestamp is accepted. The candidate cursor captures all authoritative history/rating counts in one READ COMMITTED SELECT snapshot; score calculation after validation uses those captured values, preventing mixed ranking history if a completion/rating commits while validation waits.

Order is numeric score descending, then authoritative waiting start/interest created_at ascending, then interest UUID ascending. Waiting start and original creation are the same immutable field here, so they require one tie key. Ordering is deterministic for the same committed inputs and time sample; it can evolve as real waiting time increases. No randomness is introduced.

## Requester-first integration

The private versioned requester formula is implemented and tested but is not installed into requester discovery ordering. src/services/movementService.ts uses discover_masked_offers_for_my_need from 0005; its pending-offer projection does not run the modern exact interest support assertion. The separate offering-availability discovery flow is not the same as valid explicit offer waiting. A future milestone must establish one authoritative candidate/eligibility point, use immutable movement_offers.created_at for valid offer waiting, retain safe output fields, and then apply requester_initiated_v1. Unused extra seats must never improve that score when the requester already fits. No demographic trait is an input.

## Locks, security and measurement

0048's per-candidate exception rollback still releases validation locks before acquiring the next need's locks. The ordering engine adds no row locks. Its private helpers are fully revoked from PUBLIC, anon, authenticated and service_role; the existing provenance tables receive no privileges. Baseline owners, ACLs and security attributes are preserved. No new table, mutable configuration, operational write, paid service or dependency is introduced.

The repository has immutable financial/reputation receipts, but logging every inbox read would violate this endpoint's read-only contract. Persistent ranking decision receipts are deferred. A future private immutable receipt should hold a server-generated decision ID, policy_version, initiator_context, original_places_offered, remaining_places, candidate_count, candidate_rank, history_bucket, reputation_bucket and waiting_bucket, with explicit retention/access policy and no public projection. Outcome events may reference that decision for card_opened, controlled_media_requested, selected, reservation_created/expired, activated, movement_started/completed and reviewed. Do not record media-analysis attributes, attractiveness, ethnicity, skin tone or face-inferred sex/gender. Version changes must introduce new explicit policy identities rather than mutate v1 silently.

Cost classification: no new external cost. Scaling: ordinary database query/compute cost only. Each call validates all scoped active candidates before applying its bounded output limit; private provenance indexes support member history and rating aggregation. Measure candidate volume and query cost before a future optimization; do not sacrifice eligibility or snapshot correctness to cap validation early.

## Future reservation rules — documentation only

One-sided selection/invitation is not exclusive. Exclusivity begins only after mutual choice. Mutual pre-activation reservation v1 lasts up to ten minutes and must eventually be bilateral and transactionally capacity-safe. Either person may cancel before activation; cancellation releases immediately. Ten-minute expiry releases automatically. Users and capacity return to valid pools if still eligible, and the same pair can become visible again. One cancellation is not punished. No platform fee is charged before activation; 0088 activation remains the commercial boundary. Repeated cancellation/expiry patterns are future REVIEW/reliability work, not a score in 0089.

## Deferred work

Group-set recommendation, group-fit influence (approximately ten priority-equivalent points at most), mutual selection/exclusive reservation, ten-minute reservation implementation, one-sided invitation timeout, controlled media reveal, REVIEW/admin adjudication, cancellation/reliability scoring, prior-positive-relationship signals, social compatibility, personalization, ML, paid boosting, dynamic/surge economics, demographic/sex ranking and automatic matching are outside this milestone. Movement optimises human opportunity first, capacity efficiency second. Controlled profile/media inspection belongs to later human choice.

## Verification

The disposable harness requires exact baseline commit 6dcbf22e2cebf7947f9d17f3e1d0373b039bf7df on feature/0089-completed-movement-priority-foundation, exact installed 0088, all 274 baseline function bodies/ACLs/security attributes and all 88 historical migration hashes. It clones schema only into regex-validated temporal0082_<12hex> databases, applies 0089 only there, checks every new/replaced body and cleans up. Persistent fingerprints and unrelated untracked hashes are preserved.

Final LF-normalized SHA-256:

```text
6e3e49537460206db9047d12fecb5c0bdffc6819dcb1315b1c2294cdca9f8d00
```

| Validation | Actual result |
|---|---|
| Dedicated PostgreSQL priority behavior | 75 passed, zero failed |
| Priority concurrency | 8 scenarios, 19 read assertions, 1 actual blocking proof, 3 validation-lock-release proofs, zero deadlocks |
| Original 0048 inbox regression | 86 passed |
| Original 0049 offer-continuation regression | 52 passed |
| Original 0084 reputation regression | 34 passed |
| Original 0019 legacy regression | 203 passed |
| Generic lifecycle/review provenance | Completed legacy journeys and inserted scaffold reviews remain neutral; neither contributes authoritative history/reputation |
| 0087/0088 overlapping financial behavior | Exact confirmed and response-timeout C/O settlement, no duplicate R; held no-travel changes no money |
| Initial targeted Node run | 12 passed |
| Final focused Node | 51 passed, zero failed/skipped |
| Full portable Node | 1,840 total, 1,839 passed, zero failed/cancelled; one existing optional DuckDB integration skip |
| TypeScript --noEmit | Passed |
| git diff --check | Passed |

The deadlock count is read from pg_stat_database for the disposable database. The validation wait is proved by pg_blocking_pids. Completion/rating commit and rollback cases prove uncommitted receipts are invisible. A ranking cursor waiting on an existing need lock retains its pre-commit history ordering even when a genuine completion commits; the next call sees the complete committed history. Ranking adds no write lock. Concurrent sessions also prove need, availability and interest row locks are released after a successful multi-candidate inbox call, while its outer transaction remains open.

The old 0048/0049 assertions are unchanged. Their provider-resolved endpoint fixtures are supplemented with the complete state evidence required by today's 0050 rules; no guard is disabled. Financial functions remain byte-identical in the candidate database and genuine completion fixtures check exact economics. Broader 0087/0088 migration-installation harnesses deliberately require earlier installed baselines, so they were not bypassed or applied over the current 0088 schema. The relevant financial paths are exercised against the exact current candidate and their existing Node coverage runs in the full suite.

Exact final execution commands, expanded from the logging wrapper:

```text
node .0089-audit.cjs
node .0089-build.cjs
node .0089-build-harness.cjs
node supabase/tests/0089_trusted_movement_priority_behavior.cjs
node --check supabase/tests/0089_trusted_movement_priority_concurrency.cjs
node --check supabase/tests/0089_trusted_movement_priority_regression.cjs
node --test tests/trustedMovementPriority.test.cjs tests/migrationNumbering.test.cjs
node .0089-run.cjs behavior concurrency regression focused full types
node supabase/tests/0089_trusted_movement_priority_concurrency.cjs
node supabase/tests/0089_trusted_movement_priority_regression.cjs
node --test tests/trustedMovementPriority.test.cjs tests/migrationNumbering.test.cjs supabase/tests/0048_offerer_interest_inbox.test.cjs supabase/tests/0049_interest_authorized_offer_continuation.test.cjs tests/fundedActivationFeeFinalization.test.cjs
node --test
node node_modules/typescript/bin/tsc --noEmit
git diff --check
node .0089-final-audit.cjs
```

The wrapper executes the subsequent commands as child processes, sequentially for database suites, and writes complete logs with the 0089- prefix. The direct behavior command had three initial executions (two fixture failures, then 65 passes); the wrapper sequence had two interrupted runs (schema-restore timeout and an invalid forgery fixture), then the complete successful run with expanded 75-check behavior coverage. [Validation corrections](0089-validation-corrections.md) explain each failure and its correction. Temporary audit/build/runner scripts are removed after the final successful audit.

[File manifest](0089-file-manifest.json) lists every created/modified file. [Integrity evidence](0089-integrity.json) verifies all 88 historical migration hashes, all 274 persistent function definitions/attributes, unchanged application fingerprint, empty index, unchanged branch/HEAD, no persistent 0089 history/helpers and zero leftover disposable databases. [Complete git status --short](0089-git-status.txt) includes the pre-existing unrelated untracked files, which remain untouched. No branch switch, staging, commit, push, merge, persistent installation or deployment occurred.

These are actual Codex-run PostgreSQL, Node and TypeScript results, not a separate independent external review. Requester-first integration, persistent decision receipts and future reservation behavior are deliberately unimplemented design boundaries, not runtime claims.
