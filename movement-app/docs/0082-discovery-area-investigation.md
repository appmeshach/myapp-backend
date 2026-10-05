# 0082 isolated discovery-area investigation

Classification: **B ? NOT CLEARED**. Production 0082 and 0001?0081 are unchanged.
No persistent source installation, remote operation or migration-history edit.

## Actual run and captured proof

The isolated --discovery-only runner passed 30 fresh paths, then stopped at
**discovery-only-31**, without retry. It failed BEFORE discovery-area insertion,
in private.protect_movement_context_record() on the resolved-location INSERT.
SQLSTATE 23514: Movement context creation time or expiry is invalid.

| Captured value | Exact value |
| --- | --- |
| Candidate resolved-location ID | df6eaf63-561f-453e-9987-37c0733193fb |
| Selected parent ID | 982a32f3-6e07-49be-b4f0-7aada548ca2b |
| Producer-owned candidate created_at | 2026-10-04T16:36:38.138255+00:00 |
| Later exact creation-guard clock | 2026-10-04T16:36:38.132917+00:00 |
| Notice-emission clock | 2026-10-04T16:36:38.133987+00:00 |
| Statement clock | 2026-10-04T16:36:38.099350+00:00 |
| Transaction clock | 2026-10-04T16:36:38.061406+00:00 |
| Selected parent creation/resolution input | 2026-10-04T16:36:38.107670+00:00 |
| Finite requested/target expiry | 2026-10-04T20:36:38.104156+00:00 |
| Isolation | read committed |
| Future creation delta | **5,338 microseconds**, calculated in PostgreSQL |

The exact failing comparison is NEW.created_at > the recorded guard clock.
Expiry comparison was short-circuited and not evaluated. The wrapper returns
its original captured clock argument unchanged. The installed producer's
pg_get_functiondef confirms v_now := clock_timestamp() immediately before the
INSERT, with created_at=v_now; evidence recorded_at would also copy v_now.
The installed guard independently evaluates clock_timestamp() afterward.
The created_at column has six fractional digits, confirmed from the catalog.
Thus this path proves a backward clock observation during normal PostgreSQL
producer/guard execution. There is no explicit future creation offset, Node
round-trip, rounding to milliseconds or transaction-start comparator involved.
The underlying reason for the clock regression (host/container clock source,
time adjustment or any other mechanism) remains undiagnosed.

The complete original notice/error/stack and parsed creation diagnostic are in
0082-discovery-area-stress-result.json. Source/data/catalog/ACL/RLS/migration-
history fingerprint restoration passed. The historical discovery-area failure
at proposal-only-241 was NOT reproduced; its exact subpredicate remains unknown.
Do not infer its cause solely from this separate captured failure.

## Discovery predicate matrix and timestamp provenance

Failure-only discovery diagnostics now report every one of the fifteen original
predicates as name, boolean, left value and right/expected value. They include
full discovery, resolution, selected/resolved-location rows, label length,
exact evaluated guard clock, statement/transaction clocks, isolation, scenario,
parent delta and future delta. No new clock is substituted into the validator;
original values, short-circuit expression and exception remain intact.
The discovery failure branch was not exercised in this run because the earlier
creation guard rejected first.

| Field | Origin | Statement/transaction relation |
| --- | --- | --- |
| e.recorded_at | Explicit v_now in normal 0026 producer, assigned from clock_timestamp() after source locks/version lookup | Separate internal INSERT after resolved-location INSERT; same transaction |
| d.recorded_at | 0040 table DEFAULT clock_timestamp(); normal wrapper omits recorded_at | Later internal INSERT after resolution producer returns; same outer RPC/transaction |
| Validator clock | Fresh clock_timestamp() in real assertion | AFTER discovery INSERT, same transaction |

Neither recording time is fixture-supplied, JavaScript-originated, trigger-
generated, a copied timestamp from another session, or parsed back from Node.
Resolution evidence copies the producer's PostgreSQL anchor. Discovery defaults
to its own later clock. Separate internal SQL statements occur within one outer
RPC; no commit separates parent and child. Normal source ordering therefore
expects e.recorded_at <= d.recorded_at <= the assertion clock, but source order
alone cannot guarantee time order when actual clock observations decrease.
This run proves such a decrease earlier in that same provider chain, not either
specific discovery recording comparison from the previous failed run.

## Non-time guarantees and row-selection audit

The core producer writes provider_resolved/resolved, validated finite coordinates,
namespace/place/version and a fresh returned target UUID. Its normal wrapper
uses returned evidence/target IDs to write discovery evidence, validates the
trimmed nonempty bounded label, and uses the schema default exactly
trusted_location_discovery_area_v1. The assertion selects discovery by its
primary-key resolution_evidence_id, resolution by primary-key id, and location
by exact target id, each INTO STRICT. No LIMIT 1 or provider-reference lookup
is involved. The isolated helper selects the persisted parent using selected
UUID and locates resolution by its unique resolved_location_reference_id.

Every isolated path creates a fresh auth/member UUID, producer-request UUIDs,
and scenario-plus-UUID provider place reference. Temporary helper state is
transaction-local, and each path rolls back. Owner selection is exact; no old
path timestamp is reused. No alias/unqualified-column defect or cross-talk was
found in these selectors. Original fixture provider references are repeated
labels, but source selection is by fresh ID and request UUID, not those labels.
The prior diagnostic snapshot alias ambiguity was already corrected and tested.

## Fix decision and validation gate

No safe fixture-only construction fix is established for the captured failure:
the offending created_at is generated inside the normal producer. Replacing
that producer clock, altering historical guards, backdating protected evidence,
adding sleeps or retrying would change the test contract or hide the failure.
No such action was taken. 0082 settlement is not involved or implicated.

The required 1,000 discovery, 500 provider, 500 proposal, 200 generic fixture,
50 normal/30 zero settlements, full mode matrix, 50 complete behavioral executions
and clean concurrency clearance remain incomplete. Downstream DB runs were not
started after the first isolated failure. Final portable/integrity results follow.

Final targeted portable verification: 259 passed, zero failed/skipped.
TypeScript passed. No paid dependencies were added or invoked.
Full Node: 1,604 total, 1,603 passed, zero failed, one skipped.
Tracked and all five intended-file whitespace checks passed.
0082 SHA: c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976.
Historical normalized 81-file hash:
488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223.
Nothing installed, staged, committed, pushed or changed remotely.
