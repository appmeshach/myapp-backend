# Movement planning horizon foundation (0024)

## Product rule

A movement may only be planned within the next 24 hours. This applies to both sides of the system:

- a requester creating a `public.movement_needs` declaration; and
- an offering member declaring an independent `private.offering_movement_intents` movement.

The rule is about **when a movement may be planned**, not how long physical travel may last. A movement that starts within the allowed horizon is not required to finish within 24 hours.

## Exact database rule

At the database statement that inserts a declaration (or materially changes a requester departure window):

- `earliest_departure_at` must be finite, must not be in the past, and must be no later than 24 hours from the server statement time;
- `latest_departure_at`, when present, must be finite, must be at or after `earliest_departure_at`, and must also be no later than 24 hours from the server statement time.

The upper bound is inclusive. The implementation uses PostgreSQL `statement_timestamp()` so every row in one SQL statement is evaluated against one stable server-side planning instant. It deliberately does not trust client-supplied `created_at` as the authority for the horizon.

## Requester enforcement

Authenticated clients retain the existing direct `INSERT` privilege on `public.movement_needs`, restricted by existing RLS to their own member ID. Migration 0006 already revoked direct authenticated `UPDATE` access.

0024 adds a database trigger on:

```text
INSERT
or UPDATE OF earliest_departure_at, latest_departure_at
```

This means a modified client cannot bypass the 24-hour limit during creation, while existing lifecycle RPCs that only change `status` are not blocked merely because time later passes.

A future privileged departure-edit path will also be subject to the same rule automatically.

## Offering-intent enforcement

`private.offering_movement_intents` remains private and non-operational. 0024 adds insert-time enforcement only. 0022 already makes its departure fields immutable after insertion, so lifecycle changes such as superseding or withdrawing an intent do not revalidate a stale departure window.

0024 does not create an offering-intent writer or client RPC.

## Deliberate non-goals

0024 does not:

- limit journey duration;
- create or expire movements automatically;
- add scheduling/background jobs;
- change discovery, offer acceptance, activation, payment, reveal, start/end, settlement, route evidence, matching, pricing or route negotiation;
- select a maps/routing provider;
- change `0021.route_evidence_id`;
- add a client-side UI rule (the app should mirror the backend rule later for immediate feedback, but backend enforcement is authoritative).

## Why server statement time is authoritative

`movement_needs` currently permits direct authenticated inserts. A client could explicitly provide a misleading `created_at`, so 0024 does not calculate the planning horizon from that field. The database's own statement time defines the actual enforcement instant.

This migration does not attempt the separate hardening decision of making every legacy audit timestamp server-only; that is not required to enforce the 24-hour movement-planning rule.
