# 0085 funded mutual no-travel and held-funds release

## Source audit and design

Audited before implementation: 0019; wallet 0064–0068; funding 0078;
activation 0079; coordination 0080; start 0081; completion 0083;
reputation 0084; 0057 end wrappers; MovementEnd service/controller/hook/UI.

0019 is lifecycle-only, requires legacy activation-payment evidence, and locks
journey before alignment. Its request endpoint can imply reciprocal consent;
0057 already requires separate confirmation. 0080 blocks all financial use of
that path. Its historical receipts and nonfinancial route are retained.

0064 supplies append-only balanced ledger rows, positive-only postings and the
existing `movement_hold_release` kind. 0066/0067 serialize wallet writers through
member UPDATE before account locks; 0068 forbids closing a nonzero account.
0078 holds exactly the immutable requester platform share and contribution,
uses deterministic component keys, and validates receipts and ledger on replay.
0079 proves hold/activation/face identities. 0080 proves exact coordination,
vehicle and journey. 0081 freezes meeting point and start request evidence;
only its confirmation receipt is authoritative start. 0083 requires that exact
start before completion and atomically settles the three immutable components.
0084 creates reputation only from exact completed 0083 movements.

Funded canonical lock order: agreement SHARE → alignment UPDATE → offer SHARE
(through materialization assertion) → journey UPDATE → both principal members
UPDATE ordered by UUID → requester wallet accounts UPDATE ordered by UUID.
All explicit mutations acquire both member gates before consent receipt FKs,
which would otherwise take implicit member KEY SHARE locks and risk an upgrade
or reversed member order. Request/decline/read do not lock wallet accounts;
reads take no member write gates. Replay validates historical accounts without requiring
present balances or active status. No proposal, need, or platform account write
lock is added. Trigger assertions do not acquire graph UPDATE locks.

## Architecture

Private append-only `funded_no_travel_requests`, `funded_no_travel_declines`,
and `funded_no_travel_closures` retain each explicit intent, decline and final
two-principal disposition. Each has RLS and no client/service-role table grants.
The closure binds agreement, alignment, journey, request, distinct principals,
request/release instants and the preserved pending start instant.

Existing public need-selector RPC names remain:
`get_my_movement_end_status_by_need`, `request_my_movement_end`,
`confirm_my_movement_end`, `decline_my_movement_end`.
Financial candidates route to private `funded_no_travel_alignment`,
`mutate_funded_no_travel`, and `assert_funded_no_travel`.
Private trigger helpers are `require_funded_no_travel_actor` and
`validate_funded_no_travel_graph`.
Legacy candidates retain 0057/0019 routing. Obsolete journey-selector mutation
RPCs still reject financial alignments. Explicit request cannot become consent.

Safe response adds `funding_disposition`, `released_minor`, `currency` to the
original six keys. Legacy values are `legacy`, NULL, NULL. Funded pending is
`held`, NULL, NGN. Terminal requester sees `released_to_me`; offerer sees
`released_to_requester`. Amount is the backend's exact sum, never client math.
Client accepts old six-key responses during rollout, validates exact key sets
and safe integer NGN outcomes, and refreshes after mutation before success copy.

For R=requester_platform_share and C=movement_contribution, H=R+C:
requester held −H; requester available +H; offerer and platform unchanged.
Each positive component has one `movement_hold_release:<component_id>`
transaction with exactly two matching postings. Zero components have none;
the empty-positive-component construction also has no zero postings. Current
0071 requires a positive occupied-seat price, making both requester components
zero unreachable with exact materialized provenance. The one-zero-component
case is tested through normal producers; a zero-only invented agreement is
rejected by unchanged economics. No provider fields,
settlement, payout entitlement, completion, rating or reputation credit is created.

Forward coordination assertions/guards recognize only a complete cancelled
receipt graph. Normal start and completion bodies/economics are retained.
Pending start evidence and timestamps remain immutable and frozen; cancellation
does not clear them or fabricate started_at/completed_at. Cancelled state makes
later start/completion mutation gates fail. Partial release history fails closed.

Exact own request retry preserves pending evidence. Exact first-principal request
or second-principal confirmation retry after closure writes nothing. Changed
reason, reciprocal request, self-confirmation, wrong-actor terminal retry and
terminal decline fail. Decline appends evidence, clears only the active intent
projection and allows a new explicit request without moving money.

## Cost and boundaries

Required external service: none. Recommended: none. Optional: none.
Only database receipts, positive release transactions/postings and RPC compute
grow with mutually closed funded movements. No dependency/provider added.
Unilateral refusal, contested travel, partial travel, misconduct, safety,
abandonment, fraud and external refunds remain deferred to 0086+.
0085 is tested only in disposable databases; no persistent migration application,
staging, commit, push, merge or deployment is authorized.

Operational `updated_at` remains controlled by the existing 0001 triggers and
is not historical money evidence. The authoritative release instant is shared
exactly by the terminal receipt, transactions and postings.

## Final validation

All PostgreSQL runs used schema-only disposable databases, cleaned up afterwards.
Every run verified the persistent application data/catalog/ACL/RLS/history
fingerprint remained unchanged. 0085 was not applied to the persistent database.

| Check | Result | Evidence |
| --- | --- | --- |
| PostgreSQL behavior | 420 assertions passed | `0085-behavior-results.txt` |
| Concurrency | 13 scenarios, 13 actual `pg_blocking_pids` proofs, zero deadlocks | `0085-concurrency-results.txt` |
| 0083 settlement | 149 unchanged checks passed | `0085-regression-results.txt` |
| 0084 reputation | 34 checks passed | `0085-regression-results.txt` |
| 0019 legacy | 203 checks passed; legacy projection has NULL financial values | `0085-regression-results.txt` |
| Focused portable/client tests | 151 passed, zero failures/skips | `0085-focused-results.txt` |
| Full `node --test` | 1,710 total; 1,709 passed; zero failed; one existing optional DuckDB integration skipped | `0085-full-node-results.txt` |
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit`: exit 0 | Verified final client source |
| Diff/whitespace | `git diff --check`: passed; owned new source whitespace also passed | `0085-integrity.json` |
| Historical integrity | All 0001–0084 equal committed bytes after CRLF normalization; committed SHA-256 pins retained | `0085-integrity.json` |

Migration SHA-256 (exact new-file bytes):
`7dab4e1a78cb5066c69f57cd9362bf5ada64fd51e343edf7ac1538caa3756c27`.

Concurrency covers both winners and rollback variants for close versus start,
duplicate final confirmation with commit/rollback, first closure request versus
start request in both orders, reciprocal principal requests, the existing top-up
member gate, consent FKs competing with 0083 settlement across shared principals,
and both 0083 completion RPCs competing with closure. Completion also fails before
the race because no authoritative start exists. The evidence file records each
actual blocker and blocked PostgreSQL backend PID.

Historical replay succeeds without writes after later ledger transfers change
balances and all three requester accounts legitimately close. Exact projections,
role/actor denial, actual RPC/table ACLs, RLS, update/delete/TRUNCATE CASCADE
protection, missing graph stages, partial hold history, overflow, insufficient
held funds and both caller constraint modes are covered.

The both-zero success fixture requested in the milestone cannot be produced
under unchanged 0071 economics: positive occupied-seat input guarantees positive
contribution. No provenance, economics or guard was changed to manufacture it.
The genuine zero-platform-share fixture passes and creates no zero-value row;
zero-only economic input is explicitly tested as rejected. Any future zero-only
policy requires a separately authorized upstream design.

## Exact file manifest

Modified tracked files:

- `src/components/MovementEnd.tsx`
- `src/services/movementEndService.ts`
- `supabase/tests/financial_agreement.test.cjs`
- `supabase/tests/financial_proposal.test.cjs`
- `tests/migrationNumbering.test.cjs`

The two consumer allowlists register only the exact new reviewed 0085 migration;
all other operational/client exclusions remain enforced. Numbering now requires
exactly 0001–0085 while retaining all historical byte-integrity assertions.

Created implementation/documentation files:

- `supabase/migrations/0085_funded_mutual_no_travel_release.sql`
- `supabase/tests/0085_funded_no_travel_harness.cjs`
- `supabase/tests/0085_funded_no_travel_behavior.cjs`
- `supabase/tests/0085_funded_no_travel_concurrency.cjs`
- `supabase/tests/0085_funded_no_travel_regression.cjs`
- `tests/fundedNoTravelRelease.test.cjs`
- `docs/0085-funded-mutual-no-travel-release.md`

Created validation artifacts:

- `docs/0085-behavior-results.txt`
- `docs/0085-concurrency-results.txt`
- `docs/0085-focused-results.txt`
- `docs/0085-full-node-results.txt`
- `docs/0085-regression-results.txt`
- `docs/0085-integrity.json`
- `docs/0085-git-status.txt`

Branch: `feature/0085-funded-no-travel-release`; HEAD/base:
`749ef323436a73d0af85fd24615ad0abc177ea32`.
Five tracked files modified and fourteen files created for 0085. All seventeen
pre-existing unrelated untracked entries remain untouched. Full final status is
in `0085-git-status.txt`. Nothing staged, committed, pushed, merged or deployed.
