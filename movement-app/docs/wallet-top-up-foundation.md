# Wallet top-up foundation (0066)

## Boundary and accounting

`public.record_wallet_top_up_for_server(p_member_id uuid, p_amount_minor bigint,
p_currency text, p_provider text, p_provider_reference text) RETURNS uuid`
records one already-verified external funding event. Only `service_role` can
execute it. It does not verify receipt of external funds itself. A future trusted
payment-verification layer must authenticate provider evidence and bind its final
successful status, member, amount, currency, and stable event identity before
calling this RPC. A client assertion, pending payment, or unsigned callback is
not sufficient evidence.

The currency must be exactly `NGN`; amount is a positive integer in minor units
(kobo), within PostgreSQL bigint range. A successful call creates one
`wallet_top_up` transaction with no alignment or financial-component attachment,
debits the active system NGN `provider_clearing` account, and credits that member's
NGN `member_available` account by the same amount. Exactly two postings are made.
Held and withdrawable balances receive no posting. No platform-revenue posting
is created. The available balance must remain nonnegative and within bigint range.

An unprovisioned member receives the three accounts through the existing 0065
provisioning function. 0066 first rejects an existing partial or closed NGN wallet;
it does not allow the provisioning function to fill in a partial wallet. (The
0065 implementation can fill missing accounts despite the stronger statement in
its original documentation.) Missing members fail. A system clearing account is
created idempotently using the existing partial unique index; an existing closed
clearing account fails instead of being reopened or duplicated.

## Identity, replay, and concurrency

Provider names are 1–100 characters matching `[A-Za-z0-9][A-Za-z0-9_.:-]*`.
References are 1–255 characters, contain non-whitespace, have no leading/trailing
ASCII spaces, and contain no control characters. Inputs are not normalized;
provenance is case-sensitive. The future verifier must use one canonical stable
identity per funding event, not a new reference on each retry.

The internal idempotency key is `wallet_top_up:` followed by the SHA-256 hex digest
of the UTF-8 JSONB array `[provider, reference]`. Callers cannot supply keys,
account IDs, posting direction, or transaction kind. An exact replay returns the
existing transaction UUID without another credit. A different member, amount,
currency, transaction kind, attachment, key, or posting shape is rejected.
Existing ledger uniqueness constraints remain in force; conflicting identities
fail closed.

The function requires READ COMMITTED isolation. An event-scoped transaction
advisory lock serializes duplicate delivery; the subsequent lookup sees the
committed winner. A member-row lock serializes this writer's provisioning and
balance checks, including against 0065 provisioning. Account share locks protect
the active state during posting. Clearing-account uniqueness handles creation.
Locks last until the caller's transaction ends. Use one top-up per transaction;
do not treat a returned UUID as committed until the transaction commits. An
aborted first delivery leaves a waiting retry free to create the event once.
Any future ledger writer must coordinate its balance checks with these locks.

## Minimal prerequisite correction

0066 uses `CREATE OR REPLACE FUNCTION` for
`private.validate_wallet_transaction_deferred()` because the original CASE
expression could resolve `NEW.transaction_id` on a transaction row, where that
field does not exist. Explicit IF branches validate `NEW.id` for
`wallet_transactions` and `NEW.transaction_id` for `wallet_postings`; other table
names raise SQLSTATE 23514. Existing deferred triggers, their timing, the balance
assertion, append-only protections, function ACLs, table permissions, and RLS are
preserved. No deployed migration 0001–0065 is edited.

## Scope and cost

No generic posting API, client money mutation, provider SDK, webhook, callback,
secret, network service, or real-money integration is added. Activation, pricing,
agreements, holds/releases, settlement, fees, refunds, and withdrawals remain
separate milestones. Application code is unchanged.

This milestone adds no paid dependency. A real payment provider is a future
Category 1 launch dependency, with provider onboarding and transaction costs to
be assessed in that integration milestone. This ledger boundary alone does not
make production funding ready.

## Local validation

From `movement-app/`:

```sh
node --test tests/walletTopUpFoundation.test.cjs
node supabase/tests/0066_wallet_top_up_behavior.cjs
node supabase/tests/0066_wallet_top_up_concurrency.cjs
node --test
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The two explicit integration runners require the existing local Docker container
`supabase_db_movement-app` with a PostgreSQL baseline through 0065. They are not
discovered by the portable Node suite and do not contact hosted Supabase.

The behavioral runner installs 0066 inside the SQL harness transaction, runs
permission, replay, accounting, rejection, and deferred-trigger checks, then
rolls everything back, including the function replacement. It flushes deferred
constraints before rollback. An error closes the connection and rolls back too.

The concurrency runner copies only the local public/private/auth/extensions
schema into a randomly named `wallet0066_race_*` database, applies 0066 there,
and uses separate PostgreSQL sessions. It observes actual blocking through
`pg_blocking_pids`, then checks identical replay, conflicting amount, and first
writer rollback. Each case must leave one transaction, two postings, and one
100-kobo credit. The schema copy excludes ownership and ACLs because the local
PostgreSQL role cannot restore Supabase auth-admin default privileges. This runner
validates concurrency, not baseline permissions; the rollback-only harness checks
permissions against the original database. The scratch database grants service-role
USAGE on public; 0066's own RPC ACL is applied normally.
The temporary database is dropped in `finally`. Forced process
termination may require manual cleanup of that specifically named scratch
database; never drop the application's `postgres` database.

Transport-geography DuckDB integration remains intentionally skipped in the full
portable suite. No DuckDB or other dependency installation is required here.

Observed local results: 43/43 rollback-only PostgreSQL checks, all three real
concurrency races, 8/8 focused structural tests, and TypeScript passed. The full
Node suite reported 1,294 passed, one intentional skip, and zero failures.
