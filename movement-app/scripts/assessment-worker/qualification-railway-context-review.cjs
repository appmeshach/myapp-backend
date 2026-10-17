'use strict';
// Fixed context review tickets; no credentials or transport. Schema ownership
// remains in 0107. Public detached records cannot manufacture either handoff.
const context = require('./qualification-railway-project-token-context.cjs');
const targets = require('./qualification-railway-introspection-target.cjs');
const preflight = require('./qualification-railway-introspection-preflight.cjs');
const contract = require('./qualification-railway-transport-contract.cjs').contract;
const reviews = new WeakMap(), permits = new WeakMap(), handoffs = new WeakMap();
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const fail = () => { throw Error('Railway context review unavailable'); };
function reviewProjectTokenContext(...args) {
 if (args.length !== 1) fail();
 const binding = args[0]; let target, request;
 try { target = targets.describeTarget(binding); request = context.buildRequest(); } catch { fail(); }
 const meta = freeze({ operationName: request.operationName, querySha256: context.canonicalSha256,
  targetSha256: target.targetSha256, endpoint: contract.endpoint, authKind: contract.preferredAuthKind,
  executionSchemaReady: false, providerContextObserved: false, manualReviewRequired: true });
 const review = freeze({ meta, artifacts: { graphql: request.query + '\n', variablesJson: '{}\n', metaJson: JSON.stringify(meta) + '\n' } });
 reviews.set(review, { binding, request, meta }); return review;
}
function approveProjectTokenContextReview(...args) {
 if (args.length !== 2) fail();
 const [review, ack] = args, record = reviews.get(review);
 if (!record || !ack || typeof ack !== 'object' || Array.isArray(ack) ||
  Object.keys(ack).sort().join('|') !== ['reviewed', ...Object.keys(record.meta)].sort().join('|') || ack.reviewed !== true) fail();
 for (const key of Object.keys(record.meta)) if (ack[key] !== record.meta[key]) fail();
 reviews.delete(review); const permit = Object.freeze({}); permits.set(permit, record); return permit;
}
function consumeProjectTokenContextPermitForAdapter(...args) {
 if (args.length !== 2) fail();
 const [permit, binding] = args, record = permits.get(permit);
 if (!record) fail(); permits.delete(permit);
 if (record.binding !== binding) fail();
 let request;
 try { targets.describeTarget(binding); request = context.buildRequest(); } catch { fail(); }
 if (JSON.stringify(request) !== JSON.stringify(record.request)) fail();
 const handoff = Object.freeze({});
 handoffs.set(handoff, Object.freeze({ kind: 'context', permit, binding, request: record.request, meta: record.meta }));
 return handoff;
}
function takeAdapterHandoff(...args) {
 if (args.length !== 2) fail();
 const [handoff, binding] = args, record = handoffs.get(handoff);
 if (!record) {
  try { return preflight.takeSchemaHandoffForAdapter(handoff, binding); } catch { fail(); }
 }
 handoffs.delete(handoff);
 if (record.binding !== binding) fail();
 let request;
 try { targets.describeTarget(binding); request = context.buildRequest(); } catch { fail(); }
 if (JSON.stringify(request) !== JSON.stringify(record.request)) fail();
 return record;
}
module.exports = Object.freeze({ reviewProjectTokenContext, approveProjectTokenContextReview,
 consumeProjectTokenContextPermitForAdapter, takeAdapterHandoff });
