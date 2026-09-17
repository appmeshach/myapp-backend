# 0025 Trusted Route Producer Boundary

0025 adds one narrow server-only RPC for recording trusted
`private.offering_route_evidence`.

It does not choose a routing provider or make network calls. It does not add
requester matching, detour calculations, pricing, payments, alignments, journeys,
or multi-leg routing.

The trusted server supplies only the intent ID and provider output. PostgreSQL
derives the offering member, origin and destination bindings, evidence version,
fixed schema/shape versions, and current/superseded lifecycle.

RPC:
`public.record_offering_route_evidence_for_server(...)`

Security:
- SECURITY DEFINER with empty search_path.
- EXECUTE only for service_role.
- No direct service_role INSERT/UPDATE/DELETE grant on route evidence.
- No authenticated or anon execution.
- Existing 0023 validators remain authoritative.

0025 replaces `private.assert_geojson_linestring_v1(jsonb)` forward, without
editing 0023. Its object, required-field, array, numeric-coordinate and range
checks reject SQL NULL and missing/JSON-null fields explicitly. Array lengths
are checked only after the corresponding array type has been established.
The replacement retains SECURITY DEFINER, an empty search_path and no execute
privileges for PUBLIC, anon, authenticated or service_role.

Idempotency:
- Exact retry of the same current provider reference returns the existing row.
- Reuse of a provider reference with changed content/context fails closed.
- Replay of superseded evidence fails closed.
- New provider references create the next version and supersede the previous current row.

Eligibility uses fresh `clock_timestamp()` readings after intent, endpoint and
existing provider-reference locks. Exact retries rerun
`private.assert_offering_route_evidence` immediately before returning, so expired
or otherwise ineligible evidence cannot bypass authoritative validation.

After each insert the writer explicitly validates the row and forces only
`private.offering_route_evidence_complete` IMMEDIATE while the version is current.
It then sets that constraint back to its default DEFERRED mode. This mode change
is transaction-wide (including if the caller previously chose IMMEDIATE); it does
not affect other constraints. Each writer-created insert is already checked
before return, allowing later calls in the same transaction to supersede it.

Concurrency:
- The intent FOR UPDATE lock serializes writers for the same intent through
  version calculation, supersession and insertion. No advisory lock is needed.
- The existing unique indexes enforce one current row, unique intent/version and
  global provider-reference identity. Competing first inserts using one provider
  reference for different intents can fail with unique_violation; the failed
  statement rolls back its changes. Existing mismatched references fail closed.
- The writer locks intent, endpoints, then evidence. Its validator reuses those
  locks. Owner-level code that independently locks evidence before intent must
  avoid an inverted lock order. Multi-intent transactions should lock intents in
  a consistent order; database deadlock/serialization errors require retrying the
  transaction. Ordinary one-intent writer calls do not require extra locks.

Local verification:
- `node supabase/tests/trusted_route_producer.test.cjs` checks the SQL source;
  passing static checks does not prove database execution.
- The rollback-only SQL behavioral test uses distinct dollar tags, tests malformed
  shapes directly and through the writer, tests superseded-reference rejection,
  and forces the route constraint after repeated calls in the same transaction.
  It contains 42 result checks. It must run as a fixture-capable database owner
  when database testing is separately authorized. It does not simulate concurrent
  sessions or lock waits.
- No SQL was executed against Supabase during this local repair.
- Local results: 0025 static checks 34/34, 0023 checks 21/21, 0024 checks
  14/14; application and Edge Function typechecks pass. The 0022 suite now
  passes 25/25 after explicitly adding migration 0025 to its sanctioned-consumer
  allowlist as a legitimate reader of the movement-context foundation. The
  assertion continues to reject other unauthorized consumers.

Still deferred:
- actual routing provider/adapter;
- provider licensing/retention implementation;
- endpoint snapping semantics;
- requester-to-route proximity;
- road detour/deviation;
- structured route-relative YES/NO negotiation;
- pricing;
- multi-leg chaining.
