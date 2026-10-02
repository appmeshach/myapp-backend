# Financial proposal quote binding (0070)

0070 adds exact, immutable pricing-quote provenance to the existing private financial proposal foundation. WE DO NOT CREATE JOURNEYS. It connects no new operational flow and introduces no proposal issuer or public RPC.

## Schema and migration precondition

The local database was inspected before application: migration baseline 0069 and zero financial proposals. The migration locks `private.financial_proposals` in ACCESS EXCLUSIVE mode before checking for any rows. Unexpected existing history raises SQLSTATE 23514 and aborts the transaction; there is no fabricated backfill or default binding.

The only table additions are:

- `pricing_quote_id uuid NOT NULL REFERENCES private.pricing_quotes(id)`.
- `pricing_quote_version integer NOT NULL CHECK (pricing_quote_version >= 1)`.

The existing `route_evidence_id IS NULL` constraint remains intact. Quote -> pricing geography -> exact route evidence already supplies the provenance chain; this milestone does not activate the old reserved route column.

## Construction versus historical provenance

The new private `assert_financial_proposal_quote_binding(private.financial_proposals)` helper verifies quote existence, exact version, movement need, requester (`member_needing_movement_id` on the proposal), offering member, currency and pricing policy. It requires finite, non-NULL proposal creation/expiry, creation no earlier than the quote, expiry after creation, and expiry no later than the quote.

`protect_financial_proposal()` is replaced with the original 0021 body plus two calls in its INSERT branch: the static binding assertion, then the existing live `assert_pricing_quote`. The latter validates current/unexpired quote and live upstream evidence. This runs BEFORE INSERT, ahead of FK checks. All original unaccepted/unbound/unmaterialized construction rules remain.

The original complete-row immutability comparison automatically includes both new columns. Neither is added to the permitted mutable-field list. Existing deferred roster/snapshot/consent/materialization checks are unchanged. The structural test compares the replacement body with 0021 after removing exactly the two new calls.

Historical binding validation has no lifecycle predicate, clock check or row-lock acquisition. Expiry, supersession and later movement transitions do not rewrite provenance. No live quote assertion was added to deferred proposal validation or historical reads. This does not waive existing 0021 rules for new consent or materialization actions.

Construction is not a capacity reservation or financial consent. A later operational acceptance can make an unaccepted proposal unusable without deleting its historical facts. Future sensitive consumers must explicitly validate current eligibility before their transition; a persisted current flag is not sufficient.

## Security and lock contract

Both helpers are SECURITY DEFINER with empty search_path. Application objects are qualified. EXECUTE is revoked from PUBLIC, anon, authenticated and service_role. Existing table RLS/ACLs remain unchanged; service_role has no direct proposal writes. No client receives proposal identifiers or a new API.

An initial unlocked quote read verifies immutable selectors and prevents a mismatched proposal need from introducing a second need lock. The live quote assertion then takes the canonical chain:

1. Need UPDATE.
2. Requester endpoints SHARE.
3. Offering intent SHARE.
4. Exact route SHARE.
5. Exact route-match SHARE.
6. Geography SHARE.
7. Quote SHARE, with live revalidation after waits.
8. Proposal parent/history UPDATE where applicable.
9. Vehicle then active vehicle access SHARE.
10. Roster validation under the retained need lock.

The unchanged 0021 deferred helper reacquires the already-held need after locking the proposal. Future issuers must acquire dependencies before existing proposal/history rows and before invoking that helper. They must use READ COMMITTED, preserve complete roster construction, and force deferred constraints before reporting success.

This migration does not call availability or offer acceptance helpers. A future combined operational transaction must prelock the stronger intent/route UPDATE locks before validators take SHARE locks. It must preserve 0045's need -> offer acceptance prefix and 0044's intent -> route -> availability -> vehicle/access chain. Calling an operational helper after taking quote-context SHARE locks can introduce an upgrade deadlock; this foundation is not a combined writer.

## Deliberately unfinished economics

The binding does not establish a mathematical relationship between `seat_price_minor` and either proposal total. Test values are opaque fixture amounts, not an economic policy. A future trusted issuer must await an approved definition of the seat-price basis, occupied-seat aggregation, platform total, movement contribution, final offerer net and minor-unit rounding. `trusted_server_result_infrastructure_v1` is not production-final economics.

The three obligations remain separate: `offering_platform_share`, `requester_platform_share`, and `movement_contribution`. No surge, demand, weather or scarcity pricing is added. Legacy `activation_fee_minor` gains no authority. There are no agreement/component, wallet, hold, activation, settlement, payout or payment-provider writes. No payout before mutually confirmed completion is introduced.

Cost ledger: no paid dependency is added.

## Validation and reproducibility

Local application: `supabase migration up --local` using the installed cached CLI. Nothing was pushed to remote Supabase.

```text
node --test tests/financialProposalQuoteBinding.test.cjs
node supabase/tests/0070_financial_proposal_quote_binding_behavior.cjs
node supabase/tests/0070_financial_proposal_quote_binding_concurrency.cjs
node --test supabase/tests/financial_proposal.test.cjs supabase/tests/pricing_quote_foundation.test.cjs tests/trustedPricingQuoteProducer.test.cjs supabase/tests/0044_offering_movement_availability_foundation.test.cjs supabase/tests/0045_movement_offer_availability_capacity.test.cjs
node supabase/tests/0069_trusted_pricing_quote_producer_behavior.cjs
node --test
node ./node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Results:

- New structural suite: 10 passed, 0 failed; normalized hashes pin all migrations 0001-0069.
- 0070 behavioral SQL through the runner: 45 passed, 0 failed. The runner injects the exact migration precondition into the marked SQL probe, proving it rejects real existing proposal rows. Running the SQL alone omits that one runner-supplied check.
- Concurrency: 6 scenarios passed, 0 failed. Actual blocking relationships are observed for supersession, quote expiry, roster mutation, operational acceptance, shared-intent contention, and constructor-first/later supersession. Rejected constructors leave zero proposal rows. No deadlock or timeout occurred.
- 0069 behavioral regression: 48 passed, 0 failed.
- Combined historical structural regressions: 72 passed, 1 failed.
- Full portable Node suite: 1322 passed, 1 failed, 1 intentionally skipped DuckDB integration test, 1324 total.
- TypeScript: exit 0.

Behavioral runs are rollback-only and compare external full database snapshots including data, schema, ACLs, RLS and migration history. The concurrency runner uses a unique cloned-schema disposable database, normal triggers and test-only privileged constructors; it performs real operational acceptance only there. Cleanup removes that database and verifies the application database is unchanged. No production fixture writer is installed.

Historical failures were preserved, not weakened:

- The 0021 structural test `operational callers and other migrations do not consume proposal tables` rejects any later migration mentioning either proposal table. 0070 intentionally adds such a foundation. This is the sole full Node suite failure.
- Raw 0021 SQL aborts during fixture setup because its pre-0070 proposals lack mandatory quote provenance; no completed assertion summary is available.
- Raw 0061 SQL: 113 passed, 2 failed. Its no-public-quote-function assertion predates 0069. Its TRUNCATE probe expects 23514, but the new referencing FK makes PostgreSQL reject earlier with 0A000; truncation remains blocked.
- Raw 0044 SQL: 44 passed, 0 failed.
- Raw 0045 SQL aborts building shared match fixtures. Its old resolved-location fixtures omit the trusted state evidence required by 0050. No completed assertion summary is available. The new 0070 concurrency fixtures supply real state evidence and exercise the unchanged operational acceptance successfully.

All historical SQL runs preserved the external application database snapshot. Historical test files remain unchanged. The existing CI suite remains red until the obsolete 0021 structural scope assertion is addressed in a separately authorized test-maintenance change.
