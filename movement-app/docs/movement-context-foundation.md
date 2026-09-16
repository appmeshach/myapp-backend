# Movement context foundation (0022)

WE DO NOT CREATE JOURNEYS.

An offering member independently intends to move somewhere. A requester may adapt to that path and use ordinary transport before or after the shared movement. These tables record that declaration and immutable application inputs; they do not dispatch anyone or impose a pickup obligation.

0022 is local, private and non-operational. It adds exactly five tables, six restricted helpers and nine triggers attached only to its own tables. No live writer or public RPC exists. No existing migration, operational function, discovery projection, table privilege or lifecycle behavior changes.

## Five tables

| Table in `private` | Meaning and identity |
|---|---|
| `movement_location_references` | Immutable member-owned input label, provenance and optional future resolution metadata; UUID identity |
| `offering_movement_intents` | Independent declaration with member, logical `intent_key`, positive version and departure window |
| `offering_movement_intent_locations` | Exactly one origin and one destination for each intent version |
| `movement_context_snapshots` | Exact need, independent intent/version, optional offer, vehicle, declarations, location references and capacity inputs |
| `movement_context_snapshot_travellers` | Exact member/participant identities and roles for each snapshot |

Intent version scope is `(offering_member_id, intent_key, version)`. The logical key is scoped to its member, not globally shared between members. At most one version per member/key is current. Different independent movements may coexist. Intent rows have no requester, need or offer dependency.

Snapshot version scope is `(movement_need_id, offering_member_id, version)`, with one current snapshot for that pair, even when the selected intent or vehicle changes. Version numbers must be positive and unique, not necessarily consecutive or increasing. `context_schema_version` is pinned to `movement_context_v1`; it identifies input shape, not a pricing or matching policy.

## Location and trust semantics

A broad area, business, selected suggestion or exact address can be a legitimate declaration. These are not matching categories and do not compel the offerer to travel to that place.

Unresolved records use `member_declared` or `member_selected`; coordinates, resolution time and resolution version must be absent. Optional provider namespace/place-reference pairs may describe an unresolved selection, without asserting that its position was verified.

A future `provider_resolved` record must have `resolved` status, both scalar numeric coordinates, a nonblank generic provider namespace/place reference, a resolution version and a resolution timestamp no later than recording time. Coordinate ranges are bounded; one coordinate without its pair is rejected. No provider is selected or called, no raw provider payload is stored, and no spatial extension is enabled. This shape supports a future producer but does not authenticate one. No server/application role can currently insert it.

Location records are wholly immutable. A later resolution creates a new record, then a new intent/context version if needed; it does not rewrite the declaration used by history. Every reference is member-owned in this first foundation. Shared public-place catalogs and unowned records are deferred. Requester location references are optional and independently nullable. Their labels need not equal coarse need text: the future producer must establish their semantic relationship, not merely pass an ownership check.

Database checks establish stored member bindings, exact roster identities, current application state, vehicle/access relationships, version integrity and timing/coherence metadata. They do not establish physical presence, geographic truth, route correctness, actual distance or actual deviation. There is no authenticated declaration writer yet; a privileged fixture recording a member UUID does not prove that member made the declaration.

## Snapshots and validation

Snapshots copy requester origin/destination declarations and departure window, the offering intent's version and departure window, both offering location references, optional requester location references, people count, offered seats and current vehicle capacity.

When an offer is supplied, its need, offering member, vehicle, seats, pickup/dropoff declarations and client arrival estimate must match exactly, and its status must be pending. `declared_arrival_minutes` only copies the existing client's estimate; nothing calculates an ETA. Without an offer, these three offer declaration columns must be NULL. Offering movement endpoints always come from the independent intent, never from pickup/dropoff text.

Deferred construction checks require a discoverable need with no awaiting-activation, activated, in-progress or completed alignment; matching requester/declarations; a current unexpired intent belonging to the offering member; exactly two correctly owned and unexpired intent locations; correctly owned and unexpired optional requester locations; active vehicle access; matching capacity; and seats within the declared count/capacity bounds.

Snapshot travellers must match all and only the confirmed source participant identities, roles and count. Pending invitations reject construction; the primary requester must be present and the offering member excluded. Participant IDs are historical values without a FK to mutable participant rows. Member references retain non-cascading FKs.

Final-state checks run after parent and child INSERTs. An incomplete new intent/snapshot cannot be hidden by superseding it before deferred validation. No validator creates or mutates any operational record.

## Lifecycle and history

New intents and snapshots start current. Intent transitions are `current -> superseded | withdrawn | expired`; expired requires a non-NULL deadline that has elapsed. Snapshot transitions are only `current -> superseded`. Terminal states cannot reopen or change to a different terminal state. Time passing does not automatically change stored status; eligibility always checks expiry separately.

All fields except the permitted status transition are immutable. Identical parent updates are safe no-ops. Child updates/deletes and all parent deletes are rejected. Child inserts lock their current parent; unique role/identity keys and deferred completeness checks prevent later extension of an already complete record. FKs do not cascade deletion. Parent/member/need deletion can therefore be blocked once history references it; this is intentional preservation, not automatic source cleanup.

Creation/resolution timestamps cannot be future-dated, and records cannot be inserted already expired. Finite timestamps are required; expiration must follow creation. Deferred intent/snapshot checks also reject a deadline crossed before validation. NULL expiry means no deadline. Departure windows describe intent, not a guarantee or eligibility deadline; no automatic inference from departure time is made.

Historical terminal transitions do not revalidate mutable sources. Previously valid history can be superseded after source changes or expiration. Stored `current` is not proof of continuing eligibility: existing operational/source tables have no new triggers. The restricted `assert_movement_context_snapshot(uuid)` helper can recheck eligibility, but no live consumer calls it. A future consumer must revalidate before acting.

## Locking and transaction contract

Snapshot validation explicitly requires READ COMMITTED. It reads the snapshot identity, locks need `FOR UPDATE`, rereads/locks the snapshot `FOR SHARE`, then locks optional offer, intent, vehicle and active access `FOR SHARE`. The snapshot reread prevents concurrent supersession from racing a future eligibility check. Existing participant mutation triggers also lock the need, serializing roster changes. Location/endpoint contents are immutable; the intent lock coordinates endpoint construction and lifecycle changes.

Future writers must acquire need, optional offer, intent, vehicle/access locks before constructing snapshots and their children. Lock multiple objects in a deterministic ID order. Intent-only construction takes its parent lock and does not need operational rows. Never acquire an intent lock first and then start a need-dependent snapshot workflow in a competing writer. Retrying entire transactions after deadlocks remains required; arbitrary administrator ordering is not guaranteed deadlock-free.

The implementation rejects REPEATABLE READ/SERIALIZABLE snapshot validation rather than claiming an old roster snapshot becomes fresh through a lock. A separately reviewed writer may later broaden this contract. 0021 is not called or changed; future combined financial integration needs a complete lock-order review.

Keep constraints deferred until final writes. If a privileged writer forces validation early and then changes sources, no operational-table trigger will detect that later write. Another transaction can also change sources after the snapshot commits. These are explicit foundation boundaries, not perpetual source freezes.

## Privacy and future matching

All five tables have RLS and no policies. PUBLIC, anon and authenticated have no privileges; service_role has SELECT only, including no mutation/truncate privileges. All six helpers are SECURITY DEFINER with empty search paths and EXECUTE revoked from those four roles. Owners remain trusted administrators. No public projection, coordinate setter or provider-evidence setter is introduced.

Requester exact inputs stay private. A future preactivation UX should prefer safe route-relative impact such as "~X metres from your path", not reveal exact private pins, home/frequent coordinates, place identity or provider payloads. Possession of a UUID grants no access. Disclosure of provider metadata, logs, backups and retention must be reviewed when a producer is implemented.

Requester-to-route proximity and actual vehicle/path deviation are different future measurements. Neither exists here. Future structured negotiation may let the requester move closer to the offering path or decline the proposed adaptation. Accepted conditions would belong to a later immutable matching-context model; this migration implements no bargaining, counterproposal or free-form chat.

Precise meeting pin/coordination belongs after activation in a later protected flow. Existing text meeting coordination remains unchanged. No assumption here requires door-to-door transport. Multi-leg passenger chaining remains deferred.

## Closed financial seam and exclusions

A movement-context snapshot is not route evidence. 0021 is unchanged, its `route_evidence_id` remains NULL-only, and no financial reference points at these snapshots. No financial proposal or agreement is issued.

There are no route results, path geometry, distances, deviation, overlap, detour, computed ETA, fuel, tolls or pricing. There is no provider integration, geocoding call, wallet, payment, refund, payout or settlement change. Existing offer creation/acceptance, activation, face verification, reveal, start/end and no-travel behavior is preserved.

## Local checks and independent database review

Run `node supabase/tests/movement_context.test.cjs`, all existing Node suites and both TypeScript checks. Static checks are regression guards, not a SQL parser or proof of PostgreSQL behavior. No lint dependency installation is needed.

`supabase/tests/0022_movement_context_foundation_test.sql` is a rollback-only administrator behavioral test for an isolated database with migrations 0001-0022. It uses temporary fixture functions, exact errors for deferred validators, a clean deferred baseline for each negative, unique named results and an inner rollback restoring every fixture. It compares prior rows, function definitions/configuration/grants and table ACL/RLS/policies. Read every result and the aggregate failure count; unexpected errors abort the script. Never change its final ROLLBACK to COMMIT.

For a separate migration-installation rollback test on an isolated database at 0021, run `node supabase/tests/movement_context.test.cjs --print-installation-rollback` to print a reviewable SQL batch. This command only prints text; it does not connect to a database or write a file. The batch captures prior catalog/data fingerprints in session-local temporary tables before the installation transaction, begins READ COMMITTED, appends the migration without its outer BEGIN/COMMIT, and appends the test without its opening BEGIN/SET TRANSACTION. Its ROLLBACK removes 0022 as well as fixtures. Post-rollback assertions require all five tables and six helpers to be absent and all prior rows/definitions/grants/policies to match; the baseline temporary tables are then dropped. Never send the original migration COMMIT inside an outer transaction: PostgreSQL transactions do not nest. Use a SQL client configured to stop on errors and inspect every named behavioral result. The regular test's internal catalog snapshots alone cannot prove migration non-interference because they are taken after installation.

An independent review should also run two-session races: snapshot versus need/roster edits, snapshot versus intent supersession, snapshot versus access/capacity changes, snapshot versus offer acceptance, competing current versions and opposite lock ordering. Verify blocking followed by rejection/retry, not only a final row count. Single-session rollback tests do not prove concurrency behavior. No database test is executed automatically by the static suite.
