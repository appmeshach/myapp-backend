const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const need = id(1), availability = id(2), otherAvailability = id(3), evidence = id(4), interest = id(5);
const time = '2026-09-25T12:00:00Z';
const plain = value => JSON.parse(JSON.stringify(value));
const cache = new Map();
function load(file, stubs) {
  if (!cache.has(file)) cache.set(file, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  const exports = {};
  vm.runInNewContext(cache.get(file), { exports, Error, Date, console,
    require(name) {
      if (name in stubs) return stubs[name];
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const write = { interest_id: interest, interest_status: 'active', created_at: time };
const row = {
  interest_id: interest, movement_need_id: need, availability_id: availability,
  origin_area: 'Broad origin', destination_area: 'Broad destination', people_count: 2,
  earliest_departure_at: time, latest_departure_at: null,
  requester_origin_distance_to_route_meters: 250000, interest_created_at: time,
};
const input = { requestId: id(6), movementNeedId: need, availabilityId: availability, routeMatchEvidenceId: evidence };
function service(data, error = null) {
  const calls = [];
  const api = load('src/services/requesterMovementInterestService.ts', {
    '../lib/supabase': { supabase: { rpc: async (...args) => { calls.push(plain(args)); return { data, error }; } } },
  });
  return { api, calls };
}

test('create service maps exact RPC arguments and narrow result', async () => {
  const h = service([write]);
  assert.deepEqual(plain(await h.api.createRequesterMovementInterest(input)),
    { interestId: interest, interestStatus: 'active', createdAt: time });
  assert.deepEqual(h.calls, [['create_requester_movement_interest', {
    p_request_id: id(6), p_movement_need_id: need, p_availability_id: availability, p_route_match_evidence_id: evidence,
  }]]);
});
test('create service rejects syntactically valid withdrawn and expired responses', async () => {
  for (const status of ['withdrawn', 'expired']) {
    const h = service([{ ...write, interest_status: status }]);
    await assert.rejects(h.api.createRequesterMovementInterest(input),
      { message: 'requester_interest_response_invalid' });
  }
});
test('write parser rejects malformed responses and unexpected private fields', async () => {
  for (const data of [null, {}, [], [write, write], [null], [{ ...write, interest_id: 'bad' }],
    [{ ...write, interest_status: 'accepted' }], [{ ...write, created_at: 'bad' }],
    [{ ...write, created_at: null }], [{ ...write, member_id: id(9) }], [{ interest_id: interest }]]) {
    await assert.rejects(service(data).api.createRequesterMovementInterest(input), /response_invalid/);
  }
});
test('invalid create UUIDs fail before RPC', async () => {
  for (const key of Object.keys(input)) {
    const h = service([write]);
    await assert.rejects(h.api.createRequesterMovementInterest({ ...input, [key]: 'bad' }), /invalid_requester_interest/);
    assert.equal(h.calls.length, 0);
  }
});
test('withdraw maps exact ID and requires matching withdrawn result', async () => {
  const h = service([{ ...write, interest_status: 'withdrawn' }]);
  assert.equal((await h.api.withdrawRequesterMovementInterest(interest)).interestStatus, 'withdrawn');
  assert.deepEqual(h.calls, [['withdraw_requester_movement_interest', { p_interest_id: interest }]]);
  for (const data of [[write], [{ ...write, interest_id: id(9), interest_status: 'withdrawn' }], [], null]) {
    await assert.rejects(service(data).api.withdrawRequesterMovementInterest(interest), /response_invalid/);
  }
});
test('inbox service maps exact filter limit and safe fields without ranking', async () => {
  const h = service([row, { ...row, interest_id: id(7), requester_origin_distance_to_route_meters: 0 }]);
  const result = plain(await h.api.listRequesterMovementInterestsForOfferer({ availabilityId: availability, limit: 20 }));
  assert.deepEqual(h.calls, [['list_requester_movement_interests_for_offerer', { p_availability_id: availability, p_limit: 20 }]]);
  assert.deepEqual(result[0], {
    interestId: interest, movementNeedId: need, availabilityId: availability,
    originArea: 'Broad origin', destinationArea: 'Broad destination', peopleCount: 2,
    earliestDepartureAt: time, latestDepartureAt: null, requesterOriginDistanceToRouteMeters: 250000, interestCreatedAt: time,
  });
  assert.equal(result[1].interestId, id(7));
});
test('inbox omitted or null availability maps to null with default limit', async () => {
  for (const input of [undefined, {}, { availabilityId: null }]) {
    const h = service([]);
    assert.deepEqual(plain(await h.api.listRequesterMovementInterestsForOfferer(input)), []);
    assert.deepEqual(h.calls[0][1], { p_availability_id: null, p_limit: 20 });
  }
});
test('inbox malformed rows fail closed rather than showing partial results', async () => {
  const bad = [null, {}, { ...row, people_count: 0 }, { ...row, people_count: 1.5 },
    { ...row, interest_id: 'bad' }, { ...row, movement_need_id: 'bad' }, { ...row, availability_id: otherAvailability },
    { ...row, origin_area: ' ' }, { ...row, destination_area: null }, { ...row, earliest_departure_at: 'bad' },
    { ...row, latest_departure_at: '2000-01-01' }, { ...row, latest_departure_at: undefined },
    { ...row, requester_origin_distance_to_route_meters: -1 },
    { ...row, requester_origin_distance_to_route_meters: Infinity }, { ...row, interest_created_at: 'bad' },
    { ...row, route_match_evidence_id: evidence }, { ...row, latitude: 4 }, { ...row, rating: 5 }];
  for (const invalid of bad) {
    await assert.rejects(service([{ ...row, interest_id: id(8) }, invalid]).api
      .listRequesterMovementInterestsForOfferer({ availabilityId: availability }), /response_invalid/);
  }
  for (const data of [null, {}, [row, row]]) {
    await assert.rejects(service(data).api.listRequesterMovementInterestsForOfferer(), /response_invalid/);
  }
});
test('inbox invalid filter or limit fails before network', async () => {
  for (const input of [{ availabilityId: 'bad' }, { limit: 0 }, { limit: 51 }, { limit: null }, { limit: 1.5 }]) {
    const h = service([]);
    await assert.rejects(h.api.listRequesterMovementInterestsForOfferer(input), /invalid_requester_interest_inbox/);
    assert.equal(h.calls.length, 0);
  }
});
test('expected RPC failures never expose database messages', async () => {
  for (const [method, args] of [['createRequesterMovementInterest', [input]],
    ['withdrawRequesterMovementInterest', [interest]], ['listRequesterMovementInterestsForOfferer', [{}]]]) {
    await assert.rejects(service(null, { message: 'private database detail', code: '23514' }).api[method](...args),
      error => !error.message.includes('private') && /unavailable/.test(error.message));
  }
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (node.type === 'Modal' && !node.props.visible) return '';
  return text(node.props?.children);
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (node.type === 'Modal' && !node.props.visible) return [];
  return [node, ...nodes(node.props?.children)];
}
const match = { state: 'ready', routeMatchEvidenceId: evidence, routeMatchEvidenceVersion: 1,
  routeMatchEvidenceStatus: 'current', routeMatchEvidenceExpiresAt: null, straightLineDistanceFromRouteMeters: 250000 };
const offered = a => ({ availabilityId: a, originArea: `Origin ${a}`, destinationArea: 'Destination',
  earliestDepartureAt: time, latestDepartureAt: null, remainingPlaces: 3, make: 'Make', model: 'Model', year: 2020, color: 'Blue' });
const inboxRow = { interestId: interest, movementNeedId: need, availabilityId: availability,
  originArea: 'Broad origin', destinationArea: 'Broad destination', peopleCount: 2,
  earliestDepartureAt: time, latestDepartureAt: time, requesterOriginDistanceToRouteMeters: 250000, interestCreatedAt: time };

// Same transpile/VM and lightweight hook-render approach as existing UI tests.
// Actions go through real screen handlers; no internal screen state is seeded.
function screen(kind) {
  const values = [], effects = [], calls = [];
  let cursor = 0, dirty = true, tree, serial = 100, mounted = true;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], next => { assert(mounted, 'state update after unmount');
        values[i] = typeof next === 'function' ? next(values[i]) : next; dirty = true; }];
    },
    useRef(initial) { const i = cursor++; return values[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!values[i] || !same(values[i].deps, deps)) values[i] = { fn, deps }; return values[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!values[i] || !same(values[i].deps, deps)) {
      const old = values[i]; values[i] = { deps }; effects.push(() => { old?.cleanup?.(); values[i].cleanup = fn(); });
    } },
  };
  const handlers = {
    calculateRouteMatch: async () => match,
    createRequesterMovementInterest: async () => ({ interestId: interest, interestStatus: 'active', createdAt: time }),
    withdrawRequesterMovementInterest: async () => ({ interestId: interest, interestStatus: 'withdrawn', createdAt: time }),
    listRequesterMovementInterestsForOfferer: async () => [],
    openOfferingMovementAvailability: async () => ({ availabilityId: availability }),
  };
  const wrap = name => async (...args) => { calls.push([name, ...plain(args)]); return handlers[name](...args); };
  const component = load(`src/app/${kind}-movement.tsx`, {
    react, 'expo-crypto': { randomUUID: () => id(serial++) }, 'expo-router': { Redirect: 'Redirect' },
    'react-native': Object.fromEntries(['FlatList', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View']
      .map(v => [v, v]).concat([['StyleSheet', { create: v => v }]])),
    '../services/authService': { getCurrentSession: async () => ({ user: { id: id(90) } }) },
    '../services/locationService': {
      searchMovementLocations: async query => ({ suggestions: [{ selectionRequestId: query, selectionProof: query, declaredLabel: `${query} selected` }] }),
      selectMovementLocation: async proof => ({ locationReferenceId: proof, declaredLabel: `${proof} selected` }),
      resolveSelectedLocation: async value => ({ resolvedLocationReferenceId: value === 'Origin' ? id(20) : id(21) }),
      recoverSelectedLocation: async () => { throw new Error('unexpected recovery'); },
    },
    '../services/movementService': {
      createMovementNeed: async input => { calls.push(['createMovementNeed', plain(input)]); return { movementNeedId: need }; },
      discoverMaskedMovementNeeds: async () => [],
      createMovementOffer: async input => { calls.push(['createMovementOffer', plain(input)]); },
    },
    '../services/offeringMovementService': {
      calculateRouteMatch: wrap('calculateRouteMatch'),
      discoverOfferingMovementAvailability: async () => [offered(availability), offered(otherAvailability)],
      createOfferingMovementIntent: async () => ({ offeringMovementIntentId: id(30) }),
      generateOfferingRoute: async () => ({ state: 'ready' }),
      openOfferingMovementAvailability: wrap('openOfferingMovementAvailability'),
    },
    '../services/requesterMovementInterestService': Object.fromEntries([
      'createRequesterMovementInterest', 'withdrawRequesterMovementInterest', 'listRequesterMovementInterestsForOfferer',
    ].map(name => [name, wrap(name)])),
    '../services/vehicleService': { listMyActiveVehicles: async () => [{ vehicleId: id(31), make: 'Test', model: 'Car', color: 'Blue', seatCapacity: 3 }] },
  }).default;
  function render() { cursor = 0; dirty = false; tree = component(); while (effects.length) effects.shift()(); }
  async function settle() {
    for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(setImmediate); if (!dirty) return; }
    throw new Error('render failed to settle');
  }
  function find(predicate) { const node = nodes(tree).find(predicate); assert(node, 'UI control missing'); return node; }
  function button(title) { return find(n => n.type === 'Pressable' &&
    (n.props.accessibilityLabel === title || text(n).replace(/\s+/g, ' ').trim() === title)); }
  async function press(title) { const node = button(title); assert(!node.props.disabled, `disabled: ${title}`); node.props.onPress(); await settle(); }
  async function form() {
    for (const label of ['Origin', 'Destination']) {
      const inputLabel = `${kind === 'request' ? 'Movement request' : 'Movement'} ${label.toLowerCase()}`;
      find(n => n.type === 'TextInput' && n.props.accessibilityLabel === inputLabel).props.onChangeText(label);
      await settle(); await press(`Search ${label.toLowerCase()}`); await press(`${label} selected`);
    }
    await press('Choose earliest departure');
    const list = find(n => n.type === 'FlatList');
    list.props.renderItem({ item: list.props.data[0] }).props.onPress(); await settle();
    await press(kind === 'request' ? 'Request this movement' : 'Declare this movement');
  }
  return { calls, handlers, settle, form, press, button, find,
    text: () => text(tree),
    async select(a = availability) { const card = find(n => n.type === 'Pressable' && n.key === a); assert(!card.props.disabled); card.props.onPress(); await settle(); },
    async open() { await press('Test CarBlueSeat capacity: 3'); await press('Make movement available'); },
    unmount() { for (const v of values) v?.cleanup?.(); mounted = false; },
  };
}

test('requester browsing selecting and private checking never auto-create interest', async () => {
  const h = screen('request'); await h.settle(); await h.select();
  assert(!h.text().includes("I'm interested"));
  assert.equal(h.calls.length, 0);
  await h.form();
  const waiting = deferred(); h.handlers.calculateRouteMatch = () => waiting.promise;
  await h.select(); assert(!h.text().includes("I'm interested"));
  assert(!h.text().includes('Interest lets the person'));
  waiting.resolve(match); await h.settle();
  assert.equal(h.button("I'm interested").props.disabled, false);
  assert.equal(h.calls.filter(c => c[0] === 'createRequesterMovementInterest').length, 0);
});
test('explicit create uses exact context updates CTA and performs no offer capacity or alignment action', async () => {
  const h = screen('request'); await h.settle(); await h.form(); await h.select();
  await h.press("I'm interested");
  const created = h.calls.find(c => c[0] === 'createRequesterMovementInterest')[1];
  assert.deepEqual({ ...created, requestId: 'uuid' }, { ...input, requestId: 'uuid' });
  assert.match(created.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(h.button('Interested').props.disabled, true);
  assert(h.button('Withdraw interest'));
  assert.deepEqual(h.calls.map(c => c[0]), ['createMovementNeed', 'calculateRouteMatch', 'createRequesterMovementInterest']);
});
test('withdraw uses exact ID preserves withdrawn meaning and requires a fresh check/request', async () => {
  const h = screen('request'); await h.settle(); await h.form(); await h.select(); await h.press("I'm interested");
  await h.press('Withdraw interest');
  assert.deepEqual(h.calls.find(c => c[0] === 'withdrawRequesterMovementInterest'), ['withdrawRequesterMovementInterest', interest]);
  assert(h.text().includes('Interest withdrawn.'));
  assert.equal(h.button("I'm interested").props.disabled, true);
  await h.select(); await h.press("I'm interested");
  const creates = h.calls.filter(c => c[0] === 'createRequesterMovementInterest');
  assert.notEqual(creates[0][1].requestId, creates[1][1].requestId);
});
test('switching availability preserves distinct interests and uses new evidence', async () => {
  const h = screen('request'); await h.settle(); await h.form(); await h.select(); await h.press("I'm interested");
  h.handlers.calculateRouteMatch = async () => ({ ...match, routeMatchEvidenceId: id(44) });
  h.handlers.createRequesterMovementInterest = async () => ({ interestId: id(45), interestStatus: 'active', createdAt: time });
  await h.select(otherAvailability); assert.equal(h.button("I'm interested").props.disabled, false);
  await h.press("I'm interested");
  const inputs = h.calls.filter(c => c[0] === 'createRequesterMovementInterest').map(c => c[1]);
  assert.equal(inputs[1].availabilityId, otherAvailability); assert.equal(inputs[1].routeMatchEvidenceId, id(44));
  await h.select(availability); assert(h.button('Interested'));
  await h.press('Withdraw interest');
  assert.equal(h.calls.find(c => c[0] === 'withdrawRequesterMovementInterest')[1], interest);
});
test('ambiguous create retries reuse UUID and duplicate taps do not send another write', async () => {
  const h = screen('request'); await h.settle(); await h.form(); await h.select();
  const pending = deferred(); h.handlers.createRequesterMovementInterest = () => pending.promise;
  const action = h.button("I'm interested").props.onPress; action(); action(); await h.settle();
  assert.equal(h.calls.filter(c => c[0] === 'createRequesterMovementInterest').length, 1);
  pending.reject(new Error('private database detail')); await h.settle();
  assert(!h.text().includes('private database detail'));
  h.handlers.createRequesterMovementInterest = async () => ({ interestId: interest, interestStatus: 'active', createdAt: time });
  await h.press("I'm interested");
  const creates = h.calls.filter(c => c[0] === 'createRequesterMovementInterest');
  assert.equal(creates[0][1].requestId, creates[1][1].requestId);
});
test('failed or expired compatibility cannot enable interest', async () => {
  const h = screen('request'); await h.settle(); await h.form();
  h.handlers.calculateRouteMatch = async () => { throw new Error('route_match_unavailable'); };
  await h.select(); assert(!h.text().includes("I'm interested"));
  h.handlers.calculateRouteMatch = async () => ({ ...match, routeMatchEvidenceExpiresAt: '2000-01-01' });
  await h.select(); assert.equal(h.button("I'm interested").props.disabled, true);
});

test('ready match for another availability cannot expose interest while the current check is pending', async () => {
  const h = screen('request'); await h.settle(); await h.form(); await h.select();
  assert.equal(h.button("I'm interested").props.disabled, false);
  const pending = deferred(); h.handlers.calculateRouteMatch = () => pending.promise;
  await h.select(otherAvailability);
  assert(!h.text().includes("I'm interested"));
  assert(!h.text().includes('Interest lets the person'));
  pending.resolve({ ...match, routeMatchEvidenceId: id(44) }); await h.settle();
  assert.equal(h.button("I'm interested").props.disabled, false);
  await h.press("I'm interested");
  const created = h.calls.find(c => c[0] === 'createRequesterMovementInterest')[1];
  assert.equal(created.availabilityId, otherAvailability);
  assert.equal(created.routeMatchEvidenceId, id(44));
});
test('offerer inbox waits for current availability and supports empty state and manual refresh', async () => {
  const h = screen('offer'); await h.settle(); await h.form();
  assert.equal(h.calls.filter(c => c[0] === 'listRequesterMovementInterestsForOfferer').length, 0);
  // Select the real vehicle card by its key, not private screen state.
  h.find(n => n.type === 'Pressable' && n.key === id(31)).props.onPress(); await h.settle();
  await h.press('Make movement available');
  assert.deepEqual(h.calls.find(c => c[0] === 'listRequesterMovementInterestsForOfferer'),
    ['listRequesterMovementInterestsForOfferer', { availabilityId: availability, limit: 20 }]);
  assert(h.text().includes('No interests yet.'));
  await h.press('Refresh interested requesters');
  assert.equal(h.calls.filter(c => c[0] === 'listRequesterMovementInterestsForOfferer').length, 2);
  assert(!h.calls.some(c => c[0] === 'createMovementOffer'));
});
test('offerer cards render safe fields in server order and stay view-only', async () => {
  const h = screen('offer'); h.handlers.listRequesterMovementInterestsForOfferer = async () => [inboxRow,
    { ...inboxRow, interestId: id(52), originArea: 'Later origin', requesterOriginDistanceToRouteMeters: 0 }];
  await h.settle(); await h.form();
  h.find(n => n.type === 'Pressable' && n.key === id(31)).props.onPress(); await h.settle();
  await h.press('Make movement available');
  const rendered = h.text();
  for (const value of ['Broad origin', 'Broad destination', '2 people', '250.0', 'Earliest:', 'Latest:', 'Interest received:']) assert(rendered.includes(value), value);
  assert(rendered.indexOf('Broad origin') < rendered.indexOf('Later origin'));
  for (const value of [need, availability, interest, evidence, 'latitude', 'route_shape', 'gallery', 'contact']) assert(!rendered.includes(value), value);
  assert(!rendered.includes('Review and offer'));
  assert(!h.calls.some(c => c[0] === 'createMovementOffer' || c[0] === 'calculateRouteMatch'));
});
test('offerer inbox loading and errors are neutral and retryable', async () => {
  const h = screen('offer'), pending = deferred();
  h.handlers.listRequesterMovementInterestsForOfferer = () => pending.promise;
  await h.settle(); await h.form();
  h.find(n => n.type === 'Pressable' && n.key === id(31)).props.onPress(); await h.settle();
  await h.press('Make movement available'); assert(h.text().includes('Loading interested requesters...'));
  pending.reject(new Error('private SQL details')); await h.settle();
  assert(h.text().includes('could not be loaded')); assert(!h.text().includes('private SQL'));
  h.handlers.listRequesterMovementInterestsForOfferer = async () => [];
  await h.press('Refresh interested requesters'); assert(h.text().includes('No interests yet.'));
});
