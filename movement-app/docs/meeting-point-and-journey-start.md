# 0018: meeting point and journey start

Migration: `supabase/migrations/0018_meeting_point_and_journey_start.sql`. Apply only after review; it has not been run remotely. All 0001-0017 migration files and existing functions remain unchanged.

Private `journey_meeting_points` stores one row per journey: trimmed nonblank place_text (1-200 characters), positive revision and updated_at. No updater UUID, coordinates, maps, private address inference or location permissions are added. Service infrastructure remains trusted; ordinary clients have no table access.

Authenticated movement-ID RPCs:
- get_my_movement_coordination_status(uuid)
- set_my_movement_meeting_point(uuid,text,bigint)
- request_my_movement_start(uuid)
- confirm_my_movement_start(uuid)

Every response has only meeting_point_text, meeting_point_revision, journey_state, start_requested_at, started_at, can_edit_meeting_point, can_request_start, can_confirm_start. Missing point/revision are NULL. Reads return no rows for unauthorized, absent or inactive movements; mutation authorization errors use generic coordination-unavailable copy. No IDs or payment details are returned. All functions fix search_path to empty; PUBLIC/anon execution is revoked. Private helpers are not client-callable.

Read authorization reuses 0014's exact current participant and succeeded-payment checks. Offering member, confirmed primary requester and confirmed invited travellers can read. Unrelated/declined/removed/unconfirmed people cannot. Only the two principals can edit, only while journey is not_started and start_requested_at is NULL. Activation itself does not freeze editing. NULL expected revision means no row exists; first write creates revision 1, subsequent writes must match the current revision and increment it. Conflicts fail safely with 40001; the UI discards stale state and asks for refresh.

Edits and wrappers lock journey then alignment, following the legacy start RPC order. The offering member's successful start request sets start_requested_at under the same journey lock used for editing, so competing operations serialize: an edit committed first is the frozen value; a request committed first causes the edit to fail. SQL tests are single-session rollback tests; multi-session concurrency has been reasoned about but not exercised locally.

A nonempty meeting point is required before request. A trigger also guards the original authenticated request_journey_start RPC, so callers cannot bypass the new prerequisite by using a known journey ID. The wrapper delegates to that unchanged RPC; request retries retain the original timestamp while still not_started. Confirm is only for the primary requester with a pending request; it delegates to unchanged confirm_journey_start, which atomically moves both records to in_progress and preserves repeated-confirm idempotency. Extra travellers gain no start authority. No second meeting-point confirmation exists.

## Installation preflight

The migration holds a SHARE ROW EXCLUSIVE journey-table lock through preflight and trigger installation to prevent a concurrent legacy request from slipping through. The migration stops if any existing journey is not_started with a nonnull start_requested_at. Such a legacy handshake predates recorded meeting points and is already frozen; silently resetting it or inventing a point would violate the agreed model. Review any such rows and resolve them operationally before installation. Read-only preflight for the operator:

```sql
SELECT count(*) AS legacy_pending_start_requests
FROM public.journeys
WHERE status = 'not_started' AND start_requested_at IS NOT NULL;
```

No automatic production data repair is included. Already in-progress/completed journeys may have no historical meeting point; their read-only status remains truthful.

## Client

The coordination screen mounts MeetingJourney after authorized reveal. A separate lifecycle owner derives auth context, refreshes on entry/foreground, clears on background/account/blur, discards late results, times out requests and blocks duplicate actions. The editor unmounts during actions/lifecycle invalidation so draft text does not cross accounts. Controls come exclusively from backend capabilities. Text existence, local role, face success, payment success or GPS can never enable start. Waiting comes from backend start_requested_at; Journey started comes only from backend in_progress. No amount or internal identity renders. If 0018 is not installed yet, the section fails safely as unavailable.

## Deferred

Chat, mutual-completion UI, live location and map pins remain unbuilt. Optional future location is supportive and never sole authority for start/end. A separate future pre-activation feature may provide broad area/corridor and backend-calculated rounded distance bands: Under 250 m, About 500 m, About 1 km, About 2 km, 3-5 km. It must not disclose the other member's exact coordinates, building, home/work or meter-by-meter movement; it cannot activate/start a journey or prevent offering-member cancellation before activation. None of that proximity behavior is implemented in 0018.

Rollback SQL: supabase/tests/0018_meeting_point_and_journey_start_test.sql. Run the entire file through final ROLLBACK as administrator after installation, only when authorized. It creates temporary test identities and prepares/verifies media through trusted test calls before payment/activation; it disables no safeguards. Static tests: supabase/tests/meeting_start.test.cjs. Client tests: tests/meetingJourney.test.cjs. Local static/mocked tests do not substitute for executing SQL or native-device visual testing.

## Second-pass security/concurrency audit

No edit/start serialization gap was found by code inspection. Both operations resolve eligibility, lock the journey FOR UPDATE, then the alignment FOR UPDATE, then re-read authorization and lifecycle state. Locks last until transaction end, including delegation to 0008. With READ COMMITTED, the waiting operation reads the committed state after acquiring the lock; at stricter isolation an incompatible concurrent update may abort rather than overwrite. Same-revision edits serialize: the second sees the incremented revision and fails. The initial expected revision is NULL (not zero); replaying either an applied initial insert or an applied update with its original expectation conflicts, without incrementing again. Deliberately submitting a new request with the current revision increments even if text is unchanged.

The request/confirm guards and status capabilities now explicitly check stored text validity (trimmed, non-whitespace, 1-200 characters), rather than relying solely on row existence and the table CHECK. The legacy request trigger performs the same check. This is defense in depth for malformed legacy data; no ordinary-client constraint bypass was identified. Place names are not restricted to ASCII and client tests preserve a Unicode Nigerian place name. Numeric strings, fractions and invalid revisions are rejected by the client before RPC; PostgreSQL receives its declared bigint argument.

The early table lock/preflight ordering and exact RPC signatures/ACLs are statically checked. Added rollback cases execute first-revision/replay conflicts, invalid-storage CHECK failures, capability checks, anonymous/private-helper denial, PUBLIC ACL and overload checks, and cancelled/failed read denial. Those cases have NOT yet run against PostgreSQL. Multi-session edit/edit and edit/start execution remains untested; lock-source assertions and this reasoning are not a runtime concurrency test. No database installation was attempted.

Preflight behavior is verified only by inspection/static tests: it precedes schema creation and runs under the write-blocking lock. Actual production presence/absence of incompatible pending rows is unknown until an authorized operator runs the preflight. No existing data is repaired or reset.
