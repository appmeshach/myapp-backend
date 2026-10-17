# 0093 — Requester route generation claim boundary

Development only. This is trusted evidence infrastructure in the broader 0092
shared-segment workstream. We connect journeys that were already going to happen.
No provider HTTP requests, paid dependency, matching, priority change, offers,
alignments, journeys, reservations, media or financial effects are introduced.

## Authority and deletion

`private.requester_route_generation_claims` is one slot per authoritative
`public.movement_needs.id`. Each attempt binds the requester, exact origin and
destination references, evidence schema, shape format, explicit server-selected
provider namespace/product/version, unique token, claimed time and fixed lease.
There are no coordinates or route geometry in the claim.

The movement-need FK uses `ON DELETE CASCADE`, following 0035's
`private.movement_need_locations`. Unlike 0035's independent immutable creation
receipt, a claim is ephemeral permission rather than permanent request history.
Deleting a need removes its claim; every operation requires the existing locked
need. The claim trigger allows parent cascade but rejects standalone deletion.
0092 requester evidence keeps its existing restrictive FK and immutable history.

## Boundaries and locking

The service-only public RPCs are:

- `claim_requester_route_generation_for_server`: need/member and explicit trusted
  provider contract; fixed schema/format defaults; no client execution authority.
- `record_claimed_requester_route_evidence_for_server`: exact token, endpoint,
  schema/provider context and normalized trusted result; no unclaimed writer.

Private owner-only helpers validate/lock context, validate generation-contract
strings and identify reusable evidence. All privileged functions have an empty
search path and explicit revokes. The claim table has RLS, no policies and no
direct application-role privileges, including service role.

Order: need `FOR UPDATE` → endpoint binding rows `FOR SHARE` → resolved endpoint
rows in ascending UUID order `FOR SHARE` → claim slot `FOR UPDATE` → evidence.
Acquisition and publication require READ COMMITTED. The forward replacement of
`assert_requester_route_evidence` reads immutable evidence identity without a lock,
then locks need/context before locking and rereading evidence. It preserves
status, evidence expiry, exact binding, endpoint freshness and structural checks.
The assertion itself retains its previous transaction-isolation availability.

Final lock-order review found only two production callers of the reuse helper:
the acquisition and publication RPCs. Both already own need/context locks, so
the previous helper did not introduce a present deadlock path through those
callers. PostgreSQL transactions do not conflict with their own row locks.
The helper now independently reads the authoritative member identity without a
tuple lock and invokes the context locker before selecting evidence FOR UPDATE.
That locker revalidates the member after locking the need. The helper signature,
ACLs and evidence validations are unchanged. This closes the latent inversion
for direct owner calls; a new two-session test proves the need owner can acquire
the evidence lock while a standalone helper call waits for context.

## State and idempotency

Acquisition returns `reuse_existing`, `in_progress` or `claimed`. Only `claimed`
returns a newly issued token and exact endpoint IDs. No return contains geometry
or coordinates; competing tokens are never returned.

Reusable evidence must be current, unexpired, structurally valid, bound to the
same requester and exact endpoint refs, and match the explicit provider/schema/
format contract. Endpoints must be owned, resolved/provider-backed, finite and
unexpired. NULL expiry means no stored deadline. Corrupt current evidence fails
closed even when its provider contract differs or its expiry has elapsed.

The fixed lease follows 0033: exactly 30 seconds, no same-token renewal. Failed
or crashed attempts recover by expiry and a new token. A live lease prevents
another generation permission, including a request for a different provider
contract. Reusable evidence wins before new permission is granted.

Publication rejects wrong/replaced/expired incomplete tokens and mismatched
member/endpoints/schema/provider context. It rechecks dependencies after waiting
and immediately before completion. Generation time must follow need creation,
endpoint resolution and claim acquisition. Evidence expiry is bounded by the
requested expiry and both endpoint expiries, separately from need discoverability.

Evidence appearing while work is outstanding is reused under the same need lock.
`completion_kind='reuse_existing'` records that the worker's payload was discarded;
replay returns that valid evidence without attesting the discarded payload.
`completion_kind='published'` requires exact normalized payload, generation time,
provider route reference and effective expiry on replay. Completed replay can
recover after the lease deadline, but never after token replacement or when the
completed evidence is no longer valid for current use.

New publication allocates a per-need version, supersedes old current evidence,
inserts the replacement and completes the claim in one transaction. Any failure
rolls all of this back. Superseded/expired rows remain stored and cannot reopen.
Provider route references already recorded for the same need/contract cannot be
repurposed into a new version.

## Lifecycle, provider and cost boundaries

Paused, closed, persisted-expired and past-departure needs are not automatically
structurally invalid. Scheduling policy stays separate from evidence integrity;
no copy of current-need recovery, discovery, capacity or alignment policy is added.

The service supplies an explicit trusted generation contract. No provider or
transport profile is selected by this migration; requester driving-only behavior
is not declared. Actual requester provider/profile orchestration is deferred.
Its execution budget must remain comfortably below 30 seconds. A database lease
fences authorized attempts and publication; it cannot guarantee exactly one remote
provider call across worker crashes or uncertain external outcomes.

Classification: **no new external cost**.
Scaling: **ordinary PostgreSQL/Supabase storage and compute only**.
No provider pricing is asserted.

## Validation

The explicit harness clones only local public/private/auth/extensions schema into
a uniquely named disposable database. It does not copy application rows, use a
remote URL, access a linked project, or mutate the application database. SQL suites
roll back. Concurrency tests use real PostgreSQL sessions and verify actual
`pg_blocking_pids` relationships. Lease recovery waits for genuine server expiry.

Commands:

```text
node supabase/tests/0093_requester_route_generation_claim_boundary_harness.cjs
node supabase/tests/0093_requester_route_generation_claim_boundary_concurrency.cjs
node --test
npm run typecheck
npm run typecheck:edge
git diff --check
```

Verified in this development worktree:

| Check | Result |
|---|---|
| Fresh local reset through 0093 | Passed, all 93 migrations |
| Installed functions | All seven bodies match final source; postgres owner, definer, empty search path |
| 0093 SQL behavior | 49/49; additional actual anon/authenticated denials and service-role execution |
| 0093 genuine concurrency/recovery | 16/16 after final lock-order hardening |
| 0092 requester evidence regression | 24/24 |
| 0033 offerer claim regression | 29/29 |
| Numbering/consumer/portability focused Node tests | 80/80 |
| Full Node suite | 1,906 total; 1,905 passed, one skipped, zero failed |
| App and Edge TypeScript | Both passed |
| Application clone-test fingerprint | Data/catalog/ACL/RLS/migration history unchanged |
| Whitespace check | `git diff --check` passed |

Windows reserved ports 54274–54373, including default database port 54322.
The initial local reset could not start its database container. A temporary CLI
workdir using the same local project identity and database port 55432 completed
the fresh reset. The local database now publishes host port 55432; the tracked
`supabase/config.toml` is unchanged. Temporary reset files and output logs were
removed after validation. Future local CLI work must account for this host-port
reservation until it is resolved or a local port override is supplied.

The first SQL attempt exposed a fixture clock-order error: separately sampled
resolution time could exceed creation time. Fixtures now use one statement time.
The first expiry race fixture expired during connection setup; it now allows
setup time and waits for database-confirmed endpoint expiry while the writer is
blocked. Neither correction changes production clocks or weakens validators.

The first full Node run exposed raw CRLF-versus-LF historical hash failures in
`trusted_location_search_intake_boundary.test.cjs`. Those checks retain their
fixed normalized hashes and additionally compare working content with HEAD.
The consumer allowlist admits only the two exact requester migration paths, and
its pinned normalized hash is updated. Numbering extends uniquely through 0093.
No historical migration content changed.

Final review confirmed `core.autocrlf=true`, LF index content and CRLF working
files for both 0025 and 0026. Their raw checkout hashes differ from the pinned LF
hashes solely because of that conversion. Normalized content matches HEAD and
the unchanged SHA-256 pins. In-memory mutation probes confirmed SQL replacement,
SQL addition and a lone CR fail both content and hash comparisons, while CRLF/LF
conversion passes. No whitespace, comment or SQL normalization is performed.
The final review reran the 49-check 0093 SQL suite, 24-check 0092 regression,
29-check 0033 regression and all 80 affected Node tests. The corrected helper
was applied only to the local Docker database before testing; the harness
verified all seven installed bodies against final source and preserved the
application data/catalog/ACL/RLS/history fingerprint through disposable tests.

Changed-file manifest: the migration, SQL tests, harness, concurrency runner and
this document are new. Existing changes are limited to
`tests/migrationNumbering.test.cjs`, `supabase/tests/movement_context.test.cjs`,
`supabase/tests/0048_offerer_interest_inbox.test.cjs` and
`supabase/tests/trusted_location_search_intake_boundary.test.cjs`.

No production access, deployment, staging, commit or push occurred. Provider
integration/profile selection, Edge execution budget, lifecycle scheduling and
later shared-segment eligibility remain deferred.
