# Trusted temporal evidence hardening

**B — NOT READY for persistent local installation.** The approved database scope is implemented and its source-mode tests pass. The client still treats independent DB recording clocks as causal order. Those client changes fall outside the approved 32-function SQL replacement scope and were not made. See the concrete compatibility blocker below.

Nothing was persistently installed. No migration history, remote Supabase state, historical migration, or paused completion source was changed. No staging, commit, or push occurred.

## Failure and authority

The captured trusted creation stamp was `2026-10-04T16:36:38.138255Z`; the later guard read `2026-10-04T16:36:38.132917Z`. The clock regressed by 5,338 microseconds. Historical validity cannot depend on a later wall reading being greater than an earlier trusted stamp.

Authority: the hardening audit, origins, inventory, focused review, focused writers, external review, external model, and captured catalog under `docs/0082-temporal-*`. Final numbering is 0081 financial movement start → `0082_trusted_temporal_evidence_hardening.sql` → `0083_financial_movement_completion.sql` (completion + atomic settlement). Completion was renamed byte-for-byte and remains uninstalled.

Inspected: those audit artifacts; the installed definitions/ACLs/constraints for all 32 named functions; historical location/route/match/face contracts; 0073/0074 clone utilities; 0077/0078 materialization/funding fixtures; 0079/0080/0081 SQL, behavioral, concurrency and source-verification helpers; relevant portable tests; and client parsers. All 81 historical migration files were read for raw and normalized integrity checks.

## Time contracts

External event time is supplied by the approved server/provider boundary. DB attestation time is the single Movement-controlled sample that accepts that event. Current evaluation time answers live eligibility, such as whether a new action has expired.

Location, route, and match retain their preliminary checks and exact replay contracts. First creation samples `v_attested_at := clock_timestamp()` once, after required dependency/history preparation, rechecks the full finite/event/lifetime interval against that sample, and explicitly persists it. Later live checks may fail on expired support; they do not overwrite or re-prove the attestation sample.

| Family | Persisted attestation | Preserved admission and replay policy |
| --- | --- | --- |
| Selection | verified_at = receipt.recorded_at = selected reference.created_at | Writer unchanged; signed proof identity and zero-skew DB admission unchanged |
| Resolution | receipt.recorded_at = target.created_at | Finite event; source.created_at <= resolved_at <= attestation; exact request/provider/place/version/coordinates; LEAST expiry |
| Route | created_at | Finite generated_at <= attestation and original intent/endpoint lower bounds; exact provider identity and normalized payload; route replay preserves original generation time |
| Match | created_at | Finite calculated_at <= attestation and route event lower bound; exact need/intent/route/version/geometry/payload/time; LEAST expiry |

The Edge selection-proof policy remains 30 seconds permitted skew, five minutes maximum lifetime, two minutes nominal issuance TTL. No new tolerance was added. Generic DB ingestion remains zero-skew. Direct API table/column writes stay denied, existing attestations stay immutable, and RPC ACLs stay unchanged. The pricing geography writer already shares one sample and was intentionally not replaced.

Historical A/C checks now prove finite persisted facts, exact source IDs/versions/provider provenance and deterministic copied values. Redundant numeric ordering of independent DB stamps is removed. Live expiry, planning windows, claim lease/token rules, source currentness, funding/roster/capacity checks, and original action expiry boundaries remain. No Group D field was globally reclassified as trusted.

## Face chronology and replay

`private.alignment_face_attempt_ordinal_seq` is bigint, starts at 1, increments by 1, NO CYCLE, CACHE 1. API roles and PUBLIC have no sequence privileges. The face table receives `attempt_ordinal bigint NOT NULL`, positive CHECK, global UNIQUE, an alignment/member/descending-ordinal index, and an immutable UPDATE trigger. The new private trigger helper has no PUBLIC/anon/authenticated/service_role execution.

The existing producer still locks alignment, then member, then prepared media/attempt construction. Only after that serialization does it call nextval. There is no max-plus-one allocation. Rollback gaps are intentional. New readiness/status/activation selectors use descending ordinal, never timestamp or UUID chronology. Finite timestamps, success/results/exact media/member identity, ten-minute lifetime, and expiry eligibility remain separate checks. Completion is DB-owned recording time, not an imported provider event; its numeric lower bound against an independent start clock was removed.

First activation selects the latest ordinal under the existing locks. Historical activation validates the exact immutable receipt-bound attempt, finite successful results and expiry at the recorded activation instant. It does not select today's latest attempt or demand current media/readiness/expiry. Exact successful face callback and activation replay allocate no ordinal and write no data.

Proposal construction continues to require live unexpired sources and proposal. Historical requester replay validates the complete immutable graph and original finite action deadlines. It retains current proposal status because materialized proposals cannot legitimately be superseded under existing immutability. It returns the SHARE-locked alignment's actual validated lifecycle status. Consent/materialization clocks may regress; exact agreement/operational bindings prove causal order instead of numeric wall time.

## Compatibility and atomicity

Before sequence/schema/function cutover, preflight rejects any face attempts or activation-face history. No timestamp-sort backfill is attempted. It validates historical resolution target/receipt equality, source/member/provider binding, finite event <= attestation, lower bounds and exact bounded expiry. Discovery and state evidence require exact resolution/target/provider/canonical state and finite metadata, without numeric child/parent chronology. Routes and matches require exact protected source/version/endpoint bindings, finite event <= created_at, original external lower bounds and dependency-bounded expiry strictly after attestation. Existing CHECKs and immutable guards continue protecting shape and facts. New route/match CHECKs also enforce expiry > created_at.

No observed production count is hardcoded. The user's remote counts are compatibility context, not a remote validation performed here. Expired but compatible historical evidence is preserved; preflight does not require it to be live now. Incompatible data aborts the migration, with no rewriting, backdating, invented provenance or partial schema cutover.

Tests construct historical compatible evidence and compare it unchanged after source application. An incompatible old route is constructed with controlled old-guard evaluation readings inside a rollback subtransaction, preserving every predicate/trigger; this models the old separated-clock admission hole. The unchanged new migration then fails with its exact preflight message before creating a sequence. Existing face history likewise rejects before any backfill/schema step. No system clock, session_replication_role, trigger disabling, production test seam or persistent function replacement is used.

All source DDL is committed only in disposable schema-only template0 clones. Custom-format restore excludes exactly DEFAULT ACL TOC entries and preserves ordinary ACLs, column ACLs, RLS, policies, functions and constraints. Database names are validated. Primary failures are retained, sessions/database are cleaned up, application data/catalog/ACL/RLS/migration-history fingerprints are checked, and archive/list cleanup runs independently even on failure. Results artifacts are written after successful cleanup/verification.

## Replacement scope and intentional nonchanges

Exactly the external model's 32 functions are replaced; their signatures, owners, security-definer attributes, empty search paths, volatility/strictness/parallel attributes and ACLs remain unchanged. The function list is appended below. Only one new private ordinal guard is added.

Selection writer, state-attested resolution wrappers, route claims producers, trusted matching context, snapshot/pricing producers, issuer, face callback, alignment readiness gate, funding hold writer, coordination/start RPC writers, and protected operational guards remain unchanged. Their calls inherit the approved helper changes. `assert_alignment_face_ready` delegates to the hardened latest-face predicate and keeps its canonical lock order. No economics, provider/network dependency, fee, wallet/journey side effect, global clock service, timestamp lock or paid dependency is introduced.

## Validation and harness adaptations

Final executed results are in the behavioral/concurrency JSON artifacts and Node/targeted text logs. Behavioral source verification passes 256 persisted checks plus two compatibility probes. This includes 15 ingestion checks; five regressing-clock construction checks (including inherited legacy coverage); 14 checks for each positive/zero funding variant; and all 47/65/96 persisted 0079/0080/0081 checks. Source definitions and clone replacement attributes/ACLs are checked against the actual loaded source.

New temporal concurrency: 10 scenarios, 10 actual pg_blocking_pids proofs, no deadlock. Existing hardened-source concurrency: 0079 has 14 scenarios/13 proofs; 0080 has 18 scenarios/18 proofs; 0081 has 21 scenarios/22 proofs. Every completed successful run passed clone cleanup and application fingerprint verification.

The older 0079 legacy-start expectation is updated only in an in-memory runner copy: through-0081's precise 23514 lifecycle guard supersedes its older 42501 expectation. 0079's timestamp rewrite is also rejected first by the later guard. 0080's source inspector is pinned to the audited actual through-0081 definitions and ACLs because 0081 legitimately replaced some 0080 functions. Its meeting-point capability expectation now reflects exactly offerer request authority introduced by 0081, while asserting no start receipt was created. The empty-meeting-point projection remains unchanged. No scenario or blocking assertion was removed. The initial overly broad meeting-point replacement was corrected to the exact unique case; all final cases passed.

Two simultaneous final restore runs hit the existing 60-second Docker command timeout during parallel validation. Both still passed cleanup/fingerprint checks. Sequential source verification passed afterward; no retry loop or timeout relaxation was added. Other development failures were fixture construction state/lifetime or older milestone expectations, not production defects.

Portable temporal audit/implementation: 29 passed. Broader targeted: 142 passed, zero failed/skipped. Allowlist regressions: 93 passed. Full node --test: 1,633 tests, 1,632 passed, zero failed, one skipped. TypeScript passed. Whitespace/integrity results and complete Git status are in the validation artifact. Historical raw hashes and paused completion hash remain exact. The four existing portable allowlist/hash files were adjusted narrowly to sanction this exact migration filename; their unrelated pre-existing edits were retained.

## Readiness blocker: clients still assume monotonic clocks

`src/services/movementService.ts` rejects requester replay if materialized_at < requester_accepted_at (line 112), and proposal projection still compares consent stamps with created_at and each other (lines 214–218). `src/services/meetingJourneyService.ts` rejects funded started_at < start_requested_at (line 43). These files already had unrelated workspace changes and were inspected only.

The new normal-construction SQL test proves the authorized RPC can successfully construct a complete exact graph, drain its completeness checks, and return requester consent 5,338 microseconds below offerer consent and materialization another 5,338 microseconds below requester consent. The source-mode transaction is then rolled back. Its exact retry is read-only and succeeds. The existing client parser rejects that legitimate result. This is a concrete contract mismatch, not a hypothetical system-clock warning. It needs a separately scoped client temporal audit/fix and focused parser regression tests before persistent installation is recommended. The approved DB scope was not silently expanded.

Remote evidence compatibility remains unverified here by instruction; install preflight must validate actual rows immediately before any separately authorized deployment. Migration numbering is finalized; completion remains uninstalled. No persistent install, staging, commit, push, role/history edit or remote change occurred.

## Audited replacement functions
- private.protect_movement_context_record
- private.require_verified_location_selection
- private.assert_movement_location_resolution_evidence
- private.assert_trusted_location_discovery_area
- private.assert_trusted_location_state_evidence
- private.protect_movement_need_creation_receipt
- private.protect_offering_movement_intent_creation_receipt
- private.protect_offering_route_evidence
- private.protect_trusted_route_match_evidence
- private.protect_pricing_geography_evidence
- private.assert_pricing_geography_context
- private.assert_pricing_quote_context
- private.protect_offering_movement_availability
- private.protect_requester_movement_interest
- private.protect_financial_proposal
- public.accept_my_financial_proposal_as_offerer
- public.accept_my_financial_proposal_as_requester
- private.assert_financial_proposal_materialization
- private.movement_funding_evidence
- private.assert_funded_activation
- private.assert_funded_coordination_entry
- private.require_funded_start_actor
- private.assert_movement_context_snapshot_offer_binding
- private.assert_financial_proposal_quote_binding
- private.assert_financial_proposal_movement_context_binding
- public.record_location_resolution_for_server
- public.record_offering_route_evidence_for_server
- public.record_trusted_route_match_evidence_for_server
- public.activate_my_funded_movement
- public.start_alignment_face_verification_for_server
- private.has_current_alignment_face_check
- public.get_my_alignment_face_verification_status
