# Movement wallet ledger foundation

WE DO NOT CREATE JOURNEYS.

This milestone introduces the accounting foundation for a future in-app **Movement Balance**. It does not make Movement a bank or mobile-money operator, does not connect a payment provider, does not create virtual account numbers, and does not expose any client-side money mutation.

## Product intent

Members should eventually be able to:

- add money by normal Nigerian bank transfer from OPay, PalmPay, Moniepoint, Kuda, banks, and other NIP-capable apps;
- pay Movement obligations from their in-app balance;
- have movement money held while a movement is unresolved;
- receive eligible movement earnings only after the movement reaches the approved completion state;
- withdraw eligible funds through future licensed payment infrastructure;
- receive refunds/releases when an approved financial lifecycle requires them.

The wallet is an accounting and UX layer around regulated payment infrastructure. Provider selection, KYC/compliance obligations, virtual-account issuance, collection, and payout integration remain separate reviewed milestones.

## Ledger model

The foundation is double-entry and append-only. There is deliberately no mutable `balance` column.

Balances will eventually be derived from immutable postings to accounts. Every completed ledger transaction must contain at least one debit and one credit and the debit total must exactly equal the credit total.

Current account kinds are:

- `member_available` — member funds available for future approved use;
- `member_held` — funds locked against an unresolved movement/payment lifecycle;
- `member_withdrawable` — member funds eligible for withdrawal after approved settlement;
- `platform_revenue` — platform money after an approved financial component is earned;
- `provider_clearing` — the ledger boundary representing money entering/leaving through a future licensed provider.

`withdrawn` is not represented as another stored-value account. A withdrawal is an immutable ledger transaction that moves value from the appropriate member account to the provider-clearing boundary.

## Transaction kinds

The foundation reserves explicit transaction kinds for:

- wallet top-up;
- movement hold;
- movement-hold release;
- requester platform charge;
- offering-member platform charge;
- movement-contribution settlement;
- withdrawal;
- refund;
- provider fee;
- internal transfer.

This is only an accounting vocabulary. No operational writer exists yet.

## Relationship to Movement financial agreements

The wallet does not replace the financial agreement model introduced in migration 0020.

Financial agreements/components answer **who owes what and to whom**. The wallet ledger will answer **where the money came from, where it is currently classified, and where it ultimately went**.

Movement financial transaction kinds that represent the requester platform share, offering-member platform share, or movement contribution must reference an existing immutable `private.financial_components` row. Relevant movement transactions must also reference the alignment.

There is intentionally no cutover from the older activation-payment foundation in this migration.

## Security boundaries

All wallet tables live in the private schema with RLS enabled. `anon` and `authenticated` have no direct table privileges. `service_role` receives read access only in this foundation.

Future provider callbacks, edge functions, and client actions must not INSERT/UPDATE/DELETE ledger tables directly. A later milestone must add tightly scoped trusted posting RPCs with explicit invariants and idempotency contracts.

Transactions carry a required unique idempotency key. Provider references, when present, are unique per provider. This is intended to make retries safe and prevent the same external event from being posted twice.

Wallet transaction and posting history cannot be edited, deleted, or truncated. Wallet account identity is immutable; an active account may only move once to `closed` and cannot reopen.

## What is not implemented

This milestone does not provide:

- wallet UI;
- balance-query RPCs;
- account provisioning RPCs;
- provider adapters;
- Paystack, Flutterwave, Monnify, OPay, PalmPay, or other provider integration;
- virtual bank accounts;
- bank-transfer webhooks;
- KYC/BVN/NIN flows;
- withdrawals;
- refunds;
- funding;
- movement hold/release writers;
- settlement writers;
- pricing or proposal generation;
- automatic activation.

Those require separate review because they move real money or create regulatory/provider dependencies.

## Cost ledger

This database foundation adds no paid dependency.

Future launch-required costs may include payment collection fees, payout fees, bank-transfer/virtual-account charges where applicable, provider/KYC charges, and operational reconciliation/storage costs. Provider pricing must be checked again immediately before production selection rather than hard-coded from research-time prices.

## Next milestone

Before any real-money provider is connected, the next financial milestone should define and test trusted server-side wallet posting operations and safe member read projections. Provider selection can then be evaluated against the exact funding, holding, settlement, withdrawal, reconciliation, and compliance contracts Movement actually needs.
