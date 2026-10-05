# Trusted temporal evidence audit: first pass

Recommendation: **NEEDS FURTHER AUDIT**. Do not write/install the temporal migration, rename completion, or remove guards yet. The captured failure proves a clock assumption is invalid; it does not prove every timestamp is protected against caller input or that every numeric parent/child ordering can safely be removed.

Follow-up: `0082-temporal-focused-review.md` resolves 14 previously D fields, corrects the pricing geography same-sample producer description, distinguishes mixed financial mirrors, and specifies face ordinal and DB-only predicate scope. Its writer classifications and remaining boundary decisions supersede this first-pass analysis where noted.

## Evidence and coverage

The captured PostgreSQL failure was in `private.protect_movement_context_record`, before completion/settlement. The trusted producer wrote `2026-10-04T16:36:38.138255Z`; the later guard sampled `2026-10-04T16:36:38.132917Z`. PostgreSQL interval subtraction established a 5,338 microsecond regression. No JavaScript timestamp conversion occurred. This proves successive wall-clock samples cannot establish causal ordering. It does not identify the host/container mechanism responsible. The earlier proposal-only stress failure did not capture its exact rejecting subpredicate; do not conflate it with this captured location failure.

Read-only installed-catalog capture: 229 public/private functions, 119 timestamp columns, exact function definitions/owners/ACLs/configuration, table INSERT privileges/RLS, triggers, constraints, policies, and migration versions 0001–0081. The runner's before/after application fingerprint matched. No DDL, fixtures, migration installation, or history mutation ran in `--temporal-audit` mode.

Offline scan: all 81 historical migration files, including superseded definitions, using `clock_timestamp`, `now`, `transaction_timestamp`, `statement_timestamp`, `CURRENT_TIMESTAMP`, and every timestamp-like `_at`, `_time`, `window_start` identifier. Found 1,721 historical source lines; installed bodies contain 938 matching lines across 147 functions and 93 matching catalog constraints. There were no matching policy expressions in the capture. These are **lexical inventory counts**, not counts of independently proven defects or parsed predicates. Multi-line expressions require their surrounding exact function definition.

Artifacts:

- `0082-temporal-audit-catalog.json`: exact installed definitions and catalog evidence.
- `0082-temporal-audit-inventory.json`: every matching historical/installed body line, constraint expression, and per-migration SHA-256.
- `0082-temporal-audit-origins.md`: all 119 timestamp columns, one conservative A/B/C/D classification each, producer and candidate reader/validator associations. Counts: A 32, B 8, C 23, D 56.
- `0082-temporal-audit-inventory.cjs`: reproducible offline generator; no database access.

The inventory is exhaustive at the stated search boundary. Semantic origin proof is incomplete for the D fields, some legacy writers, and indirect calls. Consequently this is not an exhaustive, implementation-ready proof of every predicate. No origin is inferred solely from a default. A/C classifications are contextual to ordinary trusted production authority, excluding a database owner who can replace functions or forge any database record.

## Fresh-wall-clock historical guards

Names below are exact installed function names; overload signatures and exact body lines are in the catalog/inventory. `v_now` is included when assigned from a fresh clock. A row with B or D is deliberately not approved for guard deletion.

| Installed function | Field / predicate | Origin and disposition |
| --- | --- | --- |
| private.protect_movement_context_record | NEW.created_at > clock; resolved_at > clock | created A: captured defect. resolved B: separate insertion boundary from historical reuse; retain ingestion validation. |
| private.require_verified_location_selection | attestation.verified_at > clock | C: receipt/source/attestation exact equality establishes producer linkage; remove historical fresh-clock proof only after preserving finite and full attestation checks. Live source expiry remains. |
| private.assert_movement_location_resolution_evidence | evidence.recorded_at > v_now | C: target.created_at exact equality. Historical candidate. External resolution bounds need separate analysis. |
| private.assert_trusted_location_discovery_area | discovery.recorded_at > clock | A: default inside attested wrapper; historical candidate. Its independent child clock versus resolution parent also needs correction. |
| private.assert_trusted_location_state_evidence | state.recorded_at > clock | A: same defect class; independent child/parent ordering needs correction. |
| private.protect_movement_need_creation_receipt | recorded_at > clock | C: exact need created_at receipt. Candidate subject to source write-boundary proof. |
| private.protect_offering_movement_intent_creation_receipt | recorded_at > clock | C: exact intent created_at receipt. Candidate. |
| private.protect_offering_route_evidence | created_at > clock; generated_at > clock | A receipt versus B provider event. Separate branches; retain provider ingestion checks. |
| private.protect_trusted_route_match_evidence | created_at > clock; calculated_at > clock | A receipt versus B provider event. Separate branches; retain provider ingestion checks. |
| private.protect_pricing_geography_evidence | created_at > clock | A: trusted classifier/default, candidate. |
| private.assert_pricing_geography_context | generated_at > clock | A: producer generates this timestamp internally; candidate. generated_at >= match.calculated_at mixes A with B and needs a separately justified causal contract. |
| private.assert_pricing_quote_context | created_at > clock | A: quote producer clock; candidate. Independent quote/geo samples can also regress. |
| private.protect_financial_proposal | created_at, offering_accepted_at, requester_accepted_at, materialized_at > clock | A under issuer/consent producers; candidates. Preserve write-once economics/consents, materialized immutability and live first-use expiry. |
| public.accept_my_financial_proposal_as_offerer | proposal.created_at > clock | A: historical identity validation during live acceptance; candidate, retain live expiry. |
| public.accept_my_financial_proposal_as_requester | proposal.created_at and offering_accepted_at > clock during construction; proposal.created_at > clock during replay | A: replay remains clock-dependent despite expiry correction. Candidates; retain exact caller/version/graph and first-use expiry. |
| private.assert_financial_proposal_materialization | materialized_at > clock | A: historical replay/graph candidate. Preserve finite, original acceptance window, exact graph/components. Numeric parent chronology needs producer treatment. |
| private.movement_funding_evidence | wallet transaction.created_at and receipt.fully_held_at > clock | transaction A; receipt C for positive holds, A for zero holds (whole column D until both paths documented). Historical candidates with exact ledger/postings/components retained. |
| private.assert_funded_activation | receipt.activated_at > clock | A: historical candidate. Preserve exact alignment timestamp copy, funding graph, roster and activation-time face evidence. |
| private.assert_funded_coordination_entry | receipt.created_at, start_requested_at, started_at > clock | A receipts; exact journey mirror C in funded path, whole journey columns D. Candidates with linked receipt validation intact. |
| private.require_funded_start_actor | requested_at, started_at > clock | funded A/C contexts: candidate. Preserve actor/meeting revision and exact receipts. |
| private.protect_offering_movement_availability | created_at > clock | D pending full availability producer/default and write-origin proof. Do not delete yet. |
| private.protect_requester_movement_interest | created_at > clock | D pending full writer proof. Do not delete yet. |
| private.protect_transport_geography_dataset | registered_at > clock | D: controlled backend/import registration, no registrar RPC found in capture. Do not assume default excludes timestamp input. |
| private.has_current_alignment_face_check; private.assert_alignment_face_ready | completed_at <= p_at, with p_at a fresh clock | A: first activation/current readiness can falsely reject. Also uses timestamp ordering for latest attempt. Needs more than deleting a predicate. |
| public.activate_my_funded_movement | fully_held_at <= fresh activation sample; current face check at that sample | Separate independently sampled A/C causal ordering from live face expiry. May false-fail after regression even with no direct `> clock` text. |

Clock references in quota/claim lease, live discovery, profile share, photo token, current need/availability/context queries, and legacy journey/payment methods are also inventoried. They must not be classified as historical future guards simply because they call a clock.

## External ingestion boundaries

| Input / producer | Finite / future / age | Event / expiry / provenance | Decision |
| --- | --- | --- | --- |
| selection proof issued/expires; public.record_verified_selected_location_for_server | finite both; issued <= sampled now; no separate maximum age | issued < expiry; expiry > now; verified caller/member, exact provider/place/request and proof retry equality | Retain first-use checks. Exact recovery uses stored attestation; do not re-expire original proof. No arbitrary skew allowance exists. |
| resolved_at / requested expiry; public.record_location_resolution_for_server and attested overloads | resolved finite, <= sampled now, >= selected source.created_at; optional expiry finite and > now; no independent maximum age | exact source owner/provider/place, stable producer request, coordinates/version; expiry bounded by source; target and receipt same producer stamp | Retain external future/finite and current dependency expiry. Cross-origin source.created_at lower bound must be resolved, not silently deleted. Legacy core is not executable by service_role/anon/authenticated; approved wrappers establish selection boundary. |
| generated_at / optional expiry; public.record_offering_route_evidence_for_server (including claimed wrapper) | finite generated, <= now; >= intent.created_at and endpoint resolved events; optional expiry finite/live; no independent maximum age | locked exact intent/endpoints; provider namespace/product/version/reference; valid shape/metrics; effective expiry LEAST input and dependencies; immutable versions | Retain ingestion. The intent A versus provider B lower bound is a clock-domain issue. Route provider event ordering against endpoint B is a separate evidence policy. |
| calculated_at / optional expiry; public.record_trusted_route_match_evidence_for_server | finite calculated, <= now, >= route.generated_at; optional expiry finite/live; no independent maximum age | exact expected route ID/version and live context; validated geometry/positions; bounded dependency lifetime; one current need/intent match | Retain ingestion. Service-only producer must attest event/source relation once; later historical use must not require a new future proof. |
| departure declarations | API inputs B; planning horizon uses statement time, finite/order constraints in inventory | copied into need/intent receipts, snapshot and proposal C | Live planning semantics remain. Complete direct-service writer audit still needed. |
| registered_at / imported dataset | D, not proven A | controlled approved dataset identity/version/bounds; protect trigger currently checks future | Actual ingestion producer/import contract unresolved. No guard deletion approved. |
| face completion | no external timestamp; booleans/provider results arrive externally, completion time A | exact session/alignment/member/current photo, finite table constraints and success/liveness/match | Temporal origin A does not itself authenticate provider truth; existing service boundary must remain. |

The reviewed proof/location/route/match input families have finite and future checks. No missing future-ingestion check was proved in those paths. Absence of an independent maximum-age policy is not by itself a security defect: lifetime, parent and event policies already constrain use. Do not invent a new age threshold without a contract. D fields and direct service-role writers prevent a repository-wide assertion that no ingestion gap exists.

## Expiry classification

| Contract / functions | Classification | Preserve |
| --- | --- | --- |
| selected source / resolution endpoints, require_verified_location_selection, assert_movement_location_resolution_evidence | Current eligibility for new resolution/context | expiry > current clock where source is being used live; finite and deterministic bounded expiry |
| current intent, route, route match, availability, interest, geography, quote, snapshot; corresponding assert/get/discover/create functions | Current eligibility | current status, expiry > now, eligible departure windows, exact source versions and all locks |
| first issuer and first offerer/requester acceptance, validate/protect_financial_proposal construction | Current eligibility | unexpired current proposal at first use; source lifetime bounds; original consent/materialization within proposal acceptance window |
| verified selection exact retry | Replay provenance | original issued/expiry/receipt values and exact request/proof equality; proof expiry alone should not invalidate already attested history; current source use can have a separate live requirement |
| route/match producer retries | Current evidence retry, not unconditional historical recovery | Existing code requires current/unexpired dependencies. Do not change that API policy as a side effect. |
| fully materialized proposal replay | Historical replay | original accepted/materialized < original expires_at and complete immutable graph; no current proposal expiry requirement. Fresh created/materialized future guards remain the defect candidates. Materialized proposal cannot legitimately supersede under protect_financial_proposal immutability. |
| funding replay | Historical provenance | exact three components, positive hold transactions, balanced postings, zero-value receipt path; do not retest present balances/active accounts or old quote expiry |
| funded activation replay, assert_funded_activation | Historical provenance | exact receipt/linked graph and face expiry > recorded activation, completed <= activation; do not require old face evidence still live now |
| first activation | Current eligibility | current face readiness/expiry > activation time and funded evidence; original financial quote need not become live again |
| coordination/start historical replay | Historical provenance | linked activation, exact journey/request/start mirrors, actors and frozen meeting-point revision; no new operational consumption |
| profile-share, photo-token, route-generation lease, active discovery/interest queries | Current eligibility | live expiry intentionally checked; profiles/photos/leases are not permanent historical authorization |
| status-to-expired transitions | Lifecycle eligibility | cannot mark unexpired evidence expired; fresh-clock comparison is intentional current state transition |

All exact expiry expressions, including table CHECKs and retired function definitions, remain in the inventory. This grouping describes intended boundaries; indirect legacy replay semantics still require individual proof.

## Causal chronology is a second problem

Deleting `trusted_stamp > clock_timestamp()` does not make two independent clock samples ordered. Independently generated discovery/state records can precede their resolution parent; quote creation can precede geography; consent can precede proposal; holds can precede consent; activation can precede funding; coordination/start can precede activation/request. Existing guards and CHECKs can reject these even after future checks are removed.

Retain exact copy relationships: selection created = receipt = attestation; resolution target created = receipt; need/intent receipts copy exact source; funded alignment activation = receipt; journey/request/start mirrors = corresponding receipts. These prove linkage without another wall reading. Finite timestamps and deterministic lifetime bounds remain mandatory.

Do not silently discard numeric historical chronology where it establishes validity during an original acceptance/face window. A per-graph causal event order must be explicitly represented/proven, or its producer timestamp convention must be defined consistently with external event time and live expiry. `GREATEST(clock,parent)` alone is not yet approved: it can produce a timestamp beyond current live expiry after a forward jump or make an external provider event impossible to satisfy. Audit every affected CHECK and first-use boundary before choosing that mechanism. No backdating, precision loss, sleeps, retries, or tolerance is proposed.

## Timestamp-ranked authorization finding

`private.has_current_alignment_face_check`, face-readiness/status functions and activation selection choose latest attempt with `ORDER BY started_at DESC,id DESC`. `start_alignment_face_verification_for_server` supersedes pending sessions only, leaving older succeeded sessions. A later attempt with an earlier wall timestamp can leave the older success ranked newest. `assert_funded_activation` also infers historical newer-attempt order using `(started_at,id)` and an activation-time cutoff.

This is a static, security-relevant candidate distinct from the observed false rejection. No regression fixture demonstrating an authorization bypass was run in this audit. UUID tie-breaking is not causal ordering. Before implementation, prove the required latest-attempt policy and test a newer failed/pending attempt following an older success with regressing timestamps. Prefer a per-alignment/member attempt revision or explicit current-attempt identity under existing alignment/member locks if needed; preserve exact activation-time face provenance. This may require a small schema addition and replacement of face readers/producers, not just guard replacements. Do not introduce a global timestamp allocator.

## Severity and reachability

| Rank | Findings |
| --- | --- |
| Critical active paths | Verified selection/resolution/discovery/state guards; route/match and pricing/quote guards; proposal creation/consent/materialization and replay; funded ledger/activation/coordination/start historical guards. Invocation can falsely reject legitimate data after backward clock observations. Exact deployed UI reachability must be confirmed separately from database callable reachability. |
| Critical authorization candidate | Timestamp-ranked latest face attempt; static evidence warrants a dedicated security regression before any implementation claim. |
| Launch-critical future path | Completion depends on all these existing graphs; current uninstalled completion itself is outside the 0001–0081 audit and remains paused/unchanged. |
| Legacy/nonfinancial | Journey/payment/status NOW writes, profile/media/member/service INSERT paths; timestamp-based ordering and mixed transaction/wall samples require complete writer review. |
| Harmless or intentional | Exact timestamp copies, finite checks, immutable timestamps, live expiry, fixed lifetime bounds, updated_at bookkeeping without trust decisions. A default or clock call alone is not a defect. |

## Proposed forward boundary (not approved implementation scope)

Recommend `0082_trusted_temporal_evidence_hardening.sql` once the unresolved proofs below are complete. Existing completion can then become 0083 in a separate explicit renumbering step. Neither action occurred here.

Minimum **predicate-review/replacement candidates** are the functions in the fresh-clock table. The following are additional **producer/call-graph review targets**, not an assertion that each must change:

- public.record_verified_selected_location_for_server; public.record_location_resolution_for_server; every public.record_attested_location_resolution_for_server overload.
- public.create_movement_need; public.create_offering_movement_intent; public.record_offering_route_evidence_for_server; public.record_claimed_offering_route_evidence_for_server; public.record_trusted_route_match_evidence_for_server.
- public.record_pricing_geography_evidence_for_server; public.record_pricing_quote_for_server; public.record_movement_context_snapshot_for_server; public.issue_financial_proposal_for_server.
- public.accept_my_financial_proposal_as_offerer; public.accept_my_financial_proposal_as_requester; public.hold_my_movement_funds; public.activate_my_funded_movement; public.open_my_funded_movement_coordination; public.request_my_funded_movement_start; public.confirm_my_funded_movement_start.
- private.has_current_alignment_face_check; private.assert_alignment_face_ready; public.start_alignment_face_verification_for_server; public.complete_alignment_face_verification_for_server; public.get_alignment_face_readiness_for_server; public.get_my_alignment_face_verification_status; public.get_my_movement_activation_status; activation face selection/history validation.
- Every catalog CHECK implicated in independent timestamp chronology, plus D-origin writer/protect functions and legacy service INSERT paths, before they can be admitted to a final scope.

There is **no honest exact final CREATE OR REPLACE list yet**. Open scope blockers: D fields, imported dataset authority, mixed funding/journey paths, independent causal chronology/expiry, and timestamp-ranked face attempts. A list that only replaces the direct guards would leave known false-rejection paths and a possible authorization-order defect unresolved.

Proposed architecture: validate B once at its authenticated ingestion boundary; persist immutable provider/request/version/subject attestation; prove A/C through inaccessible direct-write tables and exact trusted producer graph; historical validators check finite, exact identities, immutable copies and completeness; live validators alone ask whether expiry still permits a new action. Keep all RLS, grants, ACLs, SECURITY DEFINER owners, empty search paths, READ COMMITTED requirements, row lock order, unique constraints, idempotency identities, ledger checks, write-once rules, actor and roster checks. Historical validation must not consume availability/capacity again. Do not weaken the one-route-match-to-one-offer invariant.

## Regression and concurrency design

Use disposable/rollback fixtures produced through normal trusted RPCs. A test-only copy of the validator clock expression can return a fixed synthetic reference below a known trusted receipt by the captured 5,338 microseconds. The injected reference is test machinery, never a production skew threshold. Do not edit production graph timestamps to fake provenance or alter the OS clock. Separate tests simulate the producer's later sample moving backward to expose parent/child chronology; a validator-only injection cannot test those writes.

Required assertions:

1. Exact legitimate A/C graph passes historical validation and replay against the lower synthetic reference, with identical IDs/timestamps and no additional writes.
2. Future external proof/resolution/route/match inputs still fail their unchanged ingestion boundary. Include NaN/infinite/null values as appropriate, mismatched provider/request/subject/version, and malformed expiry.
3. Live-expired source/quote/face/lease still fails first-use eligibility; historically valid materialization/funding/activation/start still replays after original evidence expiry.
4. Invalid exact parent identities/copies, forged attestation, partial materialization, incorrect three components/postings, invalid original consent window and malformed causal evidence fail. Final numeric-order expectations depend on the chosen causal model; do not replace them with unconditional acceptance.
5. Face new-attempt ordering remains authoritative despite backward/equal wall samples; older successful authorization cannot win over a legitimate newer failed/pending attempt. Activation replay retains the exact historical face set.
6. No new tolerance, timestamp rewrite, truncation, sleep/retry, or payment/wallet/journey side effect on historical replay.
7. Verify installed function signatures/owners/ACLs/search paths/RLS and historical migration hashes; restoring test-only definitions must restore exact catalog fingerprints.
8. Run all issuance/materialization/funding/activation/coordination/start races with actual pg_blocking_pids relationships, deterministic winners, no duplicate materialization/holds/receipts, no partial graphs and no deadlocks. Add concurrent face-attempt/callback/activation ordering tests if revisions are introduced.

Removing a historical comparison alone should not add locks. Per-graph causal revision changes must preserve existing alignment/member ordering and uniqueness. Never serialize unrelated writes through a global clock lock. Current evidence revalidation after blocking remains necessary. Source verification involving concurrent sessions must use a disposable clone or committed temporary definitions with deterministic exact restoration; a transaction-local replacement is insufficient across connections.

## Outstanding audit work and decision

Finish D-origin producer/privilege proof, direct service-role write entry points, legacy callbacks/importers and all indirect expiry/replay paths; evaluate the causal chronology CHECKs and external/internal clock-domain bounds; prove and reproduce face attempt ordering; then produce an exact replacement/schema scope and security proof per changed predicate. No proven new external-input vulnerability was established, but the unreviewed origins and face ordering candidate preclude a clean security bill of health.

Global monotonic clock: **not justified or proposed**. Causal identities/revisions and immutable graph receipts should be tried first; wall time remains appropriate for live deadlines. No paid services are needed. Historical migrations and current completion SQL remain unchanged. No installation, migration-history manipulation, renumbering, staging, commit, push or remote Supabase change was performed.

## Verification actually run for this audit

- `node supabase/tests/0082_financial_movement_completion_settlement_stress.cjs --temporal-audit`: read-only catalog capture passed; before/after application fingerprint unchanged. This is not a settlement stress/concurrency run.
- `node docs/0082-temporal-audit-inventory.cjs`: generated the counts and inventories above offline.
- `node --test tests/financialMovementCompletion.test.cjs`: 55 passed, 0 failed, 0 skipped, including normalized historical 0001–0081 byte protection.
- `node .\node_modules\typescript\bin\tsc --noEmit`: exit 0.
- `git diff --check`: exit 0; existing CRLF conversion warnings only. Untracked audit artifacts and harness were also checked with `git -c core.autocrlf=false diff --no-index --check -- NUL <file>`: no whitespace diagnostics (exit 1 denotes the added-file difference).
- Completion SHA-256 remains `c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976`.
- Full Node suite, new synthetic-clock behavior tests, and concurrency tests were not run during this audit. The regression section is a design, not a claim of tested hardening.

Files changed in this audit: the existing untracked settlement-stress harness gained the SELECT-only catalog mode; five new audit files are the catalog JSON, inventory generator/JSON, origins table, and this report. Previously modified/untracked completion/client/test files remain in the working tree; this audit did not edit them. `git status --short` was inspected; nothing was staged.
