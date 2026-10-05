# 0082 fixture timestamp verification

Production 0082 remains unchanged at SHA-256
c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976.
Nothing is persistently installed; source verification uses transaction rollback,
and concurrency uses a disposable clone.

## Diagnosis and limits

The old focused-10-zero-false failure occurred in the inherited 0072 fixture
while public.create_offering_movement_intent was constructing its parent row.
0034 captures v_now with clock_timestamp(), inserts created_at=v_now and
expires_at=NULL, inserts the two location children, then explicitly validates.
0022 private.protect_movement_context_record rejects created_at greater than
its subsequent clock_timestamp(), or a non-NULL expiry at/before its clock.
Because expiry is NULL, only the creation-time predicate fits this intent path.
The old failure did not record the actual compared instants. Its exact temporal
cause remains unproven; neither a host-clock jump nor a production settlement
bug has been established. The separate old provider rejection also lacks its
compared timestamps. Passing new stress cannot retrospectively prove a cause.

Failure-only diagnostics now record the exact predicate clocks, full candidate
row, owning endpoint rows, scenario, isolation, transaction/statement clocks,
and synthetic offsets. Provider diagnostics include the full persisted selected
parent, request UUID, input resolution/expiry and producer validation instant.
Diagnostic wrappers return their clock argument unchanged. Replacements exist
only in rollback transactions/disposable clones and retain original exceptions.

## Chain and clock audit

0082 stress calls 0082 fixtures, which compose 0081/0080/0079/0078/0077 and
0073/0072 setup. The inherited fixture constructs members, vehicle and four
endpoint chains, requester need/confirmed two-person roster, offering intent,
trusted route, trusted match, availability, genuine offer, trusted movement
snapshot, pricing geography/quote, proposal and requester materialization.
prepare_completion uses normal face checks, top-up, funding hold, activation,
coordination entry, meeting-point selection, offerer start and requester start.
Fixture-only stress stops there, before either completion RPC.

Before: endpoint selection proof time and expiry used independent PostgreSQL
clock calls (-1 minute and +4 hours). Resolution time and requested expiry
also used independent calls. After: selection inputs share one PostgreSQL
anchor. Only after selection finishes, the helper reads that exact parent's
server-created created_at; resolution uses that persisted instant and the
four-hour expiry derived from the original selection anchor. This avoids a second future-facing resolution input and guarantees
resolution cannot predate its selected parent. The producer still validates
against its own clock, owns target creation time, and caps expiry normally.
No lifetimes are broadened and no protected rows are repaired.

A universal anchor before all normal producers would be incorrect: descendant
route/match evidence must follow server-created parents. Each such helper
already captures one PostgreSQL instant after its parent producer, deriving
route expiry +3 hours and match expiry +2 hours. Need/intent departure windows
use statement_timestamp()+1/+2 hours; normal producers own their creation
instants. Snapshot, pricing, consent, funding, activation and start timestamps
remain producer-owned. No host timestamp is persisted; JavaScript Date.now()
is used for concurrency deadlines/barriers only. No old path's timestamps are
reused. The 2/3/4-hour evidence lifetimes exceed the 60-second per-query timeout.
Short-expiry adversarial cases occur outside the setup slices used by stress.

## Validation and remaining blocker

Classification: **B ? NOT CLEARED**. No persistent installation is performed.
All stress loops stop at the first failure and never retry.

- Revised fixture-only audit: 200/200 passed, no completion actions;
  source/data/catalog/ACL/RLS/history fingerprint unchanged.
- Provider audit: paths 1?182 passed; path 183 stopped before its provider
  assertions, in the later 0078 fixture materialization step. The rejection was
  SQLSTATE 23514, "Proposal evidence cannot be future-dated". Fingerprint
  restoration passed. This is not a completed 200-path provider clearance.
- The diagnostic probe then exposed a test-only error in the initial anchor
  edit: selected-location row expiry is NULL by design, unlike its selection
  proof's four-hour expiry. Copying the row expiry to the resolver made expiry
  unbounded, and the provider check's NULL-sensitive IF did not reject it.
  The final edit keeps the finite selection-anchor +4-hour expiry separately,
  reads only the selected parent's created_at, and explicitly rejects NULL or
  non-finite resolution expiry. Consequently the earlier 200 fixture passes
  and 182 provider passes do NOT validate the final fixture revision.
- No transient failure was retried. The final revision still requires the
  requested 200 fixture and 200 provider paths before downstream clearance.
- The new materialization rejection comes from private.protect_financial_proposal
  (0073 inherited guard) comparing offering_accepted_at, requester_accepted_at
  or materialized_at against separate clock_timestamp() values. 0077 writes
  these instants through its normal producer. Exact failed values were not
  captured, so the triggering field and temporal cause remain unproven.
  New failure-only instrumentation records each actually evaluated comparison
  clock, candidate/previous proposal, snapshot and quote, retaining the original
  short-circuit comparisons and SQLSTATE. No failure reproduction was attempted.
- Required new 50-normal/30-zero stress, full mode matrix and clean concurrency
  were not run because the prerequisite fixture/provider sequence failed.
  Previously reported runs are historical evidence, not this clearance.
- Targeted portable: 257 passed, zero failed/skipped. TypeScript passed.

An initial unchanged-fixture 200-path audit passed. A redundant unchanged-
fixture audit was deliberately interrupted after 21 passes when the test-only
anchor edit became available; it is not counted as a completed validation run.

- Full Node: 1,602 total; 1,601 passed, zero failed, one skipped.
- Final diagnostic smoke test passed: intentional future resolution and creation
  retain SQLSTATE 23514, exact predicate clocks are printed, normal endpoints
  retain finite four-hour resolution expiry, and full application fingerprint
  restoration passes. It is not a stress rerun or a materialization failure
  reproduction. The new proposal diagnostic compiled but its failure branch
  has not been exercised.
