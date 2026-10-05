# 0082 proposal evidence investigation

This investigation does not change production 0082, historical migrations,
Supabase migration history, or the persistent database catalog. All diagnostic
DDL/data is rolled back; any concurrency verification uses a disposable clone.

## Exact rejection and call graph

The installed private.protect_financial_proposal() body was read from pg_proc
before the 500-path audit. It retains the exact 0073 three-field clock guard.
The source definition is 0073 lines 185?253. The exact error branch is:

    IF NEW.offering_accepted_at>clock_timestamp() OR NEW.requester_accepted_at>clock_timestamp()
      OR NEW.materialized_at>clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal evidence cannot be future-dated';
    END IF;

It runs on a substantive UPDATE after immutable-history/write-once checks and
current/unexpired eligibility. SQL OR short-circuiting may leave subsequent
clock comparisons unevaluated. All three fields belong to
private.financial_proposals. NULL comparisons do not establish a violation.
Only these three predicates raise this exact message in the active definition.
Neither statement_timestamp(), transaction_timestamp()/now(), proposal creation,
source creation nor expiry is the comparator in this branch.

Direct assertions on every candidate row:
- assert_financial_proposal_quote_binding (0070): exact quote identity/version;
  finite proposal lifetime, created_at >= quote.created_at,
  created_at < expires_at <= quote.expires_at. No clock comparison.
- assert_financial_proposal_movement_context_binding (0073): exact snapshot
  identity/version/facts; created_at >= snapshot.created_at and finite
  created_at < expires_at <= snapshot.expires_at; historical exact offer ID.
  No clock comparison.
- assert_financial_proposal_source_compatibility (0073): quote/snapshot need,
  members, intent, pricing geography, matches, route and endpoint identities.
  No temporal comparison.

INSERT additionally calls assert_movement_offer_availability_binding (0045),
assert_pricing_quote (0061 and later boundary definitions), and
assert_movement_context_snapshot (0022 and later definitions), then revalidates
availability/quote after dependency locks. Those live validators may reject
other stale/invalid source evidence with different messages; they do not raise
this exact consent/materialization future-date error. INSERT itself checks
created_at <= clock_timestamp() and expires_at > clock_timestamp() separately.
The UPDATE current/unexpired check separately compares expiry to clock_timestamp().

Requester materialization (0077) also explicitly calls historical binding,
context, roster and materialization assertions and validates source offer,
quote and snapshot. These enforce graph and consent ordering with distinct
errors. Foundation row CHECK constraints require consent >= proposal creation,
requester consent >= offering consent, both consents < expiry and materialization
>= both consents. Normal 0077 construction additionally requires materialization
< expiry. None changes the comparator in the exact rejecting guard above.

## Timestamp provenance

| Evidence field | Origin | Persisted? | Clock domain | Ordering requirement |
| --- | --- | --- | --- | --- |
| proposal.created_at | 0074 issuer, new independent clock_timestamp() after dependency validation | Yes | PostgreSQL timestamptz | >= quote/snapshot creation; <= insertion guard clock |
| proposal.expires_at | 0074 LEAST(quote.expires_at,snapshot.expires_at) | Yes | Copied PostgreSQL parents | > proposal creation; bounded by both sources; unexpired for construction |
| proposal.offering_accepted_at | 0076 accepted_at := clock_timestamp(), after live locks/validation | Yes; reused unchanged in requester update | PostgreSQL independent clock | >= proposal.created_at, < expiry, <= its own clock_timestamp() guard comparison |
| proposal.requester_accepted_at | 0077 accepted_at := clock_timestamp(), before legacy operational consumption | Yes on final proposal UPDATE | PostgreSQL independent clock | >= offering consent/creation, < expiry, <= its own guard comparison |
| proposal.materialized_at | 0077 completed_at := clock_timestamp(), after agreement/components/consents | Yes on final proposal UPDATE | PostgreSQL independent clock | >= both consents, < expiry, <= its own guard comparison |
| snapshot.created_at/expiry | Normal 0072 trusted producer; expiry bounded by legitimate sources | Yes | PostgreSQL persisted source | Proposal creation/expiry bounded by snapshot |
| quote.created_at/expiry | Normal quote producer, bounded by geography/source evidence | Yes | PostgreSQL persisted source | Proposal creation/expiry bounded by quote |
| endpoint resolution time | Final 0082 fixture reads exact selected parent's created_at | Yes in normal resolution producer | Copied PostgreSQL parent | selected.created_at <= resolved_at <= resolved.created_at |
| endpoint requested expiry | PostgreSQL selection anchor +4 hours | Yes in resolution evidence | PostgreSQL anchor plus interval | finite, > target creation; remains <= original bounded lifetime |
| route/match time and expiry | Per-helper clock captured after its parent, +3/+2 hours | Yes through trusted producers | PostgreSQL anchor plus interval | parent precedes child; descendant expiry parent-bounded |
| need/intent departure windows | statement_timestamp()+1/+2 hours | Yes | PostgreSQL statement anchor plus interval | legitimate future departure window; not proposal consent timestamps |

## JavaScript precision and transaction clocks

The stress path builds SQL from fixtures and sends it as text via docker/psql.
Consent, requester acceptance, materialization, source/quote/snapshot IDs and
versions pass between PostgreSQL functions/temporary tables entirely inside
one rollback transaction. No consumed evidence timestamp is returned to Node,
parsed into Date, and sent back. Date.now() appears in concurrency deadlines/
barriers only. Date.parse() in the separate diagnostic smoke test reads notices
for assertions and never sends those values back. Therefore JavaScript
millisecond rounding, timezone normalization and upward serialization are
excluded for this path by the inspected data flow. PostgreSQL textual formatting
inside SQL preserves its own precision; diagnostic GUC clock strings are parsed
back inside PostgreSQL solely to report the exact comparison delta.

Each fresh path is one transaction, so transaction_timestamp() can be older
than later clock_timestamp() values. The rejecting three-field guard uses
clock_timestamp() independently for each evaluated field, not now() or the
transaction timestamp. Thus the proposed transaction-start-versus-later-clock
mismatch does not explain this exact branch. Actual captured failure values
are still required before naming a temporal root cause; no clock jump is assumed.

## Diagnostic and runner changes

The test-only guard retains its comparisons and short-circuit order. Its clock
wrapper returns the original captured value unchanged. Failure notices include
candidate/previous proposals, versions/IDs and full snapshot/quote/geography/
match/route/location/provider graph, every evidence timestamp, each evaluated
comparison clock, statement/transaction/diagnostic clocks, isolation and fixture
identity. failed_predicates identifies the true comparison; deltas_microseconds
uses PostgreSQL interval arithmetic. Unevaluated comparisons remain NULL.
Definitions are restored through rollback or disposable database deletion.

--proposal-only runs 500 fresh normal-component paths, stopping immediately
after normal requester materialization. It does not load 0082 migration DDL or
call funding, activation, coordination/start, completion or settlement routines.
It drains ordinary pending constraints, asserts the exact materialization graph
and three components, rolls back each path, stops on the first failure without
retry, and verifies the application data/catalog/ACL/RLS/history fingerprint.

## Results and limitations

Classification: **B ? NOT CLEARED**.

The focused 500-path run passed paths 1?240, then stopped at proposal-only-241
without retry. The failure occurred before proposal construction/materialization,
inside 0040 private.assert_trusted_location_discovery_area(uuid), raised from
normal provider resolution. SQLSTATE 23514: "Trusted location discovery area
evidence is invalid". Application data/catalog/ACL/RLS/history fingerprint
restoration passed. No 0082 source was loaded or completion action called.
The previous proposal future-date error was NOT reproduced. Its offending
field, timestamp, comparator value and delta remain unknown.

Discovery validation rejects incorrect resolution ID, source/status, missing
coordinates/provider metadata, invalid schema/label, non-finite recorded_at,
recorded_at < resolution evidence recorded_at, or recorded_at > clock_timestamp().
0040 discovery recorded_at defaults to clock_timestamp(); 0026 resolution
recorded_at copies the normal producer's v_now. This is also a PostgreSQL-only
flow. Exact values from path 241 were not captured by the then-existing notices,
so neither temporal predicate nor a metadata predicate is proven responsible.
Additional rollback-only diagnostics now report the discovery/parent/location
rows, all predicate booleans and exact compared clock/deltas for a future audit.
That failed stress path was not retried after instrumentation.

An intentional future-consent negative test exposed a diagnostic-only alias bug:
to_jsonb(s) conflicted with the original guard's DECLARE s snapshot variable,
masking the original rejection with 42702. The snapshot alias is now uniquely
named diagnostic_snapshot. After this deterministic harness fix, the controlled
negative test passed, retained 23514 and the original error, reported offering
consent as true and the two unevaluated comparisons as NULL, printed the complete
evidence graph and positive PostgreSQL delta, and restored the fingerprint.
These deliberately synthetic values do NOT establish the original failure's
root cause. The generic diagnostic smoke test also passed and restored its
fingerprint. Discovery diagnostic DDL compiled and normal provider calls passed;
its new rejection branch has not been exercised.

No fixture timestamp construction was changed during this investigation. No
proven temporal root cause or production 0082 defect was found. No arbitrary
backdating, clock-domain substitution, lifetime broadening, validator weakening,
persistent installation or history edit was performed.

Required new 200-provider, 200-generic fixture, 50-normal, 30-zero, mode matrix,
50-execution behavioral stress and clean concurrency checks were not run after
the prerequisite failed. Prior reported passes remain historical evidence.

Final portable/integrity verification:
- Targeted: 258 passed, zero failed/skipped.
- Full Node: 1,603 total, 1,602 passed, zero failed, one skipped.
- TypeScript: passed.
- 0082 SHA-256 unchanged:
  c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976.
- Historical normalized 81-file hash unchanged:
  488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223.
- No paid dependencies added/invoked. Nothing installed, staged, committed,
  pushed, changed remotely, or manually written to migration history.
