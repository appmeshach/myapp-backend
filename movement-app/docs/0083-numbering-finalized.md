# Final migration numbering

Final sequence: **0081 financial movement start → 0082 trusted temporal evidence hardening → 0083 financial movement completion + atomic settlement**.

The completion migration was moved with PowerShell Move-Item, without opening or rewriting SQL. Old path is absent; new path is present. Both SQL hashes and all 81 historical raw hashes are unchanged. Nothing has been installed, staged, committed, pushed, renamed in migration history or changed remotely.

## Reference updates

- tests/trustedTemporalEvidenceHardening.test.cjs: completion hash input path.
- tests/temporalHardeningAudit.test.cjs: completion hash input path.
- tests/financialMovementCompletion.test.cjs: completion source input path.
- supabase/tests/financial_proposal.test.cjs: exact completion migration allowlist.
- supabase/tests/financial_agreement.test.cjs: exact completion migration allowlist.
- supabase/tests/movement_context.test.cjs: exact completion migration allowlist.
- supabase/tests/0048_offerer_interest_inbox.test.cjs: normalized movement-context test integrity pin updated for the path-only change.
- supabase/tests/0082_financial_movement_completion_harness.cjs: source path, installed-history version 0083 and mismatch diagnostics.
- supabase/tests/0082_financial_movement_completion_behavior.cjs: source input path.
- docs/0082-temporal-focused-audit.cjs: completion hash input path.
- docs/0082-temporal-external-model.cjs: completion hash input path.
- docs/0082-client-validation.cjs: completion hash input path.
- docs/0082-temporal-validation.cjs: completion hash input path.
- docs/financial-movement-completion.md: current migration number and source-mode description.
- docs/0082-temporal-hardening-implementation.md: finalized sequence and removal of pending-numbering language.

Existing completion runner/fixture filenames, diagnostic markers, test UUIDs and historical audit reports remain unchanged. Recorded prior Git statuses are historical evidence and retain the old filename. The new numbering test intentionally names the old path to prove absence. Historical conclusions are not rewritten; this document supersedes only pending numbering recommendations.

## Working-tree categories

- Temporal hardening: 0082 trusted migration, its focused SQL/CJS/portable tests, temporal implementation/build/audit/validation artifacts and exact older-suite allowlist changes.
- Client compatibility: five service/state files (movementService, meetingJourneyService, fundedCompletionService, completedMovementService, verificationState), focused client test adjustments and 0082-client audit/results/validation artifacts.
- Completion: renamed 0083 SQL, existing 0082-prefixed completion runners/fixtures, financialMovementCompletion tests, completion UI/service/controller/hooks and completion investigation artifacts.
- Numbering task: the rename and reference list above, migrationNumbering.test.cjs, 0083-numbering scripts/docs/results/status artifacts. No client source changed in this task.
- Unrelated existing work: sibling app directories, vehicle registration, other UI/state changes and earlier review/result artifacts. Preserved as found; complete status is in 0083-numbering-validation.txt.

No paid dependency. No database harness or db push command is run for this numbering task. SQL comments still mentioning the original development number are preserved because byte identity is mandatory.
