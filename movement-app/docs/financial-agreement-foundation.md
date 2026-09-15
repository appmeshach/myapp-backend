# Financial agreement foundation (0020)

This additive migration publishes economic obligations, not funding. It creates
only private.financial_agreements and private.financial_components. Existing
activation payments remain legacy; no existing activation, face, reveal,
no-travel, or settlement function reads these tables or changes behavior.
No historical agreement or component is backfilled.

## Three launch obligations

| Component | Responsible member | Beneficiary |
| --- | --- | --- |
| offering_platform_share | Offering member | Platform |
| requester_platform_share | Primary requester | Platform |
| movement_contribution | Primary requester | Offering member |

Responsibility is not the identity of an external funding source. Collection may
eventually use different methods without changing these obligations. The
requester is responsible for the full contribution at launch; group split-pay is
deferred. The contribution offsets existing movement costs and is distinct from
the platform fee. This schema introduces no pricing formula or professional-driver
fare model.

The explicit model is shared_platform_fee_v1. Allocation policy
equal_split_requester_remainder_v1 uses nonnegative bigint arithmetic:
offering = total / 2; requester = total - total / 2. Thus 201 becomes 100/101,
200 becomes 100/100, and zero becomes zero/zero. The header total is validation
metadata, not a fourth collectible component. Currency is a three-uppercase-letter
code on the agreement; this format check is not provider/currency support approval.
Contribution price is a separate component amount, not a legacy activation fee or
an independently invented settlement amount.

## Publication, acceptance and versions

An INSERT publishes immutable terms. There is no editable draft state. Insert an
agreement and its three components in one transaction. Deferred constraint
triggers validate every version at commit, including versions superseded within
the same transaction. An incomplete version cannot be hidden by supersession.

The agreement records alignment_id, the alignment's exact offering_member_id and
member_needing_movement_id, positive version, explicit model/pricing/allocation
policy identifiers, currency, quoted total, creation time, two acceptance times,
and current/superseded status. Accepted current means both acceptance times are
set; it is derived, not another independently mutable status. Published terms are
immutable even before acceptance. Components are immutable from INSERT.

Acceptance timestamps begin NULL and may be set once by a trusted writer. They
cannot be cleared or changed. 0020 supplies no operational writer or client
acceptance RPC; future authenticated acceptance must derive identity and server
time, and cannot assert the other principal's consent. Timestamp storage alone
does not prove an actual user consent ceremony exists today.

Unique (alignment_id, version) preserves version identity. A partial unique index
allows at most one current version. Supersede the old version before inserting a
new current one in the same transaction. Old terms/acceptances remain, and no
acceptance is copied to the new version. Superseded versions cannot reopen or gain
new acceptance. Deletes are rejected; foreign keys do not cascade history away.

## Integrity and access

Each component key is constrained and unique per agreement. Deferred count=3
therefore proves the exact required key set. Deferred checks bind principals to
the authoritative, already immutable alignment principals and bind component
responsibility/beneficiary to that agreement. Platform beneficiaries cannot name
members. Exact quotient/remainder checks prove the fee sum without unsafe addition
on malformed bigint inputs.

Component construction locks the agreement row. Deferred validation locks that
agreement then reads its alignment FOR SHARE. Current-version uniqueness provides
the concurrent-writer backstop. Future writers must observe a consistent lock
order; serialization/deadlock errors require whole-transaction retry. The rollback
test is single-session, not a concurrent PostgreSQL test.

Both tables have RLS enabled and no client policies or table privileges. Service
role receives SELECT only, because no operational mutation path exists. Only a
trusted database owner can construct fixtures/agreements at this stage, subject
to the integrity triggers. Helpers are SECURITY DEFINER with empty search_path,
private, and revoked from PUBLIC, anon, authenticated and service_role. Database
owners able to disable triggers or alter schema remain outside this protection.

## Deliberately absent

No wallet, balance, credit ledger, charge, funding allocation, capture event,
refund eligibility/operation, payout, settlement deduction, or financial hold is
created. No agreement grants funding readiness, activation or entitlement. No
provider calls or money movement are implemented. Future accounting must retain
actual funding provenance separately from responsibility and prevent double
refund/payout. Platform shares are normally retained after activation, with
exceptional platform-fault refunds possible later; those policies are not
implemented as financial dispositions here.

## Integration order and tests

Next: trusted pricing/version presentation and both-principal acceptance; then
funding/charge provenance and idempotency; then new-model readiness and compatible
updates across legacy payment/reveal/no-travel checks; then holds, funded
settlement/refund eligibility; finally provider refund/payout execution. The
presence of an agreement must not silently switch the live financial model.

The rollback SQL expects 0001-0020 available, either installed or temporarily
installed in the same outer rollback transaction. It does not install 0020 itself.
It uses SET CONSTRAINTS ALL IMMEDIATE to execute deferred commit-time checks,
then finishes with ROLLBACK. Negative mutations are rolled back even if they
unexpectedly succeed. It creates no real provider/Storage operations. Legacy
payment and settlement fingerprints compare whatever history exists in the test
database; they may cover empty tables. It also verifies a concrete alignment's
legacy fields and state remain untouched.

Run local static checks with node supabase/tests/financial_agreement.test.cjs.
SQL behavioral execution against PostgreSQL and live concurrency validation are
separate from static checks. No remote SQL execution is part of this implementation.

## Second-pass audit and execution boundaries

No migration logic correction was needed in this review. The rollback and static
tests now explicitly cover separate component INSERT statements; missing one/two
component sets; totals 0, 1, 2, 3, 200, 201 and bigint maximum; malformed overflowing
share inputs; beneficiary shapes; deletion of current, accepted and superseded
history; immutable IDs/timestamps; and PUBLIC ACLs and actual RLS configuration.
These are executable PostgreSQL assertions, but have not yet been run in PostgreSQL.

An acceptance timestamp written to the identical value is a permitted no-op.
Component UPDATEs, including no-ops, are rejected. At most one current version is
allowed; having no current version is allowed. Version numbers are positive and
unique per alignment, not automatically sequential. A new version may change its
pricing identifier, but the only supported model/allocation identifiers remain
the two fixed launch values. The pricing identifier is metadata, not an implemented
pricing algorithm. The contribution may independently be zero or nonzero.

The installing database role owns the tables/functions; no ownership transfer is
performed. Use the trusted migration administrator, not an application role.
RLS is enabled without FORCE: the trusted owner must be able to construct and
validate records without client policies. Revoked grants independently deny app
access; service_role has SELECT only and no helper execution. Ownership and
BYPASSRLS are privileged trust boundaries, not client bypasses. Parent deletion
is blocked by NO ACTION foreign keys once financial history exists. Existing
parent tables and their deletion rules are not rewritten.

Repeated deferred checks read the final agreement/component state and acquire
locks, but perform no data mutations and cannot recursively enqueue themselves.
The rollback helper flushes valid pending work before each negative case, rolls
the attempted mutation back in a subtransaction, and restores DEFERRED mode.
Future writers can construct parent then three children, accept later, supersede,
and publish a new version in transactions. They need reviewed identity/consent,
consistent lock ordering and transaction retries; none is supplied by 0020.

For a future remote rollback test on 0001–0019, first verify the new object names
below are absent. Capture the existing public/private function definitions,
owners, ACLs and configuration, existing-table trigger definitions, and migration
history before executing anything. Recompare afterward. The test's own function
snapshot starts after the migration body, so it proves non-interference by the
test, not by migration installation. Static review establishes that 0020 defines
only new objects; an external before/after snapshot can verify this at runtime.

Do not execute migration 0020 unchanged first: its COMMIT would persist it.
Strip only its outer BEGIN/COMMIT and the test's outer BEGIN/ROLLBACK **in memory**,
then concatenate both bodies, in that order, inside one BEGIN / final ROLLBACK.
Submit the whole combined script once. Leave function/DO dollar-quoted bodies,
PL/pgSQL BEGIN/END blocks and SET CONSTRAINTS statements intact; they are not
outer transaction wrappers. Both files have only those outer transaction commands.
There is no legacy-data preflight or migration-history write in 0020.

Expect one named boolean row per behavioral check, all TRUE, followed by rollback.
If the editor stops on an exception, issue ROLLBACK before further work on that
connection. A FALSE result is a failed test, not permission to commit. No SQL has
been executed as part of this review. Whole-table history fingerprints assume no
concurrent external writer changes those tables during the comparison.

Before and after the rollback, all five values below must be NULL:

```sql
SELECT
  to_regclass('private.financial_agreements') AS agreements,
  to_regclass('private.financial_components') AS components,
  to_regprocedure('private.protect_financial_agreement()') AS agreement_guard,
  to_regprocedure('private.protect_financial_component()') AS component_guard,
  to_regprocedure('private.validate_financial_agreement()') AS validator;
```

The tables' indexes and four triggers disappear with their transactional creation.
Fixture data and temporary helpers also roll back. Existing objects are not
replaced by this migration. Compare the full history query before and after;
on the stated starting database it must still end at 0019:

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;
```

No live installation, history repair, deployment or provider call is needed for
this rollback preparation.
