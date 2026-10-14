'use strict';
// Consumer only: adapter-owned context receipts, never arbitrary records.
const adapter = require('./qualification-railway-https-adapter.cjs');
const status = Object.freeze({ providerResultIngressConnected: false, manualLiveAuthorizationRequired: true });
function takeObservation(...args) {
 // Forward all argument counts so an owned T is burned even on wrong arity.
 try { return adapter.consumeContextResultTransfer(...args); }
 catch { throw Error('Railway identity provider observation unavailable'); }
}
module.exports = Object.freeze({ status, takeObservation });
