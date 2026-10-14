'use strict';
// Consumer only: genuine adapter-owned context/services receipts.
const status = Object.freeze({ providerResultIngressConnected: false, manualLiveAuthorizationRequired: true });
let consume = null;
function takeObservation(...args) {
 try { if (!consume) throw Error(); return consume(...args); }
 catch { throw Error('Railway identity provider observation unavailable'); }
}
const exported = Object.assign(Object.create(null), { status, takeObservation });
module.exports = exported;
// Initialization only, never present after a completed normal import. This
// synchronous link gives this module the adapter's private consumer closure;
// ordinary code cannot retrieve that closure or install another consumer.
Object.defineProperty(exported, '_connectProjectServicesConsumer', { configurable: true, value(...args) {
 if (args.length !== 1 || consume || typeof args[0] !== 'function') throw Error('Railway identity provider observation unavailable');
 consume = args[0]; Reflect.deleteProperty(exported, '_connectProjectServicesConsumer'); Object.freeze(exported);
} });
require('./qualification-railway-https-adapter.cjs');
