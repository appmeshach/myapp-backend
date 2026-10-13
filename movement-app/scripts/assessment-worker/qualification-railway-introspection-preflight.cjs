'use strict';
// Private local review tickets, never a live executor or unattended discovery loop.
const plan = require('./qualification-railway-introspection-plan.cjs');
const builder = require('./qualification-railway-introspection-request.cjs');
const targets = require('./qualification-railway-introspection-target.cjs');
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const contract = freeze({ outcome: 'TRANSPORT_NOT_READY', endpoint: null, authenticationSyntax: null,
 authVariableNameAllowlist: [], interface: 'executeReadonlyIntrospection({target,request}) -> GraphQL body only',
 capture: 'local_body_only_then_0106_validation', executionSchemaReady: false,
 ...plan.runtimeProvenance });
const reviews = new WeakMap(), permits = new WeakMap();
const fail = () => { throw Error('Introspection review preflight unavailable'); };
function reviewNext(...args) {
 if (args.length !== 2) fail();
 const [session, binding] = args;
 let request, target, next;
 try { request = builder.buildRequest(session); target = targets.describeTarget(binding); next = plan.next(session); } catch { fail(); }
 const meta = freeze({ operationName: request.operationName, querySha256: builder.verifyDocuments()[next.document === plan.documents.root ? 'root' : 'type'],
  stagedTypeName: request.variables.name ?? null, discoveryPath: next.discoveredAt, targetSha256: target.targetSha256,
  executionSchemaReady: false, manualReviewRequired: true, transportReadiness: 'TRANSPORT_NOT_READY' });
 const review = freeze({ meta, artifacts: { graphql: request.query + '\n', variablesJson: JSON.stringify(request.variables) + '\n', metaJson: JSON.stringify(meta) + '\n' } });
 reviews.set(review, { session, binding, request, meta });
 return review;
}
function approveReview(...args) {
 if (args.length !== 2) fail();
 const [review, acknowledgement] = args, record = reviews.get(review);
 if (!record || !acknowledgement || typeof acknowledgement !== 'object' || Array.isArray(acknowledgement) ||
  Object.keys(acknowledgement).sort().join('|') !== ['reviewed', ...Object.keys(record.meta)].sort().join('|') || acknowledgement.reviewed !== true) fail();
 for (const key of Object.keys(record.meta)) if (acknowledgement[key] !== record.meta[key]) fail();
 const permit = Object.freeze({}); permits.set(permit, record); reviews.delete(review);
 return permit;
}
function consumeApprovedRequest(...args) {
 if (args.length !== 1) fail();
 const record = permits.get(args[0]); if (!record) fail();
 permits.delete(args[0]); // One attempt only, including a stale-stage rejection.
 let request, target;
 try { request = builder.buildRequest(record.session); target = targets.describeTarget(record.binding); } catch { fail(); }
 if (JSON.stringify(request) !== JSON.stringify(record.request) || target.targetSha256 !== record.meta.targetSha256) fail();
 return freeze({ target, request }); // Descriptive future invocation, not an execution.
}
function acceptResponseBody(...args) {
 if (args.length !== 2) fail();
 try { return plan.accept(args[0], args[1]); } catch { fail(); }
}
module.exports = Object.freeze({ contract, reviewNext, approveReview, consumeApprovedRequest, acceptResponseBody });
