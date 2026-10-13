'use strict';
// Fixed read-only context payload and untrusted local response validation only.
const crypto = require('node:crypto');
const targets = require('./qualification-railway-introspection-target.cjs');
const document = Object.freeze({ operationName: 'Movement0108ProjectTokenContext', source: `query Movement0108ProjectTokenContext {
  projectToken {
    projectId
    environmentId
  }
}` });
const fail = () => { throw Error('Railway project token context unavailable'); };
function exact(value, keys) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== keys.slice().sort().join('|')) fail();
}
function identifier(value) {
 // Existing operator identifier convention, not a token-format validator.
 if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) || /sb_secret_|^eyJ|privatekey|railway.*token/i.test(value)) fail();
 return value;
}
// Canonical reviewed source plus exactly one LF; no working-tree byte dependency.
const CANONICAL_SHA256 = 'd3190e45cbf0ec1242ef090a9a5a437c4043a5e7542b075921744349b8039e28';
function buildRequest(...args) {
 if (args.length || crypto.createHash('sha256').update(document.source + '\n', 'utf8').digest('hex') !== CANONICAL_SHA256) fail();
 return Object.freeze({ query: document.source, operationName: document.operationName, variables: Object.freeze({}) });
}
function validateContextResponse(...args) {
 if (args.length !== 2) fail();
 const [privateTarget, body] = args;
 let target;
 try { target = targets.describeTarget(privateTarget); } catch { fail(); }
 exact(body, ['data']); exact(body.data, ['projectToken']);
 exact(body.data.projectToken, ['projectId', 'environmentId']);
 const projectId = identifier(body.data.projectToken.projectId), environmentId = identifier(body.data.projectToken.environmentId);
 if (projectId !== target.projectId || environmentId !== target.environmentId) fail();
 // Equality is a local validation fact, not proof this body came from Railway.
 return Object.freeze({ projectId, environmentId });
}
module.exports = Object.freeze({ document, canonicalSha256: CANONICAL_SHA256, buildRequest, validateContextResponse });
