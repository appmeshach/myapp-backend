'use strict';
// Preparation only: no transport, credentials, CLI, execution query or runtime intake.
const freeze = value => {
 if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
 return value;
};
const fail = () => { throw Error('Invalid local introspection evidence'); };
const exact = (value, keys) => {
 if (!value || typeof value !== 'object' || Array.isArray(value) ||
     Object.keys(value).sort().join('|') !== keys.slice().sort().join('|')) fail();
};
const name = value => { if (typeof value !== 'string' || !/^[_A-Za-z][_0-9A-Za-z]{0,127}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) fail(); return value; };
const KINDS = ['SCALAR', 'OBJECT', 'INTERFACE', 'UNION', 'ENUM', 'INPUT_OBJECT'];
// Fixed bounded wrapper selection. A deeper reference is rejected, never truncated.
const REF = 'kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }';
const documents = freeze({
 root: { operationName: 'Movement0106QueryRoot', source: 'query Movement0106QueryRoot { __schema { queryType { name } } }', establishes: ['query operation root name'] },
 type: { operationName: 'Movement0106ReferencedType', source: `query Movement0106ReferencedType($name: String!) {
 __type(name: $name) {
  kind name
  fields(includeDeprecated: true) { name args(includeDeprecated: true) { name defaultValue type { ${REF} } } type { ${REF} } }
  inputFields(includeDeprecated: true) { name defaultValue type { ${REF} } }
  enumValues(includeDeprecated: true) { name }
 }
}`, establishes: ['exact referenced type definition', 'arguments and defaults', 'wrapper nullability', 'input fields', 'enum membership'] },
});
function reference(value, depth = 0) {
 if (depth > 7) fail();
 if (!value || typeof value !== 'object') fail();
 if (['LIST', 'NON_NULL'].includes(value.kind)) {
  exact(value, ['kind', 'name', 'ofType']);
  if (value.name !== null || (value.kind === 'NON_NULL' && value.ofType?.kind === 'NON_NULL')) fail();
  return { kind: value.kind, name: null, ofType: reference(value.ofType, depth + 1) };
 }
 if (!KINDS.includes(value.kind)) fail();
 exact(value, depth === 7 ? ['kind', 'name'] : ['kind', 'name', 'ofType']);
 if (depth !== 7 && value.ofType !== null) fail();
 return { kind: value.kind, name: name(value.name), ofType: null };
}
const leaf = type => type.ofType ? leaf(type.ofType) : type;
function defaultLiteral(value) {
 if (value === null) return;
 if (typeof value !== 'string' || value.length > 4096) fail();
 // Bounded GraphQL constant-value grammar; variables/prose are never defaults.
 // Block strings require a later reviewed extension rather than guessing escapes.
 const tokens = value.match(/"(?:[^"\\\r\n]|\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4}))*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[_A-Za-z][_0-9A-Za-z]*|[\[\]{}:]|[\s,]+|./g) || [];
 const significant = tokens.filter(t => !/^[\s,]+$/.test(t));
 let position = 0;
 const parse = depth => {
  if (depth > 16) fail();
  const token = significant[position++];
  if (!token) fail();
  if (token === '[' || token === '{') {
   const end = token === '[' ? ']' : '}', names = new Set();
   while (significant[position] !== end) {
    if (token === '{') {
     const key = name(significant[position++]);
     if (names.has(key) || significant[position++] !== ':') fail(); names.add(key);
    }
    parse(depth + 1);
   }
   position++; return;
  }
  if (!/^(?:"(?:[^"\\\r\n]|\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4}))*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[_A-Za-z][_0-9A-Za-z]*)$/.test(token)) fail();
 };
 parse(0); if (position !== significant.length) fail();
}
function entries(values, convert) {
 if (!Array.isArray(values) || values.length > 2048) fail();
 const seen = new Set();
 return values.map(value => { const out = convert(value); if (seen.has(out.name)) fail(); seen.add(out.name); return out; });
}
function input(value) {
 exact(value, ['name', 'defaultValue', 'type']);
 defaultLiteral(value.defaultValue);
 const type = reference(value.type);
 if (!['SCALAR', 'ENUM', 'INPUT_OBJECT'].includes(leaf(type).kind)) fail();
 if (type.kind === 'NON_NULL' && value.defaultValue?.trim() === 'null') fail();
 // Preserve presence, not default literals: schema defaults are not runtime evidence.
 return { name: name(value.name), type, hasDefault: value.defaultValue !== null, required: type.kind === 'NON_NULL' && value.defaultValue === null };
}
function definition(value) {
 exact(value, ['kind', 'name', 'fields', 'inputFields', 'enumValues']);
 if (!KINDS.includes(value.kind)) fail();
 const out = { kind: value.kind, name: name(value.name), fields: null, inputFields: null, enumValues: null };
 if (['OBJECT', 'INTERFACE'].includes(value.kind)) {
  out.fields = entries(value.fields, field => {
   exact(field, ['name', 'args', 'type']); const type = reference(field.type);
   if (leaf(type).kind === 'INPUT_OBJECT') fail();
   return { name: name(field.name), args: entries(field.args, input), type };
  });
  if (!out.fields.length) fail();
 } else if (value.fields !== null) fail();
 if (value.kind === 'INPUT_OBJECT') out.inputFields = entries(value.inputFields, input);
 else if (value.inputFields !== null) fail();
 if (out.inputFields && !out.inputFields.length) fail();
 if (value.kind === 'ENUM') {
  out.enumValues = entries(value.enumValues, v => { exact(v, ['name']); return { name: name(v.name) }; });
  if (!out.enumValues.length) fail();
 } else if (value.enumValues !== null) fail();
 // Polymorphic outputs require possibleTypes discovery, outside this bounded plan.
 if (['INTERFACE', 'UNION'].includes(out.kind)) fail();
 return out;
}
const states = new WeakMap();
const OUTPUT_FIELDS = ['edges', 'node', 'nodes', 'pageInfo', 'cursor', 'hasNextPage', 'hasPreviousPage', 'startCursor', 'endCursor', 'id', 'deploymentId', 'environmentId', 'serviceId', 'status', 'createdAt', 'updatedAt', 'completedAt', 'deploymentMeta'];
function start() {
 const session = Object.freeze({});
 states.set(session, { root: null, pending: [{ stage: 'root' }], types: {}, expectedKinds: {}, paths: [] });
 return session;
}
function state(session) { const value = states.get(session); if (!value) fail(); return value; }
function next(session) {
 const pending = state(session).pending[0];
 if (!pending) return null;
 return freeze({ document: documents[pending.stage === 'root' ? 'root' : 'type'], variables: pending.stage === 'root' ? {} : { name: pending.name }, discoveredAt: pending.path || '__schema.queryType.name' });
}
function accept(session, response) {
 const s = state(session), pending = s.pending[0];
 if (!pending) fail();
 exact(response, ['data']);
 if (pending.stage === 'root') {
  exact(response.data, ['__schema']); exact(response.data.__schema, ['queryType']); exact(response.data.__schema.queryType, ['name']);
  const root = name(response.data.__schema.queryType.name);
  s.root = root; s.expectedKinds[root] = 'OBJECT';
  s.pending = [{ stage: 'type', name: root, path: '__schema.queryType.name', role: 'root' }];
  return evidence(session);
 }
 exact(response.data, ['__type']);
 const type = definition(response.data.__type);
 if (type.name !== pending.name || type.kind !== s.expectedKinds[type.name]) fail();
 const additions = [], expectations = { ...s.expectedKinds }, paths = [];
 const discover = (ref, path, role) => {
  const target = leaf(ref);
  if (expectations[target.name] && expectations[target.name] !== target.kind) fail();
  expectations[target.name] = target.kind;
  paths.push({ path, type: ref });
  if (!s.types[target.name] && target.name !== type.name && !s.pending.some(p => p.name === target.name) && !additions.some(p => p.name === target.name))
   additions.push({ stage: 'type', name: target.name, path, role });
 };
 if (pending.role === 'root') {
  const field = type.fields.find(f => f.name === 'deploymentInstanceExecutions');
  if (!field) fail(); // No guessed parent traversal or whole-schema fallback.
  field.args.forEach(arg => discover(arg.type, `${type.name}.${field.name}.args.${arg.name}`, 'input'));
  discover(field.type, `${type.name}.${field.name}.type`, 'output');
 } else if (type.kind === 'INPUT_OBJECT') {
  type.inputFields.forEach(field => discover(field.type, `${type.name}.inputFields.${field.name}`, 'input'));
 } else if (type.kind === 'OBJECT') {
  type.fields.filter(f => OUTPUT_FIELDS.includes(f.name)).forEach(field => {
   field.args.forEach(arg => discover(arg.type, `${type.name}.${field.name}.args.${arg.name}`, 'input'));
   discover(field.type, `${type.name}.${field.name}.type`, 'output');
  });
 }
 if (Object.keys(expectations).length > 64) fail();
 // Validate/discover from the complete raw definition above, then deliberately
 // store only reviewed investigation facts. Unrelated signatures never persist.
 const retained = type.kind === 'SCALAR' ? { kind: type.kind, name: type.name } : {
  ...type,
  fields: type.kind === 'OBJECT' ? type.fields.filter(field => pending.role === 'root'
   ? field.name === 'deploymentInstanceExecutions' : OUTPUT_FIELDS.includes(field.name)) : null,
 };
 s.types[type.name] = retained; s.expectedKinds = expectations; s.paths.push(...paths);
 s.pending = s.pending.slice(1).concat(additions);
 return evidence(session);
}
function evidence(session) {
 const s = state(session);
 // Introspection proves syntax, never pagination exhaustion, scope enforcement or ordering.
 return freeze(JSON.parse(JSON.stringify({ root: s.root, field: 'deploymentInstanceExecutions', types: s.types, references: s.paths,
  stagedDiscoveryComplete: s.pending.length === 0,
  executionSchemaReady: false,
  blockers: [...(s.pending.length ? ['incomplete_staged_discovery'] : []), 'execution_node_path_requires_review', 'scope_semantics_unproven', 'ordering_semantics_unproven', 'pagination_cursor_and_completeness_semantics_unproven'],
 })));
}
function finish(session) { if (state(session).pending.length) fail(); return evidence(session); }
function executionSchemaReady(session) { return evidence(session).executionSchemaReady; }
const runtimeProvenance = freeze({ candidates: [], blocker: 'runtime_identity_provenance_unresolved', identity_proven: null, causality_proven: null, restart_origin_proven: null, platformRestart: null, restartAttribution: { measurement: null, limitation: 'restart_origin_unattributable' } });
module.exports = Object.freeze({ documents, start, next, accept, evidence, finish, executionSchemaReady, runtimeProvenance });
