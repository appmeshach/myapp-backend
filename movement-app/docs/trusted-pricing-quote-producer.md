# Trusted pricing quote producer (0069)

0069 adds `public.record_pricing_quote_for_server(uuid, integer, text, numeric)` on top of the immutable 0061 quote foundation. It records a trusted server calculation; it does not calculate a price. WE DO NOT CREATE JOURNEYS: the existing need and independently declared offering intent remain authoritative.

## Contract and trust boundary

The four inputs are the exact pricing geography evidence ID, its expected version, policy identity, and calculated NGN minor-unit amount. The sole supported policy is `trusted_server_result_infrastructure_v1`. This name denotes an infrastructure contract, not production-final economics. A new policy requires explicit future approval and a forward migration.

The amount is PostgreSQL `numeric` so fractional values can be rejected before conversion to `bigint`. It must be an exact integer from 1 through 9223372036854775807. Null, fractional, nonfinite, zero, negative, and overflowing amounts fail. A future server caller must preserve exact decimal precision in transport rather than convert money through a JavaScript floating-point number.

The database derives need, members, offering intent/version, state, NGN currency, quote version, current status, creation time, and expiry. Expiry is exactly the source evidence expiry, must remain finite and later than creation/current time, and has no caller override. The response contains only `quote_id`, `quote_version`, `quote_created_at`, and `quote_expires_at`.

The function is `SECURITY DEFINER` with an empty search path. Only `service_role` receives EXECUTE; PUBLIC, anon, and authenticated do not. No table write privileges are added. Existing RLS, ACLs, triggers, immutable quote facts, and validation helpers remain unchanged. A future server endpoint must calculate/verify the price itself and must never relay a mobile-supplied authoritative price. This database boundary cannot prove how a privileged server calculated its input.

## Locks and replay

READ COMMITTED is mandatory. An initial unlocked evidence read discovers immutable bindings. `private.assert_pricing_quote_context` delegates upstream validation to the established pricing geography chain: movement need FOR UPDATE, requester endpoints, offering intent, route evidence, match evidence, then pricing geography evidence. The downstream validation locks are SHARE locks. Quote history is locked FOR UPDATE in version order only after this chain. The need lock serializes even an empty quote history; the producer does not upgrade a need SHARE lock.

Live context and expiry are checked again after history waits using the existing clock-based validators. Version allocation, supersession, insertion, and final validation occur in the caller's transaction. Failure rolls back publication and any supersession.

Replay identity is evidence ID + exact evidence version + policy. The search includes terminal history. Exactly one matching, live current quote with the same amount and derived facts returns the original ID, version, creation time, and expiry. Conflicting amounts, ambiguous history, expired/superseded quotes, and invalid source context fail closed. Replay never extends expiry or reopens history. A genuinely new valid source identity can allocate the next canonical version and atomically supersede the previous current quote. Version overflow fails rather than wrapping.

## Boundaries and future work

This migration adds no pricing formula, surge/demand/weather/scarcity adjustment, route classifier, dataset ingestion, client quote display RPC, or production calculator. It inherits existing state/context and supported-distance checks; it does not complete the 0063 dataset-registry integration or establish final Lagos pricing policy.

It issues no financial proposal, agreement, wallet hold, offer, alignment, activation, settlement, refund, withdrawal, or payment-provider operation. The three obligations (`offering_platform_share`, `requester_platform_share`, `movement_contribution`) remain separate. Legacy `activation_fee_minor` is not authoritative; unfinished 70/30 economics are not encoded. No offerer payout is introduced, including before mutually confirmed completion.

A trustworthy, immutable quote must precede proposal issuance so future proposals can bind to an exact server-produced price and its live source lifetime. Proposal issuance remains a separate milestone.

Cost ledger: this milestone adds no paid dependency. A future payment provider remains Category 1, required for production money movement; Nigerian bank-transfer funding UX and provider integration are deferred.

## Local validation

Apply with `supabase migration up --local`; never use a remote push for this harness. The behavioral runner requires the local `supabase_db_movement-app` Docker container with 0069 applied:

```text
node --test tests/trustedPricingQuoteProducer.test.cjs
node supabase/tests/0069_trusted_pricing_quote_producer_behavior.cjs
node supabase/tests/0069_trusted_pricing_quote_producer_concurrency.cjs
node --test
node ./node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The rollback-only SQL harness passed 48 checks with zero failures and verified a full external data/schema/ACL/RLS/migration-history snapshot remained unchanged. It also fingerprints every non-quote application table inside the test transaction to detect unintended writes.

The concurrency runner passed seven separate-session scenarios: identical publication, conflicting amount, competing versions, first-writer rollback, need invalidation during a wait, source expiry during an upstream wait, and expiry during a quote-history wait. Each scenario observes an actual blocking relationship and checks the resulting canonical history, with no deadlock or timeout. It clones the local schema into a uniquely named disposable database, restores the producer's service-role boundary there, removes that database afterward, and confirms the application database snapshot is unchanged. Fixture commits occur only in that disposable database.

The portable structural tests also pin normalized historical migrations 0001–0068. Explicit PostgreSQL runners are opt-in; importing their helpers performs no database work.

Validation on the local 0069 schema: the combined 0059/0060/0061/0069 structural suite passed 58/58 (including 9/9 for 0069); the full Node suite passed 1313 with zero failures and one intentional DuckDB integration skip; TypeScript passed. Raw historical SQL regressions produced 0059: 133 passed/1 failed, 0060: 71 passed/0 failed, and 0061: 114 passed/1 failed. The only historical failures are the obsolete assertions that no public geography writer (0059) and no public quote function (0061) exist. Those assertions predate 0060 and 0069 respectively; their original harness wrappers target older migration baselines. They were not weakened or edited. All three external rollback snapshots were unchanged.
