# 0090: Trusted Requester Movement Priority Integration

We do not create journeys. We connect journeys that were already going to happen.

Requester incoming-offer discovery now applies the private requester policy introduced in 0089. Eligibility decides who enters the pool; priority decides who rises. The requester manually chooses an offer.

## Eligibility before priority

`public.discover_masked_offers_for_my_need(uuid, integer)` requires READ COMMITTED, a real authenticated member, ownership of the requested need, and a non-null limit between 1 and 50. Foreign and missing needs produce the same denial. Only `authenticated` receives execution permission; existing direct `anon` and `service_role` grants are removed.

Pending offers for that need are traversed deterministically by creation time and UUID. Each candidate calls the existing `private.assert_movement_offer_availability_binding(uuid)` without duplicating its eligibility logic. Projection and scoring follow successful validation. Expected eligibility failures skip the candidate; unexpected errors, deadlocks and cancellations propagate.

Each candidate runs in a subtransaction. The internal `ZX090` control signal rolls that subtransaction back, releasing its canonical validation locks before another candidate is inspected. Local projected values and scores survive rollback. Discovery retains no candidate locks in the caller's enclosing transaction.

### Audited eligibility exceptions

The assertion dependency audit covered the exact installed 0089 baseline bodies of `assert_movement_offer_availability_binding`, `lock_offer_availability_intent`, `assert_movement_offer_route_match_binding`, `assert_trusted_route_match_evidence`, `get_trusted_matching_context_for_server`, `assert_offering_movement_intent`, `assert_geojson_linestring_v1`, `assert_state_bound_matching_context`, `assert_trusted_location_state_evidence`, `canonical_nigerian_state_key`, `assert_offering_movement_availability` and `assert_offering_route_evidence`. The disposable harness pins that complete baseline catalog before replacing only the discovery RPC.

SQLSTATE 23514 skips a candidate only for these exact messages:

| Message | Existing eligibility meaning |
|---|---|
| `Insufficient eligible availability for the complete requester group` | Offer/need lifecycle or group capacity no longer qualifies after validation and locks. |
| `Trusted route-match evidence is not current and unexpired` | Match evidence was superseded or expired. |
| `Movement need is not available for matching` | Need stopped being discoverable or its departure window elapsed. |
| `Movement need already has an active or completed alignment` | Another connection consumed the need's eligible lifecycle. |
| `Offering movement intent is not current and unexpired` | Matching-context intent lifecycle or expiry is stale. |
| `Offering intent is not current and unexpired` | Direct intent validator rejects stale lifecycle or expiry. |
| `Current trusted offering route evidence is unavailable` | No current route remains for the intent; superseding a route can cause this. |
| `Offering route evidence is not current and unexpired` | The exact availability route was superseded or expired. |
| `Availability requires active vehicle access and sufficient capacity` | Vehicle access was revoked or current vehicle capacity cannot support availability. |
| `Availability is not open and eligible` | The existing availability eligibility gate rejects closed/full/withdrawn capacity, elapsed support or departure, or support outside its live dependency bounds. |

Every other 23514 propagates. Exact graph/member/version/endpoint/state/shape mismatches, invalid immutable receipts, impossible expiry provenance and unexpected invariant errors are not added to this list. Some older validators combine ownership/integrity and expiry under one message: `Offering intent location owner or expiry does not match`, `Offering route evidence is not eligible for matching`, `Offering route evidence intent is not eligible`, and `Offering route evidence requires resolved eligible endpoints`. Those ambiguous messages conservatively propagate, even when expiry could be the cause; discovery does not duplicate their checks to infer which branch failed. Thus genuine route-match, intent, route, need and availability lifecycle failures are skipped through their unambiguous gates, while ambiguous dependency failures remain fail closed.

`no_data_found` is no longer caught. The chain uses `SELECT INTO STRICT` for immutable availability/route-match bindings, trusted evidence, state receipts and referenced principals. A missing row can represent broken provenance or a programming error, not merely normal lifecycle staleness. Lifecycle invalidation preserves these rows and raises the explicit eligibility messages above.

The behavior suite injects `23514 / unexpected invariant failure` into the canonical assertion and requires a failed RPC result with the exact unchanged SQLSTATE and message. It also checks missing strict dependencies and representative corruption/ambiguous messages, while retaining XX000, deadlock, cancellation, unexpected P0001 and authorization error propagation tests. The portable test pins the exact message list, requires the fallback `RAISE`, and rejects blanket 23514 or `no_data_found` continuation.

## Requester policy and evidence

`private.movement_priority_v1` receives `requester_initiated_v1`: history 35%, reputation 40%, waiting 25%, with a 60-minute waiting constant. Completed history comes from `private.completed_movement_principals` for the offering member; rating sum and count come from `private.completed_movement_ratings` for that reviewed member. Those aggregates share the candidate cursor's statement snapshot.

One `clock_timestamp()` sample supplies ranking time. Waiting is `max(0, minutes between that sample and movement_offers.created_at)`. Equal or regressed clock observations yield zero waiting without invalidating historical offers. The existing eligibility assertion separately owns live lifecycle policy checks.

The complete eligible pool is sorted by priority descending, offer creation time ascending, then UUID ascending. The requested limit is applied last. Stale earlier offers cannot consume visible slots.

## Unchanged API and exclusions

The RPC signature, default limit of 20, and all 16 existing public fields retain their order and types. Priority and private provenance remain internal. Existing age, vehicle, verification, area and public display aggregates remain visible but never influence ranking. The three protected production client files remain unchanged and consume server order.

Discovery creates no operational, financial, notification, behavior, review or configuration records. It does not select, reserve, activate, settle or pay automatically. The 0088 commercial boundary is unchanged. No paid dependency is added. Automatic matching, further discovery surfaces, new ranking signals and public score explanations are deferred.

## Validation

Portable tests cover migration integrity, the exact API, authorization, private evidence, narrow exceptions, lock release, temporal clamping and absence of writes. Disposable PostgreSQL tests cover real completion/rating evidence, lifecycle invalidation, ownership, ordering, propagated unexpected errors and unchanged operational/financial fingerprints. Concurrency tests exercise blocking invalidation, rollback and lock release. Existing 0045/0048/0049/0089 assertions are retained; older endpoint fixtures receive the complete current trusted location producer graph.

Generated validation evidence is stored in the operating system temporary directory, outside the intended source changes. The migration is applied only to disposable test databases and is not installed into persistent Supabase.

Validated results:

- 0090 portable tests: 16 passed; focused suite including numbering and 0045/0048/0049/0089: 64 passed.
- 0090 PostgreSQL behavior: 89 assertions passed (including unexpected 23514 and strict missing-data propagation).
- 0090 concurrency: 11 scenarios, six actual blocking proofs, six lock-release proofs, zero deadlocks.
- Unchanged 0045/0048/0049 assertions: 62/86/52 passed.
- Unchanged 0089 behavior: 75 assertions passed; concurrency: eight scenarios, 19 read assertions, one actual blocking proof, three lock-release proofs, zero deadlocks.
- Additional existing regression coverage: 34 reputation checks, 203 legacy assertions, two confirmed/timeout settlement cases, two held no-travel checks, and three generic lifecycle/review provenance checks passed.
- Full Node suite: 1,856 tests, 1,855 passed, zero failed, one skipped. TypeScript and `git diff --check` passed.

During validation, the test runner's error-field and cancellation assertions were corrected, and the legacy location fixture was updated to sample resolution time after trusted selection. Two schema-restore timeouts required retries; completed runs preserved the persistent fingerprint and removed their disposable databases. No production eligibility logic or historical assertions were weakened.
