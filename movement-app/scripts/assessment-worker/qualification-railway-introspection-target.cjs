'use strict';
// Operator assertions only: a binding does not authenticate a provider or runtime.
const crypto = require('node:crypto');
const bindings = new WeakMap();
const fail = () => { throw Error('Introspection target preflight unavailable'); };
function exact(v, keys) {
 if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join('|') !== keys.slice().sort().join('|')) fail();
}
const identifier = v => {
 if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v) || /sb_secret_|^eyJ|privatekey|railway.*token/i.test(v)) fail();
 return v;
};
const KEYS = ['environmentKind', 'lifecycle', 'projectId', 'environmentId', 'serviceId', 'serviceInstanceId'];
function scope(value) {
 exact(value, KEYS);
 if (value.environmentKind !== 'disposable' || value.lifecycle !== 'active') fail();
 for (const key of ['projectId', 'environmentId', 'serviceId']) identifier(value[key]);
 if (value.serviceInstanceId !== null) identifier(value.serviceInstanceId);
 return Object.fromEntries(KEYS.map(key => [key, value[key]]));
}
function bindTarget(...args) {
 if (args.length !== 3) fail();
 const [expected, selected, denylist] = args, approved = scope(expected), actual = scope(selected);
 for (const key of KEYS) if (approved[key] !== actual[key]) fail();
 exact(denylist, ['inventoryReviewed', 'projectIds', 'environmentIds', 'serviceIds', 'serviceInstanceIds']);
 if (denylist.inventoryReviewed !== true) fail();
 for (const [plural, singular] of Object.entries({ projectIds: 'projectId', environmentIds: 'environmentId', serviceIds: 'serviceId', serviceInstanceIds: 'serviceInstanceId' })) {
  const values = denylist[plural];
  if (!Array.isArray(values) || values.length > 256 || new Set(values).size !== values.length) fail();
  values.forEach(identifier);
  if (actual[singular] !== null && values.includes(actual[singular])) fail();
 }
 const digest = crypto.createHash('sha256').update(JSON.stringify(approved)).digest('hex');
 const binding = Object.freeze({});
 bindings.set(binding, Object.freeze({ ...approved, constraintCategory: 'operator_plan_constraints', targetSha256: digest,
  independentlyAuthoritative: false, identity_proven: null }));
 return binding;
}
function describeTarget(...args) {
 if (args.length !== 1 || !bindings.has(args[0])) fail();
 return bindings.get(args[0]);
}
module.exports = Object.freeze({ bindTarget, describeTarget });
