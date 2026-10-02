# Movement wallet access foundation

This milestone adds the first safe access layer on top of migration 0064.

It intentionally does **not** move real money.

## What it adds

- `ensure_ngn_wallet_accounts_for_server(member_id)`
  - service-role only;
  - idempotently provisions exactly three NGN member accounts: available, held, and withdrawable;
  - refuses missing members, partial account sets, or closed account sets.

- `get_my_wallet_balance()`
  - authenticated-member only;
  - derives identity from `auth.uid()` and accepts no caller-supplied member id;
  - returns only currency, readiness, available balance, held balance, and withdrawable balance;
  - returns `wallet_ready=false` with zero balances when the member has not yet been provisioned;
  - never creates accounts or writes ledger rows.

## Accounting convention

Member wallet accounts are liability-style accounts in the ledger projection: credits increase a member-visible balance and debits decrease it.

The projection fails closed if a member account would produce a negative balance or exceed the signed bigint range. Provider-clearing and platform-revenue accounts are never exposed by the member balance RPC.

## Security boundary

There is still no generic ledger writer and no authenticated client money mutation surface.

Top-up, movement hold/release, requester platform charge, offering-member platform charge, movement-contribution settlement, refund, provider fee, and withdrawal operations remain separate reviewed milestones. Those operations must enforce their own lifecycle, financial-component, idempotency, balance, and provider-provenance rules.

## Provider boundary

No Paystack, Flutterwave, Monnify, OPay, PalmPay, virtual-account, webhook, or callback integration is introduced here.

## Cost ledger

This milestone adds no paid dependency.
