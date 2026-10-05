# External-ingestion temporal trust model

Recommendation: **READY TO IMPLEMENT TEMPORAL HARDENING**, subject to explicit deployment preflight and the full regression/concurrency verification below. This is readiness to implement reviewed source, not permission to install or a claim of passing database tests. No production SQL, migration number, database definition, ACL or history was changed.

The remaining external boundary can be resolved without duplicate attestation fields: preserve zero-skew DB ingestion checks, persist their exact authoritative clock sample in existing immutable receipt/creation fields, and later validate event against that persisted attestation. Earlier source/input checks may still run; they are preliminary admission checks, not the authoritative persisted sample. Current live-expiry checks may resample after waits. They must never replace the stored attestation value or re-prove historical event future-dating.

## External inputs and their actual meanings

Installed overload signatures and roles come from the refreshed catalog. The table includes every timestamp argument exposed in the financial source-building path, plus wrappers and the negative findings for other requested families.

| RPC/function | Timestamp argument | Semantic meaning | Caller role / source | Persisted field |
| --- | --- | --- | --- | --- |
| public.record_verified_selected_location_for_server | p_proof_issued_at | evidence_recorded_time: Edge signed-proof issuance, not a provider-declared event | service_role; authenticated member bound by Edge proof and exact RPC subject/provider/request | selection_attestations.proof_issued_at |
| same | p_proof_expires_at | provider_expiry_time in the generic external credential sense; specifically Movement Edge proof expiry | service_role; signed claim | selection_attestations.proof_expires_at |
| public.record_location_resolution_for_server | p_resolved_at | server_received_time on the actual Mapbox adapter path; generic RPC contract accepts externally asserted resolution event | owner/internal only now; newest attested wrapper service-only | movement_location_references.resolved_at |
| same | p_expires_at | provider_expiry_time if supplied; actual Mapbox adapter supplies NULL | same | raw requested_expires_at in resolution receipt; effective location expires_at |
| public.record_attested_location_resolution_for_server, 12/13/15-argument overloads | p_resolved_at / p_expires_at | same observation/event and optional lifetime | older two owner/internal only; newest 15-argument service_role; exact verified selection/provider/member | delegates core; upgrade branch retains original resolution, attaches state evidence |
| public.record_offering_route_evidence_for_server | p_generated_at | server_received_time: Mapbox adapter stamps normalized result with server new Date(), not Mapbox response event time | service_role, exact own intent and endpoints | offering_route_evidence.generated_at |
| same | p_expires_at | optional provider_expiry_time; current Mapbox adapter supplies NULL | same | capped offering_route_evidence.expires_at |
| public.record_claimed_offering_route_evidence_for_server | p_generated_at / p_expires_at | same route observation and optional deadline | service_role; exact intent/member/claim token | delegates core; claim completed_at separately DB-generated |
| public.record_trusted_route_match_evidence_for_server | p_calculated_at | evidence_recorded_time: Edge stamps its local geometry calculation completion using new Date() | service_role; exact expected route/version and trusted context | trusted_route_match_evidence.calculated_at |
| same | p_expires_at | optional provider_expiry_time at generic API boundary; current Edge matcher supplies NULL | same | capped match expires_at |
| public.create_movement_need / create_offering_movement_intent | earliest/latest departure arguments | unknown in the requested event-role taxonomy: planned future movement declarations, not past provider events | authenticated; auth.uid ownership and planning policy | need/intent declarations and exact receipts |
| private.consume_location_provider_quota_at / consume_route_provider_quota_at | p_server_time | server_received_time used as a private clock reference, not provider event | no anon/auth/service EXECUTE; production service wrappers pass NULL, DB samples clock | quota updated_at / UTC windows |
| private.has_current_alignment_face_check | p_at | current evaluation reference, not persisted external evidence | internal only; callers supply DB sample | no new external time persisted |

No external timestamp arguments exist in `record_movement_context_snapshot_for_server`, `record_pricing_geography_evidence_for_server`, `record_pricing_quote_for_server`, `start_alignment_face_verification_for_server`, `complete_alignment_face_verification_for_server`, or `record_wallet_top_up_for_server`. The pricing geography JSON is a normalized geometric event set, not a provider time attestation. Face RPCs accept provider identity/reference and result booleans; started/completed are DB clocks. Wallet import accepts provider/reference/amount/currency, not provider event time. Do not invent provider-completed-at columns for events the current contract does not receive.

Face callback adapters require authenticity/replay validation of raw events, but no concrete provider-time acceptance policy is implemented in the DB RPC; production orchestration supplies no provider until an adapter is configured. Any future imported identity/provider event timestamp needs its own audited contract. Its absence today is not justification to weaken callback authentication.

## Existing checks, sample placement and expiry

| Family | Exact ingestion checks | Same-sample today? | Existing lifetime / age policy |
| --- | --- | --- | --- |
| selection proof | finite issued/expiry, issued < expiry; issued <= DB v_now; expiry > v_now; exact version/member/provider/place/request, exact replay proof values | Yes: one clock_timestamp v_now -> location created_at, receipt recorded_at, attestation verified_at | DB has no separate max age/duration. Edge signed-proof shape caps lifetime at 5 minutes, verifier permits +30 seconds against Edge clock, issuer requests 2-minute TTL. Preserve every layer. |
| location resolution | finite resolved, source.created_at <= resolved <= sampled v_now; optional expiry finite and > v_now; exact owner/provider/place/version/request/coordinates; live source expiry; effective expiry LEAST(requested,source) | No: first validation uses one v_now; later version/recording block replaces v_now; target.created_at and receipt.recorded_at use that later value | Optional expiry; no extra max-age rule. Existing source lower bound remains ingestion policy, not a numeric DB child chronology rule. |
| offering route | finite generated, generated <= v_now and >= intent.created_at and both endpoint resolved_at; optional expiry finite/live; exact intent/endpoints/provider reference, valid shape/positive metrics | No: event validated at v_now; INSERT omits created_at and a later default clock supplies it | LEAST(input expiry,intent expiry,origin expiry,destination expiry); NULL only if all unconstrained. No independent max age or route TTL. |
| route match | finite calculated, route.generated_at <= calculated <= v_now; optional expiry finite/live; exact expected route/version, live matching context and geometry/positions | No: validation sample, later expiry/replay samples, then default created_at sample | LEAST(input expiry,requester origin/destination expiry,intent expiry,route expiry); no extra match TTL/max age. |
| claimed route | exact member/intent/token and live lease before first recording; delegates external time validation to route RPC; completed claim verifies provider identity and normalized payload through core replay | Core must change as above; claim metadata is a separate event, not external attestation | Lease = claimed_at + 30 seconds; completed-route replay retains its existing live route policy. |
| discovery/state attestation | exact resolution/target/provider/state/discovery identity; newest wrapper validates fresh supplied observation time before legacy upgrade or core creation | Metadata recorded defaults are independent DB clocks; no external event field in these child tables | Do not reinterpret their metadata as a provider event. Remove numeric child/parent recording order; preserve exact attestation provenance. |
| snapshot, pricing, face, funding | timestamps generated or copied inside DB; no external event-time argument | Geography already uses generated_at = created_at; face callback uses one completion sample for result/expiry decision | Existing DB deadlines and policies remain; not new external-ingestion families. |

All DB event-ingestion comparisons use `clock_timestamp()`, not transaction/statement time. Preliminary context functions can take additional samples. The proposed authoritative sample is taken after applicable canonical locks and first-creation version/history preparation, immediately before the final full timestamp validation and INSERT. Versioning locks, source revalidation and READ COMMITTED stay unchanged. A later live-expiry failure may still abort the operation; it is legitimate current eligibility, not historical future proof.

No maximum past age is independently defined for resolution/route/match. Existing source/event lower bounds are their policy; retain them. If a backward DB reading is below a previously recorded source boundary, new external input may still fail this interval policy. That is intentionally not “fixed” with skew, backdating or deleting the external lower bound. The hardening guarantees accepted evidence will not later contradict its own attestation sample; it does not promise external admission under every cross-clock observation.

## Threat model: what is proved once

Event <= DB ingestion sample prevents a service/provider submission from asserting that an observation or signed credential was created after Movement's acceptance instant. Parent/source lower bounds reject observations predating the required source event, and bounded expiry prevents a caller extending usefulness past dependencies. These are admission properties. They are not statements that wall-clock values will remain ordered forever.

Later historical checks prove Movement accepted the exact event at its recorded DB reference under that policy. Comparing an old event or DB receipt to a fresh lower wall time adds no protection against a new forged row. The protection is: restricted ingestion RPC EXECUTE, no direct API table or column INSERT/UPDATE, caller timestamp cannot choose DB attestation, finite/event-to-attestation constraints, and immutable facts linked to exact trusted source/provider/request/version. A database owner able to replace functions and write any row is outside this API adversary boundary; this design does not pretend a timestamp guard protects against that owner.

Externally supplied optional expiry is not an event that must be <= ingestion time. It is a deadline and intentionally lies in the future. Enforce finite, input expiry > ingestion reference, event < effective expiry, and effective expiry <= every applicable dependency, exactly as current LEAST policy requires. Do not substitute a new fixed lifetime.

## Reuse existing attestation fields: family invariants

Let E = externally asserted event, I = authoritative DB ingestion sample, X = effective expiry, N = fresh live evaluation time.

| Family | First ingestion | Historical attestation | Live use |
| --- | --- | --- | --- |
| selection | finite issued/expires/I, issued <= I < proof expiry, exact proof/member/provider/request | verified_at = receipt.recorded_at = source.created_at; preserve finite and issued <= verified < original proof expiry; immutable proof/receipt facts | Current selected source eligibility where needed; do not demand original proof still live to recover already attested selection |
| resolution | finite E/I; source.created_at <= E <= I; raw optional expiry finite > I; X=LEAST(raw,source expiry), X NULL or X>I | target.created_at = receipt.recorded_at = I; E <= persisted I; exact request/provider/source/target/coordinates/version and effective lifetime formula; no E/I > fresh N | Existing source/target expiry > N and live source predicates stay on resolution/context consumers |
| route | finite E/I; intent.created_at and endpoint event lower bounds <= E <= I; optional raw expiry > I; effective X NULL or X>I | created_at = I explicitly; generated <= created; immutable exact provider reference, endpoints, intent/version, valid shape and bounded expiry | Existing current route/intent/endpoints and expiry > N |
| match | finite E/I; persisted route.generated <= E <= I; optional raw expiry > I; X=NULL or X>I and bounded dependencies | created_at = I explicitly; calculated <= created; immutable exact need/intent/route/version/endpoints/geometry; original event lower bound remains against persisted route event | Existing current match/context/departure/expiry > N |
| discovery/state | DB-only finite recorded metadata; approved wrapper and exact parent/provider evidence | Exact immutable parent/target/schema/state/discovery evidence; no recorded-time ordering or fresh future proof | Context's existing live source eligibility is separate |
| face | No provider time E received; start/callback clocks are DB event recording, success requires exact authenticated result/session/media | Exact success/results/finite completion/original expiry and bound attempt; chronology from ordinal, not clocks | Latest ordinal's current media/readiness/expiry > N; expired evidence cannot authorize a new activation |

Existing CHECKs already establish selection's complete event/attestation window, location resolved <= created, route generated <= created and match calculated <= created. Existing immutable triggers protect these fields. Keep them. Add explicit nullable expiry > ingestion-created constraints to route/match if absent, so the persisted lifetime attestation is enforced as well as the producer. Location already has expires > created. No new external attestation column/table is required. `created_at` retains its DB recording/acceptance meaning; using one authoritative sample does not turn it into a monotonic clock or provider event.

Core location writer's final sample must validate **all** submitted timestamp conditions before storing that same sample. Route/match must explicitly include created_at in INSERT rather than letting a default resample. Preserve existing replay identities: location is exact stable request and payload; match is exact source/payload/time; route replay intentionally preserves stored generation time when returning the same provider reference and identical normalized declarations. Do not tighten route's replay into a different equality contract. Replay evaluates the original persisted attestation; validating freshly submitted parameters remains where existing route/wrapper contracts require it.

The 15-argument state wrapper's legacy upgrade validates a fresh observation even though it does not rewrite the original resolution event. Preserve that validation. Its child recorded_at is DB recording metadata, not the supplied p_resolved_at; it cannot be used to claim that ignored input was the original resolution event. No new external field is needed for a value never used as later event-time evidence.

## Compatibility and mixed rows

Existing private approved producer rows can use their immutable created/recorded values as historical attestation if their persisted relationships satisfy the proposed invariant. They need not be rewritten to pretend the old recording sample equalled an earlier internal validation variable. Existing constraints prove accepted event <= recorded value; finite/lifetime/provenance checks certify a conservative historical record. No migration can recover an unrecorded prior sample.

An old route/match row could have a default recording stamp beyond expiry after a clock jump even if a later live check passed against a lower sample. Do not invent an attestation for it or silently weaken the new lifetime proof. Preflight counts must verify existing event/recording/expiry compatibility; abort migration if a row cannot be certified, preserving original database. Then independently investigate that real data or design a reviewed legacy receipt policy. This is a defined fail-closed deployment condition, not an unresolved generic timestamp architecture choice.

Current **local read-only** checks: selection/resolution/route/match row counts all 0; incompatible resolution/route/match counts all 0; face attempts and activation-face counts 0. Application fingerprint unchanged. Remote was not touched. Remote emptiness must be verified immediately before deployment under a write gate; remembered zero-row audits are insufficient.

No further whole-column D classifications are converted in this pass. Their authority is not guessed. Active mixed funding is fully known A-or-C, protected private ledger; funded operational mirrors are C only when exact private receipts prove them. Public creation metadata, member media/vehicle/access fields and imported dataset registration remain D globally. Numeric offer-created lower bounds can be removed in trusted snapshot binding because exact immutable route-match/availability binding proves authorization; this does not make an arbitrary legacy offer's timestamp trusted. Leave legacy payment/journey/share/import timestamp protection unchanged. None of those D fields blocks the private receipt/ingestion fix.

## Historical replay and live boundaries

0079 activation replay validates exact financial proposal/agreement/three-component funding, immutable activation receipt/alignment mirror and exact historical face IDs. Face expiry > recorded activation and completed < face expiry preserve original validity; old face expiry > current time is not required. Independent DB completed <= activation ordering is replaced by locked producer/result provenance and attempt ordinal. 0080/0081 replay inherits that proof and exact coordination/request/start receipt graph without repeating live quote/route/face/capacity consumption.

Current problematic clock dependence in those historical chains is in `movement_funding_evidence`, `assert_funded_activation`, `assert_funded_coordination_entry`, `assert_financial_proposal_materialization` and requester replay, plus shared lower-level historical source bindings. They compare producer-owned ledger/materialization/activation/start stamps against fresh wall readings; remove those proofs as specified below. Do not call live `assert_offering_route_evidence` or `assert_trusted_route_match_evidence` during funded historical replay to make old sources current again.

New issuance/materialization needs live quote/snapshot/offer/availability/source eligibility; new route/match admission needs live source context; first activation needs latest valid face and funded graph; first start needs protected activated coordination/request/meeting-point authority. Retain their genuine current-time deadlines, revalidation after lock waits, and failed-action rollback. Already successful replay never rewrites timestamps or consumes capacity/funds again.

## Existing skew policy (correction to earlier broad statements)

`location-selection-proof.ts` intentionally uses MAX_FUTURE_SKEW_MS=30,000 and MAX_PROOF_LIFETIME_MS=300,000; `location-orchestration.ts` issues nominal TTL=120,000. Signature/audience/version/member/request/label/provider identity and canonical finite ISO checks remain. PostgreSQL `record_verified_selected_location_for_server` still requires issued <= DB clock with **zero** allowance. Thus Edge may accept a proof that DB currently rejects; preserve both policies, do not transplant the Edge allowance into SQL. No DB future-skew allowance was found in these ingestion RPCs. No new tolerance is proposed. Existing JS ISO normalization is not a proposed workaround for the captured PostgreSQL microsecond regression.

## Full Group A–F function scope

The machine-readable companion `0082-temporal-external-model.json` lists **32 exact existing replacement functions** and the one new ordinal guard. All names were checked against installed definitions. Rows mentioning two names mean both explicit replacements. Unchanged delegates/consumers are named separately so they are not needlessly replaced.

### Group A — DB-owned historical time and redundant numeric chronology

| Replacement function(s) | Exact change / retained proof | Schema required |
| --- | --- | --- |
| private.protect_movement_context_record | Remove NEW.created_at > fresh clock; keep finite private field constraints, immutable location/context facts and live expiry. External resolved future branch moves to Group C. | Existing CHECKs retained |
| private.protect_movement_need_creation_receipt; private.protect_offering_movement_intent_creation_receipt | Remove DB-created recorded-at future proof; immutable producer request/subject/source linkage remains. | No |
| private.assert_trusted_location_discovery_area; private.assert_trusted_location_state_evidence | Remove recorded > clock and recorded < parent recorded; preserve finite, exact immutable resolution/target/provider/schema/labels. | No |
| private.protect_offering_movement_availability; private.protect_requester_movement_interest | Remove DB default created future proof; trigger owns updated stamp; preserve capacity, write-once, terminal transitions and live expiry. | Replace updated>=created CHECKs only |
| private.protect_pricing_geography_evidence; private.assert_pricing_geography_context | Remove DB recording future proof and geography.generated < match.calculated; exact immutable source/version and classifier prove causality; bounded expiry retained. | No; geography same-sample CHECK retained |
| private.assert_pricing_quote_context | Remove created < geography.created and > fresh clock; exact geography/version/seat/pricing/lifetime remains. | No |
| private.assert_movement_context_snapshot_offer_binding | Remove snapshot.created < offer.created; exact offer and both private authorization bindings remain. | No |
| private.assert_financial_proposal_quote_binding; private.assert_financial_proposal_movement_context_binding | Remove proposal-created numeric source ordering; exact ID/version/declarations/lifetime/roster remains. | No |
| private.protect_financial_proposal | Remove trusted created/consent/materialized > fresh clock; preserve immutable economics, write-once and live first-use expiry. | Consent/construction CHECK replacements below |
| public.accept_my_financial_proposal_as_offerer | Remove created future, accepted < created and replay original consent > new accepted sample; retain finite original consent < expiry, exact caller/version/source and first-use eligibility. | Same proposal CHECK changes |
| public.accept_my_financial_proposal_as_requester | Remove source created/consent future and numeric consent/construction ordering, including completed < accepted; keep first-use expiry at authoritative acceptance/materialization gates, exact complete graph and historical replay unchanged IDs/times. | Same proposal CHECK changes |
| private.assert_financial_proposal_materialization | Remove materialized > fresh clock and independent sample lower bounds; retain finite stamps, original deadline and exact locked alignment/agreement/three components/closed need/accepted offer. | Same proposal CHECK changes |
| private.movement_funding_evidence | Remove hold/receipt > fresh clock and < requester-consent sample; exact ledger/postings/components and greatest-value receipt equality retained, including zero branch. | No |
| public.activate_my_funded_movement; private.assert_funded_activation | Remove funding > activation sample and DB face completed > activation sample/fresh sample; exact funding receipt, face results and original deadline remain. Ordinal logic in Group E. | Face ordinal and face result CHECK |
| private.assert_funded_coordination_entry; private.require_funded_start_actor | Remove receipt/request/start > fresh clock and numeric predecessor order; exact immutable receipts, roles, frozen meeting-point revision and permitted lifecycle remain. | No |

Do not replace DB producer clocks with parent timestamps or GREATEST timestamps. They record each event's actual clock observation; provenance proves causality. Original acceptance/activation deadlines remain separate semantic comparisons. Finite checks are retained/added where a removed chronology condition previously incidentally excluded infinity.

### Group B — single-sample external ingestion writers

| Replacement | Exact behavior | Schema required |
| --- | --- | --- |
| public.record_location_resolution_for_server | For first creation, final authoritative clock_timestamp sample validates event finite/source bound/future and raw/effective expiry; persist exact sample to target.created_at and receipt.recorded_at. No later recording resample. Existing preliminary checks and exact retry/source locks remain. | No new field |
| public.record_offering_route_evidence_for_server | Validate final event/expiry against authoritative sample after applicable dependencies/history preparation, explicitly INSERT created_at=that sample. Preserve provider-reference replay policy and immutable versions. | Add nullable expiry > created attestation CHECK |
| public.record_trusted_route_match_evidence_for_server | Final event finite/route bound/future and optional/effective expiry use one authoritative sample, explicitly INSERT created_at=sample. Preserve geometry, isolation, exact versions/current-match uniqueness and replay. | Add nullable expiry > created attestation CHECK |

`record_verified_selected_location_for_server` already satisfies same-sample persistence and needs no replacement. All attested-location overloads and `record_claimed_offering_route_evidence_for_server` delegate to the corrected core and need no function replacement solely for event attestation. Preserve newest state wrapper's independent fresh-observation validation in its upgrade branch. Claimed-route completion metadata needs the constraint-only chronology change below, not a writer rewrite.

### Group C — historical external evidence tied to stored attestation

| Replacement | Exact behavior | Schema required |
| --- | --- | --- |
| private.require_verified_location_selection | Remove verified_at > fresh clock; require exact source/receipt/attestation and existing proof issued <= verified < proof expiry; source's live expiry stays. | Existing immutable CHECKs sufficient |
| private.assert_movement_location_resolution_evidence | Remove receipt.recorded > fresh now; preserve resolved event <= exact target.created = receipt.recorded, finite/source lower bound and deterministic expiry. Keep live source/target expiry where this function authorizes live context. | None |
| private.protect_movement_context_record, location branch | Replace resolved > fresh clock with finite resolved <= NEW.created_at for approved private producers; existing table shape/event/expiry CHECKs and RPC validation enforce the same attestation. Do not remove ingestion RPC event future checks. | Existing CHECKs sufficient |
| private.protect_offering_route_evidence | Replace fresh generated/created future proof with finite generated <= DB-owned NEW.created_at and original attested lifetime; keep immutable facts/current-to-terminal lifecycle/live expiry. | Nullable expiry > created CHECK |
| private.protect_trusted_route_match_evidence | Same for calculated <= created; keep immutable identities/geometry/current-to-terminal and live expiry. | Nullable expiry > created CHECK |

`assert_offering_route_evidence` and `assert_trusted_route_match_evidence` remain **live** validators: their current status/expiry and exact context checks do not need replacement. The match validator's calculated >= persisted route.generated remains external event policy, not a fresh wall check. New history calls must not route through these live validators.

### Group D — live consumers unchanged except corrected shared helpers

Retain live eligibility in `assert_offering_movement_intent`, `assert_offering_route_evidence`, `assert_trusted_route_match_evidence`, `assert_offering_movement_availability`, `assert_requester_movement_interest`, `assert_pricing_geography_evidence`, `assert_pricing_quote`, `assert_movement_context_snapshot`, and source-owner/expiry checks in resolution/context functions. Also retain first-use expiry in `issue_financial_proposal_for_server`, both acceptance RPCs, first activation/readiness, `claim_offering_route_generation_for_server`, `get_offering_route_generation_context_for_server`, `get_trusted_matching_context_for_server`, `get_pricing_classification_context_for_server`, discovery/interest consumers and expiry transitions. These unchanged functions require no schema changes for time hardening; acceptance/activation bodies also have Group A/E edits without weakening their live gates.

`assert_alignment_face_ready`, `get_alignment_face_readiness_for_server`, `get_my_movement_activation_status`, funded coordination/start public RPCs and `require_funded_alignment_activation` retain their signatures/locks/gates and invoke corrected helpers; no replacement solely for an inherited helper fix.

### Group E — face ordinal

Exact replacements: `start_alignment_face_verification_for_server` allocates immutable ordinal after alignment/member UPDATE locks; `has_current_alignment_face_check`, `get_my_alignment_face_verification_status`, `activate_my_funded_movement` choose greatest ordinal for exact subject; `assert_funded_activation` validates exact bound face against ordinal rather than `(started_at,id)` and wall cutoff. `has_current_alignment_face_check` also drops completed <= current p_at as future proof, retaining completed presence/finite/success/deadline and live expiry. Add private `protect_alignment_face_attempt_ordinal` trigger function to prevent ordinal rewrites.

Schema: one positive NOT NULL bigint attempt_ordinal; one logged ascending NO CYCLE CACHE 1 sequence, no API usage/update grants; uniqueness and `(alignment_id,member_id,attempt_ordinal DESC)` lookup index; ordinal immutability guard. Existing alignment/member locks serialize same-subject allocation; rollback gaps are acceptable, sequence alone is not commit order. Successful replay allocates nothing. Financial alignment cannot return to pre-payment after activation under 0080 protections, so supported new attempts cannot appear afterward; exact historical face IDs survive later media changes. If that lifecycle changes, an activation-bound cutoff/epoch must be added by the future change.

`complete_alignment_face_verification_for_server` needs no replacement: it already stamps completion once and decides result/expiry from that sample under locks. Replace its result table CHECK to remove completed >= started while preserving finite timestamps, successful liveness/match/completion and completed < expires. Do not turn failed/pending newer attempts into fallback success.

### Group F — intentionally unchanged ambiguous/legacy paths

Leave dataset `protect_transport_geography_dataset` and import-time registration guards unchanged; no registrar authority proved. Leave legacy payment/settlement/profile-share/journey timestamps and service-role table grants unchanged. Do not globally trust public alignments/journeys/member_media/movement_needs/movement_offers timestamps. Exact funded private receipts define trusted mirrors only for proven financial graphs. Informational latest-by-time UI selectors remain outside this security scope; no general ordinal mechanism is introduced. Private explicit-time quota helpers retain their internal/testing contract and inaccessible API ACLs; public wrappers still supply NULL.

## Complete schema scope and deployment conditions

Beyond the face ordinal objects, replace only these existing chronology CHECKs, keeping every non-chronology conjunct:

- offering_movement_availability_check1; requester_movement_interests_check1: remove audit updated>=created.
- financial_proposals_check5; financial_proposals_requester_consent_check; financial_proposals_check6: remove independent consent/materialization numeric lower bounds; preserve original expiry, nullability/consent prerequisites and graph shape.
- alignment_face_verifications_check1: replace numeric callback>=start with trusted state/result provenance and explicit finite validity; preserve completed<expires. Add finite start/expiry/completion checks if not already explicit.
- **Newly confirmed** offering_route_generation_claims_check2: remove completed_at>=claimed_at; exact intent/member/token/completed-route identity and immutable completion prove cause. Keep lease=claimed+30s, finite timestamps, paired completion fields and uniqueness. No sequence needed for claim metadata.
- Add route/match nullable expires_at>created_at attestation lifetime CHECKs after fail-closed compatibility preflight. Keep existing event<=created and finite constraints.

No external attestation fields or receipt table; no global clock or new paid service. No historical migration edited. Deployment preflight must abort on incompatible old external evidence, existing face rows lacking independently proved order, catalog/ACL drift or missing deployed prerequisites. Verify remote counts only with separate authorization before actual implementation/deployment; do not rely on remembered emptiness. Migration must not silently repair/reorder/backdate data.

## Security proof for each removal class

| Removed fresh comparison | What prevents future insertion now? |
| --- | --- |
| location/proof event or attestation versus a new clock | verified proof RPC or core resolution RPC validates event<=authoritative ingestion sample; exact sample stored, private tables/columns inaccessible to API INSERT/UPDATE; existing immutable receipt/attestation and event<=recorded CHECK |
| route generated / created versus a new clock | service-only core validates generated<=sample; caller cannot supply created_at; explicit INSERT uses sample; private write ACLs + immutable facts + generated<=created and expiry attestation CHECK |
| match calculated / created versus a new clock | service-only exact-context core validates calculated<=sample and route bound; explicit created sample + no private API writes + immutable facts + calculated<=created CHECK |
| later discovery/state DB stamps | only approved trusted wrappers/defaults generate stamps; exact immutable resolution/target/provider/state evidence remains; no external recorded-at argument or direct API writes |
| DB quote/proposal/consent/funding/activation/start stamps | trusted writer owns clock value, no external timestamp parameter or private API writes; immutable exact actor/source/receipt/ledger graph. Public mirrors must equal private evidence, not a caller-chosen timestamp. Finite/deadline checks remain. |

Replacing a fresh comparison does not admit a newly future-dated E: the ingestion RPC still rejects it at the authoritative sample. Regressing later evaluator N below I cannot undo an already accepted historical fact. Live X>N may still change as the clock changes because that is explicitly a live deadline question. Existing public/legacy ambiguity is not used as an excuse to remove its whole-column protection.

## Eventual regression matrix

| Case | Expected proof |
| --- | --- |
| external E > authoritative I | ingestion rejects with existing SQLSTATE; no new skew window |
| E passes preliminary sample but exceeds final authoritative I after regression | reject before persistence; no contradictory accepted row |
| valid E <= I, later trigger/evaluator reference below E/I | accepted attestation/history succeeds; no fresh future proof |
| same sample | instrument test-only producer capture of I and compare exact microsecond persisted created/recorded values; no JS roundtrip |
| expired X at final ingress/live action | new action rejects, including after lock waits |
| original evidence expired today | exact 0079/0080/0081 replay succeeds if original recorded gates were valid; no writes/new capacity/holds |
| wrong event/provider/request/source/expiry relation | fail despite plausible timestamps; direct anon/auth/service attestation INSERT/column UPDATE denied |
| old route retry with different allowed observation time | preserve current provider-reference replay semantics and stored original event/I |
| selection proof Edge skew/TTL | preserve +30s Edge verifier, 5-minute cap, nominal 2-minute issuer and zero-skew DB first intake |
| old incompatible attestation / nonzero unordered faces | preflight abort, no migration mutation or forged backfill |
| reverse face times and callback/activation races | latest ordinal wins; actual pg_blocking_pids wait; no fallback to older success, duplicate graph or deadlock |
| rollback/gaps | no attempt/receipt on failed transaction; gaps accepted; use disposable sequence, do not claim rollback restores sequence state |
| mixed legacy row | cannot acquire trusted private receipt semantics just by timestamp or status; existing legacy grants/guards unaffected |

No behavioral/concurrency source was executed in this audit. These are tests required during implementation; portable tests here verify existing code facts and the authored model, not deployed hardening behavior.

## Ordering and final decision

Implement new 0082 trusted temporal evidence hardening, verify its invariants and concurrency, then rename current completion to 0083 in an explicitly authorized step and revalidate completion against hardened prerequisites. Do not install/rename during this audit. Design scope is now complete for the audited private financial path through 0081; legacy dataset imports and informational chronology remain deliberately outside scope. Future provider timestamp contracts are not pre-authorized by this design.

Actual command results, hashes, changed files and complete git status are in `0082-temporal-external-validation.txt`. Production completion remains byte-identical and paused. Nothing was installed, staged, committed, pushed, or changed remotely.
