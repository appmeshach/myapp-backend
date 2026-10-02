# Wallet ledger hardening — migration 0068

WE DO NOT CREATE JOURNEYS.

Migration 0068 hardens the existing Movement wallet ledger foundation. It does not add a payment provider, wallet UI, withdrawal flow, settlement writer, movement hold/release writer, refund writer, or client-side money mutation.

## What 0068 fixes

Before 0068, an active wallet account could be changed to `closed` even when its immutable ledger postings produced a nonzero balance.

That was unsafe because closing an account with money still classified in it could leave the ledger in a terminal state that did not reflect the financial position of the account.

0068 changes the existing wallet-account protection function so an account may move from `active` to `closed` only when its authoritative ledger balance is exactly zero.

The authoritative balance is derived from immutable postings:

- credits increase the balance;
- debits decrease the balance;
- the calculation uses PostgreSQL `numeric` arithmetic so aggregation does not overflow at bigint boundaries.

There is still no mutable balance column.

## Closure rules

The account lifecycle remains intentionally narrow:

- a newly created wallet account must start as `active`;
- account identity remains immutable;
- an active account may move to `closed` only once;
- a closed account cannot reopen;
- a positive-balance account cannot close;
- a negative-balance account cannot close;
- only an exactly zero-balance account can close.

Transaction and posting history remain append-only.

## Concurrency rule

Wallet postings already acquire a row-level `FOR SHARE` lock on the account being posted to.

Closing an account requires an incompatible row lock.

0068 relies on that existing lock relationship and validates the balance while the closure owns its account-row lock.

Real two-session PostgreSQL tests verify both directions:

1. If a posting obtains the account lock first, closure waits. After the posting commits and makes the balance nonzero, closure fails.

2. If closure obtains the account lock first on a zero-balance account, a posting waits. After closure commits, the posting fails because the account is closed.

This prevents posting/closure races from bypassing either rule.

## One posting per account per transaction

The existing constraint equivalent to:

`UNIQUE(transaction_id, account_id)`

is intentionally retained.

This means one ledger transaction cannot contain multiple separate posting rows for the same account.

For future trusted wallet writers, if a logical financial operation has multiple legs that resolve to the same ledger account, those amounts must be aggregated into one posting for that account before the transaction is written.

This rule currently provides a useful duplicate-leg protection and no implemented Movement financial operation requires multiple rows for the same account inside one ledger transaction.

It should only be reconsidered later if a concrete, reviewed financial transaction requires a different representation.

## Movement Balance model

The user-facing product remains one Movement Balance backed by internal ledger classifications.

The current member account kinds remain:

- `member_available`
- `member_held`
- `member_withdrawable`

These are internal ledger buckets, not three separate user wallets or bank accounts.

System account kinds remain:

- `platform_revenue`
- `provider_clearing`

## What 0068 does not implement

0068 does not implement:

- Paystack, Flutterwave, Monnify, OPay, PalmPay, or another provider;
- virtual bank accounts;
- payment-provider callbacks or webhooks;
- movement funding;
- movement hold/release operations;
- platform-fee charging;
- movement-contribution settlement;
- withdrawals;
- refunds;
- activation-payment changes;
- pricing or financial-proposal issuance;
- client access to private wallet tables;
- a generic trusted ledger writer.

Those remain separate milestones because they can move or classify real money.

## Validation completed

0068 was validated with:

- focused migration structural tests;
- real PostgreSQL behavioral tests;
- positive, negative, and zero-balance closure checks;
- immutable account/lifecycle checks;
- closed-account posting checks;
- real two-session posting-versus-closure concurrency tests;
- the combined 0064/0065/0067 wallet audit;
- the existing 0066 trusted top-up behavioral suite against the post-0068 database;
- the existing 0067 wallet-provisioning concurrency suite;
- rollback/cleanup verification.

## Cost ledger

0068 adds no paid dependency.

No external payment provider, verification vendor, bank-transfer product, virtual-account service, messaging service, or other paid infrastructure is introduced by this milestone.

A production payment provider remains a future Category 1 launch dependency because Movement will eventually require regulated infrastructure for collecting and paying out real money. Provider pricing and compliance requirements must be re-verified when that integration milestone begins.
