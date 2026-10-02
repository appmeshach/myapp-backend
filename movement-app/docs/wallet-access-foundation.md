# Movement wallet access foundation

This milestone adds the first safe access layer on top of migration 0064.

Migration **0067** makes the provisioning implementation match the fail-closed
contract below. The original 0065 implementation inserted missing accounts before
checking completeness and could therefore repair partial wallets. Deployed
migrations 0001–0066 remain unchanged.

It intentionally does **not** move real money.

## What it adds

- `ensure_ngn_wallet_accounts_for_server(member_id)`
  - service-role only;
  - idempotently provisions exactly three NGN member accounts: available, held, and withdrawable;
  - refuses missing members, partial account sets, or closed account sets.

After 0067, provisioning locks the member row for update, then locks and checks
all existing NGN accounts for that member before any insert. Zero accounts allow
creation of the three required active kinds. Exactly three active accounts, one
per required kind, return their existing IDs without insertion. Every other
existing state fails with `23514`; no missing account is filled in and no closed
account is reopened. Existing unique indexes and account constraints also prevent
duplicate or invalid kinds from being created.

The signature, return columns, SECURITY DEFINER/empty search path, and service-only
execution remain unchanged. The member lock serializes simultaneous provisioning
and follows the same member-first order as the 0066 top-up gate. Concurrency is
validated at READ COMMITTED, the normal RPC isolation level; callers using higher
isolation levels must handle PostgreSQL serialization retries.

The correction does not change `get_my_wallet_balance()` or any money operation.
See [wallet foundation behavioral audit](wallet-foundation-behavior-audit.md) for
the local PostgreSQL results, known limitations, and repeatable commands.

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
