# 0091 — Pre-Departure Roster Freeze

Candidate only. No persistent installation, staging, commit, push, merge, or deployment was performed.

## Implemented contract

The first offerer start request for an availability-backed movement freezes that exact parent roster. An immutable private receipt records the accepted initiating graph and funded or legacy start authority. An open parent becomes unavailable; remaining capacity is unchanged. Full, withdrawn, expired, and already unavailable parents retain their truthful status. Later starts reuse the first receipt rather than replacing its provenance.

New interests, offers, matching context, and offer acceptance fail closed after the freeze. Previously accepted siblings retain their funding, activation, coordination, start, completion, dispute, and held-review lifecycle. Unused places create no agreements, wallet movements, or settlement components. Completion and no-travel do not restore capacity.

Funded start preserves the agreement/alignment/offer/journey/meeting-point lock prefix, then locks the exact offering intent, route, and availability. Admission serializes on that same intent. No sibling requester needs are locked. Legacy bound start appends the same parent locks; genuinely unbound legacy starts do not fabricate modern provenance.

The receipt and start metadata are constructed atomically with named, initially immediate completeness constraints. The funded request is inserted before the freeze receipt, so its foreign key also works when the caller has selected `SET CONSTRAINTS ALL IMMEDIATE`. Direct partial construction, forged graph identity, and foreign legacy start actors are rejected. Existing funded actor guards and their error contracts are retained. New table RLS has no public policies, and all new helper/table privileges are revoked from PUBLIC, anon, authenticated, and service_role.

`frozen_at` and `initiating_requested_at` are immutable server-observed metadata. Historical truth uses exact graph provenance and immutable request identity, never an inequality between independent clock observations or a later live clock sample. Equal and regressed observations are valid. The server owns the freeze observation.

The preflight rejects existing availability-backed requested/started journeys that lack deliberate freeze remediation. It does not backfill invented historical timestamps. Historical unbound legacy journeys remain compatible.

## Files

Created:

- `supabase/migrations/0091_pre_departure_roster_freeze.sql`
- `supabase/tests/0091_pre_departure_roster_freeze_harness.cjs`
- `supabase/tests/0091_pre_departure_roster_freeze_behavior.cjs`
- `supabase/tests/0091_pre_departure_roster_freeze_concurrency.cjs`
- `supabase/tests/0091_pre_departure_roster_freeze_temporal.cjs`
- `supabase/tests/0091_pre_departure_roster_freeze_regression.cjs`
- `supabase/tests/0091_roster_regression_support.sql`
- `tests/preDepartureRosterFreeze.test.cjs`
- `docs/0091-pre-departure-roster-freeze.md`

Updated only test registries:

- `tests/migrationNumbering.test.cjs`: include migration 0091 while retaining historical hashes.
- `supabase/tests/movement_context.test.cjs`: register the sanctioned 0091 matching-context consumer.
- `supabase/tests/0048_offerer_interest_inbox.test.cjs`: update the registry checksum.

## Validation method

PostgreSQL tests use schema-only disposable `temporal0082_*` databases cloned from the exact installed 0090 catalog (277 functions). The migration produces 283 functions. Source bodies, replacement owner/security/ACL metadata, unchanged unrelated functions, new helper privileges, and RLS are checked. Each run compares the persistent application/catalog/history fingerprint and drops its clone. Restore uses a single transaction solely within disposable clones.

Historical test files are unchanged. The composition harness adapts fixture construction to current trusted endpoint/state producers and creates a genuine start graph for unavailable parents. The 0081 all-table fingerprint excludes only the initiating parent's status/update metadata and its new freeze receipt; capacity and sibling rows remain fingerprinted. Financial regression expectations reuse the documented 0088 policy: R earned at activation, C/O at completion, and new no-travel held review rather than refund. Original historical upgrade-only tests remain intact; current-policy 0088 behavior runs in the 0091 clone.

LF-normalized migration SHA-256:
`f59912cb3a7c11cf0421cbbb9c10964b541553036c7e7c1efab2e34fcf3a2392`

## Commands and counts

Executed PostgreSQL commands:

```
node supabase/tests/0091_pre_departure_roster_freeze_behavior.cjs
node supabase/tests/0091_pre_departure_roster_freeze_concurrency.cjs
node supabase/tests/0091_pre_departure_roster_freeze_temporal.cjs
node supabase/tests/0091_pre_departure_roster_freeze_regression.cjs admission
node supabase/tests/0091_pre_departure_roster_freeze_regression.cjs state
node supabase/tests/0091_pre_departure_roster_freeze_regression.cjs foundation
node supabase/tests/0091_pre_departure_roster_freeze_regression.cjs start
node supabase/tests/0091_pre_departure_roster_freeze_regression.cjs priority
node supabase/tests/0091_pre_departure_roster_freeze_regression.cjs finance
node supabase/tests/0091_pre_departure_roster_freeze_regression.cjs activation
```

| Coverage | Passed |
|---|---:|
| 0091 behavior | 102 assertions + 2 preflight checks |
| 0091 temporal | 17 assertions |
| 0044 / 0045 / 0046 / 0047 / 0048 / 0049 | 44 / 62 / 26 / 70 / 86 / 52 |
| 0050 / 0054 / 0055 / 0056 | 14 / 35 / 26 / 29 |
| 0074 / 0076 / 0077 / 0078 | 32 / 56 / 62 / 52 |
| 0081 positive / zero-value scenarios | 96 / 95 |
| 0083 settlement (current 0088 economics) | 149 |
| 0084 reputation / 0019 legacy no-travel | 34 / 203 |
| 0086 behavior / temporal | 558 / 118 |
| 0087 behavior / temporal | 235 / 70 |
| 0088 current-policy behavior | 240 |
| 0089 behavior | 75 |
| 0089 regression | inbox 86; continuation 52; reputation 34; confirmed/timeout settlement 2; held-review 2; legacy 203; provenance 3 |
| 0090 behavior | 89 |

| Concurrency suite | Scenarios | Actual blocking proofs | Deadlocks |
|---|---:|---:|---:|
| 0091 | 22 | 18 | 0 |
| 0086 | 20 | 19 | 0 |
| 0087 | 33 | 32 | 0 |
| 0088 | 38 | 32 | 0 |
| 0089 | 8 | 1 | 0 |
| 0090 | 11 | 6 | 0 |

0091 additionally proves six existing-sibling continuation cases. 0089 has 19 read assertions and three lock-release proofs; 0090 has six lock-release proofs. All blocking counts use actual `pg_blocking_pids`, rather than elapsed-time assumptions.

Portable commands:

```
node --test tests/preDepartureRosterFreeze.test.cjs
node --test tests/preDepartureRosterFreeze.test.cjs tests/migrationNumbering.test.cjs tests/financialMovementStart.test.cjs tests/trustedTemporalEvidenceHardening.test.cjs tests/trustedMovementPriority.test.cjs tests/trustedRequesterMovementPriority.test.cjs supabase/tests/movement_context.test.cjs supabase/tests/0048_offerer_interest_inbox.test.cjs
node --test
node .\node_modules\typescript\bin\tsc --noEmit
git diff --check
```

0091 portable: 11/11. Focused: 138/138. Full Node: 1,867 total, 1,866 passed, one skipped, zero failed/cancelled/todo. TypeScript and `git diff --check` pass.

Initial validation failures were corrected: migration sequence/context-consumer/checksum registries needed the new milestone; historical unavailable fixtures needed genuine accepted start provenance. One concurrent Docker cleanup call timed out after all 191 start assertions passed; the complete start group was rerun and passed with cleanup/fingerprint verification. A transient route-production fixture observation failed under heavy concurrent workload; the complete isolated concurrency rerun passed. No production time tolerance or clock adjustment was introduced.

## Integrity

All 90 historical migration normalized contents equal HEAD. Combined filename-plus-normalized-content SHA-256:
`8ce33c31c31504e5c1aa046d4130d3e408f01151fcb5b19ec09e4f27dd6a851c`.

HEAD remains `9308aa06b09a7af83ada68bc111b98254b896854` on `feature/0091-cascading-route-segments`. The index is empty. Protected production client and dependency files have no tracked diff. Existing unrelated untracked files were neither edited nor staged. No paid dependency or remote Supabase operation was introduced.

Final read-only persistent database check:

```
disposable_clones=0
0091_history=0
0091_table=absent
0091_helpers=0
```

0079 activation and 0080 coordination contracts are exercised through the current-policy activation/security suites and accepted-sibling lifecycle tests. 0082 temporal principles are exercised by the focused portable temporal suite and the 0091/0086/0087 PostgreSQL temporal suites. No claim is made that the historical pre-upgrade 0079, 0080, or 0082 standalone cutover installers were run against the current 0090 baseline. The 0075 historical correction is preserved and its guards run in the issuer/materialization/funding composition.

## Final git status --short

```text
 M supabase/tests/0048_offerer_interest_inbox.test.cjs
 M supabase/tests/movement_context.test.cjs
 M tests/migrationNumbering.test.cjs
?? ../gseller-app/
?? ../gtransport-app/
?? ../gzone-app/
?? 0061-manual-review.txt
?? 0062-behavioral-test-review.txt
?? 0062-input-contract-review.txt
?? 0062-route-contracts-review.txt
?? 0062-runtime-review.txt
?? docs/0059-pricing-geography-concurrency-results.json
?? docs/0059-pricing-geography-sql-results.txt
?? docs/0060-pricing-geography-concurrency-results.json
?? docs/0086-0082-baseline-acl-failure.txt
?? docs/0086-concurrency-restore-timeout.txt
?? docs/0086-git-status.txt
?? docs/0086-regression-restore-timeout.txt
?? docs/0086-regression-retry-timeout.txt
?? docs/0088-behavior-results.json
?? docs/0088-behavior-results.txt
?? docs/0088-concurrency-results.json
?? docs/0088-concurrency-results.txt
?? docs/0088-diff-results.txt
?? docs/0088-file-manifest.json
?? docs/0088-focused-results.txt
?? docs/0088-full-initial-registry-failure.txt
?? docs/0088-full-results.txt
?? docs/0088-git-status.txt
?? docs/0088-migration-integrity.json
?? docs/0088-policy-held-initial-forgery-error.txt
?? docs/0088-pre-policy-migration.sql.txt
?? docs/0088-pre-policy-report.md
?? docs/0088-regression-0087-behavior-results.json
?? docs/0088-regression-0087-concurrency-results.json
?? docs/0088-regression-0087-temporal-results.json
?? docs/0088-regression-adaptations.json
?? docs/0088-regression-remaining-results.txt
?? docs/0088-regression-results.txt
?? docs/0088-regression-settlement-results.txt
?? docs/0088-types-results.txt
?? docs/0089-behavior-results.json
?? docs/0089-behavior-results.txt
?? docs/0089-concurrency-results.json
?? docs/0089-concurrency-results.txt
?? docs/0089-file-manifest.json
?? docs/0089-focused-results.txt
?? docs/0089-full-results.txt
?? docs/0089-git-status.txt
?? docs/0089-initial-display-forgery-fixture-error.txt
?? docs/0089-integrity.json
?? docs/0089-regression-results.json
?? docs/0089-regression-results.txt
?? docs/0089-schema-restore-timeout.txt
?? docs/0089-types-results.txt
?? docs/0091-pre-departure-roster-freeze.md
?? docs/MOVEMENT_SYSTEM_SPEC.md
?? src/app/register-vehicle.tsx
?? supabase/.branches/
?? supabase/migrations/0091_pre_departure_roster_freeze.sql
?? supabase/tests/0091_pre_departure_roster_freeze_behavior.cjs
?? supabase/tests/0091_pre_departure_roster_freeze_concurrency.cjs
?? supabase/tests/0091_pre_departure_roster_freeze_harness.cjs
?? supabase/tests/0091_pre_departure_roster_freeze_regression.cjs
?? supabase/tests/0091_pre_departure_roster_freeze_temporal.cjs
?? supabase/tests/0091_roster_regression_support.sql
?? tests/preDepartureRosterFreeze.test.cjs
?? transport-geography-tooling-corrected-review.txt
?? transport-geography-tooling-full-review.txt
?? transport-geography-tooling-review.txt
```
