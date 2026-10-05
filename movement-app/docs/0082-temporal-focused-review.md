# Focused temporal-hardening review

Decision: **NEEDS FURTHER AUDIT**. The financial receipt writers and face sequencing design are substantially resolved. An exact approved migration still needs the external-event/DB-recording boundary described below. No production SQL or migration name changed.

Follow-up: `0082-temporal-external-review.md` resolves that boundary using existing immutable fields and one authoritative ingestion sample, preserves external lower bounds, documents the existing Edge-only proof skew rule, and supplies the complete 32-function candidate scope. Its READY recommendation supersedes this pass's unresolved boundary; deployment remains gated on compatibility/face-history preflight and implementation tests.

## Writer review and origin corrections

See `0082-temporal-focused-writers.md` for all 56 previously D fields and `0082-temporal-focused-evidence.json` for installed writer signatures, triggers, direct table/column privileges, timestamp-argument ACLs and focused selectors. This is a writer review, not a repeat of the full lexical inventory. Status-only writers are listed alongside timestamp writers so none is silently treated as an authoritative timestamp producer.

Fourteen formerly D fields now have a single proven production-origin class:

| Table.field | Actual timestamp writer | Caller value / overwrite | Multiple timestamp authorities | Final class |
| --- | --- | --- | --- | --- |
| private.offering_movement_availability.created_at | open_offering_movement_availability INSERT omits field, DB default clock | No argument or API INSERT/column INSERT | No | A |
| private.offering_movement_availability.updated_at | protect_offering_movement_availability: insert copies created_at; updates sample clock | Trigger owns value | Same DB authority, multiple lifecycle invocations | A (initial copy is same internal creation event, not an independent caller event) |
| private.offering_movement_availability.expires_at | open_offering_movement_availability | DB LEAST persisted intent earliest/expiry and route expiry | No | C |
| private.requester_movement_interests.created_at | create_requester_movement_interest default clock | No argument or direct API writes | No | A |
| private.requester_movement_interests.updated_at | protect_requester_movement_interest | Trigger owns value | Same DB authority | A |
| private.requester_movement_interests.expires_at | create_requester_movement_interest | LEAST persisted availability and match expiry | No | C |
| private.offering_movement_intents.expires_at | create_offering_movement_intent explicitly inserts NULL | No caller expiry argument | No installed dated writer | A, NULL-only sentinel; no event time is claimed |
| private.movement_location_references.expires_at | selected/verified selection insert NULL; resolution producer accepts and caps p_expires_at | Caller can shorten expiry, DB bounds it | Yes, but external value controls resolved branch | B |
| private.offering_route_evidence.expires_at | record_offering_route_evidence_for_server | p_expires_at capped by persisted dependencies | No alternate timestamp writer | B |
| private.trusted_route_match_evidence.expires_at | record_trusted_route_match_evidence_for_server | p_expires_at capped by dependencies | No alternate timestamp writer | B |
| private.location_provider_quota_buckets.updated_at, window_start | consume_location_provider_quota_at; public wrapper passes NULL timestamp | DB clock / UTC bucket derivation; private explicit-time argument inaccessible to API roles | Owner/test helper can supply time; public production caller cannot | A on public production path |
| private.route_provider_quota_buckets.updated_at, window_start | consume_route_provider_quota_at; public wrapper passes NULL | Same boundary | Same | A on public production path |

42 whole-column D classifications remain. The companion evidence JSON enumerates them explicitly. They do **not** all represent unknown security-sensitive financial inputs:

- `movement_funding_holds.fully_held_at` has one writer, `hold_my_movement_funds`: C = greatest exact persisted hold transaction stamps for positive components; A = fresh clock for zero-only obligations. Both writers are proven trusted, but the whole field is mixed A/C under the required mutually exclusive classification. Retain D and document each branch; do not call it wholly C. MAX is a deterministic receipt value, not an ordering authority selecting a different component.
- `public.alignments.activated_at` is C when backed by funded activation: `activate_my_funded_movement` inserts the private A receipt and mirrors its stamp; `require_funded_alignment_activation` verifies exact equality and protects it from changes. Legacy payment callbacks and service-role direct writes keep the whole column D.
- Financial `public.journeys.created_at`, `start_requested_at`, `started_at` are C mirrors of private coordination/request/start receipts. `protect_financial_coordination_journey` requires exact copies on INSERT and permitted transitions; legacy writers and service direct writes keep whole columns D. Financial completion/end fields are NULL through 0081; legacy mutators are blocked by the financial journey guard.
- Public need/offer/alignment `created_at` and public membership/media/vehicle timestamps remain D: service-role INSERT/UPDATE/column writes exist, defaults can be overridden, and no universal timestamp-overwrite trigger proves creation ownership. `set_updated_at` owns normal UPDATE bookkeeping but does not overwrite explicitly supplied INSERT timestamps. The complete installed mutation function/trigger lists are in the writer table. Existing financial receipt construction narrows some operational mirrors, not every operational creation timestamp.
- `private.journey_meeting_points.updated_at` remains D due to service direct writes; the financial start contract freezes its explicit integer `revision` and exact text. Time is not its chronology authority.
- Legacy activation-payment, settlement, profile-share, no-travel closure and review fields are retained D and outside the minimal active financial hardening replacement scope. They were reviewed for writer boundaries; their broader lifetime contracts were not re-audited here.
- `transport_geography_datasets.registered_at` remains D: no installed registrar INSERT function, backend/import authority not yet proven. Keep its ingestion-time future check. It does not justify removing a trusted receipt check elsewhere.

Corrections to the first-pass report: installed `record_pricing_geography_evidence_for_server` assigns `e.generated_at:=clock_timestamp(); e.created_at:=e.generated_at` and inserts `e.*`. Its default is not used on that path. There is no independent geography generated/created clock pair. Also, equal values copied from one local `v_now` into several newly constructed rows are A under the strict “already persisted evidence” definition of C; equality remains essential provenance even where the first-pass table labelled such receipts C. Actual reads of persisted parent values, such as agreement consent copies and funded operational mirrors, are C. The initial 32/8/23/56 totals are a first-pass snapshot, not a final origin census.

## Call and privilege boundaries

Fresh SELECT-only capture includes table INSERT/UPDATE/DELETE and any-column INSERT/UPDATE for anon/authenticated/service_role. All are false for the private location, discovery/state, route/match, availability/interest, pricing, proposal/agreement/component, funding, face-attempt and funded receipt tables. Service-role direct writes remain on legacy/public operational tables. The catalog captured zero local face attempts and zero local activation-face rows, with no existing public/private sequences. This says nothing about remote production row counts.

All 13 installed timestamp-argument functions are recorded with exact overload signature and ACL:

| Function family | anon | authenticated | service_role | Boundary |
| --- | --- | --- | --- | --- |
| create_movement_need; create_offering_movement_intent | no | yes | no | auth.uid member identity/ownership; finite declared departure interval; external B planning inputs |
| record_verified_selected_location_for_server | no | no | yes | service identity and verified-member/provider/request binding; finite issued/expiry and first-use current-time checks |
| record_attested_location_resolution_for_server: newest 15-argument overload | no | no | yes | require_verified_location_selection + exact provider identity; fresh observation validation; state/discovery evidence |
| older 12/13-argument attested overloads and core record_location_resolution_for_server | no | no | no | owner/internal delegation only; caller-facing overload delegates core checks |
| record_offering_route_evidence_for_server; record_claimed_offering_route_evidence_for_server | no | no | yes | exact intent/endpoints or verified member + claim; validated provider identity, finite future/expiry and bounded sources |
| record_trusted_route_match_evidence_for_server | no | no | yes | exact context/route version, geometry/positions and finite event/future/expiry |
| consume_location_provider_quota_at; consume_route_provider_quota_at | no | no | no | private explicit-time seam; public wrappers supply NULL, so production time is DB-generated |
| has_current_alignment_face_check | no | no | no | private validator reference p_at, not a persisted caller-chosen event |

Server functions generally do not impersonate end-user auth.uid: service-only EXECUTE is the boundary, and verified member/subject arguments are validated in the graph. Authenticated creation RPCs explicitly check auth.uid. Owners can call internal functions and forge database state; their power is not evidence that an API caller controls a private timestamp.

The inspected Edge runtime adapters send resolution/route/match timestamp values as RPC arguments (`location-runtime.ts`, `route-runtime.ts`). They are B regardless of whether an upstream provider or server clock originally generated them. Face adapters call named RPCs and authenticate callbacks rather than writing attempt timestamps. The payment runtime's direct alignment request is GET/read-only. No `.insert()`/`.update()` direct mutations were found in the inspected Edge function directory. This source review does not revoke service-role database powers or prove every possible external integration.

## Chronology and semantic role

True *construction order* is required for all child graphs. Numeric order of independent wall readings is generally not the proof of that construction. Preserve exact FK/receipt/version/actor binding and original live deadline checks. The following distinguishes those two requirements explicitly.

| Parent -> child | Current numeric condition | Semantic role | Numeric order needed? / replacement |
| --- | --- | --- | --- |
| selected location -> provider resolution | resolved_at >= source.created_at; resolved_at <= target.created_at | source recorded_time A versus external event_time B | Unresolved cross-clock acceptance policy. Source identity proves association, but current lower bound also rejects stale event input. Do not silently delete it. |
| resolution -> discovery/state | child.recorded_at >= resolution.recorded_at | recorded_time -> recorded_time | Redundant numeric ordering; preserve exact resolution/target/provider/schema, immutable row and finite timestamp. |
| endpoints/intent -> provider route | generated_at >= endpoint.resolved_at and intent.created_at | B event relation and A recording mixed | Provider event-to-event freshness may be required; relation to A intent sample remains unresolved. Preserve external ingestion pending decision. |
| provider route -> match | calculated_at >= route.generated_at | B external event_time pair | Declared dependency event chronology; retain at ingestion. It is not two DB-produced timestamps. |
| match -> pricing geography | geography.generated_at >= match.calculated_at | A recorded_time (despite name generated_at) versus B event_time | Exact match/version classifier binding establishes computation source. Numeric wall ordering does not prove it; proposed replacement keeps identity/geometry/dataset and ingestion policy. Requires external/recording boundary resolution below. |
| geography generated -> geography created | generated_at <= created_at | same producer event | Already one sample; preserve equality/finite rather than claiming clock regression between these fields. |
| geography -> quote | quote.created_at >= geography.created_at | recorded_time pair | Redundant; retain exact geography version and bounded expiry. |
| offer -> context snapshot | snapshot.created_at >= offer.created_at | recorded_time A versus public D | Redundant to exact immutable offer/route-match/availability binding for trusted snapshot. Do not globally relabel offer.created_at A. |
| snapshot/quote -> proposal | proposal.created_at >= source.created_at | recorded_time pair | Redundant to exact source ID/version/compatibility, historical snapshots and roster. |
| proposal -> offerer consent -> requester consent -> materialization | accepted >= created, requester >= offerer, materialized >= consent | DB-recorded consent/events overloaded as causal markers | Causal write order is real; numeric independent clock order redundant. Trusted locked write-once graph and exact copies prove sequence. Keep all consent/materialization stamps finite and strictly before original expiry. |
| requester consent -> hold transaction/receipt | hold.created_at / fully_held_at >= requester consent | recorded_time, positive receipt C, zero A | Redundant to exact component/ledger/idempotency graph produced after agreement validation. Keep balance/postings/amount proof and deterministic greatest-value receipt equality. |
| funding -> activation | fully_held_at <= activation stamp | recorded_time pair | Redundant with complete funded graph under canonical locks and immutable activation receipt. Do not remove funding amount completeness. |
| face start -> callback -> activation | completed >= started; completed <= activation/reference | recorded_time pair overloaded as chronology/valid_from | Use producer state transition and alignment/member locks; completed existence/success/result/identity still required. Live expiry and activation-time expiry remain. Attempt chronology needs ordinal. |
| activation -> coordination | coordination.created_at >= activated_at | recorded_time pair | Redundant to required exact activation receipt and protected alignment state. |
| coordination -> start request -> confirmation | requested >= journey.created, started >= requested | recorded_time pair | Redundant to exact immutable receipt dependency, offerer/requester roles, frozen meeting revision and lifecycle transition. |
| availability/interest creation -> later updated_at | updated_at >= created_at | audit metadata | Unsafe redundant numeric CHECK; trigger-owned UPDATE may regress. Retain immutable bindings and terminal/capacity lifecycle controls. |

Strictly required temporal relationships are **deadline/validity** relations, not chronology authorities: finite departure earliest <= latest; finite proof issued < proof expiry; first-use event/sample < applicable expiry; face started + fixed lifetime; face completed < expiry and expiry > recorded activation; proposal consent/materialization < original expiry; bounded child expiry <= exact parent deadline. Historical equal timestamp mirrors and deterministic receipt values remain exact. Do not infer validity of a new action solely because a historical parent was once valid.

| Field family | Explicit semantic role |
| --- | --- |
| location selection created / receipt recorded / attestation verified | recorded_time and immutable attestation identity; not a provider event or monotonic causal counter |
| location resolved_at; proof_issued_at; route generated_at; match calculated_at | externally asserted event_time (proof issued also external valid_from) |
| resolution/discovery/state recorded_at | recorded_time; source FK is causal_marker, wall value is not |
| need/intent/availability/interest created_at and receipts | recorded_time; planned departure inputs are future event declarations/eligibility deadlines |
| pricing geography generated_at and created_at | one recorded_time; “generated” does not mean external classifier event time |
| quote/snapshot/proposal created_at | recorded_time; exact source IDs/versions carry causality |
| offering/requester_accepted_at; materialized_at | DB-recorded consent/construction event_time, also historical deadline evidence; not a sequence counter |
| agreement consent values | C exact proposal event copies; agreement/components created_at are recorded_time metadata |
| wallet transaction/posting created_at | DB ledger recorded_time; component identity and write-once ledger carry causality |
| funding fully_held_at | positive C greatest recorded hold stamp or zero A recording stamp; not necessarily the last causal transaction's wall time |
| face started_at / completed_at | DB-recorded start/callback event_time; started currently conflates chronology and validity origin |
| face expires_at | deterministic expiry from start; retain fixed lifetime; proposed attempt_ordinal is causal_marker, never wall time |
| funded activation/coordination/request/start receipt stamps | DB-recorded lifecycle event_time; exact public operational copies C; receipt graph is causal authority |
| meeting-point updated_at | audit metadata; existing revision is causal_marker |
| expiry fields throughout | expires_at; live decisions compare now, historical proofs compare recorded acceptance/activation where required |

## Face ordering: exact failure and minimum authority

Installed UUIDs are generated by `gen_random_uuid()`, not an order-preserving ID. No attempt identity/ordinal/sequence currently exists. Option A UUID order and Option B started/completed wall order cannot establish chronology.

Current mechanism:

1. `start_alignment_face_verification_for_server` locks alignment UPDATE then member UPDATE; only pending older attempts are superseded. An older succeeded attempt remains succeeded.
2. `complete_alignment_face_verification_for_server` uses alignment -> member -> attempt UPDATE locks, accepts only pending (or exact successful callback replay), stores DB completion sample and may leave existing verified flags true on a failed attempt.
3. `has_current_alignment_face_check`, `get_my_alignment_face_verification_status` and `activate_my_funded_movement` choose started_at DESC, UUID DESC.
4. `assert_funded_activation` infers a newer historical attempt from `(started_at,id)` and `newer.started_at <= activated_at`.

Counterexample established from exact definitions and portable model (not a PostgreSQL exploit run): attempt 1 succeeded with started=T+5ms; attempt 2 is causally later on the same prepared photo but starts=T and fails. Old success survives and ranks newest. With later live reference T+100ms, its completed/future and expiry checks can pass and activation can bind attempt 1. Inverse failure/success can ignore a newer valid success. Equal wall samples fall back to unrelated UUID ordering. Existing alignment/member locks serialize the actual events but that order is discarded by the timestamp selector.

Recommend **one logged PostgreSQL bigint sequence dedicated to face attempts**, one NOT NULL positive immutable `attempt_ordinal` column, and an index for `(alignment_id,member_id,attempt_ordinal DESC)` plus uniqueness. Allocate after the existing alignment/member locks, before inserting the attempt. Use `CACHE 1`, ascending, NO CYCLE; API roles receive no sequence usage/update rights and no direct attempt-column writes. Add a narrow ordinal-immutability guard (new private trigger function) or equivalent immutable-field protection; explicit ordinal replacement must fail. Do not use max+1 or infer commit order across unrelated subjects. This is an event ordinal, not a global clock or timestamp service.

Chronology: latest means greatest attempt_ordinal for that exact alignment/member. Validity: that latest row must match exact media/member/alignment, succeeded/liveness/match, finite completion and expiry, valid completion-time deadline, current prepared/verified media at first activation, and unexpired at the activation gate. A newer pending/failed/expired attempt must prevent falling back to older success.

Activation history uses the exact immutable `funded_movement_activation_faces.face_verification_id`. No supported attempt can start after funded activation: start/callback require pre-payment alignment while holding its UPDATE lock; funded activation and coordination protections forbid returning that financial alignment to pre-payment. Under this proved through-0081 invariant, assert the bound attempt is the greatest ordinal for that subject **without a timestamp cutoff**. Later photo revocation/preparation does not rewrite successful attempt rows, so exact historical activation remains readable. If future migrations permit new post-activation attempts or alignment reuse, they must introduce an activation-bound ordinal cutoff/epoch; that requirement is not currently necessary and must not be silently assumed away in future work.

Sequence atomicity/gaps and cache ordering are specified by [PostgreSQL CREATE SEQUENCE](https://www.postgresql.org/docs/current/sql-createsequence.html) and [sequence functions](https://www.postgresql.org/docs/current/functions-sequence.html). Rollback/crash gaps are acceptable: only uniqueness and order matter. CACHE greater than one can hand another connection a larger block before earlier cached values are used; CACHE 1 avoids that ordering trap. Existing subject locks are still essential: sequence allocation alone is not transaction commit order. For the same alignment/member, transaction 2 cannot allocate until transaction 1 releases those locks; rolled-back attempts disappear while their ordinal remains consumed. Unrelated subjects need no new application-level global lock.

## Other timestamp selectors

Focused evidence contains 29 timestamp-associated ORDER/MAX/GREATEST sites (including surrounding lines, not all security selectors). Reviewed active-path outcomes:

| Selector | Decision |
| --- | --- |
| has_current_alignment_face_check; get_my_alignment_face_verification_status; activate_my_funded_movement; assert_funded_activation | Unsafe chronology authority; ordinal required |
| movement_funding_evidence latest:=greatest and hold_my_movement_funds funding_at:=greatest | Safe deterministic aggregate of exact component rows, not latest evidence selection; misleading “fully held event time” interpretation must be documented |
| get_my_current_movement_need created_at DESC | Chooses a default among caller-owned eligible needs; unsafe if product means causally newest, but no authorization/capacity decision bypass. Subsequent mutations require exact need. No ordinal added without product contract. |
| get_my_requester_movement_continuation / list_my_offerer_movement_continuations / list_my_active_movement_continuations / completed recoveries | Sorting/pagination or default recovery selection; exact ownership and graph eligibility constrain candidates. Wall order may reorder/hide pages, not establish authorization. Class safe informational for security, separate UX chronology issue. |
| get_my_profile_photo_submission_status | Timestamp-ranked UI submission projection; readiness gates bind the exact ready submission/media, not this latest projection. Safe informational for financial authorization, potentially stale UI after regression. |
| get_post_activation_people / resolve_post_activation_photo_for_server current verified media ORDER created_at | Selects current verified media; normal prepare RPC clears previous current flags under member lock. No database current-media uniqueness constraint in capture; service direct media writes can create multiple current rows. Needs separate current-media invariant review if service may do so. No proven ordinal requirement from normal active path. |
| discover_masked_* / discovery availability / interest / participant displays / reveal subject numbering | Presentation/ranking among independently eligible rows; not trusted latest authorization |
| get_my_activation_payment_status | Legacy-only explicitly rejects financial alignment; out of financial scope |
| MAX(version) in immutable evidence/proposal history | Existing locked version authority, not wall timestamp; retain. Not proposed for face ordinals. |

No additional active financial **authorization** selector requiring a sequence was proved beyond face attempts. This does not claim every default “current” UI choice is chronologically correct.

## Exact candidate replacement scope

These are explicit future edits for proved DB-origin cases, not SQL written or a claim that the unresolved ingestion boundary has an approved solution. Deduplicate functions occurring in several groups. Preserve owners, overloads/signatures/return types, empty search_path, ACLs, auth, isolation, lock order, immutable facts, row counts and exact producer graphs.

### Group 1: historical not-future guards

| Function to replace | Predicate change / preserved security |
| --- | --- |
| private.protect_movement_context_record | Remove fresh NEW.created_at comparison for the known private producer tables; keep finite, lifecycle and live expiry. External resolved_at branch is pending ingestion-boundary decision below. |
| private.require_verified_location_selection | Remove verified_at > fresh clock; retain exact source/receipt/attestation equality, provider/member/request and live source expiry. |
| private.assert_movement_location_resolution_evidence | Remove recorded_at > v_now for producer-owned receipt; retain exact target equality and live dependencies. External event bounds pending. |
| private.assert_trusted_location_discovery_area; private.assert_trusted_location_state_evidence | Remove recorded_at > clock; finite plus immutable exact evidence/target/provider/schema remains. |
| private.protect_movement_need_creation_receipt; private.protect_offering_movement_intent_creation_receipt | Remove fresh recorded-at future comparison; preserve immutable request/subject/source receipt and exact construction values. Do not assert public need.created_at is globally trusted. |
| private.protect_offering_route_evidence; private.protect_trusted_route_match_evidence | Remove NEW.created_at future comparison; external generated/calculated future branch pending one-time ingestion boundary. |
| private.protect_pricing_geography_evidence; private.assert_pricing_geography_context; private.assert_pricing_quote_context | Remove trusted creation/generated future comparisons; retain exact match/geography, policy, state, versions and live bounded expiry. |
| private.protect_offering_movement_availability; private.protect_requester_movement_interest | Remove producer-owned created_at future comparison; preserve capacity/terminal/write-once and current expiry. |
| private.protect_financial_proposal | Remove trusted created/consent/materialized fresh future comparisons; retain write-once immutable economics/consent/materialization and first-use expiry. |
| public.accept_my_financial_proposal_as_offerer; public.accept_my_financial_proposal_as_requester | Remove trusted source created/consent future comparisons in construction and replay; keep exact caller/version, current unexpired first use and historical complete graph. |
| private.assert_financial_proposal_materialization | Remove materialized_at > fresh clock; keep original deadline, finite stamps and exact complete locked alignment/agreement/components/need/offer graph. |
| private.movement_funding_evidence | Remove transaction/receipt > fresh clock in both proven A/C branches; retain exact component transaction identities, balanced two postings, zero paths and deterministic receipt aggregate. |
| private.assert_funded_activation | Remove activated_at > clock; retain exact funded receipt/public mirror and activation-time validity of exact face set. |
| private.assert_funded_coordination_entry; private.require_funded_start_actor | Remove recorded/request/start > fresh clock; retain linked exact receipts/roles/frozen revision and protected lifecycle. |
| private.has_current_alignment_face_check | Remove completion <= fresh p_at solely as historical future proof; retain completion/success/result/identity finite and live expiry, use ordinal. |

### Group 2: redundant numeric chronology

| Function to replace | Replacement |
| --- | --- |
| private.assert_trusted_location_discovery_area; private.assert_trusted_location_state_evidence | Remove child recorded < resolution recorded rejection; FK/target/provider/schema is causal proof. |
| private.assert_pricing_geography_context | Remove generated < match.calculated as DB chronology only after ingestion/recording semantics decision; exact source identity remains. |
| private.assert_pricing_quote_context | Remove quote.created < geography.created; exact version/lifetime remains. |
| private.assert_movement_context_snapshot_offer_binding | Remove snapshot.created < offer.created; preserve exact immutable offer and both authorization bindings. |
| private.assert_financial_proposal_quote_binding; private.assert_financial_proposal_movement_context_binding | Remove proposal.created < quote/snapshot.created; preserve exact historical IDs/versions/terms and bounded lifetime. |
| private.assert_financial_proposal_materialization | Remove consent/creation/materialization independent sample inequalities; retain causal write-once complete graph and all original deadline conditions. |
| public.accept_my_financial_proposal_as_requester | Remove accepted_at < offering consent and completed_at < accepted_at checks, and replay/validation lower-bound comparisons; preserve expiry rejection at actual first-use gates and unchanged graph construction. |
| private.movement_funding_evidence | Remove transaction/receipt < requester consent; exact funded components prove dependency. |
| public.activate_my_funded_movement; private.assert_funded_activation | Remove funding sample > activation sample and face completed sample > activation sample; complete funding and success state already established under alignment/member locks. |
| private.assert_funded_coordination_entry; private.require_funded_start_actor | Remove coordination < activation, request < coordination, start < request; immutable receipt linkage/actors/meeting revision/state transitions carry cause. |
| private.assert_funded_activation; public.complete_alignment_face_verification_for_server (if needed by final finite-check placement) | Drop completed < started rejection; trusted callback pending-state transition proves order. Preserve completion < expires and finite checks. Callback currently has no explicit such PL/pgSQL predicate; table CHECK does, so do not replace the function unnecessarily. |

Required **constraint replacements**, not just functions: availability `offering_movement_availability_check1` and interest `requester_movement_interests_check1` (updated >= created); proposal `financial_proposals_check5`, `financial_proposals_requester_consent_check`, `financial_proposals_check6` (remove only causal numeric lower bounds, retain null/graph-shape/consent/expires conjuncts); face `alignment_face_verifications_check1` (remove completed >= started, retain successful result/completion/expiry and add explicit finite fields). Finite and deadline constraints remain. External event <= recording CHECKs on location/route/match are pending, not approved blanket removals. Existing geography same-sample relation needs no chronology change.

### Group 3: face chronology authority

Exact replacement functions: `public.start_alignment_face_verification_for_server` allocates ordinal under its existing locks; `private.has_current_alignment_face_check`, `public.get_my_alignment_face_verification_status`, and `public.activate_my_funded_movement` select greatest ordinal; `private.assert_funded_activation` replaces timestamp/id newer test with ordinal and protected pre-payment epoch reasoning. Add a narrowly scoped private ordinal immutability trigger/function. `private.assert_alignment_face_ready`, `public.get_alignment_face_readiness_for_server`, `public.get_my_movement_activation_status` call the corrected helper and need **no replacement solely for ordering**. Photo prepare/revoke preserve ordinals and successful history and need no sequence changes. Existing callback requires no ordinal allocation or rewrite.

### Groups 4 and 5: unchanged live and external boundaries

Keep current expiry checks in intent/route/match/availability/interest/context/snapshot/pricing/proposal first use, face readiness/first activation, claims/quotas/tokens and expiry lifecycle transitions. Keep original expiry comparisons for recorded consent/materialization/activation history. Keep exact original timestamps on replay; never refresh history.

Keep external finite/future checks in `record_verified_selected_location_for_server`, core and attested location resolution overloads, route and claimed-route writers, trusted-match writer. Keep provider/member/source/version/request and proof validation. Registered dataset future check stays until its import authority is proved.

**Remaining boundary blocker:** a provider B input can pass `input <= ingestion_clock`, then a second protected INSERT/default/validator clock can regress below it. Keeping both future checks blindly does not fix the original class. One-time ingestion validation must retain evidence of the exact reference used; historical validators must trust that attestation rather than resample. For location/route/match, inspect whether the existing created/recorded field can consistently store that same ingress reference without changing its event semantics or introducing a new receipt field. Existing `event <= created` CHECKs and B-event >= A-parent-created bounds need explicit treatment. External bounds are not automatically redundant: they may reject a stale provider observation. Therefore there is no final approved **complete** replacement list yet, even though the DB-only candidate scope above is exact. Do not implement a subset and claim the inherited problem solved.

## Schema, backfill and concurrency

Minimum proven addition: one face-attempt ordinal column/sequence/index/immutability guard; no new table or general clock. The additional constraint replacements above are schema changes too. Additional ingestion attestation columns may or may not be necessary; unresolved, so “function replacements plus one ordinal only” is not yet a final promise.

Local face and activation-face row counts are currently zero. Remote was deliberately not queried. Immediately before implementation, authorized read-only production checks must verify attempts, activations, proposals/agreements and operational row counts under a deployment write gate. If attempts exist, timestamp/UUID sorting cannot reconstruct causal order. A deterministic numbering is possible but not a truthful ordering proof. Abort the zero-row migration path rather than silently invent history; use independently authenticated provider/order evidence or a reviewed legacy epoch policy if data exists. Preserve existing IDs/timestamps and bound activation faces; 0079/0080/0081 replay must remain exact. Filling ordinals by arbitrary sorting is not an approved backfill.

Same-subject lock order remains alignment -> member -> attempt; allocate sequence only after those locks. Replay never allocates another ordinal. Rollback leaves sequence gaps and no attempt; gaps do not matter. Concurrency between unrelated subjects may interleave numbers, but no contract compares their chronology. Sequence allocation is not commit-order authority without subject locks. Protect sequence CACHE 1 / NO CYCLE / ownership/ACL/configuration in portable and DB tests. Sequence gaps mean a rollback-only test against an installed persistent sequence can alter its state: use a disposable clone for new attempt/concurrency tests or temporary test-local sequence substitutions; do not promise unchanged sequence state from transaction rollback alone.

## Eventual tests

1. Normal producer graph plus test-only synthetic lower validator clock passes historical assertions/replay with identical IDs/stamps and zero writes. Wrong FK/version/member/attestation/partial graph still fails even with plausible timestamps.
2. Inject producer samples T+5ms then T in disposable test-only source copies: redundant metadata chronology no longer rejects; live expiry, finite values and exact copies still hold. Never alter OS clock or add production tolerance.
3. Future B input fails ingestion, including recorded authority consistency, stale/provider mismatch and nonfinite values. Expired live source/quote/face fails first use. Historical replay after original expiry remains exact.
4. Face attempt 1 success at T+5ms then attempt 2 failed at T: ordinal 2 is latest, readiness false, activation rejected. Inverse statuses select newer success; include pending/expired newer row, equal timestamps, random UUID reversal, callback replay and concurrent start/callback/activation with actual blocking.
5. Activation binds exact highest ordinal under locks. Subsequent photo changes do not rewrite receipts; historical activation/coordination/start replay validates exact bound face IDs. Any invented ordinal, subject mismatch, missing face or malformed result fails.
6. Sequence rollback gaps, rejected callback after supersession, no duplicate ordinals/receipts, no deadlock, no new operational/ledger side effects on replay. Verify restored catalog/data/ACL/history plus sequence state where applicable.

## Results and limits

Read-only catalog refresh passed with application fingerprint unchanged. Offline focused evidence generated successfully. Audit + focused completion portable tests: **65 passed, 0 failed, 0 skipped**, including 10 new audit tests and raw historical migration hash checks. These prove catalog facts and comparator counterexamples, not a PostgreSQL execution of the proposed fix. No production fixes, synthetic DB clock tests, behavioral suite or concurrency suite ran. No TypeScript code changed; TypeScript was not required/rerun in this focused pass.

No global monotonic clock is needed by the proven findings. No paid dependency. Recommend hardening as future 0082 and completion as later 0083 once the remaining boundary is approved; neither written/renamed/installed. Historical migration integrity and paused completion SHA are protected by the portable tests. Full working-tree status and final whitespace results are recorded separately in `0082-temporal-focused-validation.txt`.
