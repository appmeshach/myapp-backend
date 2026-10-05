# 0084 completed Movement reputation

Branch: `feature/0084-completed-movement-reputation`.

## Forensic audit and scope

`0001_core_movement_schema.sql` defines `members.rating` as nullable NUMERIC(3,2), constrained to 1–5, and `completed_movements` as a nonnegative integer defaulting to zero. Repository-wide searches found no aggregate writer. `update_my_profile` in 0002 accepts only name and birth date; 0004 revokes direct authenticated member writes. Existing 0014 behavioral fixtures assign illustrative values as owner; those are historical test data, not an authoritative producer.

0001 also defines `public.journey_reviews`, with reviewer/reviewee UUIDs, integer stars, several optional review fields, and journey/pair uniqueness. It is an unfinished scaffold: no review submission RPC, no write policies, no client write grant, no aggregate producer, and no client integration were found through 0083. This is not a competing authoritative reputation system. 0084 preserves it but refuses installation if it contains rows, avoiding silent parallel histories.

0009 participant rows use primary_requester/invited_participant roles and confirmed/invited/declined/removed status. They identify the need and internal member. Direct client access is revoked. Confirmation establishes roster membership, not an individual observation of travel. The 0072 movement-context snapshot freezes authorization/roster evidence before travel, not proof of each invitee's completed travel.

`private.post_activation_reveal_subjects` in 0014 is the server authority for person numbers: travellers see only the offering member as number 1. The offerer sees confirmed travellers ordered by primary requester first, then created_at and participant UUID. Invitee ordinals depend on the roster. `public.get_post_activation_people` projects those server ordinals without member UUIDs. For the two principals alone, the only eligible counterpart is always person 1. 0084 preserves that viewer-relative semantic and validates identity against immutable completion-principal receipts; it never persists or reuses an unstable invitee ordinal.

0083 completion requires exact offerer request and requester confirmation, linked activation, coordination, start, completion request and receipt, terminal alignment/journey consistency, the three stored financial components, and exact balanced settlement transactions/postings. Its funded selector follows agreement, alignment, then journey lock order. The historical financial graph validates with `assert_funded_coordination_entry` and `assert_funded_completion`. Completed recovery is need-based, limited to principals, and projects safe route/time/settlement fields. No legacy completed journey alone qualifies for 0084.

The read-only local audit found **0 members, 0 reviews, 0 nonzero counts, 0 nonnull ratings, and 0 completion receipts**, with history through 0083. The only existing member trigger was set_updated_at. Remote data was not queried. Deployment must run the read-only audit there; unexplained reviews/aggregates abort installation rather than being overwritten. Existing valid funded receipts can be backfilled only by full historical graph validation; this path was tested in a populated disposable clone.

## Architecture and invariants

- Two private RLS-enabled tables: immutable completion-principal receipts and immutable rating receipts. No PUBLIC/anon/authenticated/service_role table access. Update/delete/truncate guards apply even to owner-level test operations.
- Only the offerer and primary requester count and may rate each other. Invited-participant reputation is deferred until individual historical travel evidence exists.
- Completion capture is a DEFERRABLE construction constraint trigger on the 0083 receipt, validating the entire financial graph at statement end or commit. Each principal receives one count per alignment, protected by unique keys. Insert validation rejects outsider identities and incorrect completion timestamps.
- Read RPC: `get_my_completed_movement_rating_targets(p_movement_need_id uuid)`.
- Write RPC: `rate_my_completed_movement_person(p_movement_need_id uuid,p_person_number integer,p_stars integer)`.
- Both accept no other member UUID and return only person_number, person_role, first_name, rating, completed_movements, already_rated and my_stars. Authenticated caller must be an exact principal. A valid funded completion and complete principal receipts are mandatory.
- Write locks: the existing agreement → alignment → journey order, followed by member UUID order. Member gates precede inserts and fresh aggregate reads. Unique movement/reviewer/reviewee identity is the final duplicate guard. Exact replay performs no data writes; changed stars fail.
- Rating aggregates use exact numeric AVG and ROUND to two decimal places (positive half ties away from zero); no votes yields NULL. Completed counts derive exclusively from principal receipts. Member guards reject fabricated aggregate changes. Rating insertion also validates its historical graph/timestamp and refreshes the aggregate atomically.
- 0083 settlement functions are not replaced. No wallet writer, payment provider, payout, surge, financial amount input or journey producer was added.

## Client and startup cost

Completed movement cards expose a lazy “View rating options” control. The authoritative rating controls render only after the RPC succeeds. There are five explicit choices, a separate submit action, submitted-state display and no editing. Legacy completed movements receive a neutral unavailable result. Parsers reject extra/private keys, malformed roles, ordinals, counts, decimal stars and unsupported numeric precision. Errors are generic. Controller guards duplicate taps and clears/aborts stale account or unmounted requests.

No dependency or paid service was added. No rating RPC runs on app startup or for unopened cards; opening one panel adds one authenticated read/subscription. Backend costs are two principal rows per completed movement, indexed integer/count/numeric aggregation, and at most two rating receipts per movement. Aggregate recomputation scans the affected member's indexed history; future high-volume optimization must preserve this authority and locking contract.

## Files changed/created

Implementation:

- `supabase/migrations/0084_completed_movement_reputation.sql`
- `src/services/completedMovementReputationService.ts`
- `src/state/completedMovementReputationController.ts`
- `src/hooks/useCompletedMovementReputation.ts`
- `src/components/CompletedMovementReputation.tsx`
- `src/components/CompletedMovements.tsx`

Tests:

- `supabase/tests/0084_completed_movement_reputation_audit.cjs`
- `supabase/tests/0084_completed_movement_reputation_harness.cjs`
- `supabase/tests/0084_completed_movement_reputation_test.sql`
- `supabase/tests/0084_completed_movement_reputation_behavior.cjs`
- `supabase/tests/0084_completed_movement_reputation_concurrency.cjs`
- `supabase/tests/0084_completed_movement_reputation_compatibility.cjs`
- `supabase/tests/0084_completed_movement_reputation_settlement_regression.cjs`
- `tests/completedMovementReputation.test.cjs`
- `tests/support/historicalMigrationBytes.cjs`
- `tests/migrationNumbering.test.cjs`
- `tests/requesterMovementInterest.test.cjs` (new component dependency stub only)
- `tests/temporalHardeningAudit.test.cjs`
- `tests/trustedTemporalEvidenceHardening.test.cjs`

Artifacts: this document, `0084-focused-results.txt`, `0084-full-node-results.txt`, `0084-integrity.json`, and `0084-git-status.txt`.

## Integrity and validation

0084 SHA-256: `f18dabb6f74f4cdb41118d2e9cc58292aaf6d706b051c7a1d1679e4f25f8f2ef`.

Historical 0001–0081 normalized SHA remains `488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223`; all 81 raw hashes match the audit inventory. No historical migration has a Git diff.

0082 committed raw/LF SHA: `75cba03be6dc31d9869861ba53e50623d9756028d2b0be281ddac903d3b15351`.
0083 committed raw/LF SHA: `c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976`.
This checkout uses CRLF for both files: working raw SHA values are respectively `5b9eb6e47d5e7912f26572d79cab16d260a9539552208986ca142ee64c8ed627` and `701da37c49e9e74cfbfc654698d4c57157aa39cf259d3df43ceee2632c9a4604`. Integrity tests hash exact committed bytes and separately require the checkout to match them after only CRLF normalization; arbitrary SQL changes still fail. Historical files were not rewritten.

Final-source results:

- PostgreSQL behavioral: 34 checks passed.
- PostgreSQL concurrency: 11 scenarios passed, 10 actual blocking proofs, zero deadlocks (session errors and database counter checked). Includes duplicate commit/rollback, reciprocal ratings, repeated shared-member writers, exact replay, and waiting on the completion commit.
- Historical compatibility/backfill: passed, including fail-closed unexplained aggregates.
- 0083 settlement regression: 149 checks passed. Its side-effect proof excludes only the intentional new principal receipts and completed counts, with an additional exact-principal/count check. All financial and operational assertions remain.
- Focused portable: 129 passed, 0 failed, 0 skipped.
- Full Node: 1702 passed, 0 failed, 1 existing skip.
- TypeScript: passed.
- Tracked `git diff --check`: passed.
- Intended new-file whitespace checks: passed.

Database tests use committed source only in disposable schema clones. Application data/catalog/ACL/RLS/migration-history fingerprints and disposable cleanup passed. No persistent local 0084 installation, migration history edit, role change, staging, commit, push or remote change occurred. Existing unrelated untracked files were ignored.

Deferred: invitee reputation, remote compatibility audit, persistent installation/deployment, and device-level visual QA.
