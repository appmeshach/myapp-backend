# 0088 funded activation fee finalization — corrected policy

This report supersedes the earlier local 0088 C-release design. The before-policy migration and report are retained as explicitly superseded evidence, never installable migrations. Only the revised 0088 SQL is a candidate. No persistent installation, staging, commit, push, merge or deployment is authorized.

## Audit and financial state

The installed baseline is 0087 on branch feature/0088-funded-activation-fee-finalization, HEAD f00e06ef689d2683057754c181e6b476555d62d0. The 120-function baseline audit remains in 0088-installed-baseline-audit.json. The harness checks those exact original bodies/owners/ACLs/security settings before applying SQL only in a disposable clone, preserves all existing attributes afterward, and matches all 21 added/replaced function bodies exactly. Migrations 0001–0087 must remain byte-identical after LF normalization.

Stored economics remain G=S*N; F=30% HALF-UP once; O=floor(F/2); R=F-O; C=G-R; NET=C-O=G-F. No client amount is authoritative and no recomputation changes stored components.

| Event | Financial truth | Lifecycle truth |
|---|---|---|
| Initial funding | R+C held | Awaiting activation |
| New successful activation | R earned once; C held; O unpaid | Activated |
| Confirmed or response-timeout completion | C settles to offerer; O earned; no second R | Authoritative completed |
| Pending no-travel intent | No money movement | Not started, pending distinct consent |
| Confirmed no-travel after activation | No C or R release; held_review_required | Immutable no_travel_held receipt; underlying journey remains not_started and progress is frozen |
| 0086/0087 dispute | Unresolved obligations frozen; no automatic winner/refund | Existing review receipt and guards |

Existing legacy earned/release/completion history is never rewritten. Legacy activations retain their original R timing; a new no-travel decision for such an activation keeps the original R+C held rather than inventing an activation fee transaction. Already-written legacy no-travel releases remain historically valid and replayable. No activated graph can create a new user refund through the old no-travel path.

## Why the new receipt is separate

The old funded_no_travel_closures receipt certifies both cancelled lifecycle and an exact balanced R/C release graph. Reusing it for cancellation without a refund would make historical truth ambiguous and break the existing lifecycle guards. A new private funded_no_travel_holds receipt instead binds alignment, original activation/agreement, journey, request, both distinct principals, the exact original request observation and frozen pending-start metadata. Its observed_at is finite immutable server metadata, not cross-transaction chronology authority. The public confirmation generates it after the canonical agreement/alignment/journey and sorted principal waits. No wallet locks or postings are required because no money moves.

The operational non-start decision is authoritative in this receipt; the physical journey row remains not_started. This deliberately avoids inventing a cancelled/refunded journey graph. Further start requests/construction, start confirmation, completion construction and financial disposition are rejected; start projection hides edit/request/confirm capabilities. An already-written start request may replay its immutable history but exposes no start capability. No-travel replays are idempotent. A declined intent has no terminal receipt and moves no money. Existing 0086 reporting is available before terminal non-travel; a committed dispute beats no-travel confirmation, while committed no-travel becomes its own non-allegation review-required freeze. This does not create a report, assign fault or blame an offerer for a requester's schedule change. Later exceptional review/adjudication is deferred.

## SQL and client correction

The earlier 0088 adds two fee-policy/evidence tables, four private fee functions and nine replacements. The correction adds the held receipt table, four fully revoked private functions (assert_held_no_travel, require_held_no_travel_actor, reject_held_no_travel_progress, validate_held_no_travel_graph), immutable/actor guards, five progress/disposition gates and three graph constraint triggers. It additionally replaces require_funded_no_travel_actor, assert_funded_coordination_entry, get_my_movement_start_status and get_my_funded_movement_dispute_status while preserving their signatures/owners/grants/security settings. In total there are three new tables, eight new private functions and thirteen replacements.

mutate_funded_no_travel contains no ledger writes, no release receipt construction and no cancellation update. Its old historical terminal replay stays intact. The old closure actor rejects every new closure insert. movement_hold_release is rejected for materialized funded graphs; forged component/alignment/actor evidence still fails closed. assert_funded_no_travel rejects a release closure on a new fee-finalized activation and preserves exact legacy release validation. assert_undisposed_funded_graph rejects held terminal non-travel before new dispute opening. Existing dispute locks and exclusive races remain intact. Completion's canonical locks, deadline classification and C/O economics remain unchanged.

All new private tables use RLS and revoke PUBLIC/anon/authenticated/service_role direct access. All eight new helpers use SECURITY DEFINER with empty search_path and revoke app/PUBLIC execution. No new public RPC, refund/waive/admin capability, journey, match, offer, intent, scheduler or paid dependency is introduced.

MovementEndService accepts only the exact held projection and rejects any released amount, released disposition, cancelled/completed status, controls or leaked private identity attached to it. MovementEnd explains that no travel was recorded, progress is frozen and the contribution remains held pending future authorized review. It exposes only refresh in that terminal state and never says released_to_me. Existing truthful legacy release copy remains for original legacy release history. Requester completion UI still exposes only Confirm completed and Dispute.

## Verification

New-policy behavior and races cover zero/positive R, pending start, either initiator, self-refund denial, trusted forged release/closure/lifecycle/receipt rejection, rollback, immutable replays, unchanged complete money snapshots, no invented report, C held, R retained, and start/completion freeze. Legacy 0085 programs run with their original assertions unchanged on genuine pre-install 0087 state; 0088 then validates and replays every resulting legacy closure and proves that a pending old activation cannot create a new refund. No guards are disabled and no legacy marker is forged. New-policy race tests independently prove the corrected financial behavior. 0083/0087 settlement and 0086 dispute programs run against the revised candidate with explicit documented policy adaptations only.

Reproduction:

```text
node supabase/tests/0088_funded_activation_fee_behavior.cjs
node supabase/tests/0088_funded_no_travel_hold_behavior.cjs
node supabase/tests/0088_funded_no_travel_refund_denial.cjs
node supabase/tests/0088_funded_activation_fee_concurrency.cjs
node supabase/tests/0088_funded_activation_fee_regression.cjs
node --test tests/fundedActivationFeeFinalization.test.cjs tests/fundedNoTravelHold.test.cjs tests/fundedCompletionTimeout.test.cjs tests/fundedDisputeFreeze.test.cjs tests/fundedNoTravelRelease.test.cjs tests/trustedTemporalEvidenceHardening.test.cjs
node --test
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Final LF-normalized SHA-256: 74150ffc0c39d24f1ee256cbb1ebbe5d025e258bf634344b057dc649aafb8cea.

All checks passed. Exact corrected-policy results:

| Suite | Passed checks / scenarios | Actual blocking proofs | Deadlocks |
|---|---:|---:|---:|
| 0088 activation behavior | 254 | — | — |
| 0088 held no-travel behavior | 433 | — | — |
| 0088 direct refund denial and future-observed legacy admission | 48 | — | — |
| 0088 concurrency | 38 | 32 | 0 |
| 0087 behavior / temporal | 235 / 70 | — | — |
| 0087 concurrency | 33 | 32 | 0 |
| 0086 behavior / temporal | 558 / 118 | — | — |
| 0086 concurrency | 20 | 19 | 0 |
| Original 0085 behavior before upgrade | 420 | — | — |
| Original 0085 concurrency before upgrade | 13 | 13 | 0 |
| 0083 settlement regression | 149 | — | — |
| 0084 reputation regression | 34 | — | — |
| Legacy 0019 regression | 203 | — | — |

There are 2,522 PostgreSQL behavior/temporal/regression assertions. Candidate concurrency totals are 91 scenarios and 83 observed blocking proofs, with four prerequisite rejections, four proven wallet-lock bypasses, zero duplicate settlements and zero deadlocks. Including the explicitly pre-upgrade 0085 compatibility races gives 104 scenarios and 96 blocking proofs. All blocking proofs use actual PostgreSQL blocker/waiter evidence, not elapsed-time assumptions. Both lock orders and rollback variants are covered. The original 0085 behavior run produced nine genuine legacy closures and its concurrency run produced eleven; every closure validates and replays without writes after 0088, and both upgrade runs separately prove that a pending legacy activation cannot obtain a new refund.

Focused Node: 137 tests, 137 passed, zero failures/skips. Full node --test: 1,829 tests, 1,828 passed, zero failures/cancellations, one existing optional DuckDB integration skip (DUCKDB_BIN is not configured). TypeScript --noEmit passed. Exact current logs have the 0088-policy- prefix; older non-policy logs describe the superseded candidate. [Regression adaptations](0088-policy-regression-adaptations.json) record every policy-related expectation change and all original program hashes.

ACL/security checks pass for all new tables/helpers: RLS, app-role direct-access/execution denials, empty search_path, preserved replacement owners/grants/security attributes, immutable receipts and forged graph/actor rejection. The client cannot supply private identity, money, or server metadata. No new public financial RPC exists. Complete money snapshots remain unchanged for held no-travel, dispute, denied refund, rollback and historical replay; genuine confirmed/timeout settlement retains exact C/O economics and never earns R twice.

Final integrity evidence is in [0088-policy-integrity.json](0088-policy-integrity.json), the exact correction-only changed/created file inventory with before/after hashes is in [0088-policy-file-manifest.json](0088-policy-file-manifest.json), and the complete git status --short is in [0088-policy-git-status.txt](0088-policy-git-status.txt). git diff --check passes; all 87 historical migrations retain exact LF-normalized bytes. HEAD remains f00e06ef689d2683057754c181e6b476555d62d0 and the index is empty. Persistent baseline function definitions/owners/ACLs/security settings are unchanged for all 120 audited functions; all three 0088 tables and migration history are absent, the application fingerprint is unchanged, and disposable test databases are cleaned up. Nothing was staged, committed, installed persistently, pushed, merged or deployed.

The migration's full existing coordination-history audit runs after the corrected validators are defined, before commit. This avoids calling 0085's obsolete later-clock check during admission of genuine legacy releases. The preliminary safe activation audit and immutable legacy boundary remain; the final complete graph audit still aborts on forged/partial evidence. This admission-only correction changes no runtime function body, table, constraint, trigger or grant. A dedicated pre-install fixture constructs a valid original release under a server observation one day ahead, restores the clock sample and proves that the corrected migration, historical validation and replay accept it without money movement.

## Deferred product policy

**REVIEW: Future admin/report adjudication of held C after post-activation problems.** No automatic refund or winner exists. Vehicle breakdown after authoritative start retains R; exact C disposition is deferred. No partial-distance settlement is implemented. Review must cover unexpected occupants, inability to meet and disputed physical events without forcing a false allegation for personal schedule changes.

**REVIEW: Structured clickable/non-typable Movement review/report categories and reputation effects.** Finalize bounded categories rather than free text, and show counterpart rating during the Movement. A single report is not a verdict; reputation may combine repeated signals, ratings, verification and authoritative completion history. No automatic penalty is added here.

Completed movement count remains one positive future ranking/social/history signal among others. The Movement playlist remains internal/private to movers in that Movement and externally non-shareable. No charity, waive, forgive, free-ride, mutual-refund or gender-specific financial rule is added. One-seat offers remain fully valid while monitored; 2/3/4 seats remain fully supported. Limited early leakage does not justify an explicit bypass mechanism.

Mother rule: We do not create journeys. We connect journeys that were already going to happen.
