# 0114K PR #35 pre-merge identity remediation report

## Outcome and boundary

Outcome: `PRE_MERGE_IDENTITY_REMEDIATION_IMPLEMENTED_VALIDATED_REVIEW_PENDING`.

PR #35 merge readiness was blocked because GitHub Actions checks out the generated
PR merge ref with detached HEAD, while production `verifyCodeIdentity` intentionally
requires the exact reviewed commit and the literal symbolic branch
`feature/0092-shared-segment-suitability`. The production rule remains strict and
unchanged. The GitHub Actions workflow remains unchanged and continues to exercise
the base-plus-PR-head merge ref.

This implementation changed only the two authorized test files and this report plus
the readiness register. It added no runtime hook, exported setter, environment
switch, CI bypass, branch override, caller-controlled branch authority, or GitHub
environment authority. Runtime, workflow, fixtures, templates, migrations,
dependencies, package/evidence, `package.json`, and `run.cjs` remain unchanged.
Nothing was staged, committed, pushed, merged, rebased, deployed, or promoted. No
provider, Railway, Supabase project API, production, credential, or secret access
occurred. The protected `0102-remote-fixtures.capsule` remained unread, unhashed,
unmodified, untracked, and unstaged.

Starting and final HEAD:
`db3c8c1e5f97369e5814876ea32f7c64eea7e7a4`. The branch remained
`feature/0092-shared-segment-suitability`, the remote feature head remained the same
commit, and the index remained empty.

## Test remediation

`0110_railway_first_live_preflight.test.cjs` now checks named-branch identity through
its existing private VM/Git substitution. The exact synthetic reviewed HEAD and
branch pass. A detached symbolic branch (`""`), wrong named branch, and wrong HEAD
fail. Existing review- and issuance-time branch drift tests, the extraction-time
burn-on-drift test, and the ordinary inert-template checks remain intact.

`0114e_acquisition_input_review.test.cjs` now uses the existing private
`loadAcquisition()` fixture for current executable identity. Exact synthetic current
identity passes. Detached branch, wrong branch, and wrong HEAD fail. Historical
assessment metadata fails against a distinct synthetic current identity. The
historical/current distinction, current source-hash comparison, and inert
package/template validation remain fail-closed.

These substitutions are test-local. Normal runtime imports retain real Git process
observation, and an arbitrary detached commit or GitHub PR merge ref cannot acquire
executable review authority. `CI`, `GITHUB_SHA`, `GITHUB_REF`, `GITHUB_HEAD_REF`, and
`GITHUB_BASE_REF` remain non-authoritative.

## Source identity

Production runtime bytes did not change. Direct current-identity verification
returned authorization self-hash
`a1da1eec17b431009e8b580fe0480884b73d4c05334ec860c19c66c46b53d178`,
source-role count 13, and successful validation of all 13 unchanged role hashes.
No source pin or template was regenerated. No PTY rerun was required because runtime
bytes did not change.

## Validation

All required local/offline gates passed:

- Exact 14 focused suites: 1,528 total, 1,528 passed, 0 failed, 0 skipped.
- Exact 19 regression paths: 1,117 total, 1,114 passed, 0 failed, 3 established
  Windows skips.
- TypeScript scopes: root, Supabase functions, and assessment worker passed 3/3.
- Full portable `node ./node_modules/typescript/bin/tsc --noEmit`: passed.
- Full portable `node --test`: 4,593 total, 4,589 passed, 0 failed, 4 established
  skips.
- `git diff --check`: passed.

The former three checkout-dependent CI failures now pass under isolated synthetic
Git identity while retaining the production rejection semantics.

## Narrow security analysis

The remediation-specific read-only analysis passed with no blocking ambiguity:

1. Production runtime has no diff.
2. `.github/workflows/movement-ci.yml` has no diff.
3. No test-only hook or exported test API entered production.
4. No environment-based or GitHub-metadata authority was added.
5. Detached symbolic branch is rejected.
6. Wrong HEAD is rejected.
7. Wrong named branch is rejected.
8. Historical identity cannot become current executable authority.
9. The synthetic Git fixtures are private VM/module-loader substitutions and cannot
   affect normal runtime imports.
10. GitHub's default PR merge-ref integration coverage remains intact.
11. The authorization self-hash is unchanged.
12. All 13 source-role hashes are unchanged and verified.

A separate narrow identity/security review is still required. PR #35 should remain
draft, and merge remains unauthorized. This report grants no provider, live,
deployment, production, package-promotion, migration, credential, or secret authority.

## Post-merge future design - not implemented

After an eventual normal merge, executable use on `main` remains unauthorized until
a separately authorized post-merge identity remediation and review are complete. The
planned future design distinguishes private compile-time constants:

- `REVIEWED_CODE_BRANCH = main`
- `RAILWAY_TARGET_BRANCH = feature/0092-shared-segment-suitability`

This split is future design only. Runtime has not been split. It will require a new
reviewed HEAD, authorization self-hash, review package, focused and regression
validation, TypeScript validation, PTY/VM acceptance, semantic security gate, and
independent implementation review.
