'use strict';
// Local payload construction only. No credentials, environment intake or transport.
const crypto = require('node:crypto');
const plan = require('./qualification-railway-introspection-plan.cjs');
const HASHES = Object.freeze({ root: 'c2d77d8ecb5af73166ce944034246eb70160ad7d5f7610c7c5e2c425fcb0f9aa', type: '767e872ef31749fc65294af899f50da35cd0b50cb866b31809a7736e7fbdefa7' });
const fail = () => { throw Error('Introspection request preflight unavailable'); };
function verifyDocuments(...args) {
 if (args.length) fail();
 for (const [key, operationName] of Object.entries({ root: 'Movement0106QueryRoot', type: 'Movement0106ReferencedType' })) {
  const doc = plan.documents[key];
  if (!doc || typeof doc.source !== 'string' || doc.operationName !== operationName ||
   crypto.createHash('sha256').update(doc.source + '\n', 'utf8').digest('hex') !== HASHES[key]) fail();
 }
 return HASHES;
}
function buildRequest(...args) {
 if (args.length !== 1) fail();
 verifyDocuments();
 let next;
 try { next = plan.next(args[0]); } catch { fail(); }
 if (!next) fail();
 const root = next.document === plan.documents.root, type = next.document === plan.documents.type;
 if (!root && !type) fail();
 if (Object.keys(next.variables).sort().join('|') !== (root ? '' : 'name')) fail();
 if (type && (typeof next.variables.name !== 'string' || !/^[_A-Za-z][_0-9A-Za-z]{0,127}$/.test(next.variables.name))) fail();
 return Object.freeze({ query: next.document.source, operationName: next.document.operationName,
  variables: Object.freeze(root ? {} : { name: next.variables.name }) });
}
module.exports = Object.freeze({ verifyDocuments, buildRequest });
