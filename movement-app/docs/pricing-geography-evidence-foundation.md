# 0059 Pricing geography evidence foundation

WE DO NOT CREATE JOURNEYS. This foundation records private, monetary-neutral facts for a possible later pricing policy. It does not change independently intended movement, matching eligibility, consent or the accepted movement lifecycle.

## Meaning and distance

`private.pricing_geography_evidence` records one immutable classification of a qualifying Movement pricing corridor for one exact trusted route-match row and version. `pricing_corridor_distance_meters` is a positive integer measured for that corridor by a future trusted classifier. This migration neither identifies the corridor nor computes its distance.

The offerer's `offering_route_evidence.route_distance_meters` is the complete provider route distance. It is not pricing distance, requester distance, shared-segment distance, pickup/drop-off deviation, overlap or requester ETA. No column default, expression or assertion copies that metric into pricing distance. The future producer must establish an explicit qualifying corridor; it must not substitute the entire route by default.

`pricing_range_supported` is exactly equivalent to distance `<= 100000` metres. Thus 100000 is supported and 100001 is unsupported. An unsupported row retains its actual distance; it is not capped, truncated or rejected merely for exceeding this range. This is only Pricing Policy v1's supported distance range, not a declaration that longer same-state movements are constitutionally invalid, nor proof that a quote is otherwise authorized.

## Ordered events

`geographic_events` is a JSONB array. Each element has exactly two keys:

```json
{"event_type":"core_stage_entry","position_meters":1200}
```

`core_stage_entry` represents entry into a qualifying mapped core transport stage. `major_transport_transition` represents a qualifying mapped transition between major transport areas or facilities along the corridor. These are neutral event categories, not prices. The dataset and operational criteria identifying a qualifying stage or transition remain a future classifier decision; 0059 does not claim to establish geographic truth.

Array order is traversal order from the pricing corridor's beginning. Positions are integer metres between zero and the corridor distance inclusive, in nondecreasing order. Distinct types can occur at the same position; their array order is retained. The same type at the same position cannot be repeated. A type may recur at different positions. No arbitrary extra keys, coordinates, amounts, free-text payloads or duplicated counts are accepted. An empty array represents a continuous corridor with no qualifying events; there is no repeated `continuous_corridor` event.

The sequence is one immutable value because child-row insertion could otherwise append events to an already recorded classification. Shape, vocabulary, position and ordering checks run before insertion and during live validation.

## Binding and provenance

The row snapshots the exact trusted route-match ID/version, movement need, requester, offerer, offering intent ID/version, and offering route ID/version. Cross-table comparisons use `IS DISTINCT FROM` to fail closed. The match itself preserves the exact requester endpoint references and context. As in 0037, the need ID has no foreign key, so deletion of a declaration cannot erase historical evidence.

`state_location_reference_id` references the immutable provider-backed state evidence for the match's requester origin. No state name or provider state identity is accepted independently. The authoritative match assertion calls the current trusted matching context (0052), which includes 0050's checks that all four exact endpoints share the provider namespace, provider state reference and canonical state key. The new evidence must use that exact origin anchor.

`classifier_name`, `classifier_version`, `transport_geography_version` and fixed `evidence_schema_version = pricing_geography_evidence_v1` identify how and against which mapped geography release the classification was produced. Provenance tokens are bounded and structurally validated. They are not an approved-classifier registry: a future trusted producer must establish which classifier and dataset versions are trustworthy. No classifier is selected or implemented here.

## Lifecycle and locking

All facts, including bindings, distance, events, provenance and timestamps, are immutable. Rows cannot be deleted. Positive versions are unique within a need/intent pair; at most one row for that pair is stored as `current`. A later producer must serialize version allocation and supersession. The only permitted changes are `current` to `superseded`, or `current` to `expired` after its expiry. Terminal rows cannot reopen or change terminal state.

Generation, creation and expiry timestamps must be finite. Generation cannot precede the match calculation or be in the future. Creation cannot precede generation or be in the future. Expiry is mandatory, later than creation, and no later than either the requester's effective departure deadline or the match's expiry when present. The inherited match assertion also enforces its dependency expiry bounds.

A stored `current` status alone never proves current eligibility. Future consumers must call `private.assert_pricing_geography_evidence(uuid)` in the same READ COMMITTED transaction before relying on the row. It rejects stale matches, replacement routes, closed/deleted/elapsed requester needs and invalid source context through the existing authoritative assertion. Historical facts remain intact; 0059 does not install source-table triggers or automatic status propagation.

Insertion validates in a BEFORE trigger, before foreign-key locks. The need UPDATE lock follows 0038's serialization boundary. The existing match assertion then owns the requester-endpoints → intent → route lock order. Only afterwards does 0059 lock the match, and live consumption then locks the pricing evidence. It rechecks context after a possible evidence-row wait. The new layer does not call the older route assertion with its different lock order or implement another matching validator. Future writers must acquire context locks before updating existing pricing evidence; multi-context batches require a reviewed consistent ordering.

## Security and exclusions

RLS is enabled without client policies. PUBLIC, anon and authenticated have no table access. Service role has SELECT only. All four private SECURITY DEFINER helpers use an empty search path and have EXECUTE revoked from PUBLIC, anon, authenticated and service_role. Only owner-level setup can currently insert evidence; no operational writer exists. No public RPC, client output, route geometry copy or new application code is introduced.

Explicit exclusions:

- No naira pricing or ₦450/₦850 coefficients.
- No 100% / 50% / 25% monetary weighting or 70/30 financial allocation.
- No financial proposal issuance or financial agreement changes.
- No payment/activation change or change to `accept_movement_offer`.
- No external provider call or operational classifier.
- No client writer or service-role writer.
- No live demand/surge/traffic/weather pricing.
- No public-transport or Bolt fare dependency.
- No multi-leg pricing.
- No >100 km Pricing Policy v1 extrapolation.

## Future dependency sequence and review

1. Review this storage contract and run local SQL installation/rollback, adversarial binding/event tests and concurrent source-replacement tests.
2. Define the qualifying corridor and mapped event criteria, dataset governance, classifier provenance and deterministic replay rules.
3. Add a separately reviewed narrow trusted producer that derives bindings, invokes these validators, allocates versions under the existing lock order and retains unsupported-range results.
4. Add the pricing-policy consumer with explicit out-of-range handling, then separately review any financial proposal/consent integration.

Static Node tests inspect the SQL contract; they do not prove concurrent locking or real geographic accuracy. Local PostgreSQL behavioral validation now also exercises the real triggers, assertions, constraints and application roles, using the existing generated installation/rollback convention. The migration itself remains unchanged and is not installed persistently.

## Local rollback validation

Run from the repository root against the local container only:

```powershell
node supabase/tests/pricing_geography_evidence_foundation.test.cjs --print-rollback | docker exec -i supabase_db_movement-app psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
```

The runner refuses an existing 0059 installation, fingerprints pre-existing data and catalog definitions/privileges, installs the migration body inside one READ COMMITTED transaction, runs `0059_pricing_geography_evidence_foundation_test.sql`, and ends with ROLLBACK. It then independently checks the fingerprints, absence of 0059 objects, and unchanged migration history. Neither the runner nor SQL test writes migration history. Run the generated batch rather than the SQL fixture file alone: the latter assumes transaction-local installation has already happened.

The 2026-09-29 local run passed 134 named SQL assertions with zero failures, plus three external rollback checks. [Complete SQL output, including every named assertion and diagnostic](0059-pricing-geography-sql-results.txt) is retained. Rejected cases run inside rolled-back subtransactions, with separate successful probes proving that the upstream lifecycle transitions used to make dependencies stale are legal. All existing application/auth/migration-history rows are fingerprinted again after fixture creation and after the pricing operations; only the new pricing table changes.

The integer input test rejects the fractional JSON/text representation `1.5` when PostgreSQL parses it as bigint. PostgreSQL itself can round an explicitly cast numeric value before a bigint column receives it; the test does not claim to override PostgreSQL cast semantics. Distinct event types at the same position are allowed; duplicate type/position pairs are rejected.

No genuine 0059 defect was found in these tests. No application code or migration was changed for this validation. The separate concurrency execution below adds two-session evidence; the single-session results alone do not prove concurrency.

## Executed disposable concurrency validation

Run explicitly from the repository root (this integration harness is not included in normal Node test discovery):

```powershell
node supabase/tests/0059_pricing_geography_concurrency.cjs --run-disposable
```

The harness uses only container `supabase_db_movement-app`. It verifies that normal database `postgres` has migration history through 0058 and no 0059 table, and takes the same full data/catalog snapshot used by the rollback runner. It creates a randomly named `pricing0059_race_<12 hex digits>` database from template0, restores a schema-only dump of the installed 0058 baseline, then applies the unchanged 0059 migration with psql. It does not replay 0001–0058 or copy development data or migration-history rows. The installed schema is the baseline under test. Restore requires the existing local `supabase_admin` owner role; fixtures and test operations run as `postgres`. No cluster role or normal-database permission changes are made.

The exact setup command templates are:

```text
docker exec supabase_db_movement-app pg_dump -U postgres -d postgres --schema-only --no-publications --no-subscriptions
docker exec -i supabase_db_movement-app psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose
  stdin: CREATE DATABASE <generated_name> TEMPLATE template0;
docker exec -i supabase_db_movement-app psql -X -qAt -U supabase_admin -d <generated_name> -v ON_ERROR_STOP=1 -v VERBOSITY=verbose
  stdin: schema-only dump
docker exec -i supabase_db_movement-app psql -X -qAt -U postgres -d <generated_name> -v ON_ERROR_STOP=1 -v VERBOSITY=verbose
  stdin: unchanged migration 0059, then transactionally committed test fixtures
```

Seven independent trusted fixture chains reuse the behavioral SQL fixture definitions. Test helpers are made visible across sessions only in the disposable `race0059` schema. Two independent psql processes per race use READ COMMITTED, ON_ERROR_STOP, a 12-second lock timeout, a 15-second statement timeout and a 25-second idle-transaction timeout. Explicit output markers establish transaction milestones. A third observer checks `pg_blocking_pids` before the harness permits the winning transaction to commit; timed polling observes the barrier and does not decide who wins. Marker waits and observer waits also have bounded deadlines.

The successful 2026-09-29 run used database `pricing0059_race_c1063863c352`. [Complete timestamped results](0059-pricing-geography-concurrency-results.json) contain every command, observed lock wait, SQLSTATE/error, assertion, and final pricing/source identity. All seven interleavings passed:

| Race | Exact ordering | Final pricing evidence |
|---|---|---|
| Match, pricing first | A inserts v1 and holds; B waits; A commits; B replaces route and match through the trusted writers and commits | One unchanged stored-current v1 row bound to old route/match v1; live assertion rejects 23514 |
| Match, source first | B replaces route and match and holds; A waits; B commits; A rejects 23514 | No pricing rows |
| Route, pricing first | A inserts v1 and holds; B route writer waits; A commits; B replaces route and commits | One unchanged stored-current v1 row bound to old route v1; live assertion rejects 23514 |
| Route, source first | B route writer replaces and holds; A waits; B commits; A rejects 23514 | No pricing rows |
| Competing versions | A inserts v1 and holds; B attempts v2 and waits; A commits; B rejects 23505 on the one-current index | Exactly one current, live-valid v1 row; no v2 row |
| Need, pricing first | A inserts v1 and holds; B closes the mutable need and waits; A commits; B commits | One unchanged stored-current v1 row; live assertion rejects 23514 |
| Need, source first | B closes the mutable need and holds; A waits; B commits; A rejects 23514 | No pricing rows |

Match replacement invokes the existing need/endpoints/intent lock helper before composing the route writer and match writer. It never directly updates immutable route/match evidence. The optional need race changes only its supported mutable status; it does not fabricate expiry timestamps. For competing versions there is no stale source, so the live assertion must succeed. Where source-first creation is rejected, there is no pricing history to mutate or silently rebind.

All observed waits were PostgreSQL `Lock` / `transactionid`. There were no deadlocks or timeouts, no silent substitutions, and no unrelated financial/alignment/payment writes. Stored-current historical rows are intentionally not auto-superseded by source changes; future consumers must still call the live assertion. Full immutable pricing records before and after replacement were equal.

Cleanup ran `DROP DATABASE <generated_name> WITH (FORCE)` against the generated, pattern-checked name, verified absence in `pg_database`, and verified the normal database's full snapshot was unchanged. 0059 remains absent there. The initial restore attempt as postgres failed on Supabase schema ownership before any race; that disposable database was also destroyed and normal-database integrity verified. No production migration changes were needed.

## Manual two-session concurrency review (not executed)

The original manual procedure below is retained for review; it was not executed. Use the new scripted harness above for the validated procedure. These manual commands require a **separate disposable database** with committed migrations through 0059 and a committed, valid, unexpired trusted fixture chain. Do not run its installation or commit variants against the current local database. Objects installed by the rollback runner are uncommitted and invisible to another session, and disappear on rollback; its fixture IDs cannot be reused here.

Open two owner-role psql sessions to the same reviewed disposable database, using its explicit connection string:

```powershell
psql -X "$env:PRICING_CONCURRENCY_DISPOSABLE_DSN" -v ON_ERROR_STOP=1
```

In both sessions, use the **same** fixture match UUID in place of `REVIEWED_MATCH_UUID`. Recreate the disposable fixture before each commit variant, since superseded source records are immutable history and cannot be reopened.

```sql
\set match_id 'REVIEWED_MATCH_UUID'
SELECT m.movement_need_id AS need_id,
       m.offering_movement_intent_id AS intent_id,
       m.route_evidence_id AS route_id
FROM private.trusted_route_match_evidence m
WHERE m.id=:'match_id'::uuid
\gset
SELECT private.assert_trusted_route_match_evidence(:'match_id'::uuid);
SELECT count(*) AS existing_pricing_rows
FROM private.pricing_geography_evidence
WHERE movement_need_id=:'need_id'::uuid
  AND offering_movement_intent_id=:'intent_id'::uuid;
-- Require existing_pricing_rows = 0 for these version 1/2 tests.

PREPARE pricing_probe(uuid, integer) AS
INSERT INTO private.pricing_geography_evidence (
 route_match_evidence_id,route_match_evidence_version,movement_need_id,
 requesting_member_id,offering_member_id,offering_movement_intent_id,
 offering_intent_version,route_evidence_id,route_evidence_version,
 state_location_reference_id,version,evidence_schema_version,
 classifier_name,classifier_version,transport_geography_version,
 pricing_corridor_distance_meters,pricing_range_supported,geographic_events,
 generated_at,expires_at
)
SELECT m.id,m.version,m.movement_need_id,m.requesting_member_id,
 m.offering_member_id,m.offering_movement_intent_id,m.offering_intent_version,
 m.route_evidence_id,m.route_evidence_version,m.requester_origin_location_reference_id,
 $2,'pricing_geography_evidence_v1','manual-test','v1','manual-v1',
 100000,true,'[]'::jsonb,clock_timestamp(),
 least(clock_timestamp()+interval '5 minutes',m.expires_at,
       coalesce(n.latest_departure_at,n.earliest_departure_at))
FROM private.trusted_route_match_evidence m
JOIN public.movement_needs n ON n.id=m.movement_need_id
WHERE m.id=$1
RETURNING id,version,status;
```

Confirm the fixture has several minutes remaining before its deadline and expiry. Each race follows this sequence: run session A's block and leave it open; run session B's block and observe it waiting; issue the indicated end command in A; inspect B's result, then `ROLLBACK` B even after an expected error. A timeout or deadlock is not a passing result. In interactive psql an expected error with ON_ERROR_STOP leaves the failed transaction available for explicit ROLLBACK.

**Race 1: exact match supersession.** Session A:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='30s';
SELECT id FROM public.movement_needs WHERE id=:'need_id'::uuid FOR UPDATE;
UPDATE private.trusted_route_match_evidence
SET status='superseded' WHERE id=:'match_id'::uuid;
-- Leave open; start B below.
```

Session B, also used for race 2:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='30s';
EXECUTE pricing_probe(:'match_id'::uuid,1);
-- After A ends and this returns (or fails):
ROLLBACK;
```

In A, `ROLLBACK;` should release B to insert successfully. On a fresh fixture, repeat with A `COMMIT;` (disposable database only): B should fail with SQLSTATE 23514 because the exact match is no longer current. This uses the legitimate lifecycle transition and the need-first serialization boundary used by writer 0038.

**Race 2: route replacement through the existing trusted writer.** Session A:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='30s';
SELECT w.*
FROM private.offering_route_evidence r
CROSS JOIN LATERAL public.record_offering_route_evidence_for_server(
 r.offering_movement_intent_id,r.provider_namespace,r.provider_product,
 r.provider_version,'manual-0059-'||gen_random_uuid()::text,
 r.route_shape,r.route_distance_meters,r.route_duration_seconds,
 clock_timestamp(),r.expires_at
) w
WHERE r.id=:'route_id'::uuid;
-- Leave open; start B using the block above.
```

A `ROLLBACK;` should let B insert against the original route. On a fresh fixture, A `COMMIT;` should make B fail with SQLSTATE 23514: the match still names the replaced route. This exercises writer 0043's intent-first UPDATE lock against 0059's inherited intent SHARE lock.

**Race 3: competing current versions.** Session A:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='30s';
EXECUTE pricing_probe(:'match_id'::uuid,1);
-- Leave open; start B below.
```

Session B:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='30s';
EXECUTE pricing_probe(:'match_id'::uuid,2);
-- After A ends and this returns (or fails):
ROLLBACK;
```

A `ROLLBACK;` should allow B's version 2 insert. On a fresh fixture, A `COMMIT;` should make B fail with SQLSTATE 23505 on the one-current partial unique index. Versions need to be positive and unique, not contiguous. Also review reverse scheduling for source races: hold A's pricing insert open, start B's source transition/replacement, verify B waits on the protected dependency, then roll back both. These are expected outcomes from lock inspection, not observed concurrency results.
