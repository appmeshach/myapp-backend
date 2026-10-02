# Financial proposal economics policy (0071)

The displayed seat price is the FULL requester Movement amount for one occupied seat. The platform's 30% comes from inside that amount. No Movement platform fee is added on top. External payment-provider fees are out of scope; their future treatment is not decided here.

WE DO NOT CREATE JOURNEYS. This milestone adds only a private, pure, immutable arithmetic helper:

```text
private.calculate_financial_proposal_economics(
  p_seat_price_minor bigint,
  p_people_count integer,
  p_financial_model_version text,
  p_platform_fee_allocation_policy_version text
)
```

It returns one row of six bigint values: `gross_requester_total_minor`, `quoted_platform_fee_total_minor`, `offering_platform_share_minor`, `requester_platform_share_minor`, `quoted_movement_contribution_minor`, and `offering_final_net_minor`.

## Exact policy

The supported identities remain `shared_platform_fee_v1` and `equal_split_requester_remainder_v1`. Both are required and compared exactly. Quote-generation `pricing_policy_version`, including `trusted_server_result_infrastructure_v1`, is a separate concept and is not an accepted financial-model identifier.

For positive integer seat price S and occupied people count N:

```text
G   = S * N
F   = floor((3 * G + 5) / 10)  -- 30% of G, HALF-UP once
O   = floor(F / 2)             -- existing 0020 allocation
R   = F - O
C   = G - R
NET = C - O = G - F
```

PostgreSQL exact numeric `div(G*3+5,10)` implements the single HALF-UP platform-total rounding operation for nonnegative gross amounts. `div(F,2)` implements the existing floor split, with the requester receiving its remainder. The helper never independently calculates or rounds 15%, 15%, 70% or 85%; doing so could break conservation of minor units.

The identities are exact:

- Requester total: C + R = G.
- Platform total: O + R = F.
- Offerer final net: C - O = G - F.

The contribution C is a gross transfer to the offerer; it is not the offerer's final net after O. The three obligations remain distinct. Occupancy N is the multiplier; `seats_offered` is not an input. Aggregate G is calculated before rounding F, not by rounding each seat independently.

## Examples

All table values are integer minor units (100 NGN minor units = NGN 1).

| S | N | G | F | O | R | C | NET |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 200000 | 1 | 200000 | 60000 | 30000 | 30000 | 170000 | 140000 |
| 200000 | 3 | 600000 | 180000 | 90000 | 90000 | 510000 | 420000 |
| 1 | 1 | 1 | 0 | 0 | 0 | 1 | 1 |
| 2 | 1 | 2 | 1 | 0 | 1 | 1 | 1 |
| 5 | 1 | 5 | 2 | 1 | 1 | 4 | 3 |
| 15 | 1 | 15 | 5 | 2 | 3 | 12 | 10 |
| 5 | 3 | 15 | 5 | 2 | 3 | 12 | 10 |

Thus a displayed NGN 2,000 seat costs the requester exactly NGN 2,000: NGN 1,700 contribution plus NGN 300 requester platform share. The platform receives NGN 600 total; the offerer's final net is NGN 1,400. Three occupied seats cost exactly NGN 6,000.

## Safety and authority

Inputs are bigint/integer. They are cast to exact numeric before multiplication. All six numeric outputs must be within 0..9223372036854775807 before any bigint cast. Positive gross can legitimately yield zero platform components. There is no floating-point arithmetic or fractional output. PostgreSQL input types enforce their own representable ranges; callers must preserve integer precision during transport and not pre-round fractional or floating-point prices into this typed interface.

NULL inputs/policies raise 22004; nonpositive inputs or unsupported policies raise 23514; oversized monetary outputs raise 22003. The maximum bigint seat price is valid for one occupied person; multiplying it by two is rejected. Integer people count is not restricted to a vehicle capacity here: roster/capacity eligibility belongs to the future issuer.

The helper follows the existing private SECURITY DEFINER convention, pins an empty search_path, and revokes EXECUTE from PUBLIC, anon, authenticated and service_role. It reads no tables, takes no state-dependent locks, performs no writes and creates no public wrapper. Existing RLS and table privileges remain untouched. Owner execution in local tests does not grant application access.

A future trusted issuer must validate the exact live quote and 0070 provenance, lock/copy the confirmed roster, supply its authoritative people_count, choose the supported financial policies and persist the returned proposal totals atomically. This helper alone cannot authenticate a supplied price, roster count or previous quote semantics. Existing infrastructure quotes are not retroactively certified as production-ready prices by this migration.

0071 neither generates seat prices nor implements route coefficients. It issues no proposal, records no consent, and changes no offer, alignment, agreement, component, wallet, hold, activation, settlement or movement state. No payout occurs. There is no payment-provider integration or decision about external fees.

Cost ledger: no paid dependency introduced. No concurrency harness is needed because the function is pure and stateless.

## Local validation

```text
supabase migration up --local
node --test tests/financialProposalEconomicsPolicy.test.cjs
node supabase/tests/0071_financial_proposal_economics_policy_behavior.cjs
node --test supabase/tests/financial_agreement.test.cjs supabase/tests/financial_proposal.test.cjs supabase/tests/pricing_quote_foundation.test.cjs tests/trustedPricingQuoteProducer.test.cjs tests/financialProposalQuoteBinding.test.cjs
node supabase/tests/0069_trusted_pricing_quote_producer_behavior.cjs
node supabase/tests/0070_financial_proposal_quote_binding_behavior.cjs
node --test --test-reporter=tap
node ./node_modules/typescript/bin/tsc --noEmit
git diff --check
git status --short
```

The explicit PostgreSQL runner compares application data/schema/ACL/RLS snapshots both before rollback and externally after rollback. Its in-transaction snapshot check is injected into the SQL batch; the standalone SQL supplies the other checks. The behavioral suite covers 12,000 positive combinations against an independent decimal-round oracle, exact example vectors, bigint boundaries, invalid inputs, policies and actual role denials.

Observed results: 8/8 new structural checks; 42/42 PostgreSQL checks; 80/80 focused historical structural regressions; 0069 behavioral 48/48; 0070 behavioral 45/45; full Node 1331 passed, 0 failed, 1 intentional DuckDB integration skip; TypeScript passed. Historical migrations 0001-0070 are pinned by normalized SHA-256 and were not modified.

Additional unchanged historical SQL regressions were run through local Docker psql with external rollback snapshots:

- 0020: 115 passed, 0 failed.
- 0021: fixture construction aborts because pre-0070 proposals omit mandatory quote provenance; no completed assertion count.
- 0061: 113 passed, 2 failed. The no-public-quote-function assertion predates 0069. The TRUNCATE probe expects 23514, while the referencing FK added in 0070 rejects it earlier with 0A000. Truncation remains blocked.

No historical test was modified. The repository already contains the separately reviewed 0070-only proposal-table allowlist. 0071 needs no additional allowlist because it does not consume proposal tables. All application snapshots remained unchanged. No concurrency harness was created.
