const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loader(stubs = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(file); if (cache.has(full)) return cache.get(full);
    const exports = {}; cache.set(full,exports);
    const source = ts.transpileModule(fs.readFileSync(full,'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInNewContext(source,{ exports, Error, TypeError, Date, Blob, AbortSignal, AbortController, setTimeout, clearTimeout, ...globals,
      require(name) {
        if (name in stubs) return stubs[name];
        if (!name.startsWith('.')) return require(name);
        const base = path.resolve(path.dirname(full),name);
        return load(fs.existsSync(base+'.ts') ? base+'.ts' : base+'.tsx');
      },
    }, { filename: full });
    return exports;
  }
  return load;
}
const load = loader();
const state = load('src/state/verificationState.ts');
const controllers = load('src/state/verificationController.ts');
const { unavailableBiometricProvider } = load('src/providers/movementBiometricProvider.ts');
const copy = load('src/components/verificationCopy.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const future = '2099-01-01T00:10:00Z';
const newer = '2099-01-01T00:20:00Z';
const row = (status, expiresAt = future) => ({ status, expiresAt, completedAt: status === 'succeeded' ? '2099-01-01T00:00:00Z' : null, readyForActivation: status === 'succeeded' });
const photoRow = (status, verified = false, submittedAt = '2026-01-01T00:00:00Z') => ({ status, currentPhotoVerified: verified, submittedAt, processedAt: null });
const movement = (previous, data) => state.movementTransition(previous, { type: 'backend', row: data, now: 0 });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('upload receipt cannot produce verified; processing produces prepared_unverified', () => {
  let s = state.photoTransition(state.initialPhoto,{ type: 'submit' });
  s = state.photoTransition(s,{ type: 'uploaded', status: 'pending' }); assert.equal(s.phase,'processing');
  s = state.photoTransition(s,{ type: 'backend', row: photoRow('ready') }); assert.equal(s.phase,'prepared_unverified');
});
test('replacement immediately hides verification and ignores previous photo status', () => {
  let s = state.photoTransition(state.initialPhoto,{ type: 'backend', row: photoRow('ready',true) });
  assert.equal(s.phase,'verified'); s = state.photoTransition(s,{ type: 'submit' }); assert.equal(s.phase,'submitting');
  s = state.photoTransition(s,{ type: 'uploaded', status: 'ready' }); assert.equal(s.phase,'prepared_unverified');
  s = state.photoTransition(s,{ type: 'backend', row: photoRow('ready',true) }); assert.equal(s.phase,'prepared_unverified');
  s = state.photoTransition(s,{ type: 'backend', row: photoRow('pending',true,'2026-01-02T00:00:00Z') }); assert.equal(s.phase,'processing');
});
test('invalid photo transition is rejected', () => assert.throws(() => state.photoTransition(state.initialPhoto,{ type:'uploaded',status:'ready' })));
test('movement start and unavailable provider are explicit transitions', () => {
  const starting = state.movementTransition(state.initialMovement,{ type:'start' }); assert.equal(starting.phase,'starting');
  const unavailable = state.movementTransition(starting,{ type:'unavailable' }); assert.equal(unavailable.phase,'provider_unavailable');
  assert.equal(state.ownPaymentReadiness(unavailable),'provider_unavailable');
});
test('provider capture submission never implies success', () => {
  let s = state.movementTransition(state.initialMovement,{ type:'start' });
  s = state.movementTransition(s,{ type:'session',expiresAt:future }); assert.equal(s.phase,'provider_session_ready');
  s = state.movementTransition(s,{ type:'capture_submitted' }); assert.equal(s.phase,'pending'); assert.equal(s.ownReady,false);
  s = movement(s,row('succeeded')); assert.equal(s.phase,'succeeded'); assert.equal(s.ownReady,true);
});
test('stale success cannot override newer pending', () => {
  const s = movement(state.initialMovement,row('pending',newer));
  assert.equal(movement(s,row('succeeded',future)),s);
});
for (const phase of ['failed','expired']) test(`${phase} is terminal for same attempt but permits newer backend success`, () => {
  const s = movement(state.initialMovement,row(phase));
  assert.equal(movement(s,row('succeeded')),s);
  assert.equal(movement(s,row('succeeded',newer)).phase,'succeeded');
});
test('clock expiry clears readiness without network polling', () => {
  const s = movement(state.initialMovement,row('succeeded'));
  const expired = state.movementTransition(s,{ type:'tick',now:Date.parse(future) });
  assert.equal(expired.phase,'expired'); assert.equal(expired.ownReady,false);
});
test('network failure is separate from check failure and disables payment indication', () => {
  const s = movement(state.initialMovement,row('succeeded'));
  const offline = state.movementTransition(s,{ type:'error',error:'network_unavailable' });
  assert.equal(offline.phase,'succeeded'); assert.equal(offline.error,'network_unavailable');
  assert.equal(state.ownPaymentReadiness(offline),'not_ready');
});
test('safe succeeded status with false readiness never claims ready', () => {
  const s = movement(state.initialMovement,{ ...row('succeeded'),readyForActivation:false });
  assert.equal(state.ownPaymentReadiness(s),'not_ready');
});
test('invalid movement transitions rejected', () => {
  assert.throws(() => state.movementTransition(state.initialMovement,{ type:'capture_submitted' }));
  assert.throws(() => state.movementTransition(state.initialMovement,{ type:'session',expiresAt:future }));
});
test('state projection drops extra private fields', () => {
  const s = movement(state.initialMovement,{ ...row('pending'), mediaId:'private',memberId:'private',providerReference:'private',score:1 });
  assert(!JSON.stringify(s).includes('private')); assert(!('score' in s));
});
test('default provider cannot start or manufacture results', async () => {
  assert.equal(await unavailableBiometricProvider.isAvailable(),false);
  await assert.rejects(unavailableBiometricProvider.start('need'));
  assert.equal(await unavailableBiometricProvider.presentCapture(),'unavailable');
});
test('controller ignores response started before new attempt', async () => {
  const pending = deferred();
  const c = controllers.createMovementController('need',() => pending.promise,unavailableBiometricProvider);
  const refresh = c.refresh(); await c.start(); assert.equal(c.getSnapshot().phase,'provider_unavailable');
  pending.resolve(row('succeeded')); await refresh; assert.equal(c.getSnapshot().phase,'provider_unavailable');
});
test('controller duplicate start calls cannot create duplicate provider sessions', async () => {
  const wait = deferred(); let count = 0;
  const provider = { isAvailable: async () => true, start: async () => { count++; await wait.promise; return { status:'pending',expiresAt:future }; }, presentCapture: async () => 'submitted' };
  const c = controllers.createMovementController('need',async () => row('pending'),provider);
  const first = c.start(); await flush(); await c.start(); assert.equal(count,1);
  wait.resolve(); await first; assert.equal(c.getSnapshot().phase,'pending');
});
test('disposed/background owner drops late responses and disallows submission', async () => {
  const wait = deferred(); let uploads = 0;
  const c = controllers.createPhotoController({ status:() => wait.promise, submit:async () => { uploads++; return { status:'pending' }; } });
  const fetching = c.refresh(); c.deactivate(); await c.submit(new Blob(['photo']));
  wait.resolve(photoRow('ready',true)); await fetching;
  assert.equal(c.getSnapshot().phase,'none'); assert.equal(uploads,0);
});
test('photo refresh cannot restore old verified state after replacement starts', async () => {
  const wait = deferred();
  const c = controllers.createPhotoController({ status:() => wait.promise, submit:async () => ({ status:'pending' }) });
  const fetching = c.refresh(); await c.submit(new Blob(['photo']));
  wait.resolve(photoRow('ready',true)); await fetching; assert.equal(c.getSnapshot().phase,'processing');
});
test('poller has one loop, pauses, resumes and stops on terminal status', async () => {
  let count = 0; let poll = true; let next; let delay; let cleared = 0;
  const p = controllers.createStatusPoller(async () => { count++; },() => poll,
    (fn,ms) => { assert.equal(next,undefined); next=fn; delay=ms; return 1; },() => { next=undefined; cleared++; });
  p.resume(); p.resume(); await flush(); assert.equal(count,1); assert.equal(delay,15000);
  p.pause(); assert.equal(next,undefined); assert(cleared>0);
  p.resume(); await flush(); assert.equal(count,2);
  poll=false; const fire=next; next=undefined; fire(); await flush(); assert.equal(count,3); assert.equal(next,undefined);
  p.dispose(); await p.refresh(); assert.equal(count,3);
});
test('poller coalesces simultaneous refresh requests and cleanup prevents rescheduling', async () => {
  const wait = deferred(); let count=0; let scheduled=0;
  const p = controllers.createStatusPoller(async () => { count++; await wait.promise; },() => true,() => { scheduled++; return 1; },() => {});
  p.resume(); void p.refresh(); void p.refresh(); assert.equal(count,1);
  p.dispose(); wait.resolve(); await flush(); assert.equal(count,1); assert.equal(scheduled,0);
});
test('terminal controllers do not request recurring polls', async () => {
  for (const phase of ['succeeded','failed','expired']) {
    const c = controllers.createMovementController('need',async () => row(phase),unavailableBiometricProvider,() => 0);
    await c.refresh(); assert.equal(c.shouldPoll(),false);
  }
});

function renderedText(element) {
  if (element == null || typeof element === 'boolean') return '';
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  if (Array.isArray(element)) return element.map(renderedText).join(' ');
  if (typeof element.type === 'function') return renderedText(element.type(element.props));
  return renderedText(element.props?.children);
}
function cards(photo, movementState) {
  return loader({
    react: { ...require('react'), useState: value => [value,() => {}], useRef: value => ({ current: value }), useEffect: () => {} },
    'react-native': { View:'View', Text:'Text', Pressable:'Pressable',StyleSheet:{ create:x=>x } },
    '../hooks/useVerification': {
      useProfilePhotoVerification: () => ({ state:photo, signedIn:true, submit:async()=>{}, refresh:async()=>{} }),
      useMovementFaceVerification: () => ({ state:movementState, signedIn:true, start:async()=>{}, refresh:async()=>{} }),
    },
  })('src/components/VerificationCards.tsx');
}
test('prepared card does not render Verified and verified photo card does', () => {
  const prepared = state.photoTransition(state.initialPhoto,{ type:'backend',row:photoRow('ready') });
  assert(!renderedText(cards(prepared).ProfilePhotoVerificationCard({})).includes('Verified'));
  const verified = state.photoTransition(state.initialPhoto,{ type:'backend',row:photoRow('ready',true) });
  assert(renderedText(cards(verified).ProfilePhotoVerificationCard({})).includes('Verified photo'));
});
test('unavailable and expired cards render neutral copy with retry path', () => {
  for (const phase of ['provider_unavailable','expired']) {
    const s = { ...state.initialMovement, phase,loaded:true };
    const text = renderedText(cards(null,s).MovementFaceVerificationCard({ movementNeedId:'need' }));
    assert(text.includes('Try again')); assert(!/Smile|Veriff|score|storage_path|provider.reference|media.id/i.test(text));
  }
});
test('safe error mapping never shows server internals', () => {
  assert.equal(state.safeVerificationError(new Error('SQL private/member-id')),'verification_unavailable');
  assert.equal(state.safeVerificationError(new TypeError('Failed to fetch private/url')),'network_unavailable');
  assert(!Object.values(copy.errorCopy).join(' ').includes('private/url'));
});

function serviceHarness(response, fetchError) {
  const calls=[];
  const api = loader({ '../lib/supabase': { supabase:{ auth:{ getSession:async()=>({ data:{ session:{ access_token:'user-token' } } }) } } } }, {
    process:{ env:{ EXPO_PUBLIC_SUPABASE_URL:'https://project.invalid',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-key' } },
    fetch:async (url,init) => { calls.push([url,init]); if(fetchError) throw fetchError; return response; },
  })('src/services/faceOrchestrationService.ts');
  return { api,calls };
}
test('start service sends only need ID and projects only safe receipt fields', async () => {
  const { api,calls } = serviceHarness(new Response(JSON.stringify({ status:'pending',expiresAt:future,mediaId:'private',providerReference:'private' })));
  const receipt = await api.startMyMovementFaceVerification('44444444-4444-4444-8444-444444444444');
  assert.deepEqual(plain(receipt),{ status:'pending',expiresAt:future });
  assert.deepEqual(Object.keys(JSON.parse(calls[0][1].body)),['movementNeedId']);
  assert.equal(calls[0][1].headers.Authorization,'Bearer user-token');
});
test('photo service sends only raw photo and public credentials; upload never returns verification', async () => {
  const { api,calls } = serviceHarness(new Response(JSON.stringify({ status:'pending',verified:true,mediaId:'private' })));
  const photo = new Blob(['photo'],{ type:'image/png' });
  assert.deepEqual(plain(await api.submitMovementIdentityPhoto(photo)),{ status:'pending' });
  assert.equal(calls[0][1].body,photo); assert.equal(calls[0][1].headers.apikey,'public-key');
});
test('oversize photo is rejected locally without network', async () => {
  const { api,calls } = serviceHarness();
  await assert.rejects(api.submitMovementIdentityPhoto(new Blob([new Uint8Array(5242881)],{type:'image/png'})),/photo_too_large/);
  assert.equal(calls.length,0);
});
for (const [code,message] of [[401,'authentication_required'],[413,'photo_too_large'],[503,'request_unavailable']]) test(`HTTP ${code} becomes safe category`, async () => {
  const { api } = serviceHarness(new Response('SQL secret media',{status:code}));
  await assert.rejects(api.submitMovementIdentityPhoto(new Blob(['photo'],{type:'image/png'})),new RegExp(message));
});
test('transport failure maps to network error without raw URL', async () => {
  const { api } = serviceHarness(null,new TypeError('private/url'));
  await assert.rejects(api.submitMovementIdentityPhoto(new Blob(['photo'],{type:'image/png'})),/network_unavailable/);
});
test('production client provider cannot be enabled by environment or create success', () => {
  const provider = fs.readFileSync('src/providers/movementBiometricProvider.ts','utf8');
  assert.doesNotMatch(provider,/process\.env|livenessPassed|faceMatchPassed|service_role/);
  const ui = fs.readFileSync('src/components/VerificationCards.tsx','utf8');
  assert.doesNotMatch(ui,/storagePath|providerReference|biometricScore|memberId|mediaId/);
});

test('backgrounded photo upload becomes refreshable and ignores late receipt', async () => {
  const upload = deferred();
  const owner = controllers.createPhotoController({ status: async () => photoRow('ready'), submit: () => upload.promise });
  const work = owner.submit(new Blob(['photo']));
  owner.deactivate(); assert.equal(owner.getSnapshot().phase, 'none');
  upload.resolve({ status: 'pending' }); await work;
  owner.activate(); await owner.refresh();
  assert.equal(owner.getSnapshot().phase, 'prepared_unverified');
});

test('backgrounded provider session can reconcile safe backend status on resume', async () => {
  const capture = deferred();
  const owner = controllers.createMovementController('need', async () => row('pending'), {
    isAvailable: async () => true, start: async () => ({ expiresAt: future }), presentCapture: () => capture.promise,
  }, () => 0);
  const work = owner.start(); await flush();
  assert.equal(owner.getSnapshot().phase, 'provider_session_ready');
  owner.deactivate(); assert.equal(owner.getSnapshot().phase, 'required');
  capture.resolve('submitted'); await work;
  owner.activate(); await owner.refresh();
  assert.equal(owner.getSnapshot().phase, 'pending'); assert.equal(owner.getSnapshot().ownReady, false);
});

for (const kind of ['photo','movement']) test(`${kind}: later refresh wins over an out-of-order success or error`, async () => {
  for (const rejectOld of [false,true]) {
    const old = deferred(); const fresh = deferred(); let reads = 0; const signals = [];
    const status = (...args) => { signals.push(args.at(-1)); return ++reads === 1 ? old.promise : fresh.promise; };
    const c = kind === 'photo'
      ? controllers.createPhotoController({ status, submit: async () => ({ status:'pending' }) })
      : controllers.createMovementController('need',status,unavailableBiometricProvider,() => 0);
    const first = c.refresh(); const second = c.refresh(); assert.equal(signals[0].aborted,true);
    fresh.resolve(kind === 'photo' ? photoRow('pending') : row('pending')); await second;
    const snapshot = c.getSnapshot();
    if (rejectOld) old.reject(new Error('private/path')); else old.resolve(kind === 'photo' ? photoRow('ready',true) : row('succeeded'));
    await first; assert.equal(c.getSnapshot(),snapshot);
  }
});

test('deactivation aborts reads and late completion cannot notify subscribers', async () => {
  const wait = deferred(); let signal; let notifications = 0;
  const c = controllers.createMovementController('need',(_need,s) => { signal=s; return wait.promise; },unavailableBiometricProvider);
  c.subscribe(() => notifications++); const work = c.refresh();
  c.deactivate(); c.reset(); const before = notifications;
  assert.equal(signal.aborted,true); wait.resolve(row('succeeded')); await work;
  assert.equal(notifications,before); assert.equal(c.getSnapshot().ownReady,false);
});

test('foreground before provider promise settles refreshes afterward without getting stuck', async () => {
  const capture = deferred(); let reads = 0;
  const c = controllers.createMovementController('need',async () => { reads++; return row('pending'); },{
    isAvailable:async () => true, start:async () => ({ status:'pending',expiresAt:future }), presentCapture:() => capture.promise,
  },() => 0);
  const work = c.start(); await flush(); c.deactivate(); c.activate(); await c.refresh();
  assert.equal(c.shouldPoll(),true); capture.resolve('submitted'); await work;
  assert.equal(reads,1); assert.equal(c.getSnapshot().phase,'pending');
});

test('later attempts within one millisecond retain PostgreSQL ordering', () => {
  let s = movement(state.initialMovement,row('failed','2099-01-01T00:10:00.000001Z'));
  s = state.movementTransition(s,{type:'start'});
  s = state.movementTransition(s,{type:'session',expiresAt:'2099-01-01T00:10:00.000002+00:00'});
  s = state.movementTransition(s,{type:'capture_submitted'});
  assert.equal(movement(s,row('succeeded','2099-01-01T00:10:00.000001Z')),s);
  assert.equal(movement(s,row('succeeded','2099-01-01T00:10:00.000002Z')).phase,'succeeded');
});

test('fresh not-started backend state removes prior readiness', () => {
  const s = movement(state.initialMovement,row('succeeded'));
  const next = movement(s,{ status:'not_started',expiresAt:null,completedAt:null,readyForActivation:false });
  assert.equal(next.phase,'required'); assert.equal(next.ownReady,false);
});

test('unexpected positive provider result cannot establish success', async () => {
  const c = controllers.createMovementController('need',async () => row('pending'),{
    isAvailable:async () => true,start:async () => ({status:'pending',expiresAt:future}),
    presentCapture:async () => ({succeeded:true,livenessPassed:true,providerReference:'private'}),
  });
  await c.start(); assert.notEqual(c.getSnapshot().phase,'succeeded'); assert.equal(c.getSnapshot().ownReady,false);
  assert(!JSON.stringify(c.getSnapshot()).includes('private'));
});

for (const input of [undefined,'','bad-id',['44444444-4444-4444-8444-444444444444'],'../private']) test(`movement route rejects ${JSON.stringify(input)}`, () => {
  let cards = 0;
  const screen = loader({
    'expo-router':{ Stack:{Screen:'Screen'},useLocalSearchParams:() => ({movementNeedId:input}) },
    'react-native':{ScrollView:'ScrollView',Text:'Text'},
    '../components/VerificationCards':{MovementFaceVerificationCard:() => {cards++; return null;}},
  })('src/app/movement-verification.tsx').default;
  assert.match(renderedText(screen()),/Open a movement/); assert.equal(cards,0);
});

test('valid movement route passes only the movement need ID', () => {
  let props;
  const need = '44444444-4444-4444-8444-444444444444';
  const screen = loader({
    'expo-router':{ Stack:{Screen:'Screen'},useLocalSearchParams:() => ({movementNeedId:need,memberId:'private',providerReference:'private'}) },
    'react-native':{ScrollView:'ScrollView',Text:'Text'},
    '../components/VerificationCards':{MovementFaceVerificationCard:p => {props=p; return null;}},
  })('src/app/movement-verification.tsx').default;
  renderedText(screen()); assert.deepEqual(Object.keys(props),['movementNeedId']); assert.equal(props.movementNeedId,need);
});

test('picker double taps coalesce and unmount drops late selection and UI updates', async () => {
  const wait = deferred(); let picked = 0; let submitted = 0; let updates = 0; let cleanup;
  const card = loader({
    react:{...require('react'),useState:v => [v,() => updates++],useRef:v => ({current:v}),useEffect:fn => {cleanup=fn();}},
    'react-native':{View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:v=>v}},
    '../hooks/useVerification':{useProfilePhotoVerification:() => ({state:{...state.initialPhoto,loaded:true},signedIn:true,
      submit:async () => submitted++,refresh:async()=>{}})},
  })('src/components/VerificationCards.tsx').ProfilePhotoVerificationCard;
  const tree = card({picker:{pick:() => {picked++;return wait.promise;}}});
  function find(e) { if(!e || typeof e!=='object') return; if(Array.isArray(e)) return e.map(find).find(Boolean);
    if(e.props?.title==='Choose photo') return e; return find(e.props?.children); }
  const action = find(tree); action.props.onPress(); action.props.onPress(); assert.equal(picked,1);
  cleanup(); const before = updates; wait.resolve(new Blob(['photo'])); await flush();
  assert.equal(submitted,0); assert.equal(updates,before);
});

test('status RPC rejects malformed safe fields instead of storing private strings', async () => {
  const need = '44444444-4444-4444-8444-444444444444';
  for (const bad of [
    {status:'private/provider',expires_at:future,completed_at:null,ready_for_activation:false},
    {status:'pending',expires_at:'private/storage/path',completed_at:null,ready_for_activation:false},
    {status:'succeeded',expires_at:future,completed_at:future,ready_for_activation:'private'},
  ]) {
    const api = loader({'../lib/supabase':{supabase:{rpc:async () => ({data:[bad]})}}})('src/services/faceVerificationService.ts');
    await assert.rejects(api.getMyAlignmentFaceVerificationStatus(need),/^Error: verification_unavailable$/);
  }
});

test('status RPC sanitizes thrown exceptions and forwards cancellation', async () => {
  const need = '44444444-4444-4444-8444-444444444444';
  for (const error of [new TypeError('private/path'),new Error('SQL private')]) {
    const api = loader({'../lib/supabase':{supabase:{rpc:() => {throw error;}}}})('src/services/faceVerificationService.ts');
    await assert.rejects(api.getMyAlignmentFaceVerificationStatus(need),new RegExp(error instanceof TypeError ? 'network_unavailable' : 'verification_unavailable'));
  }
  const abort = new AbortController(); let received;
  const api = loader({'../lib/supabase':{supabase:{rpc:() => ({abortSignal:s => {received=s;return Promise.resolve({data:[]});}})}}})('src/services/faceVerificationService.ts');
  assert.equal(await api.getMyAlignmentFaceVerificationStatus(need,abort.signal),null); assert.equal(received,abort.signal);
});

test('invalid movement status input never reaches RPC', async () => {
  let calls = 0;
  const api = loader({'../lib/supabase':{supabase:{rpc:() => calls++}}})('src/services/faceVerificationService.ts');
  await assert.rejects(api.getMyAlignmentFaceVerificationStatus('bad'),/verification_unavailable/); assert.equal(calls,0);
});

test('start denial is not mislabeled as a photo format error', async () => {
  const {api} = serviceHarness(new Response('private',{status:400}));
  await assert.rejects(api.startMyMovementFaceVerification('44444444-4444-4444-8444-444444444444'),/request_unavailable/);
});
