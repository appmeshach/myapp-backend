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
function load(file, stubs, globals = {}) {
  if (!cache.has(file)) cache.set(file, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  const exports = {};
  vm.runInNewContext(cache.get(file), { exports, Error, Date, console, ...globals,
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
  const values = [], effects = [], calls = [], navigationCalls = [], continuationCalls = [];
  const recoveryCalls = [], declarationCalls = [];
  const offererContinuationCalls = [];
  const activeMovementCalls = [];
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
    listMyActiveMovementContinuations: async () => [],
    listMyOffererMovementContinuations: async () => [],
    listMyOpenOfferingMovementAvailabilities: async () => [],
    recoverRequesterMovementContinuation: async () => null,
    recoverLatestActiveMovementNeed: async () => need,
    discoverMaskedOffersForMyNeed: async () => [],
    acceptMovementOffer: async movementOfferId => ({
      alignmentId: id(70),
      alignmentStatus: 'awaiting_activation_payment',
      movementNeedId: need,
      movementOfferId,
      createdAt: time,
    }),
    calculateRouteMatch: async () => match,
    createRequesterMovementInterest: async () => ({ interestId: interest, interestStatus: 'active', createdAt: time }),
    withdrawRequesterMovementInterest: async () => ({ interestId: interest, interestStatus: 'withdrawn', createdAt: time }),
    listRequesterMovementInterestsForOfferer: async () => [],
    createMovementOfferFromInterest: async input => ({
      movementOfferId: id(60),
      status: 'pending',
      createdAt: time,
      input,
    }),
    openOfferingMovementAvailability: async () => ({ availabilityId: availability }),
  };
  const wrap = name => async (...args) => { calls.push([name, ...plain(args)]); return handlers[name](...args); };
  const component = load(`src/app/${kind}-movement.tsx`, {
    react, 'expo-crypto': { randomUUID: () => id(serial++) },
    'expo-router': { Redirect: 'Redirect', router: { push: route => navigationCalls.push(plain(route)) } },
    'react-native': Object.fromEntries(['FlatList', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View']
      .map(v => [v, v]).concat([['StyleSheet', { create: v => v }]])),
    '../services/authService': { getCurrentSession: async () => ({ user: { id: id(90) } }) },
    '../components/CompletedMovements': { CompletedMovements: () => null },
    '../services/locationService': {
      searchMovementLocations: async query => ({ suggestions: [{ selectionRequestId: query, selectionProof: query, declaredLabel: `${query} selected` }] }),
      selectMovementLocation: async proof => ({ locationReferenceId: proof, declaredLabel: `${proof} selected` }),
      resolveSelectedLocation: async value => ({ resolvedLocationReferenceId: value === 'Origin' ? id(20) : id(21) }),
      recoverSelectedLocation: async () => { throw new Error('unexpected recovery'); },
    },
    '../services/movementService': {
      listMyActiveMovementContinuations: async (...args) => {
        activeMovementCalls.push(plain(args));
        return handlers.listMyActiveMovementContinuations(...args);
      },
      listMyOffererMovementContinuations: async (...args) => {
        offererContinuationCalls.push(plain(args));
        return handlers.listMyOffererMovementContinuations(...args);
      },
      recoverRequesterMovementContinuation: async (...args) => {
        continuationCalls.push(plain(args));
        return handlers.recoverRequesterMovementContinuation(...args);
      },
      recoverLatestActiveMovementNeed: wrap('recoverLatestActiveMovementNeed'),
      discoverMaskedOffersForMyNeed: wrap('discoverMaskedOffersForMyNeed'),
      acceptMovementOffer: wrap('acceptMovementOffer'),
      createMovementOfferFromInterest: wrap('createMovementOfferFromInterest'),
      createMovementNeed: async input => { calls.push(['createMovementNeed', plain(input)]); return { movementNeedId: need }; },
      discoverMaskedMovementNeeds: async () => [],
      createMovementOffer: async input => { calls.push(['createMovementOffer', plain(input)]); },
    },
    '../services/offeringMovementService': {
      listMyOpenOfferingMovementAvailabilities: async (...args) => {
        recoveryCalls.push(plain(args));
        return handlers.listMyOpenOfferingMovementAvailabilities(...args);
      },
      calculateRouteMatch: wrap('calculateRouteMatch'),
      discoverOfferingMovementAvailability: async () => [offered(availability), offered(otherAvailability)],
      createOfferingMovementIntent: async input => {
        declarationCalls.push(plain(input));
        return { offeringMovementIntentId: id(30) };
      },
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
  return { calls, navigationCalls, continuationCalls, recoveryCalls, declarationCalls, offererContinuationCalls, activeMovementCalls, handlers, settle, form, press, button, find,
    text: () => text(tree),
    async select(a = availability) { const card = find(n => n.type === 'Pressable' && n.key === a); assert(!card.props.disabled); card.props.onPress(); await settle(); },
    async open() { await press('Test CarBlueSeat capacity: 3'); await press('Make movement available'); },
    unmount() { for (const v of values) v?.cleanup?.(); mounted = false; },
  };
}

test('recovered current movement need alone cannot check route or express interest', async () => {
  const h = screen('request');
  await h.settle();

  assert.deepEqual(h.calls, [
    ['recoverLatestActiveMovementNeed'],
    ['discoverMaskedOffersForMyNeed', need],
  ]);

  await h.select();

  assert(!h.text().includes("I'm interested"));
  assert(!h.text().includes('Interest lets the person'));
  assert.equal(
    h.calls.filter(c => c[0] === 'calculateRouteMatch').length,
    0,
  );
  assert.equal(
    h.calls.filter(c => c[0] === 'createRequesterMovementInterest').length,
    0,
  );
  assert(
    h.text().includes(
      'Submit your movement request first.',
    ),
  );
});

test('requester browsing selecting and private checking never auto-create interest', async () => {
  const h = screen('request');
  h.handlers.recoverLatestActiveMovementNeed = async () => null;
  await h.settle(); await h.select();
  assert(!h.text().includes("I'm interested"));
  assert.deepEqual(h.calls, [['recoverLatestActiveMovementNeed']]);
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
  assert.deepEqual(h.calls.map(c => c[0]), ['recoverLatestActiveMovementNeed', 'discoverMaskedOffersForMyNeed',
    'createMovementNeed', 'calculateRouteMatch', 'createRequesterMovementInterest']);
  assert.deepEqual(h.calls[1], ['discoverMaskedOffersForMyNeed', need]);
});
test('editing submitted movement details requires explicit resubmission before interest', async () => {
  const mutationCases = [
    {
      name: 'origin',
      mutate: async h => {
        h.find(
          n =>
            n.type === 'TextInput'
            && n.props.accessibilityLabel === 'Movement request origin',
        ).props.onChangeText('Changed origin');
        await h.settle();
      },
    },
    {
      name: 'destination',
      mutate: async h => {
        h.find(
          n =>
            n.type === 'TextInput'
            && n.props.accessibilityLabel === 'Movement request destination',
        ).props.onChangeText('Changed destination');
        await h.settle();
      },
    },
    {
      name: 'departure',
      mutate: async h => {
        await h.press('Choose earliest departure');
        const list = h.find(n => n.type === 'FlatList');
        list.props.renderItem({
          item: list.props.data[0],
        }).props.onPress();
        await h.settle();
      },
    },
    {
      name: 'people count',
      mutate: async h => {
        h.find(
          n =>
            n.type === 'TextInput'
            && n.props.accessibilityLabel === 'Number of people',
        ).props.onChangeText('2');
        await h.settle();
      },
    },
  ];

  for (const mutationCase of mutationCases) {
    const h = screen('request');
    await h.settle();
    await h.form();

    await mutationCase.mutate(h);

    const routeCallsBefore =
      h.calls.filter(c => c[0] === 'calculateRouteMatch').length;

    await h.select();

    assert.equal(
      h.calls.filter(c => c[0] === 'calculateRouteMatch').length,
      routeCallsBefore,
      mutationCase.name,
    );

    assert(
      !h.text().includes("I'm interested"),
      mutationCase.name,
    );

    assert.equal(
      h.calls.filter(c => c[0] === 'createRequesterMovementInterest').length,
      0,
      mutationCase.name,
    );

    h.unmount();
  }
});
test('resubmitting changed movement restores route and interest flow', async () => {
  const h = screen('request');
  await h.settle();
  await h.form();

  h.find(
    n =>
      n.type === 'TextInput'
      && n.props.accessibilityLabel === 'Movement request origin',
  ).props.onChangeText('Changed origin');

  await h.settle();
  await h.select();

  assert.equal(
    h.calls.filter(c => c[0] === 'calculateRouteMatch').length,
    0,
  );
  assert(!h.text().includes("I'm interested"));

  await h.form();
  await h.select();

  assert.equal(
    h.calls.filter(c => c[0] === 'calculateRouteMatch').length,
    1,
  );
  assert.equal(
    h.button("I'm interested").props.disabled,
    false,
  );

  await h.press("I'm interested");

  assert.equal(
    h.calls.filter(c => c[0] === 'createRequesterMovementInterest').length,
    1,
  );

  assert.equal(
    h.calls.filter(c => c[0] === 'createMovementNeed').length,
    2,
  );
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
test('offerer inbox recovers globally then filters current availability and supports manual refresh', async () => {
  const h = screen('offer'); await h.settle();
  assert.deepEqual(h.calls, [['listRequesterMovementInterestsForOfferer', { availabilityId: null, limit: 20 }]]);
  assert(h.text().includes('No interests yet.'));
  await h.form();
  // Select the real vehicle card by its key, not private screen state.
  h.find(n => n.type === 'Pressable' && n.key === id(31)).props.onPress(); await h.settle();
  await h.press('Make movement available');
  assert.deepEqual(h.calls.filter(c => c[0] === 'listRequesterMovementInterestsForOfferer'), [
    ['listRequesterMovementInterestsForOfferer', { availabilityId: null, limit: 20 }],
    ['listRequesterMovementInterestsForOfferer', { availabilityId: availability, limit: 20 }],
  ]);
  assert(h.text().includes('No interests yet.'));
  await h.press('Refresh interested requesters');
  assert.deepEqual(h.calls.map(c => c[0]), ['listRequesterMovementInterestsForOfferer',
    'openOfferingMovementAvailability', 'listRequesterMovementInterestsForOfferer',
    'listRequesterMovementInterestsForOfferer']);
  assert.deepEqual(h.calls.at(-1),
    ['listRequesterMovementInterestsForOfferer', { availabilityId: availability, limit: 20 }]);
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

test('requester accepts an exact pending movement offer and removes pending offers after alignment creation', async () => {
  const h = screen('request');
  const movementOfferId = id(71);

  h.handlers.discoverMaskedOffersForMyNeed = async () => [{
    movementOfferId,
    seatsOffered: 2,
    estimatedArrivalMinutes: 12,
    offerStatus: 'pending',
    offerCreatedAt: time,
    vehicleMake: 'Test',
    vehicleModel: 'Car',
    vehicleYear: 2024,
    vehicleColor: 'Blue',
    vehicleSeatCapacity: 3,
    age: null,
    commonMovementArea: null,
    identityVerified: true,
    profileMediaVerified: true,
    completedMovements: 4,
    rating: null,
  }];

  await h.settle();

  const acceptButton =
    h.button(`Accept movement offer ${movementOfferId}`);

  assert.equal(
    text(acceptButton).replace(/\s+/g, ' ').trim(),
    'Accept offer',
  );

  assert(!h.text().includes('Continue to movement verification'));
  await h.press(`Accept movement offer ${movementOfferId}`);

  assert.deepEqual(
    h.calls.filter(c => c[0] === 'acceptMovementOffer'),
    [['acceptMovementOffer', movementOfferId]],
  );

  assert(
    h.text().includes(
      'Movement offer accepted. Continue to verify and activate this movement.',
    ),
  );

  assert(!h.text().includes('Status: pending'));
  assert(!h.text().includes('awaiting_activation_payment'));
  assert(h.button('Continue to movement verification'));
  assert.deepEqual(h.navigationCalls, []);

  await h.press('Continue to movement verification');

  assert.deepEqual(h.navigationCalls, [{
    pathname: './movement-verification',
    params: { movementNeedId: need },
  }]);
});

test('requester movement offer acceptance prevents duplicate writes while one acceptance is pending', async () => {
  const h = screen('request');
  const movementOfferId = id(72);
  const pending = deferred();

  h.handlers.discoverMaskedOffersForMyNeed = async () => [{
    movementOfferId,
    seatsOffered: 1,
    estimatedArrivalMinutes: null,
    offerStatus: 'pending',
    offerCreatedAt: time,
    vehicleMake: 'Test',
    vehicleModel: 'Car',
    vehicleYear: null,
    vehicleColor: 'Blue',
    vehicleSeatCapacity: 3,
    age: null,
    commonMovementArea: null,
    identityVerified: true,
    profileMediaVerified: true,
    completedMovements: 0,
    rating: null,
  }];

  h.handlers.acceptMovementOffer =
    () => pending.promise;

  await h.settle();

  const action =
    h.button(
      `Accept movement offer ${movementOfferId}`,
    ).props.onPress;

  action();
  action();

  await h.settle();

  assert.equal(
    h.calls.filter(c => c[0] === 'acceptMovementOffer').length,
    1,
  );

  assert(
    h.text().includes('Accepting...'),
  );

  pending.resolve({
    alignmentId: id(73),
    alignmentStatus: 'awaiting_activation_payment',
    movementNeedId: need,
    movementOfferId,
    createdAt: time,
  });

  await h.settle();

  assert.equal(
    h.calls.filter(c => c[0] === 'acceptMovementOffer').length,
    1,
  );
});

test('failed movement offer acceptance keeps the offer visible and does not expose backend details', async () => {
  const h = screen('request');
  const movementOfferId = id(74);

  h.handlers.discoverMaskedOffersForMyNeed = async () => [{
    movementOfferId,
    seatsOffered: 1,
    estimatedArrivalMinutes: null,
    offerStatus: 'pending',
    offerCreatedAt: time,
    vehicleMake: 'Test',
    vehicleModel: 'Car',
    vehicleYear: null,
    vehicleColor: 'Blue',
    vehicleSeatCapacity: 3,
    age: null,
    commonMovementArea: null,
    identityVerified: true,
    profileMediaVerified: true,
    completedMovements: 0,
    rating: null,
  }];

  h.handlers.acceptMovementOffer =
    async () => {
      throw new Error(
        'Movement need is not available for matching private SQL detail',
      );
    };

  await h.settle();

  await h.press(
    `Accept movement offer ${movementOfferId}`,
  );

  assert.equal(
    h.calls.filter(c => c[0] === 'acceptMovementOffer').length,
    1,
  );

  assert(
    h.text().includes(
      'This movement offer could not be accepted. It may no longer be available, or your movement request may have expired.',
    ),
  );

  assert(
    h.text().includes('Status: pending'),
  );

  assert(
    !h.text().includes('private SQL detail'),
  );
  assert(h.button(`Accept movement offer ${movementOfferId}`));
  assert(!h.text().includes('Continue to movement verification'));
  assert.deepEqual(h.navigationCalls, []);
});
test('offerer sends requester-specific movement offer from exact interest context', async () => {
  const h = screen('offer');

  h.handlers.listRequesterMovementInterestsForOfferer =
    async ({ availabilityId: requestedAvailabilityId }) => (
      requestedAvailabilityId === availability
        ? [inboxRow]
        : []
    );

  await h.settle();
  await h.form();

  h.find(
    n =>
      n.type === 'Pressable'
      && n.key === id(31),
  ).props.onPress();

  await h.settle();
  await h.press('Make movement available');

  await h.press('Send movement offer');

  assert.deepEqual(
    h.calls.find(
      c => c[0] === 'createMovementOfferFromInterest',
    ),
    [
      'createMovementOfferFromInterest',
      {
        interestId: interest,
        seatsOffered: 2,
        proposedPickupArea: null,
        proposedDropoffArea: null,
        estimatedArrivalMinutes: null,
      },
    ],
  );

  assert(
    h.text().includes(
      'Movement offer sent to the interested requester.',
    ),
  );

  const sentButton = h.button('Offer sent');

  assert.equal(
    sentButton.props.disabled,
    true,
  );
});

test('offer-from-interest prevents duplicate writes while the first offer is pending', async () => {
  const h = screen('offer');
  const pending = deferred();

  h.handlers.listRequesterMovementInterestsForOfferer =
    async ({ availabilityId: requestedAvailabilityId }) => (
      requestedAvailabilityId === availability
        ? [inboxRow]
        : []
    );

  h.handlers.createMovementOfferFromInterest =
    () => pending.promise;

  await h.settle();
  await h.form();

  h.find(
    n =>
      n.type === 'Pressable'
      && n.key === id(31),
  ).props.onPress();

  await h.settle();
  await h.press('Make movement available');

  const action =
    h.button('Send movement offer').props.onPress;

  action();
  action();

  await h.settle();

  assert.equal(
    h.calls.filter(
      c => c[0] === 'createMovementOfferFromInterest',
    ).length,
    1,
  );

  pending.resolve({
    movementOfferId: id(61),
    status: 'pending',
    createdAt: time,
  });

  await h.settle();

  assert.equal(
    h.calls.filter(
      c => c[0] === 'createMovementOfferFromInterest',
    ).length,
    1,
  );
});

test('failed offer-from-interest stays safe and does not expose backend details', async () => {
  const h = screen('offer');

  h.handlers.listRequesterMovementInterestsForOfferer =
    async ({ availabilityId: requestedAvailabilityId }) => (
      requestedAvailabilityId === availability
        ? [inboxRow]
        : []
    );

  h.handlers.createMovementOfferFromInterest =
    async () => {
      throw new Error(
        'private SQL requester deadline detail',
      );
    };

  await h.settle();
  await h.form();

  h.find(
    n =>
      n.type === 'Pressable'
      && n.key === id(31),
  ).props.onPress();

  await h.settle();
  await h.press('Make movement available');
  await h.press('Send movement offer');

  assert.equal(
    h.calls.filter(
      c => c[0] === 'createMovementOfferFromInterest',
    ).length,
    1,
  );

  assert(
    h.text().includes(
      'The movement offer could not be created. The interest or movement may no longer be available.',
    ),
  );

  assert(
    !h.text().includes(
      'private SQL requester deadline detail',
    ),
  );
});


test('requester continuation service sends no arguments and returns only a valid need', async () => {
  for (const [data, expected] of [[[], null], [[{ movement_need_id: need }], need]]) {
    const calls = [];
    const api = load('src/services/movementService.ts', {
      '../lib/supabase': { supabase: { rpc: async (...args) => { calls.push(args); return { data, error: null }; } } },
    });
    assert.equal(await api.recoverRequesterMovementContinuation(), expected);
    assert.deepEqual(calls, [['get_my_requester_movement_continuation']]);
  }
});

test('continuation service fails closed on malformed, extra, or failed responses', async () => {
  const invalid = [null, {}, [null], [[]], [{}], [{ movement_need_id: 'bad' }],
    [{ movement_need_id: 12 }], [{ movement_need_id: [need] }],
    [{ movement_need_id: need }, { movement_need_id: need }]];
  for (const field of ['alignment_id', 'movement_offer_id', 'member_id', 'payment_id', 'provider_id', 'status']) {
    invalid.push([{ movement_need_id: need, [field]: 'private' }]);
  }
  for (const rpc of [
    ...invalid.map(data => async () => ({ data, error: null })),
    async () => ({ data: [{ movement_need_id: need }], error: { message: 'private SQL' } }),
    async () => { throw new Error('private transport'); },
  ]) {
    const api = load('src/services/movementService.ts', { '../lib/supabase': { supabase: { rpc } } });
    await assert.rejects(api.recoverRequesterMovementContinuation(),
      error => error.message === 'movement_continuation_recovery_unavailable');
  }
});

test('reload recovers accepted continuation independently of a discoverable need', async () => {
  for (const currentNeed of [null, id(88)]) {
    const h = screen('request');
    h.handlers.recoverLatestActiveMovementNeed = async () => currentNeed;
    h.handlers.recoverRequesterMovementContinuation = async () => need;
    await h.settle();
    assert.deepEqual(h.continuationCalls, [[]]);
    assert(h.button('Continue to movement verification'));
    assert.deepEqual(h.navigationCalls, []);
    assert.equal(h.calls.filter(c => c[0] === 'acceptMovementOffer').length, 0);
    assert.deepEqual(h.calls.filter(c => c[0] === 'discoverMaskedOffersForMyNeed'),
      currentNeed ? [['discoverMaskedOffersForMyNeed', currentNeed]] : []);
    assert.equal(h.text().includes('Offers sent to you'), !!currentNeed);
    assert(!h.text().includes('awaiting_activation_payment'));
    await h.select();
    assert.equal(h.calls.filter(c => c[0] === 'calculateRouteMatch').length, 0);
    await h.press('Continue to movement verification');
    assert.deepEqual(h.navigationCalls, [{ pathname: './movement-verification', params: { movementNeedId: need } }]);
    h.unmount();
  }
});

test('empty or failed continuation recovery exposes no action or private errors', async () => {
  for (const recover of [async () => null, async () => { throw new Error('private SQL details'); }]) {
    const h = screen('request');
    h.handlers.recoverLatestActiveMovementNeed = async () => null;
    h.handlers.recoverRequesterMovementContinuation = recover;
    await h.settle();
    assert(!h.text().includes('Continue to movement verification'));
    assert(!h.text().includes('private SQL'));
    assert.deepEqual(h.navigationCalls, []);
    h.unmount();
  }
});

test('late recovery cannot overwrite same-session acceptance or update an unmounted screen', async () => {
  for (const unmount of [false, true]) {
    const h = screen('request'), pending = deferred();
    h.handlers.recoverRequesterMovementContinuation = () => pending.promise;
    h.handlers.discoverMaskedOffersForMyNeed = async () => [{
      movementOfferId: id(89), offerStatus: 'pending', seatsOffered: 1,
      estimatedArrivalMinutes: null, offerCreatedAt: time, vehicleMake: 'Test',
      vehicleModel: null, vehicleYear: null, vehicleColor: 'Blue',
    }];
    await h.settle();
    if (unmount) h.unmount();
    else await h.press('Accept movement offer ' + id(89));
    pending.resolve(id(87));
    await h.settle();
    if (!unmount) {
      await h.press('Continue to movement verification');
      assert.deepEqual(h.navigationCalls, [{ pathname: './movement-verification', params: { movementNeedId: need } }]);
    }
  }
});


const recoveryRow = {
  availability_id: id(201), offering_movement_intent_id: id(202), vehicle_id: id(203),
  total_places: 3, remaining_places: 2, expires_at: '2026-09-29T12:00:00+00:00',
  origin_area: 'Broad start', destination_area: 'Broad end',
  earliest_departure_at: '2026-09-29T12:00:00+00:00', latest_departure_at: null,
  vehicle_make: 'Recovered make', vehicle_model: 'Recovered model', vehicle_year: 2024, vehicle_color: 'Green',
};
const recovered = {
  availabilityId: id(201), offeringMovementIntentId: id(202), vehicleId: id(203),
  totalPlaces: 3, remainingPlaces: 2, expiresAt: recoveryRow.expires_at,
  originArea: 'Broad start', destinationArea: 'Broad end',
  earliestDepartureAt: recoveryRow.earliest_departure_at, latestDepartureAt: null,
  vehicleMake: 'Recovered make', vehicleModel: 'Recovered model', vehicleYear: 2024, vehicleColor: 'Green',
};
function recoveryService(rpc) {
  return load('src/services/offeringMovementService.ts', { '../lib/supabase': { supabase: { rpc } } });
}
test('offerer recovery service sends exact bounded RPC and parses multiple safe rows', async () => {
  const calls = [];
  const rows = [recoveryRow, { ...recoveryRow, availability_id: id(204), vehicle_model: null,
    vehicle_year: null, latest_departure_at: '2026-09-29T13:00:00+00:00' }];
  const api = recoveryService(async (...args) => { calls.push(plain(args)); return { data: rows, error: null }; });
  const result = plain(await api.listMyOpenOfferingMovementAvailabilities());
  assert.deepEqual(result, [recovered, { ...recovered, availabilityId: id(204), vehicleModel: null,
    vehicleYear: null, latestDepartureAt: '2026-09-29T13:00:00+00:00' }]);
  await api.listMyOpenOfferingMovementAvailabilities(2);
  assert.deepEqual(calls, [['list_my_open_offering_movement_availabilities', { p_limit: 20 }],
    ['list_my_open_offering_movement_availabilities', { p_limit: 2 }]]);
  assert.deepEqual(plain(await recoveryService(async () => ({ data: [], error: null })).listMyOpenOfferingMovementAvailabilities()), []);
});
test('offerer recovery validates limit before network', async () => {
  let calls = 0;
  const api = recoveryService(async () => { calls++; return { data: [], error: null }; });
  for (const limit of [0, 51, -1, 1.5, null, '20', NaN, Infinity]) {
    await assert.rejects(api.listMyOpenOfferingMovementAvailabilities(limit), /offering_movement_recovery_unavailable/);
  }
  assert.equal(calls, 0);
});
test('offerer recovery rejects malformed, duplicate, oversized and private responses', async () => {
  const invalid = [null, {}, [null], [[]], [{}], [recoveryRow,recoveryRow],
    [recoveryRow,{ ...recoveryRow, availability_id: id(204) },{ ...recoveryRow, availability_id: id(205) }]];
  for (const field of Object.keys(recoveryRow)) {
    const missing = { ...recoveryRow }; delete missing[field]; invalid.push([missing]);
  }
  for (const [field, values] of Object.entries({
    availability_id: ['bad', null], offering_movement_intent_id: ['bad', [id(1)]], vehicle_id: ['bad', 1],
    total_places: [0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1],
    remaining_places: [0, -1, 4, 1.5, '2'],
    expires_at: ['bad', '2026-02-30T12:00:00Z', null, 123],
    earliest_departure_at: ['bad', '2026-09-29', '2026-09-29T24:00:00Z'],
    latest_departure_at: ['bad', '2026-09-28T12:00:00Z'],
    origin_area: ['', '  ', 'private\nlabel', 1], destination_area: ['', null],
    vehicle_make: ['', null], vehicle_color: ['', null], vehicle_model: [1], vehicle_year: ['2024', 2.5, 1800, 2101],
  })) for (const value of values) invalid.push([{ ...recoveryRow, [field]: value }]);
  for (const field of ['member_id','route_evidence_id','provider_id','latitude','route_shape','interest_id','offer_id','alignment_id','payment_id']) {
    invalid.push([{ ...recoveryRow, [field]: 'private' }]);
  }
  for (const data of invalid) {
    await assert.rejects(recoveryService(async () => ({ data, error: null })).listMyOpenOfferingMovementAvailabilities(2),
      error => error.message === 'offering_movement_recovery_unavailable');
  }
});
test('offerer recovery neutralizes Supabase and thrown transport errors', async () => {
  for (const rpc of [async () => ({ data: [recoveryRow], error: { message: 'private SQL' } }),
    async () => { throw new Error('private transport'); }]) {
    await assert.rejects(recoveryService(rpc).listMyOpenOfferingMovementAvailabilities(),
      error => error.message === 'offering_movement_recovery_unavailable');
  }
});
test('zero recovered offerings preserves explicit declaration with no automatic writes or navigation', async () => {
  const h = screen('offer'); await h.settle();
  assert.deepEqual(h.recoveryCalls, [[]]);
  assert.deepEqual(h.declarationCalls, []);
  assert.deepEqual(h.navigationCalls, []);
  assert(!h.text().includes('Your active offered movements'));
  assert(!h.text().includes('Movement availability opened'));
  await h.form();
  assert.equal(h.declarationCalls.length, 1);
  assert(h.button('Make movement available'));
});
test('one recovered offering restores fixed details and exact filtered inbox without writes', async () => {
  const h = screen('offer');
  h.handlers.listMyOpenOfferingMovementAvailabilities = async () => [recovered];
  await h.settle();
  assert.deepEqual(h.recoveryCalls, [[]]);
  assert.deepEqual(h.declarationCalls, []);
  assert.deepEqual(h.calls, [
    ['listRequesterMovementInterestsForOfferer', { availabilityId: null, limit: 20 }],
    ['listRequesterMovementInterestsForOfferer', { availabilityId: recovered.availabilityId, limit: 20 }],
  ]);
  assert(h.text().includes('Recovered make'));
  assert(h.text().includes('Total places: 3'));
  assert(h.text().includes('Vehicle and total places are fixed'));
  assert.throws(() => h.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Available places'), /UI control missing/);
  assert.throws(() => h.button('Make movement available'), /UI control missing/);
  assert.equal(h.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Movement origin').props.value, '');
  assert.deepEqual(h.navigationCalls, []);
  for (const value of [recovered.availabilityId, recovered.offeringMovementIntentId, recovered.vehicleId]) assert(!h.text().includes(value));
});
test('multiple recovered offerings require explicit selection and switch filtered inbox', async () => {
  const h = screen('offer');
  const second = { ...recovered, availabilityId: id(204), offeringMovementIntentId: id(205), vehicleId: id(206), totalPlaces: 2 };
  h.handlers.listMyOpenOfferingMovementAvailabilities = async () => [recovered,second];
  await h.settle();
  assert(!h.text().includes('Selected offered movement'));
  assert.deepEqual(h.calls, [['listRequesterMovementInterestsForOfferer', { availabilityId: null, limit: 20 }]]);
  await h.press('Select active offered movement 2');
  assert.deepEqual(h.calls.at(-1), ['listRequesterMovementInterestsForOfferer', { availabilityId: second.availabilityId, limit: 20 }]);
  assert(h.text().includes('Total places: 2'));
  await h.press('Select active offered movement 1');
  assert.deepEqual(h.calls.at(-1), ['listRequesterMovementInterestsForOfferer', { availabilityId: recovered.availabilityId, limit: 20 }]);
  assert.deepEqual(h.declarationCalls, []);
  assert.deepEqual(h.navigationCalls, []);
});
test('new explicit offerer declaration clears recovered availability choices', async () => {
  const h = screen('offer');
  const second = {
    ...recovered,
    availabilityId: id(204),
    offeringMovementIntentId: id(205),
    vehicleId: id(206),
    totalPlaces: 2,
  };

  h.handlers.listMyOpenOfferingMovementAvailabilities =
    async () => [recovered, second];

  await h.settle();

  assert(h.text().includes('Your active offered movements'));

  await h.form();

  assert.equal(h.declarationCalls.length, 1);
  assert(!h.text().includes('Your active offered movements'));
  assert(!h.text().includes('Recovered make'));
  assert(h.button('Make movement available'));
});
test('failed offerer recovery is neutral and retryable rather than an empty success', async () => {
  const h = screen('offer');
  h.handlers.listMyOpenOfferingMovementAvailabilities = async () => { throw new Error('private SQL backend details'); };
  await h.settle();
  assert(h.text().includes('Your active offered movements could not be loaded. Please retry.'));
  assert(!h.text().includes('private SQL'));
  assert(!h.text().includes('Movement availability opened'));
  h.handlers.listMyOpenOfferingMovementAvailabilities = async () => [recovered];
  await h.press('Retry active offered movements');
  assert.equal(h.recoveryCalls.length, 2);
  assert(h.text().includes('Selected offered movement'));
  assert.deepEqual(h.declarationCalls, []);
  assert.deepEqual(h.navigationCalls, []);
});
test('late offerer recovery cannot replace newly opened availability', async () => {
  const h = screen('offer'), pending = deferred();
  h.handlers.listMyOpenOfferingMovementAvailabilities = () => pending.promise;
  await h.settle(); await h.form();
  h.find(n => n.type === 'Pressable' && n.key === id(31)).props.onPress(); await h.settle();
  await h.press('Make movement available');
  pending.resolve([recovered]); await h.settle();
  assert(!h.text().includes('Recovered make'));
  assert.equal(h.calls.filter(c => c[0] === 'openOfferingMovementAvailability').length, 1);
  assert.deepEqual(h.calls.at(-1), ['listRequesterMovementInterestsForOfferer', { availabilityId: availability, limit: 20 }]);
  await h.press('Refresh interested requesters');
  assert.deepEqual(h.calls.at(-1), ['listRequesterMovementInterestsForOfferer', { availabilityId: availability, limit: 20 }]);
});
test('unmounted offerer recovery never updates state', async () => {
  for (const fail of [false,true]) {
    const h = screen('offer'), pending = deferred();
    h.handlers.listMyOpenOfferingMovementAvailabilities = () => pending.promise;
    await h.settle(); h.unmount();
    if (fail) pending.reject(new Error('private SQL'));
    else pending.resolve([recovered]);
    await h.settle();
    assert.deepEqual(h.navigationCalls, []);
  }
});


const offererContinuationRow = {
  movement_need_id: id(301), alignment_status: 'awaiting_activation_payment',
  origin_area: 'Accepted origin', destination_area: 'Accepted destination', created_at: time,
};
const offererContinuation = {
  movementNeedId: id(301), alignmentStatus: 'awaiting_activation_payment',
  originArea: 'Accepted origin', destinationArea: 'Accepted destination', createdAt: time,
};
function offererContinuationService(rpc) {
  return load('src/services/movementService.ts', { '../lib/supabase': { supabase: { rpc } } });
}
test('offerer continuation service maps exact RPC, limit, empty and multiple rows', async () => {
  const calls = [];
  const rows = [offererContinuationRow, { ...offererContinuationRow, movement_need_id: id(302), alignment_status: 'activated' }];
  const api = offererContinuationService(async (...args) => { calls.push(plain(args)); return { data: rows, error: null }; });
  assert.deepEqual(plain(await api.listMyOffererMovementContinuations()), [offererContinuation,
    { ...offererContinuation, movementNeedId: id(302), alignmentStatus: 'activated' }]);
  await api.listMyOffererMovementContinuations(2);
  assert.deepEqual(calls, [['list_my_offerer_movement_continuations', { p_limit: 20 }],
    ['list_my_offerer_movement_continuations', { p_limit: 2 }]]);
  assert.deepEqual(plain(await offererContinuationService(async () => ({ data: [], error: null })).listMyOffererMovementContinuations()), []);
});
test('offerer continuation invalid limits fail before network', async () => {
  let calls = 0;
  const api = offererContinuationService(async () => { calls++; return { data: [], error: null }; });
  for (const limit of [0, -1, 51, 1.5, '20', null, NaN, Infinity]) {
    await assert.rejects(api.listMyOffererMovementContinuations(limit),
      error => error.message === 'offerer_movement_continuation_recovery_unavailable');
  }
  assert.equal(calls, 0);
});
test('offerer continuation malformed/private/duplicate/oversized rows fail closed', async () => {
  const row = offererContinuationRow;
  const invalid = [null, {}, [null], [[]], [{}], [row,row],
    [row,{ ...row, movement_need_id: id(302) },{ ...row, movement_need_id: id(303) }]];
  for (const field of Object.keys(row)) {
    const missing = { ...row }; delete missing[field]; invalid.push([missing]);
  }
  for (const [field, values] of Object.entries({
    movement_need_id: ['bad', null, 1, [id(1)]],
    alignment_status: ['in_progress','completed','cancelled','failed','unknown',null],
    created_at: ['bad', '2026-09-28', '2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z',
      '2026-09-28T24:00:00Z', '2026-09-28T12:61:00Z', '2026-09-28T12:00:00', 'infinity', 123, null],
    origin_area: ['', '  ', 'private\nlabel', 'control\u0085label', 'x'.repeat(501), 1],
    destination_area: ['', '\t', null, 'control\u007flabel'],
  })) for (const value of values) invalid.push([{ ...row, [field]: value }]);
  for (const field of ['alignment_id','movement_offer_id','member_id','payment_id','provider_id','route_evidence_id','latitude','route_shape']) {
    invalid.push([{ ...row, [field]: 'private' }]);
  }
  const uuidWithLetters = 'abcdef01-0000-4000-8000-000000000001';
  invalid.push([{ ...row, movement_need_id: uuidWithLetters },{ ...row, movement_need_id: uuidWithLetters.toUpperCase() }]);
  for (const data of invalid) {
    await assert.rejects(offererContinuationService(async () => ({ data, error: null })).listMyOffererMovementContinuations(2),
      error => error.message === 'offerer_movement_continuation_recovery_unavailable');
  }
});
test('offerer continuation accepts real leap-day and PostgreSQL fractional timezone timestamps', async () => {
  for (const created_at of ['2024-02-29T12:00:00Z','2026-09-28T12:00:00.123456+00:00']) {
    const api = offererContinuationService(async () => ({ data: [{ ...offererContinuationRow, created_at }], error: null }));
    assert.equal((await api.listMyOffererMovementContinuations())[0].createdAt, created_at);
  }
});
test('offerer continuation Supabase and transport errors are generic only', async () => {
  for (const rpc of [async () => ({ data: [offererContinuationRow], error: { message: 'private SQL' } }),
    async () => { throw new Error('private transport'); }]) {
    await assert.rejects(offererContinuationService(rpc).listMyOffererMovementContinuations(),
      error => error.message === 'offerer_movement_continuation_recovery_unavailable');
  }
});
function assertNoOffererWrites(h) {
  assert.deepEqual(h.declarationCalls, []);
  assert(!h.calls.some(c => ['createMovementOffer','createMovementOfferFromInterest','openOfferingMovementAvailability','acceptMovementOffer'].includes(c[0])));
  // Unstubbed dependencies fail the harness, including payment/verification/journey APIs.
}
test('zero accepted offerer continuations makes no writes or navigation', async () => {
  const h = screen('offer'); await h.settle();
  assert.deepEqual(h.offererContinuationCalls, [[]]);
  assert(!h.text().includes('Movements waiting for you'));
  assert.deepEqual(h.navigationCalls, []);
  assertNoOffererWrites(h);
});
test('one accepted offerer continuation needs explicit Continue and exposes only human copy', async () => {
  const h = screen('offer');
  h.handlers.listMyOffererMovementContinuations = async () => [offererContinuation];
  await h.settle();
  assert(h.text().includes('Movements waiting for you'));
  assert(h.text().includes('Accepted origin'));
  assert(h.text().includes('Verification and activation needed'));
  assert(!h.text().includes('awaiting_activation_payment'));
  assert(!h.text().includes(offererContinuation.movementNeedId));
  assert(!h.text().includes('alignmentId'));
  assert(!h.text().includes('movementOfferId'));
  assert.deepEqual(h.navigationCalls, []);
  assertNoOffererWrites(h);
  await h.press('Continue accepted movement 1');
  assert.deepEqual(h.navigationCalls, [{ pathname: './movement-verification', params: { movementNeedId: id(301) } }]);
  assertNoOffererWrites(h);
});
test('multiple accepted continuations coexist with open availabilities and preserve selected inbox', async () => {
  const h = screen('offer');
  h.handlers.listMyOffererMovementContinuations = async () => [offererContinuation,
    { ...offererContinuation, movementNeedId: id(302), alignmentStatus: 'activated', originArea: 'Second accepted origin' }];
  h.handlers.listMyOpenOfferingMovementAvailabilities = async () => [recovered,
    { ...recovered, availabilityId: id(204), totalPlaces: 2 }];
  await h.settle();
  assert(h.text().includes('Your active offered movements'));
  assert(h.text().includes('Ready to continue'));
  assert(h.text().includes('Second accepted origin'));
  assert.deepEqual(h.navigationCalls, []);
  await h.press('Select active offered movement 2');
  const before = plain(h.calls);
  await h.press('Continue accepted movement 2');
  await h.press('Continue accepted movement 1');
  assert.deepEqual(h.navigationCalls, [
    { pathname: './movement-verification', params: { movementNeedId: id(302) } },
    { pathname: './movement-verification', params: { movementNeedId: id(301) } },
  ]);
  assert.deepEqual(h.calls, before);
  assert(h.text().includes('Total places: 2'));
  assert.equal(h.button('Select active offered movement 2').props.accessibilityState.selected, true);
  await h.press('Refresh interested requesters');
  assert.deepEqual(h.calls.at(-1), ['listRequesterMovementInterestsForOfferer', { availabilityId: id(204), limit: 20 }]);
  assertNoOffererWrites(h);
});
test('accepted continuation failure is neutral, retryable, and independent of open recovery', async () => {
  const h = screen('offer');
  h.handlers.listMyOpenOfferingMovementAvailabilities = async () => [recovered];
  h.handlers.listMyOffererMovementContinuations = async () => { throw new Error('private SQL alignment details'); };
  await h.settle();
  assert(h.text().includes('Accepted movements could not be loaded. Please retry.'));
  assert(!h.text().includes('private SQL'));
  assert(h.text().includes('Total places: 3'));
  const before = plain(h.calls);
  h.handlers.listMyOffererMovementContinuations = async () => [offererContinuation];
  await h.press('Retry accepted movements');
  assert.equal(h.offererContinuationCalls.length, 2);
  assert.equal(h.recoveryCalls.length, 1);
  assert(h.button('Continue accepted movement 1'));
  assert.deepEqual(h.calls, before);
  assert.deepEqual(h.navigationCalls, []);
  assertNoOffererWrites(h);
});
test('late accepted recovery leaves a same-session declaration and opened availability intact', async () => {
  const h = screen('offer'), pending = deferred();
  h.handlers.listMyOffererMovementContinuations = () => pending.promise;
  await h.settle(); await h.form();
  h.find(n => n.type === 'Pressable' && n.key === id(31)).props.onPress(); await h.settle();
  await h.press('Make movement available');
  const before = plain(h.calls);
  pending.resolve([offererContinuation]); await h.settle();
  assert(h.button('Continue accepted movement 1'));
  assert.deepEqual(h.calls, before);
  assert.equal(h.declarationCalls.length, 1);
  assert(h.text().includes('Your movement is now available.'));
  assert.equal(h.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Movement origin').props.value, 'Origin selected');
  await h.press('Refresh interested requesters');
  assert.deepEqual(h.calls.at(-1), ['listRequesterMovementInterestsForOfferer', { availabilityId: availability, limit: 20 }]);
  assert.deepEqual(h.navigationCalls, []);
});
test('unmounted accepted continuation recovery drops both success and failure', async () => {
  for (const fail of [false,true]) {
    const h = screen('offer'), pending = deferred();
    h.handlers.listMyOffererMovementContinuations = () => pending.promise;
    await h.settle(); h.unmount();
    if (fail) pending.reject(new Error('private SQL'));
    else pending.resolve([offererContinuation]);
    await h.settle();
    assert.deepEqual(h.navigationCalls, []);
  }
});

const activeContinuationRow = {
  movement_need_id: id(301),
  origin_area: 'Accepted origin', destination_area: 'Accepted destination', started_at: time,
};
const activeContinuation = {
  movementNeedId: id(301),
  originArea: 'Accepted origin', destinationArea: 'Accepted destination', startedAt: time,
};
function activeContinuationService(rpc) {
  return load('src/services/movementService.ts', { '../lib/supabase': { supabase: { rpc } } });
}
test('active movement recovery service maps exact RPC, limit, empty and multiple rows', async () => {
  const calls = [];
  const rows = [activeContinuationRow, { ...activeContinuationRow, movement_need_id: id(302) }];
  const api = activeContinuationService(async (...args) => { calls.push(plain(args)); return { data: rows, error: null }; });
  assert.deepEqual(plain(await api.listMyActiveMovementContinuations()), [activeContinuation,
    { ...activeContinuation, movementNeedId: id(302) }]);
  await api.listMyActiveMovementContinuations(2);
  assert.deepEqual(calls, [['list_my_active_movement_continuations', { p_limit: 20 }],
    ['list_my_active_movement_continuations', { p_limit: 2 }]]);
  assert.deepEqual(plain(await activeContinuationService(async () => ({ data: [], error: null })).listMyActiveMovementContinuations()), []);
});
test('active movement recovery invalid limits fail before network', async () => {
  let calls = 0;
  const api = activeContinuationService(async () => { calls++; return { data: [], error: null }; });
  for (const limit of [0, -1, 51, 1.5, '20', null, NaN, Infinity]) {
    await assert.rejects(api.listMyActiveMovementContinuations(limit),
      error => error.message === 'active_movement_recovery_unavailable');
  }
  assert.equal(calls, 0);
});
test('active movement recovery malformed/private/duplicate/oversized rows fail closed', async () => {
  const row = activeContinuationRow;
  const invalid = [null, {}, [null], [[]], [{}], [row,row],
    [row,{ ...row, movement_need_id: id(302) },{ ...row, movement_need_id: id(303) }]];
  for (const field of Object.keys(row)) {
    const missing = { ...row }; delete missing[field]; invalid.push([missing]);
  }
  for (const [field, values] of Object.entries({
    movement_need_id: ['bad', null, 1, [id(1)]],
    started_at: ['bad', '2026-09-28', '2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z',
      '2026-09-28T24:00:00Z', '2026-09-28T12:61:00Z', '2026-09-28T12:00:00', 'infinity', 123, null],
    origin_area: ['', '  ', 'private\nlabel', 'control\u0085label', 'x'.repeat(501), 1],
    destination_area: ['', '\t', null, 'control\u007flabel'],
  })) for (const value of values) invalid.push([{ ...row, [field]: value }]);
  for (const field of ['alignment_id','movement_offer_id','member_id','payment_id','provider_id','route_evidence_id','latitude','route_shape']) {
    invalid.push([{ ...row, [field]: 'private' }]);
  }
  const uuidWithLetters = 'abcdef01-0000-4000-8000-000000000001';
  invalid.push([{ ...row, movement_need_id: uuidWithLetters },{ ...row, movement_need_id: uuidWithLetters.toUpperCase() }]);
  for (const data of invalid) {
    await assert.rejects(activeContinuationService(async () => ({ data, error: null })).listMyActiveMovementContinuations(2),
      error => error.message === 'active_movement_recovery_unavailable');
  }
});
test('active movement recovery accepts real leap-day and PostgreSQL fractional timezone timestamps', async () => {
  for (const started_at of ['2024-02-29T12:00:00Z','2026-09-28T12:00:00.123456+00:00']) {
    const api = activeContinuationService(async () => ({ data: [{ ...activeContinuationRow, started_at }], error: null }));
    assert.equal((await api.listMyActiveMovementContinuations())[0].startedAt, started_at);
  }
});
test('active movement recovery Supabase and transport errors are generic only', async () => {
  for (const rpc of [async () => ({ data: [activeContinuationRow], error: { message: 'private SQL' } }),
    async () => { throw new Error('private transport'); }]) {
    await assert.rejects(activeContinuationService(rpc).listMyActiveMovementContinuations(),
      error => error.message === 'active_movement_recovery_unavailable');
  }
});

for (const kind of ['request','offer']) {
  test(kind+' active recovery is empty without navigation or writes',async()=>{
    const h=screen(kind);await h.settle();
    assert.deepEqual(h.activeMovementCalls,[[]]);
    assert(!h.text().includes('Your active movements'));
    assert.deepEqual(h.navigationCalls,[]);assertNoOffererWrites(h);
  });
  test(kind+' multiple active movements continue explicitly and preserve prior recovery',async()=>{
    const h=screen(kind);
    const rows=[{ movementNeedId:id(401),originArea:'Active origin',destinationArea:'Active destination',startedAt:time },
      { movementNeedId:id(402),originArea:'Second active origin',destinationArea:'Second active destination',startedAt:time }];
    h.handlers.listMyActiveMovementContinuations=async()=>rows;
    h.handlers.recoverRequesterMovementContinuation=async()=>need;
    h.handlers.listMyOffererMovementContinuations=async()=>[offererContinuation];
    h.handlers.listMyOpenOfferingMovementAvailabilities=async()=>[recovered];
    await h.settle();assert(h.text().includes('Movement in progress'));
    assert(h.text().includes('Second active origin'));assert.deepEqual(h.navigationCalls,[]);
    if(kind==='request') assert(h.button('Continue to movement verification'));
    else {assert(h.button('Continue accepted movement 1'));assert(h.text().includes('Total places: 3'));}
    const before=plain(h.calls);
    await h.press('Continue active movement 2');await h.press('Continue active movement 1');
    assert.deepEqual(h.navigationCalls,[
      {pathname:'./movement-coordination',params:{movementNeedId:id(402)}},
      {pathname:'./movement-coordination',params:{movementNeedId:id(401)}},
    ]);
    assert.deepEqual(h.calls,before);assertNoOffererWrites(h);
    assert(!h.text().includes(id(401)));
    if(kind==='offer') {
      await h.press('Refresh interested requesters');
      assert.deepEqual(h.calls.at(-1),['listRequesterMovementInterestsForOfferer',{availabilityId:recovered.availabilityId,limit:20}]);
    }
  });
  test(kind+' active recovery failure is neutral and retryable',async()=>{
    const h=screen(kind);
    h.handlers.listMyActiveMovementContinuations=async()=>{throw Error('private SQL');};
    await h.settle();assert(h.text().includes('Active movements could not be loaded. Please retry.'));
    assert(!h.text().includes('private SQL'));
    h.handlers.listMyActiveMovementContinuations=async()=>[activeContinuation];
    await h.press('Retry active movements');assert.equal(h.activeMovementCalls.length,2);
    assert(h.button('Continue active movement 1'));assert.deepEqual(h.navigationCalls,[]);
  });
  test(kind+' late active recovery cannot change a new declaration',async()=>{
    const h=screen(kind),pending=deferred();h.handlers.listMyActiveMovementContinuations=()=>pending.promise;
    await h.settle();await h.form();const before=plain(h.calls);
    pending.resolve([activeContinuation]);await h.settle();
    assert.deepEqual(h.calls,before);assert(h.button('Continue active movement 1'));
    assert.deepEqual(h.navigationCalls,[]);
    if(kind==='offer') assert(h.button('Make movement available'));
    else { await h.select();assert(h.button("I'm interested")); }
  });
  test(kind+' unmounted active recovery ignores success and failure',async()=>{
    for(const fail of [false,true]) {
      const h=screen(kind),pending=deferred();h.handlers.listMyActiveMovementContinuations=()=>pending.promise;
      await h.settle();h.unmount();
      if(fail)pending.reject(Error('private SQL'));else pending.resolve([activeContinuation]);
      await h.settle();assert.deepEqual(h.navigationCalls,[]);
    }
  });
}


// 0057: principal-neutral completion UI, strict RPC boundary and lifecycle owner.
const endRow = (patch = {}) => ({ journey_state: 'in_progress', end_status: 'no_pending_end_request',
  requested_by_me: false, action_required_from_me: false, requested_at: null, completed_at: null, ...patch });
const endStatus = (patch = {}) => ({ journeyState: 'in_progress', endStatus: 'no_pending_end_request',
  requestedByMe: false, actionRequiredFromMe: false, requestedAt: null, completedAt: null, ...patch });
const endMine = endStatus({ endStatus: 'awaiting_other_member', requestedByMe: true, requestedAt: time });
const endOther = endStatus({ endStatus: 'action_required_from_me', actionRequiredFromMe: true, requestedAt: time });
const endDone = endStatus({ journeyState: 'completed', endStatus: 'completed', requestedAt: time, completedAt: time });
function endService(data = [endRow()], error = null) {
  const calls = [];
  const api = load('src/services/movementEndService.ts', { '../lib/supabase': { supabase: {
    rpc: (...args) => { calls.push(plain(args)); return { abortSignal: async () => ({ data, error }) }; },
  } } });
  return { api, calls };
}
const endSignal = () => new AbortController().signal;
test('0057 service sends only movementNeedId and optional reason to exact RPCs', async () => {
  for (const [method, rpc] of [['getMovementEndStatus','get_my_movement_end_status_by_need'],['requestMovementEnd','request_my_movement_end'],['confirmMovementEnd','confirm_my_movement_end'],['declineMovementEnd','decline_my_movement_end']]) {
    const h = endService();
    assert.deepEqual(plain(await h.api[method](need,endSignal())), endStatus());
    assert.deepEqual(h.calls, [[rpc,{p_movement_need_id:need}]]);
  }
  const h=endService(); await h.api.requestMovementEnd(need,endSignal(),'  Arrived  ');
  assert.deepEqual(h.calls,[['request_my_movement_end',{p_movement_need_id:need,p_reason:'Arrived'}]]);
});
test('0057 parser accepts each canonical state including no travel', async () => {
  for(const patch of [ {}, {journey_state:'not_started'},
    {end_status:'awaiting_other_member',requested_by_me:true,requested_at:time},
    {end_status:'action_required_from_me',action_required_from_me:true,requested_at:time},
    {journey_state:'completed',end_status:'completed',requested_at:time,completed_at:time},
    {journey_state:'cancelled',end_status:'mutual_no_travel',requested_at:time}]) {
    await endService([endRow(patch)]).api.getMovementEndStatus(need,endSignal());
  }
});
test('0057 rejects malformed, inconsistent and private response fields with generic errors', async () => {
  const invalid = [null,{},[],[null],[endRow(),endRow()],...[
    {journey_id:id(20)},{alignment_id:id(21)},{member_id:id(22)},{settlement_id:id(23)},
    {journey_state:'failed'},{end_status:'unknown'},{requested_by_me:'false'},{action_required_from_me:1},
    {requested_at:'2026-02-30T12:00:00Z'},{requested_at:'2026-09-25'},
    {requested_at:'2026-09-25T24:00:00Z'},{completed_at:'infinity'},
    {end_status:'completed'},{journey_state:'cancelled'},{requested_by_me:true},
    {end_status:'action_required_from_me',requested_at:time},
  ].map(p=>[endRow(p)])];
  for(const data of invalid) await assert.rejects(endService(data).api.getMovementEndStatus(need,endSignal()),{message:'movement_end_unavailable'});
  const missing=endRow();delete missing.requested_at;
  await assert.rejects(endService([missing]).api.getMovementEndStatus(need,endSignal()),{message:'movement_end_unavailable'});
  await assert.rejects(endService(null,{message:'PRIVATE SQL',code:'42501'}).api.getMovementEndStatus(need,endSignal()),{message:'movement_end_unavailable'});
});
test('0057 invalid arguments and aborted calls make no RPC', async () => {
  for(const value of [null,'bad',[need]]) {const h=endService();await assert.rejects(h.api.requestMovementEnd(value,endSignal()));assert.equal(h.calls.length,0);}
  for(const reason of ['', ' ', 'x'.repeat(501), 5]) {const h=endService();await assert.rejects(h.api.requestMovementEnd(need,endSignal(),reason));assert.equal(h.calls.length,0);}
  const h=endService(), abort=new AbortController();abort.abort();
  await assert.rejects(h.api.confirmMovementEnd(need,abort.signal),{message:'movement_end_unavailable'});assert.equal(h.calls.length,0);
});
const createEnd = load('src/state/movementEndController.ts', {}, {AbortController,setTimeout,clearTimeout}).createMovementEndController;
function endController(initial=endStatus(), overrides={}) {
  let server=initial;const calls=[];
  const api={read:async()=>{calls.push('read');return server;},
    request:async()=>{calls.push('request');return server=endMine;},
    confirm:async()=>{calls.push('confirm');return server=endDone;},
    decline:async()=>{calls.push('decline');return server=endStatus();},...overrides};
  const c=createEnd(need,api);c.activate();return {c,calls};
}
function endDeferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('0057 loading reads only; explicit request refreshes and cannot self-confirm or decline',async()=>{
  const h=endController();await h.c.refresh();assert.deepEqual(h.calls,['read']);
  await h.c.requestEnd();assert.equal(h.c.getSnapshot().status.endStatus,'awaiting_other_member');
  await h.c.confirmEnd();await h.c.declineEnd();await h.c.requestEnd();
  assert.deepEqual(h.calls,['read','request','read']);
});
test('0057 other principal can decline, start a fresh request or explicitly confirm',async()=>{
  const h=endController(endOther);await h.c.refresh();await h.c.requestEnd();assert.deepEqual(h.calls,['read']);
  await h.c.declineEnd();assert.equal(h.c.getSnapshot().status.endStatus,'no_pending_end_request');
  await h.c.requestEnd();assert.deepEqual(h.calls,['read','decline','read','request','read']);
  const k=endController(endOther);await k.c.refresh();await k.c.confirmEnd();
  assert.equal(k.c.getSnapshot().status.endStatus,'completed');await k.c.requestEnd();await k.c.confirmEnd();await k.c.declineEnd();
  assert.deepEqual(k.calls,['read','confirm','read']);
});
for(const [method,initial,action] of [['requestEnd',endStatus(),'request'],['confirmEnd',endOther,'confirm'],['declineEnd',endOther,'decline']]) {
  test('0057 duplicate taps guarded synchronously for '+action,async()=>{
    const pending=endDeferred();let writes=0;
    const h=endController(initial,{[action]:async()=>{writes++;return pending.promise;}});await h.c.refresh();
    const first=h.c[method]();await h.c[method]();await h.c.refresh();assert.equal(writes,1);
    assert.notEqual(h.c.getSnapshot().status.endStatus,'completed');pending.resolve(endDone);await first;
    assert.equal(h.c.getSnapshot().status.endStatus,initial.endStatus); // refreshed result wins over mutation response
  });
}
test('0057 late initial read cannot overwrite newer same-session mutation',async()=>{
  const old=endDeferred();let reads=0;
  const h=endController(endStatus(),{read:async()=>++reads===1?old.promise:reads===2?endStatus():endMine});
  const pending=h.c.refresh();await h.c.requestEnd();assert.equal(h.calls.length,0); // cannot write before initial read
  h.c.clear();h.c.activate();await h.c.refresh();await h.c.requestEnd();
  old.resolve(endStatus());await pending;assert.equal(h.c.getSnapshot().status.endStatus,'awaiting_other_member');
});
test('0057 unmount invalidates pending writes and prevents their refresh',async()=>{
  const pending=endDeferred();const h=endController(endOther,{confirm:async()=>pending.promise});await h.c.refresh();
  const writing=h.c.confirmEnd();h.c.clear();pending.resolve(endDone);await writing;
  assert.equal(h.c.getSnapshot().status,null);await h.c.requestEnd();assert.deepEqual(h.calls,['read']);
});
test('0057 failed authoritative refresh clears controls and exposes only neutral error state',async()=>{
  let reads=0;const h=endController(endOther,{read:async()=>{if(++reads>1)throw Error('PRIVATE');return endOther;}});
  await h.c.refresh();await h.c.confirmEnd();assert.deepEqual(plain(h.c.getSnapshot()),{status:null,busy:false,error:true});
});
function endUI(status, busy=false) {
  const calls=[];const model={state:{status,busy,error:false},refresh:()=>calls.push('read'),requestEnd:()=>calls.push('request'),confirmEnd:()=>calls.push('confirm'),declineEnd:()=>calls.push('decline')};
  const component=load('src/components/MovementEnd.tsx',{'react-native':{View:'View',Text:'Text',Pressable:'Pressable'},'../hooks/useMovementEnd':{useMovementEnd:n=>{assert.equal(n,need);return model;}}}).MovementEnd;
  const tree=component({movementNeedId:need});const buttons=[];let text='';
  function visit(v){if(v==null)return;if(typeof v==='string'){text+=v+' ';return;}if(Array.isArray(v)){v.forEach(visit);return;}if(v.type==='Pressable')buttons.push(v);visit(v.props?.children);}
  visit(tree);return {calls,buttons,text};
}
test('0057 both principal UI states require explicit press and show human consent controls',()=>{
  for(const role of ['requester','offerer']) {
    const h=endUI(endStatus());assert.deepEqual(h.calls,[]);assert.match(h.text,/End movement/);h.buttons[0].props.onPress();assert.deepEqual(h.calls,['request'],role);
    const mine=endUI(endMine);assert.match(mine.text,/Waiting for the other person/);assert.equal(mine.buttons.length,1);
    const other=endUI(endOther);assert.match(other.text,/Confirm movement ended/);assert.match(other.text,/Not yet/);
    other.buttons[0].props.onPress();other.buttons[1].props.onPress();assert.deepEqual(other.calls,['confirm','decline']);
  }
});
test('0057 completed and no-travel UI have no active controls or raw technical labels',()=>{
  const done=endUI(endDone);assert.match(done.text,/Movement completed/);assert.equal(done.buttons.length,1);
  const noTravel=endUI(endStatus({journeyState:'cancelled',endStatus:'mutual_no_travel',requestedAt:time}));
  assert.match(noTravel.text,/No travel took place/);assert.doesNotMatch(noTravel.text,/Movement completed/);assert.equal(noTravel.buttons.length,1);
  for(const h of [done,noTravel,endUI(endMine),endUI(endOther)]) assert.doesNotMatch(h.text,/awaiting_other_member|action_required_from_me|mutual_no_travel/);
  const busy=endUI(endOther,true);assert.equal(busy.buttons.length,1);assert.equal(busy.buttons[0].props.disabled,true);
});
test('0057 client exposes no internal identifiers or navigation and keeps chat unavailable',()=>{
  for(const p of ['src/services/movementEndService.ts','src/state/movementEndController.ts','src/hooks/useMovementEnd.ts','src/components/MovementEnd.tsx']) {
    assert.doesNotMatch(fs.readFileSync(p,'utf8'),/journeyId|alignmentId|memberId|settlementId|router.push|router.replace|latitude|longitude/);
  }
  const coordination=fs.readFileSync('src/components/MovementCoordination.tsx','utf8');
  assert.match(coordination,/Chat is not available/);assert.doesNotMatch(coordination,/journey completion controls are not available/);
  assert.match(coordination,/<MovementEnd movementNeedId={movementNeedId}/);
});

function endHookHarness() {
  let auth, app, cleanup, snapshot;const calls=[];
  const AppState={currentState:'active',addEventListener:(_,fn)=>{app=fn;return {remove(){calls.push('remove');}};}};
  const api=load('src/hooks/useMovementEnd.ts',{
    react:{useMemo:fn=>fn(),useCallback:fn=>fn,useSyncExternalStore:(_subscribe,get)=>{snapshot=get;return get();}},
    'react-native':{AppState},'expo-router':{useFocusEffect:fn=>{cleanup=fn();}},
    '../lib/supabase':{supabase:{auth:{onAuthStateChange:fn=>{auth=fn;return {data:{subscription:{unsubscribe(){calls.push('unsubscribe');}}}};}}}},
    '../state/movementEndController':{createMovementEndController:createEnd},
    '../services/movementEndService':{getMovementEndStatus:async()=>{calls.push('read');return endStatus();},
      requestMovementEnd:async()=>{calls.push('request');return endMine;},confirmMovementEnd:async()=>{calls.push('confirm');return endDone;},declineMovementEnd:async()=>{calls.push('decline');return endStatus();}},
  });
  const model=api.useMovementEnd(need);
  return {model,calls,state:()=>snapshot(),login:id=>auth('SIGNED_IN',id?{user:{id}}:null),
    background:()=>{AppState.currentState='background';app();},resume:()=>{AppState.currentState='active';app();},cleanup:()=>cleanup()};
}
test('0057 hook foreground, account change and unmount clear state and never write automatically',async()=>{
  const h=endHookHarness();h.login('requester');await new Promise(setImmediate);assert.equal(h.state().status.endStatus,'no_pending_end_request');
  h.background();assert.equal(h.state().status,null);h.resume();await new Promise(setImmediate);
  h.login('offerer');assert.equal(h.state().status,null);await new Promise(setImmediate);
  h.login(null);assert.equal(h.state().status,null);h.cleanup();await h.model.requestEnd();
  assert.deepEqual(h.calls,['read','read','read','remove','unsubscribe']);
});

// 0058: completed travelled movement recovery and settlement visibility.
const completedRow = (patch = {}) => ({
  movement_need_id: id(501),
  origin_area: 'Completed origin',
  destination_area: 'Completed destination',
  completed_at: '2026-09-28T12:00:00+00:00',
  settlement_status: 'pending_amount',
  settlement_is_for_me: true,
  settled_at: null,
  ...patch,
});

const completedRecovery = (patch = {}) => ({
  movementNeedId: id(501),
  originArea: 'Completed origin',
  destinationArea: 'Completed destination',
  completedAt: '2026-09-28T12:00:00+00:00',
  settlementStatus: 'pending_amount',
  settlementIsForMe: true,
  settledAt: null,
  ...patch,
});

function completedService(data, error = null) {
  const calls = [];

  const rpc = (...args) => {
    calls.push(plain(args));

    const result = Promise.resolve({
      data,
      error,
    });

    result.abortSignal = async () => ({
      data,
      error,
    });

    return result;
  };

  const api = load(
    'src/services/completedMovementService.ts',
    {
      '../lib/supabase': {
        supabase: {
          rpc,
        },
      },
    },
  );

  return {
    api,
    calls,
  };
}

test('0058 completed recovery service maps exact bounded RPC and safe rows', async () => {
  const secondRow = completedRow({
    movement_need_id: id(502),
    settlement_status: 'settled',
    settlement_is_for_me: false,
    settled_at: '2026-09-28T12:01:00+00:00',
  });

  const h = completedService([
    completedRow(),
    secondRow,
  ]);

  assert.deepEqual(
    plain(
      await h.api.listMyCompletedMovementRecoveries(),
    ),
    [
      completedRecovery(),
      completedRecovery({
        movementNeedId: id(502),
        settlementStatus: 'settled',
        settlementIsForMe: false,
        settledAt: '2026-09-28T12:01:00+00:00',
      }),
    ],
  );

  await h.api.listMyCompletedMovementRecoveries(2);

  assert.deepEqual(
    h.calls,
    [
      [
        'list_my_completed_movement_recoveries',
        {
          p_limit: 20,
        },
      ],
      [
        'list_my_completed_movement_recoveries',
        {
          p_limit: 2,
        },
      ],
    ],
  );

  assert.deepEqual(
    plain(
      await completedService([])
        .api
        .listMyCompletedMovementRecoveries(),
    ),
    [],
  );
});

test('0058 completed recovery validates limit and aborted calls before network', async () => {
  let calls = 0;

  const rpc = () => {
    calls++;
    return Promise.resolve({
      data: [],
      error: null,
    });
  };

  const api = load(
    'src/services/completedMovementService.ts',
    {
      '../lib/supabase': {
        supabase: {
          rpc,
        },
      },
    },
  );

  for (const limit of [
    0,
    -1,
    51,
    1.5,
    '20',
    null,
    NaN,
    Infinity,
  ]) {
    await assert.rejects(
      api.listMyCompletedMovementRecoveries(limit),
      {
        message:
          'completed_movement_recovery_unavailable',
      },
    );
  }

  const abort = new AbortController();
  abort.abort();

  await assert.rejects(
    api.listMyCompletedMovementRecoveries(
      20,
      abort.signal,
    ),
    {
      message:
        'completed_movement_recovery_unavailable',
    },
  );

  assert.equal(calls, 0);
});

test('0058 completed recovery rejects malformed duplicate oversized and private responses', async () => {
  const row = completedRow();

  const invalid = [
    null,
    {},
    [null],
    [[]],
    [{}],
    [
      row,
      row,
    ],
    [
      row,
      completedRow({
        movement_need_id: id(502),
      }),
    ],
  ];

  for (const field of Object.keys(row)) {
    const missing = {
      ...row,
    };

    delete missing[field];

    invalid.push([
      missing,
    ]);
  }

  for (const [field, values] of Object.entries({
    movement_need_id: [
      'bad',
      null,
      1,
      [
        id(501),
      ],
    ],
    origin_area: [
      '',
      ' ',
      ' private',
      'private ',
      'private\nlabel',
      'control\u0085label',
      'x'.repeat(501),
      1,
      null,
    ],
    destination_area: [
      '',
      '\t',
      'private\nlabel',
      'control\u007flabel',
      1,
      null,
    ],
    completed_at: [
      null,
      'bad',
      '2026-09-28',
      '2026-02-30T12:00:00Z',
      '2025-02-29T12:00:00Z',
      '2026-09-28T24:00:00Z',
      '2026-09-28T12:61:00Z',
      '2026-09-28T12:00:00',
      'infinity',
      123,
    ],
    settlement_status: [
      'unknown',
      'no_settlement',
      null,
      1,
    ],
    settlement_is_for_me: [
      'true',
      1,
      null,
    ],
  })) {
    for (const value of values) {
      invalid.push([
        {
          ...row,
          [field]: value,
        },
      ]);
    }
  }

  for (const field of [
    'journey_id',
    'alignment_id',
    'movement_offer_id',
    'settlement_id',
    'beneficiary_member_id',
    'member_id',
    'provider_id',
    'payment_id',
    'vehicle_id',
    'latitude',
    'longitude',
    'route_shape',
  ]) {
    invalid.push([
      {
        ...row,
        [field]: 'private',
      },
    ]);
  }

  invalid.push([
    completedRow({
      settlement_status: 'settled',
      settled_at: null,
    }),
  ]);

  invalid.push([
    completedRow({
      settlement_status: 'pending_amount',
      settled_at: '2026-09-28T12:01:00+00:00',
    }),
  ]);

  invalid.push([
    completedRow({
      settlement_status: 'pending_settlement',
      settled_at: '2026-09-28T12:01:00+00:00',
    }),
  ]);

  invalid.push([
    completedRow({
      settlement_status: 'failed',
      settled_at: '2026-09-28T12:01:00+00:00',
    }),
  ]);

  invalid.push([
    completedRow({
      settlement_status: 'settled',
      settled_at: '2026-09-28T11:59:59+00:00',
    }),
  ]);

  for (const data of invalid) {
    await assert.rejects(
      completedService(data)
        .api
        .listMyCompletedMovementRecoveries(1),
      {
        message:
          'completed_movement_recovery_unavailable',
      },
    );
  }
});

test('0058 completed recovery accepts canonical statuses and PostgreSQL timestamps', async () => {
  const cases = [
    completedRow({
      completed_at:
        '2024-02-29T12:00:00Z',
    }),
    completedRow({
      completed_at:
        '2026-09-28T12:00:00.123456+00:00',
    }),
    completedRow({
      settlement_status:
        'pending_settlement',
    }),
    completedRow({
      settlement_status:
        'failed',
    }),
    completedRow({
      settlement_status:
        'settled',
      settled_at:
        '2026-09-28T12:00:01.123456+00:00',
    }),
  ];

  for (const row of cases) {
    const result =
      await completedService([
        row,
      ])
        .api
        .listMyCompletedMovementRecoveries();

    assert.equal(
      result.length,
      1,
    );
  }
});

test('0058 completed recovery Supabase and transport errors remain generic', async () => {
  await assert.rejects(
    completedService(
      [
        completedRow(),
      ],
      {
        message:
          'PRIVATE settlement database detail',
        code:
          '42501',
      },
    )
      .api
      .listMyCompletedMovementRecoveries(),
    {
      message:
        'completed_movement_recovery_unavailable',
    },
  );

  const api = load(
    'src/services/completedMovementService.ts',
    {
      '../lib/supabase': {
        supabase: {
          rpc() {
            throw new Error(
              'PRIVATE transport detail',
            );
          },
        },
      },
    },
  );

  await assert.rejects(
    api.listMyCompletedMovementRecoveries(),
    {
      message:
        'completed_movement_recovery_unavailable',
    },
  );
});


const createCompletedController =
  load(
    'src/state/completedMovementController.ts',
    {},
    {
      AbortController,
      setTimeout,
      clearTimeout,
    },
  ).createCompletedMovementController;

test('0058 controller stays signed out until an account exists and reads only after account activation', async () => {
  const calls = [];

  const controller =
    createCompletedController(
      async (
        limit,
        signal,
      ) => {
        calls.push({
          limit,
          signal,
        });

        return [
          completedRecovery(),
        ];
      },
    );

  assert.deepEqual(
    plain(
      controller.getSnapshot(),
    ),
    {
      phase:
        'signed_out',
      rows: [],
    },
  );

  await controller.refresh();

  assert.equal(
    calls.length,
    0,
  );

  controller.activate();
  controller.setAccount(
    'account-a',
  );

  assert.equal(
    controller.getSnapshot().phase,
    'loading',
  );

  await new Promise(
    setImmediate,
  );

  assert.equal(
    calls.length,
    1,
  );

  assert.equal(
    calls[0].limit,
    20,
  );

  assert.equal(
    calls[0].signal.aborted,
    false,
  );

  assert.deepEqual(
    plain(
      controller.getSnapshot(),
    ),
    {
      phase:
        'ready',
      rows: [
        completedRecovery(),
      ],
    },
  );

  controller.dispose();

  assert.deepEqual(
    plain(
      controller.getSnapshot(),
    ),
    {
      phase:
        'signed_out',
      rows: [],
    },
  );
});

test('0058 controller aborts old-account reads and ignores stale success', async () => {
  const first = deferred();
  const second = deferred();

  const signals = [];
  let reads = 0;

  const controller =
    createCompletedController(
      async (
        _limit,
        signal,
      ) => {
        signals.push(
          signal,
        );

        reads++;

        return reads === 1
          ? first.promise
          : second.promise;
      },
    );

  controller.activate();

  controller.setAccount(
    'account-a',
  );

  assert.equal(
    reads,
    1,
  );

  controller.setAccount(
    'account-b',
  );

  assert.equal(
    reads,
    2,
  );

  assert.equal(
    signals[0].aborted,
    true,
  );

  first.resolve([
    completedRecovery({
      originArea:
        'OLD ACCOUNT DATA',
    }),
  ]);

  second.resolve([
    completedRecovery({
      movementNeedId:
        id(502),
      originArea:
        'New account origin',
    }),
  ]);

  await new Promise(
    setImmediate,
  );

  const state =
    controller.getSnapshot();

  assert.equal(
    state.phase,
    'ready',
  );

  assert.equal(
    state.rows.length,
    1,
  );

  assert.equal(
    state.rows[0].movementNeedId,
    id(502),
  );

  assert.equal(
    state.rows[0].originArea,
    'New account origin',
  );

  assert.notEqual(
    state.rows[0].originArea,
    'OLD ACCOUNT DATA',
  );
});

test('0058 controller dispose aborts pending recovery and blocks late updates', async () => {
  const pending =
    deferred();

  let signal;

  const controller =
    createCompletedController(
      async (
        _limit,
        nextSignal,
      ) => {
        signal =
          nextSignal;

        return pending.promise;
      },
    );

  controller.activate();

  controller.setAccount(
    'account-a',
  );

  assert.equal(
    controller.getSnapshot().phase,
    'loading',
  );

  controller.dispose();

  assert.equal(
    signal.aborted,
    true,
  );

  pending.resolve([
    completedRecovery(),
  ]);

  await new Promise(
    setImmediate,
  );

  assert.deepEqual(
    plain(
      controller.getSnapshot(),
    ),
    {
      phase:
        'signed_out',
      rows: [],
    },
  );
});


test('0058 hook clears identity through the controller and performs no write automatically', () => {
  const calls = [];

  let authCallback;
  let cleanup;

  const owner = {
    subscribe() {
      return () => {};
    },

    getSnapshot() {
      return {
        phase:
          'signed_out',
        rows: [],
      };
    },

    activate() {
      calls.push(
        'activate',
      );
    },

    setAccount(account) {
      calls.push([
        'account',
        account,
      ]);
    },

    dispose() {
      calls.push(
        'dispose',
      );
    },

    refresh() {
      calls.push(
        'refresh',
      );
    },
  };

  const api =
    load(
      'src/hooks/useCompletedMovements.ts',
      {
        react: {
          useMemo:
            fn => fn(),

          useEffect:
            fn => {
              cleanup =
                fn();
            },

          useSyncExternalStore:
            (
              _subscribe,
              getSnapshot,
            ) =>
              getSnapshot(),
        },

        '../lib/supabase': {
          supabase: {
            auth: {
              onAuthStateChange(
                fn,
              ) {
                authCallback =
                  fn;

                return {
                  data: {
                    subscription: {
                      unsubscribe() {
                        calls.push(
                          'unsubscribe',
                        );
                      },
                    },
                  },
                };
              },
            },
          },
        },

        '../services/completedMovementService': {
          listMyCompletedMovementRecoveries:
            async () => [],
        },

        '../state/completedMovementController': {
          createCompletedMovementController:
            () => owner,
        },
      },
    );

  const model =
    api.useCompletedMovements();

  assert.deepEqual(
    calls,
    [
      'activate',
    ],
  );

  authCallback(
    'SIGNED_IN',
    {
      user: {
        id:
          'account-a',
      },
    },
  );

  authCallback(
    'SIGNED_IN',
    {
      user: {
        id:
          'account-b',
      },
    },
  );

  authCallback(
    'SIGNED_OUT',
    null,
  );

  assert.deepEqual(
    calls,
    [
      'activate',
      [
        'account',
        'account-a',
      ],
      [
        'account',
        'account-b',
      ],
      [
        'account',
        null,
      ],
    ],
  );

  assert.equal(
    typeof model.refresh,
    'function',
  );

  cleanup();

  assert.deepEqual(
    calls.slice(-2),
    [
      'dispose',
      'unsubscribe',
    ],
  );

  assert(
    !calls.includes(
      'refresh',
    ),
  );
});


function completedUI(
  state,
) {
  const calls = [];

  const component =
    load(
      'src/components/CompletedMovements.tsx',
      {
        'react-native': {
          View:
            'View',
          Text:
            'Text',
          Pressable:
            'Pressable',
        },

        '../hooks/useCompletedMovements': {
          useCompletedMovements:
            () => ({
              state,
              refresh:
                () => {
                  calls.push(
                    'refresh',
                  );
                },
            }),
        },
      },
    )
      .CompletedMovements;

  const tree =
    component();

  return {
    tree,
    calls,
    text:
      text(tree),
    buttons:
      nodes(tree)
        .filter(
          node =>
            node.type ===
            'Pressable',
        ),
  };
}

test('0058 completed movement UI shows human settlement copy without internal identifiers or enums', () => {
  const offerer =
    completedUI({
      phase:
        'ready',
      rows: [
        completedRecovery(),
      ],
    });

  assert.match(
    offerer.text,
    /Completed movements/,
  );

  assert.match(
    offerer.text,
    /Completed origin/,
  );

  assert.match(
    offerer.text,
    /Completed destination/,
  );

  assert.match(
    offerer.text,
    /Settlement for you/,
  );

  assert.match(
    offerer.text,
    /Pending calculation/,
  );

  assert.doesNotMatch(
    offerer.text,
    /pending_amount|movementNeedId|settlementIsForMe/,
  );

  assert(
    !offerer.text.includes(
      id(501),
    ),
  );

  const requester =
    completedUI({
      phase:
        'ready',
      rows: [
        completedRecovery({
          settlementIsForMe:
            false,
        }),
      ],
    });

  assert.match(
    requester.text,
    /Pending calculation for the person who offered the movement/,
  );

  assert.doesNotMatch(
    requester.text,
    /pending_amount/,
  );

  const settled =
    completedUI({
      phase:
        'ready',
      rows: [
        completedRecovery({
          settlementStatus:
            'settled',
          settledAt:
            '2026-09-28T12:01:00+00:00',
        }),
      ],
    });

  assert.match(
    settled.text,
    /Settled/,
  );
});

test('0058 completed movement UI loading error empty and refresh states are neutral', () => {
  const signedOut =
    completedUI({
      phase:
        'signed_out',
      rows: [],
    });

  assert.match(
    signedOut.text,
    /Sign in to view completed movements/,
  );

  assert.equal(
    signedOut.buttons.length,
    0,
  );

  const loading =
    completedUI({
      phase:
        'loading',
      rows: [],
    });

  assert.match(
    loading.text,
    /Loading completed movements/,
  );

  assert.equal(
    loading.buttons.length,
    1,
  );

  assert.equal(
    loading.buttons[0].props.disabled,
    true,
  );

  const empty =
    completedUI({
      phase:
        'ready',
      rows: [],
    });

  assert.match(
    empty.text,
    /No completed movements yet/,
  );

  empty.buttons[0]
    .props
    .onPress();

  assert.deepEqual(
    empty.calls,
    [
      'refresh',
    ],
  );

  const failed =
    completedUI({
      phase:
        'error',
      rows: [],
    });

  assert.match(
    failed.text,
    /Completed movements could not be loaded\. Please retry\./,
  );

  assert.match(
    failed.text,
    /Retry completed movements/,
  );

  assert.doesNotMatch(
    failed.text,
    /SQL|database|provider|settlement_id/,
  );
});

test('0058 completed recovery stays independently mounted on requester and offerer screens', () => {
  for (const file of [
    'src/app/request-movement.tsx',
    'src/app/offer-movement.tsx',
  ]) {
    const source =
      fs.readFileSync(
        file,
        'utf8',
      );

    assert.match(
      source,
      /import \{ CompletedMovements \} from '\.\.\/components\/CompletedMovements';/,
    );

    assert.match(
      source,
      /<CompletedMovements \/>/,
    );
  }

  const source =
    fs.readFileSync(
      'src/components/CompletedMovements.tsx',
      'utf8',
    );

  assert.doesNotMatch(
    source,
    /router\.push|router\.replace|journeyId|alignmentId|settlementId|latitude|longitude/,
  );
});
