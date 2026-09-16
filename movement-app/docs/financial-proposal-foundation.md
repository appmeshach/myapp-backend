Financial Proposal Foundation (0021)

Purpose

Migration 0021_financial_proposal_foundation.sql creates a private, immutable foundation for versioned financial proposals.

It is intentionally non-operational. It does not calculate prices, publish production proposals, modify the live offer flow, collect money, activate a movement, or create financial agreements automatically.

What a proposal represents

A proposal is a stored record of proposed economics for one exact movement context and one exact proposal version.

The proposal stores:

movement need identity;

offering member;

primary requester;

selected vehicle;

proposal version;

financial-model and pricing-policy provenance;

currency;

quoted total platform fee;

quoted movement contribution;

the declared movement-need snapshot used by pricing;

seats/capacity inputs;

optional offer declarations such as pickup/dropoff area and arrival estimate;

exact confirmed traveller identities in a private roster snapshot;

future acceptance evidence;

future one-way links to the movement offer, alignment and 0020 financial agreement.

A proposal is not a payment, funding record, wallet balance, settlement entitlement, refund, payout, or completed financial agreement.

No pricing engine exists yet

0021 does not implement a pricing formula.

In particular, it does not decide:

how the movement contribution is calculated;

how much below a privately created journey the contribution must remain;

whether or how vehicle class affects a future cost estimate;

whether tolls or other operating costs are included;

minimum or maximum contribution;

the exact platform-fee function;

quote-validity policy.

Those remain future trusted pricing-policy decisions.

No trusted routing exists yet

The current backend does not yet contain authoritative:

offering-member route geometry;

road-route distance;

matched overlap distance;

detour distance;

routing-provider duration;

toll estimate;

fuel or energy estimate;

existing-movement cost estimate.

0021 therefore does not add fake distance, overlap, detour, duration or cost fields.

route_evidence_id is reserved but constrained to NULL. A future migration must introduce a real trusted evidence model before a non-NULL route-evidence reference is permitted.

Zero must never be used to mean "unknown" for route evidence.

Monetary representation

The proposed economics are stored as integer minor units:

quoted_platform_fee_total_minor;

quoted_movement_contribution_minor.

Both are bigint, nonnegative and required.

Zero is an actual quoted amount. It is not a sentinel for "not priced".

The two platform-fee responsibility shares are not duplicated in this table because 0020 already defines the deterministic allocation policy:

offering member share = floor(total / 2);

requester share = total - offering share.

Movement contribution remains a separate obligation.

Versioning and history

A proposal version is scoped to the movement need and offering member.

The schema preserves historical versions and permits at most one current proposal for that context.

A superseded proposal cannot reopen.

Proposal economics and pricing-input snapshots are immutable.

Proposal history and roster history cannot be deleted.

A materialized proposal is permanently frozen.

Exact confirmed roster

Pricing validity is tied to the exact confirmed traveller roster, not merely a count.

The private financial_proposal_travellers table stores the confirmed participant identities used by the proposal.

Merely invited participants are not treated as confirmed priced travellers.

The proposal context validator requires:

traveller snapshot count equals declared people_count;

current confirmed participant count equals people_count;

no participant remains in invited status;

every snapshot row still matches the exact confirmed participant row;

the primary requester is present;

the offering member is not part of the requester roster.

This is foundation integrity only. No production proposal issuer exists yet.

Acceptance model

Future intended flow:

trusted backend produces one immutable priced proposal;

offering member sees the exact economics;

offering member submits an offer bound to that proposal and records offering-member acceptance;

requester sees the same proposal;

requester accepts;

in the same final transaction, the accepted offer, alignment and 0020 agreement are materialized.

0021 does not expose the RPCs that will perform these steps.

The schema enforces important future-state invariants:

offering acceptance requires the exact bound movement offer;

a bound offer requires offering-member acceptance;

requester acceptance cannot persist without same-transaction materialization;

superseded proposals cannot gain new consent;

acceptance timestamps and durable links are write-once.

Existing offer submission must never be retroactively interpreted as financial consent.

Offer binding

A proposal may exist before a movement offer exists.

Future offer submission may bind a proposal to one exact offer.

Once written, movement_offer_id cannot be changed or cleared.

At binding validation, before materialization the bound offer must be pending.

At materialization validation it must be accepted.

The offer's need, offering member, vehicle, seats and offer declarations must match the proposal snapshot.

Materialization linkage

0021 does not create an alignment or 0020 financial agreement automatically.

It only provides one-way, unique linkage fields for a future trusted transaction:

alignment_id;

financial_agreement_id;

materialized_at.

A valid materialization must match:

the proposal principals;

the exact accepted offer;

the alignment;

the 0020 financial agreement;

the proposal's financial-model, pricing-policy, allocation-policy and currency values;

the total platform fee;

the movement-contribution component;

both acceptance timestamps.

The materialization links are write-once and unique.

Legacy model remains unchanged

0021 does not modify:

create_movement_offer;

accept_movement_offer;

alignment creation;

activation-payment functions;

face-verification readiness;

post-activation reveal;

meeting-point or journey-start functions;

mutual no-travel/end functions;

settlement functions;

Edge payment functions;

client services.

No legacy alignment is backfilled.

No proposal is created automatically.

No 0020 agreement is created automatically.

The existing legacy offer/payment/activation path remains the only operational path until later migrations implement trusted pricing, funding and model-specific activation rules.

A proposal row by itself does not mean the new financial model is funded, payable or live.

Access control

The proposal tables are in the private schema.

PUBLIC: no access;

anon: no direct access;

authenticated: no direct access;

service_role: SELECT only in this foundation phase.

RLS is enabled and no client policies are created.

Private helper functions use SECURITY DEFINER with an empty search_path, schema-qualified references, and no execute privilege for PUBLIC, anon, authenticated or service_role.

No client-facing proposal RPC exists in 0021.

Future work

Later work must add, in dependency order:

trusted representation of the offering member's existing movement and route/input evidence;

approved backend pricing policy and proposal issuer;

safe client proposal projection;

offer + proposal acceptance integration;

atomic agreement materialization;

funding provenance and charge allocation;

model-specific activation, reveal, no-travel, completion and settlement rules;

refunds and payouts.

The new model must remain disabled until those dependencies are implemented and tested end to end.

Validation boundaries and future writer contract

The deferred proposal and roster triggers read the final stored proposal when their queued events run. Offering consent and offer binding may be separate statements in one transaction, but neither may survive validation alone. Requester consent may precede the materialization writes in that transaction, but cannot survive validation without them. An identical proposal UPDATE is a safe no-op; it does not refresh or revalidate historical evidence.

Only status-only supersession and identical no-op updates bypass mutable context validation. This preserves previously validated history after a need, roster, vehicle access or capacity changes, including after expiry. Construction events already queued in the same transaction still validate their final context; supersession cannot hide an incomplete new snapshot or standalone requester acceptance.

Source validity is checked at proposal construction and new consent/link validation. It is not a perpetual constraint on operational tables. Later legacy offer/status/source changes do not enqueue proposal checks. In particular, a privileged writer could force constraints early and then change source rows in the same transaction. Preventing that requires the separately reviewed future writer integration; 0021 intentionally does not hook existing operational tables. Stored timestamps and links do not prove that the referenced rows were created in that transaction, or that a user actually saw a quote. No migration backfill is performed.

Future writers must lock movement need, then proposal, then vehicle/access consistently before writes, keep validation deferred until all writes finish, and retry whole transactions after deadlocks or serialization failures. The helper takes a proposal lock before reading/locking the need, so callers must acquire the need lock first; arbitrary administrator write ordering is not deadlock-proof. Existing participant mutation triggers lock the need, which serializes roster validation against concurrent roster mutations. Unique indexes arbitrate competing current versions and link claims. Version numbers are positive and unique within (movement_need_id, offering_member_id); they are not required to increase monotonically.

That roster serialization assumes READ COMMITTED visibility after acquiring the need lock (or a separately verified SERIALIZABLE writer with retries). REPEATABLE READ with an older snapshot is not an approved future writer contract: locking the need does not itself advance visibility of participant rows.

Creation cannot be future-dated or already expired. New consent/link writes cannot be made after expiry or carry future timestamps. Deferred validation also checks wall-clock expiry, so a transaction that records consent before expiry but validates afterward is rejected and must not be retried with that expired proposal. A NULL expiry means no deadline. Supersession and identical historical retries remain possible after expiry.

The financial-model and allocation-policy identifiers are pinned. The pricing-policy identifier is immutable provenance text with a constrained format, not an approved-policy registry or an ordered version: 0021 cannot independently detect a pricing-policy downgrade. A future trusted issuer must authorize that policy. Currency is immutable uppercase three-letter text, not validation against an ISO currency catalog.

0021 compares agreement principals, policy identifiers, currency, platform total, contribution and both consent timestamps. 0020 independently enforces exactly three immutable components, their responsible parties/beneficiaries, and the overflow-safe integer platform split. Duplicating those component checks in 0021 is unnecessary.

All proposal/member/need/vehicle/offer/alignment/agreement foreign keys use the default non-cascading deletion behavior. Traveller participant_id is intentionally a historical UUID without a source-row FK. Application roles cannot mutate or truncate either proposal table. Database owners remain trusted administrators and can bypass protections through DDL; this is not tamper-proof storage against an administrator.
