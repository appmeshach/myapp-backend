'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const targets = require('../../../scripts/assessment-worker/qualification-railway-introspection-target.cjs');
const context = require('../../../scripts/assessment-worker/qualification-railway-project-token-context.cjs');
const { loadIdentity } = require('./0111-target-identity.cjs');
const categories = ['projectIds', 'environmentIds', 'serviceIds', 'serviceInstanceIds'];
const scope = { environmentKind: 'disposable', lifecycle: 'active', projectId: 'synthetic-project', environmentId: 'synthetic-env', serviceId: 'synthetic-service', serviceInstanceId: null };
const clone = v => JSON.parse(JSON.stringify(v));
const empty = () => ({ inventoryReviewed: true, ...Object.fromEntries(categories.map(k => [k, { reviewed: true, ids: [] }])) });
const binding = () => targets.bindTarget(scope, scope, { inventoryReviewed: true, ...Object.fromEntries(categories.map(k => [k, []])) });
function identityFixture(capture = false) {
 const h = loadIdentity(capture), target = binding(), session = h.api.startTargetIdentitySession(target), execution = Object.freeze({});
 h.api.acceptContextObservation(session, h.issue({ kind: 'project_token_context', session, binding: target, executionContext: execution,
  endpoint: 'https://backboard.railway.com/graphql/v2', authKind: 'project_token', request: context.buildRequest(),
  body: { data: { projectToken: { projectId: scope.projectId, environmentId: scope.environmentId } } } }));
 return { ...h, target, session, execution };
}
const serviceBody = () => ({ data: { project: { id: scope.projectId, services: {
 edges: [{ node: { id: scope.serviceId, name: 'myapp-backend' } }], pageInfo: { hasNextPage: false } } } } });
function observe(f, body = serviceBody()) {
 const review = f.api.reviewNextIdentityRequest(f.session);
 const permit = f.api.approveIdentityReview(review, { ...review.meta, reviewed: true });
 const handoff = f.api.consumeIdentityPermitForFutureAdapter(permit, f.session);
 const receipt = f.api.takeIdentityHandoffForFutureAdapter(handoff, f.session, f.execution);
 return f.api.acceptIdentityObservation(f.session, receipt.invocation, f.issue({ ...receipt,
  endpoint: 'https://backboard.railway.com/graphql/v2', authKind: 'project_token', body }));
}
function serviceFixture(capture = false) { const f = identityFixture(capture); observe(f); return f; }
const serviceAck = review => ({ ...clone(review), reviewed: true });
function acquisitionFixture() {
 const file = path.resolve(__dirname, '../../../scripts/assessment-worker/qualification-railway-live-authorization.cjs');
 const source = fs.readFileSync(file, 'utf8'), code = { reviewedHead: 'a'.repeat(40), reviewedBranch: 'feature/0092-shared-segment-suitability' };
 const drift = { ...code, files: new Map() };
 const sandbox = { module: { exports: {} }, Buffer, __dirname: path.dirname(file), __filename: file, require(name) {
  if (name === 'node:fs') return { existsSync: fs.existsSync, readFileSync: (p, enc) => drift.files.has(p) ? drift.files.get(p) : fs.readFileSync(p, enc) };
  if (name === 'node:child_process') return { execFileSync(command, args, options) {
   assert.equal(command, 'git'); assert.deepEqual(Object.keys(options.env), []); assert.equal(options.shell, false);
   const action = args.slice(2).join(' ');
   if (action === 'rev-parse HEAD') return drift.reviewedHead;
   if (action === 'branch --show-current') return drift.reviewedBranch;
   assert.fail('Unexpected subprocess');
  } };
  if (name.startsWith('./')) return require(path.resolve(path.dirname(file), name));
  assert.ok(['node:path', 'node:crypto'].includes(name)); return require(name);
 } };
 require('./0114d-authorization-loader.cjs').loadAuthorizationSandbox(source, sandbox, file);
 const api = sandbox.module.exports, target = binding(), draft = api.createAcquisitionDraft(target, empty(), code);
 return { api, target, draft, drift, file };
}
const acquisitionAck = review => ({ reviewed: true, manifest: clone(review.manifest), manifestSha256: review.manifestSha256, liveAuthorized: false });
module.exports = { categories, scope, clone, empty, binding, identityFixture, serviceFixture, observe, serviceBody, serviceAck, acquisitionFixture, acquisitionAck };
