const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
function loader(stubs={},globals={}) {
  const cache=new Map();
  function load(file){const full=path.resolve(file);if(cache.has(full))return cache.get(full);const exports={};cache.set(full,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
      exports,Error,TypeError,Date,Blob,AbortController,AbortSignal,setTimeout,clearTimeout,...globals,
      require(name){if(name in stubs)return stubs[name];if(!name.startsWith('.'))return require(name);const base=path.resolve(path.dirname(full),name);return load(fs.existsSync(base+'.ts')?base+'.ts':base+'.tsx');},
    });return exports;
  }return load;
}
const load=loader();
const {createMovementController}=load('src/state/verificationController.ts');
const {unavailableBiometricProvider}=load('src/providers/movementBiometricProvider.ts');
const {initialMovement}=load('src/state/verificationState.ts');
const need='44444444-4444-4444-8444-444444444444';
const expires='2099-01-01T00:10:00.000001Z';
const newer='2099-01-01T00:20:00.000001Z';
const receipt=(expiresAt=expires)=>({status:'pending',expiresAt});
const status=(phase='pending',expiresAt=expires,ready=phase==='succeeded')=>({status:phase,expiresAt,completedAt:phase==='succeeded'?'2099-01-01T00:00:00Z':null,readyForActivation:ready});
const adapter=(extra={})=>({isAvailable:async()=>true,start:async()=> 'ready',presentCapture:async()=> 'submitted',...extra});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function hookHarness({provider=adapter(),start=async()=>receipt(),read=async()=>status(),signedIn=true,initialRequired=true}={}) {
  let cleanup;let change;let snapshot;let id=0;let firstRead=true;const timers=new Map();
  const AppState={currentState:'active',addEventListener:(_event,fn)=>{change=fn;return {remove(){change=undefined;}};}};
  const hook=loader({
    react:{useState:()=>[{generation:1,signedIn},()=>{}],useEffect:()=>{},useCallback:fn=>fn,useMemo:fn=>fn(),useSyncExternalStore:(_subscribe,get)=>{snapshot=get;return get();}},
    'react-native':{AppState},'expo-router':{useFocusEffect:fn=>{cleanup=fn();}},
    '../lib/supabase':{supabase:{}},
    '../services/faceVerificationService':{getMyAlignmentFaceVerificationStatus:async(...args)=>{
      const row=await read(...args);if(firstRead&&initialRequired){firstRead=false;return {status:'not_started',expiresAt:null,completedAt:null,readyForActivation:false};}return row;
    }},
    '../services/faceOrchestrationService':{startMyMovementFaceVerification:start},
  },{setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key)})('src/hooks/useVerification.ts').useMovementFaceVerification;
  const model=hook(need,provider);
  return {model,snapshot:()=>snapshot(),timers,background(){AppState.currentState='background';change?.();},foreground(){AppState.currentState='active';change?.();},dispose(){cleanup?.();}};
}
function serviceHarness({response,fetchError,getSession}={}) {
  const calls=[];
  const api=loader({'../lib/supabase':{supabase:{auth:{getSession:getSession??(async()=>({data:{session:{access_token:'user-jwt'}}}))}}}},{
    process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://project.invalid',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-key'}},
    fetch:async(url,options)=>{calls.push({url,options});if(fetchError)throw fetchError;return typeof response==='function'?response(options):response;},
  })('src/services/faceOrchestrationService.ts');
  return {api,calls};
}
function text(e){if(e==null)return '';if(typeof e==='string')return e;if(Array.isArray(e))return e.map(text).join(' ');if(typeof e.type==='function')return text(e.type(e.props));return text(e.props?.children);}
function card(state){return loader({react:require('react'),'react-native':{View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:x=>x}},
  '../hooks/useVerification':{useMovementFaceVerification:()=>({state,signedIn:true,start:async()=>{},refresh:async()=>{},cancel:()=>{}})},
})('src/components/VerificationCards.tsx').MovementFaceVerificationCard({movementNeedId:need,identityPhotoLink:'Manage movement identity photo'});}

test('hook sends server start first, then invokes adapter, then refreshes backend',async()=>{
  const events=[];
  const h=hookHarness({start:async(id,signal)=>{assert.equal(id,need);assert(signal instanceof AbortSignal);events.push('server');return receipt();},
    provider:adapter({isAvailable:async()=>{events.push('available');return true;},start:async(context,signal)=>{events.push('adapter');assert.deepEqual(Object.keys(context).sort(),['expiresAt','movementNeedId']);assert(!signal.aborted);return 'ready';},presentCapture:async()=>{events.push('capture');return 'submitted';}}),
    read:async()=>{events.push('status');return status();}});
  await flush();events.length=0;await h.model.start();
  assert.deepEqual(events,['server','available','adapter','capture','status']);assert.equal(h.snapshot().phase,'pending');assert.equal(h.snapshot().ownReady,false);h.dispose();
});
test('duplicate start taps create one trusted request',async()=>{
  const wait=deferred();let starts=0;const h=hookHarness({start:async()=>{starts++;return wait.promise;}});await flush();
  const first=h.model.start();const second=h.model.start();assert.equal(starts,1);assert.equal(h.snapshot().phase,'starting');wait.resolve(receipt());await Promise.all([first,second]);assert.equal(starts,1);h.dispose();
});
test('real start helper sends only movementNeedId and normal public auth credentials',async()=>{
  const {api,calls}=serviceHarness({response:new Response(JSON.stringify({...receipt(),memberId:'secret',mediaId:'secret',providerReference:'secret',verified:true}))});
  const result=await api.startMyMovementFaceVerification(need);const request=calls[0];
  assert.deepEqual(JSON.parse(request.options.body),{movementNeedId:need});assert.deepEqual(Object.keys(request.options.headers).sort(),['Authorization','Content-Type','apikey']);
  assert.equal(request.options.headers.Authorization,'Bearer user-jwt');assert.equal(JSON.stringify(result),JSON.stringify(receipt()));
});
test('server 503 fails closed without exposing its body or invoking capture',async()=>{
  const {api}=serviceHarness({response:new Response('private/server/provider',{status:503})});let adapters=0;
  const h=hookHarness({start:api.startMyMovementFaceVerification,provider:adapter({isAvailable:async()=>{adapters++;return true;}})});await flush();await h.model.start();
  assert.equal(h.snapshot().phase,'provider_unavailable');assert.equal(adapters,0);assert(!JSON.stringify(h.snapshot()).includes('private'));h.dispose();
});
test('default client adapter fails closed after an accepted backend receipt',async()=>{
  let starts=0;const h=hookHarness({start:async()=>{starts++;return receipt();},provider:unavailableBiometricProvider});await flush();await h.model.start();
  assert.equal(starts,1);assert.equal(h.snapshot().phase,'provider_unavailable');assert.equal(h.snapshot().ownReady,false);h.dispose();
});
test('only backend succeeded plus ready renders movement verification complete',async()=>{
  let backend=status();const h=hookHarness({read:async()=>backend});await flush();await h.model.start();assert(!text(card(h.snapshot())).includes('Verified for this movement'));
  backend=status('succeeded',expires,false);await h.model.refresh();assert(!text(card(h.snapshot())).includes('Verified for this movement'));
  backend=status('succeeded');await h.model.refresh();assert.match(text(card(h.snapshot())),/Verified for this movement/);assert.equal(h.timers.size,0);h.dispose();
});
test('unexpected local positive provider object cannot create success or leak fields',async()=>{
  const h=hookHarness({provider:adapter({presentCapture:async()=>({succeeded:true,verified:true,providerReference:'secret',score:1})})});await flush();await h.model.start();
  assert.notEqual(h.snapshot().phase,'succeeded');assert.equal(h.snapshot().ownReady,false);assert(!JSON.stringify(h.snapshot()).includes('secret'));h.dispose();
});
test('provider cancellation also refreshes the backend without asserting failure',async()=>{
  let reads=0;const h=hookHarness({read:async()=>{reads++;return status();},provider:adapter({presentCapture:async()=> 'cancelled'})});await flush();await h.model.start();
  assert.equal(reads,2);assert.equal(h.snapshot().phase,'pending');assert.equal(h.snapshot().ownReady,false);h.dispose();
});
test('late old adapter result cannot overwrite a newer attempt or clear its busy guard',async()=>{
  const old=deferred();const current=deferred();let starts=0;let capture=0;const signals=[];
  const c=createMovementController(need,{status:async()=>status(),start:async()=>receipt(++starts===1?expires:newer)},adapter({presentCapture:signal=>{signals.push(signal);return ++capture===1?old.promise:current.promise;}}),()=>0);
  const first=c.start();await flush();c.cancel();assert(signals[0].aborted);const second=c.start();await flush();old.resolve('submitted');await first;
  assert.equal(c.getSnapshot().expiresAt,newer);assert.equal(c.getSnapshot().phase,'provider_session_ready');await c.start();assert.equal(starts,2);
  current.resolve('submitted');await second;assert.equal(c.getSnapshot().phase,'pending');
});
for(const action of ['dispose','background']) test(`${action} aborts provider interaction and rejects late outcomes`,async()=>{
  const wait=deferred();let signal;const h=hookHarness({provider:adapter({presentCapture:s=>{signal=s;return wait.promise;}})});await flush();const work=h.model.start();await flush();
  h[action]();assert(signal.aborted);const before=h.snapshot();wait.resolve('submitted');await work;assert.equal(h.snapshot(),before);assert.equal(h.timers.size,0);h.dispose();
});
test('background pauses pending polling; foreground refreshes with a single conservative loop',async()=>{
  let reads=0;const h=hookHarness({initialRequired:false,read:async()=>{reads++;return status();}});await flush();assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,15000);
  h.background();assert.equal(h.timers.size,0);const before=reads;await h.model.refresh();assert.equal(reads,before);
  h.foreground();await flush();assert.equal(reads,before+1);assert.equal(h.timers.size,1);h.dispose();assert.equal(h.timers.size,0);
});
for(const phase of ['failed','expired']) test(`${phase} can retry with a new server attempt`,async()=>{
  let starts=0;const c=createMovementController(need,{status:async()=>status(phase),start:async()=>{starts++;return receipt(newer);}},adapter(),()=>0);
  await c.refresh();assert.equal(c.getSnapshot().phase,phase);assert.equal(await c.start(),true);assert.equal(starts,1);assert.equal(c.getSnapshot().phase,'pending');assert.equal(c.getSnapshot().expiresAt,newer);
});
test('start network errors stay distinct from biometric failure',async()=>{
  const {api}=serviceHarness({fetchError:new TypeError('private/network/url')});const h=hookHarness({start:api.startMyMovementFaceVerification});await flush();await h.model.start();
  assert.equal(h.snapshot().error,'network_unavailable');assert.notEqual(h.snapshot().phase,'failed');assert(!text(card(h.snapshot())).includes('private'));h.dispose();
});
test('missing prepared photo denial remains generic with a safe identity-photo path',async()=>{
  const {api}=serviceHarness({response:new Response('Prepared photo required media_id private',{status:404})});const h=hookHarness({start:api.startMyMovementFaceVerification});await flush();await h.model.start();
  const content=text(card(h.snapshot()));assert.match(content,/photo must be prepared/);assert.match(content,/Manage movement identity photo/);assert.equal(h.snapshot().error,'verification_unavailable');assert(!/media_id|private/.test(content));h.dispose();
});
test('current-member copy never implies aggregate readiness or payment approval',()=>{
  const content=text(card({...initialMovement,phase:'succeeded',loaded:true,ownReady:true}));
  assert.match(content,/your check only/i);assert.match(content,/platform's activation checks/);assert.doesNotMatch(content,/all participants are ready|payment approved|guaranteed|trust score|Smile|Veriff/);
});
test('invalid public IDs are rejected before status or start requests',async()=>{
  for(const value of [undefined,'','bad','../path',[need]]){let calls=0;const c=createMovementController(value,{status:async()=>{calls++;return null;},start:async()=>{calls++;return receipt();}},adapter());await c.refresh();await c.start();assert.equal(calls,0);
    const {api, calls:network}=serviceHarness();await assert.rejects(api.startMyMovementFaceVerification(value));assert.equal(network.length,0);}
});
for(const extra of ['alignmentId','memberId','mediaId','providerReference','sessionId']) test(`route refuses ${extra} even beside a valid need`,()=>{
  let mounted=0;const screen=loader({'expo-router':{Stack:{Screen:'Screen'},useLocalSearchParams:()=>({movementNeedId:need,[extra]:'secret'})},'react-native':{ScrollView:'ScrollView',Text:'Text'},'../components/ActivationPaymentCard':{ActivationPaymentCard:()=>null}, '../components/VerificationCards':{MovementFaceVerificationCard:()=>{mounted++;return null;}}})('src/app/movement-verification.tsx').default;
  assert.match(text(screen()),/Open a movement/);assert.equal(mounted,0);
});
test('navigation cancellation aborts the actual Edge fetch signal and drops late receipt',async()=>{
  const wait=deferred();let signal;const {api}=serviceHarness({response:options=>{signal=options.signal;return wait.promise;}});
  const h=hookHarness({start:api.startMyMovementFaceVerification});await flush();const work=h.model.start();await flush();h.dispose();assert(signal.aborted);
  wait.resolve(new Response(JSON.stringify(receipt())));await work;assert.equal(h.snapshot().ownReady,false);
});
test('expired receipt never launches SDK capture',async()=>{
  let calls=0;const c=createMovementController(need,{status:async()=>null,start:async()=>receipt('2020-01-01T00:00:00Z')},adapter({isAvailable:async()=>{calls++;return true;}}));await c.start();assert.equal(calls,0);assert.equal(c.getSnapshot().phase,'expired');
});
