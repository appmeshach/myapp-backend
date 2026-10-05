# Client temporal compatibility audit

The database clock regression captured by the audit was 5,338 microseconds. Trusted server lifecycle timestamps are audit data, not client causal-order authority. No SQL or UI design was changed.

## Comparisons found before editing

| Location / check | Class | Decision |
| --- | --- | --- |
| movementService requester materialized_at >= requester_accepted_at (nanosecond conversion) | C | Removed; exact response identity, version, enums and required timestamps retained. |
| movementService proposal offering/requester consent >= created_at | C | Removed; independent DB action clocks can regress. |
| movementService requester consent >= offerer consent | C | Removed; prerequisite offerer consent remains required. |
| movementService proposal expires_at > created_at | B | Retained; deterministic proposal lifetime relationship. |
| movementService consent < expires_at | B | Retained; historical acceptance deadline, not ordering of independent action clocks. |
| movementService latest_departure_at >= earliest_departure_at | A | Retained; user-declared interval shape, not recording chronology. |
| meetingJourneyService funded started_at >= start_requested_at | C | Removed; both timestamps, funded handshake, meeting point and state shape remain required. |
| fundedCompletionService completed_at >= completion_requested_at | C | Removed; settled graph shape and request presence retained. |
| completedMovementService settled_at >= completed_at | C | Removed; exact settled-status/nullability correspondence retained. |
| verificationState session expiry > previous expiry | C/D | Removed; start generation/abort guards admit the current session. |
| verificationState backend expiry >= previous expiry, strict newer expiry while awaiting attempt, equal-expiry failed/expired success rejection | C/D | Removed; server selects latest attempt by ordinal; controller readId/generation rejects stale responses. |
| verificationState/controller and useVerification expiry versus evaluation time/timer delay | B | Retained; local readiness downgrade only, never authorization. |
| coordinationService profile-photo expiry versus Date.now (before and after fetch) | B | Retained; access-token freshness, no lifecycle ordering. |
| offeringMovementService input and recovery latest departure >= earliest departure | A | Retained; declared time interval. |
| requesterMovementInterestService latest departure >= earliest departure | A | Retained; declared time interval. |
| finite Date.parse, ISO/calendar validation throughout financial, activation, funding, provider, start, completion and recovery parsers | A | Retained. |
| CompletedMovements date display | E | Retained; presentation only. |

Search covered src/services, src/state, src/hooks and src/components for Date.parse, getTime, Date.now, new Date and sorting. Object-key sorting only validates response keys. No lifecycle timestamp sorting was found. Funding and activation projections parse timestamps independently. Coordination entry exposes state/capability without activation or coordination timestamps, so no fabricated pair was added to its regression test. Completion projection similarly exposes request/completion timestamps but no started_at; coverage exercises regressed confirmation and historical completed start projection separately.

## Response sequencing and safety

No controller was replaced. Meeting, completion and recovery controllers retain generation tokens, AbortController checks, active/disposed guards and synchronous duplicate guards. Face controller retains independent readId and attempt generation; a cancelled old response cannot overwrite a newer authorized read regardless of timestamp values. Account/background/unmount hooks remain unchanged.

The face reducer now trusts a fresh server-selected attempt even if its expiry is equal to or earlier than prior attempt expiry. It still suppresses backend updates during active start/provider preparation and locally downgrades expired readiness. It does not grant operational permission: server RPCs remain authoritative.

Required field sets, UUIDs, integer bounds, enum validation, valid ISO calendars, required handshake timestamps, completed/settled consistency and impossible capability/null combinations remain fail closed. No tolerance window, compensation, retry, synthetic client timestamp or paid dependency was introduced.

## Changes and verification

Changed five client files: movementService.ts, meetingJourneyService.ts, fundedCompletionService.ts, completedMovementService.ts and verificationState.ts. Adjusted four existing focused tests: financialProposalRequesterMaterialization.test.cjs, financialMovementStart.test.cjs, verificationClient.test.cjs and requesterMovementInterest.test.cjs. Added temporalClientCompatibility.test.cjs and this audit. Test-output/status artifacts are recorded separately.

All migrations remain unchanged. This client task runs portable tests only; prior database source-mode results are not represented as new database executions.
