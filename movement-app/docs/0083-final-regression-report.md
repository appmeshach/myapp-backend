# Final-catalog regression verification

Classification: **B — NOT READY**. The 0079 installed run failed its read-only catalog preflight before any concurrency scenario. No retry was made, as requested.

## Changes in this task

- `supabase/tests/final_movement_regression_catalog.cjs` (new): final-owner selection, ordered source composition, installed history/structure guards, narrowly scoped public row-type signature normalization.
- `supabase/tests/0079_funded_movement_activation_harness.cjs`
- `supabase/tests/0080_funded_movement_coordination_entry_harness.cjs`
- `supabase/tests/0081_financial_movement_start_harness.cjs`
- The corresponding three `*_behavior.cjs` modules: export composed final-state source and retain separately named `historicalMigrationBody`.
- `supabase/tests/0079_funded_movement_activation_concurrency.cjs`: previously demonstrated final-catalog legacy-start rejection now checks 23514 and its exact lifecycle message.
- `supabase/tests/0080_funded_movement_coordination_entry_concurrency.cjs`: previously demonstrated final-catalog meeting-point capability projection is checked, with an additional assertion that no start request was created.
- `tests/finalMovementRegressionOwnership.test.cjs` (new).
- `tests/fundedMovementActivation.test.cjs`: synthetic final-catalog rows include the required owner.
- This report, ownership JSON, focused result log, and complete Git status snapshot.

No production SQL or client implementation was changed in this task. Other existing working-tree changes belong to preceding work.

## Ownership

The complete function-by-function map is in `0083-final-regression-ownership.json`.

- 0079 redirects `private.assert_funded_activation` and `public.activate_my_funded_movement` to 0082. Its other 11 functions remain pinned to 0079.
- 0080 redirects `private.funded_coordination_alignment`, `private.assert_funded_coordination_entry`, `private.protect_financial_coordination_journey`, and `private.protect_financial_coordination_alignment` to 0083. An additional source-confirmed overlap redirects `public.get_my_movement_coordination_status` to 0081. Its other 16 functions remain pinned to 0080.
- 0081 redirects those same four private functions to 0083 and `private.require_funded_start_actor` to 0082. Its other six functions remain pinned to 0081.

Source-mode final-state composition appends every migration from the tested milestone through 0083 in numeric order. Installed mode only reads and verifies; it never repairs source automatically. Original definitions remain available for explicitly selected historical-boundary verification. Disposable source composition was structurally tested, not executed in this task.

Body, argument/result signature, definer, search path, owner, function attributes and ACL verification remain strict. Normalization accepts `public.alignments`/`public.journeys` versus their unqualified source spellings; a counterfeit private schema is rejected.

## Results

- 0079: failed preflight on `private.assert_funded_activation` argument formatting (`a public.alignments` versus `a alignments`); zero scenarios executed. This was a harness verifier defect. It was corrected with a focused regression test, but the database runner was not retried. No clone was created; clone cleanup/fingerprint assertions were not reached.
- 0080: 18 scenarios passed, 18 actual blocking proofs, no deadlock, disposable cleanup passed, application fingerprint unchanged.
- 0081: 21 scenarios passed, 22 actual blocking proofs, no deadlock, disposable cleanup passed, application fingerprint unchanged.
- Focused portable suite: 180 passed, zero failed, zero skipped. It covers all three harnesses, temporal/completion ownership, overlap precedence, historical retention, malformed/missing catalog, ACL/body/owner/signature drift and read-only installed verification.
- Full `node --test` and TypeScript were not run: the requested all-regressions-pass prerequisite was not met. No earlier result is represented as a fresh result.
- `git diff --check`: exit 0; Git emitted only line-ending conversion notices.
- Supplementary new-file checks reported no whitespace diagnostics. The first wrapper unnecessarily treated a line-ending notice as an error; the remaining no-index checks produced no diagnostics (exit 1 denotes added-file differences).

## Integrity

- 0082 SHA-256: `75cba03be6dc31d9869861ba53e50623d9756028d2b0be281ddac903d3b15351`
- 0083 SHA-256: `c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976`
- Historical normalized 0001–0081 SHA-256: `488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223`
- All 81 raw historical hashes also match the audit inventory.

No paid dependency was added or used. No production migration reinstallation, migration-history edits, staging, commit, push, role changes, or remote Supabase changes occurred. Complete working-tree status is in `0083-final-regression-git-status.txt`.
