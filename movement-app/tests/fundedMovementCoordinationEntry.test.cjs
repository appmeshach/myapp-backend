'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const source=read('supabase/migrations/0080_funded_movement_coordination_entry.sql');
const body=tag=>source.match(new RegExp('AS \\$'+tag+'\\$([\\s\\S]*?)\\$'+tag+'\\$'))[1];
const need='00000000-0000-4000-8000-000000000080';
const row={movement_need_id:need,journey_state:'not_started',coordination_ready:true};
function load(p,requireFn=()=>({})){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,require:requireFn});return exports;}
function service(response={data:[row],error:null}) {const calls=[];return {...load('src/services/movementService.ts',()=>({supabase:{rpc:(...args)=>{calls.push(args);const promise=response instanceof Error?Promise.reject(response):Promise.resolve(response);promise.abortSignal=()=>promise;return promise;}}})),calls};}
test('public selector only need, exact principals, receipt-backed graph and vehicle',()=>{
 assert.match(source,/open_my_funded_movement_coordination\(p_movement_need_id uuid\)/);
 const selector=body('coordination_selector');for(const text of ['auth.uid()','count(*)','FOR SHARE','FOR UPDATE','private.movement_funding_agreement','private.assert_funded_activation','o.vehicle_id=p.vehicle_id'])assert(selector.includes(text),text);
 assert.match(selector,/caller NOT IN \(a.offering_member_id,a.member_needing_movement_id\)/);
 assert.doesNotMatch(selector,/owner_id|ownership|assert_movement_offer_availability_binding/);
});
test('immutable private exact receipt, narrow deferred FK and trusted post-wait clock',()=>{
 for(const text of ['ENABLE ROW LEVEL SECURITY','FROM PUBLIC,anon,authenticated,service_role','BEFORE UPDATE OR DELETE OR TRUNCATE','journey_id uuid NOT NULL UNIQUE','DEFERRABLE INITIALLY IMMEDIATE'])assert(source.includes(text));
 const open=body('coordination_open');assert(open.indexOf('clock_timestamp()')>open.indexOf('funded_coordination_alignment'));
 assert(open.indexOf('INSERT INTO private.funded_movement_coordination_entries')<open.indexOf('INSERT INTO public.journeys'));
 assert.match(open,/SET CONSTRAINTS private.funded_coordination_entry_journey_fk DEFERRED/);assert.match(open,/SET CONSTRAINTS private.funded_coordination_entry_journey_fk IMMEDIATE/);
 assert.doesNotMatch(open,/SET CONSTRAINTS ALL|NOW\(|wallet|payment|settlement|chat|notification/);
});
test('replay no writes, full persisted identity and empty lifecycle fields',()=>{
 const open=body('coordination_open');const replay=open.slice(open.indexOf('IF EXISTS'),open.indexOf(' ELSE'));
 assert.doesNotMatch(replay,/INSERT|UPDATE public|DELETE/);assert.match(replay,/assert_funded_coordination_entry/);
 for(const name of ['start_requested_at','started_at','completion_requested_at','completed_at','end_requested_by_member_id','end_requested_at','end_confirmed_by_member_id','end_confirmed_at','end_reason','end_method'])assert(body('coordination_graph').includes('j.'+name+' IS NOT NULL'));
});
test('guards block direct service writes and all retained start end completion RPCs before locks',()=>{
 for(const name of ['request_journey_start','confirm_journey_start','request_journey_completion','confirm_journey_completion','request_movement_end','confirm_movement_end','decline_movement_end']){
  const start=source.indexOf('FUNCTION public.'+name+'(');const end=source.indexOf('\n$$;',start);const rpc=source.slice(start,end);
  assert(rpc.indexOf('private.is_financial_alignment')<rpc.indexOf('FOR UPDATE'),name);
 }
 assert.match(body('journey_guard'),/TG_OP='TRUNCATE'/);assert.match(body('journey_guard'),/TG_OP='DELETE'/);
 assert.match(body('coordination_alignment_guard'),/OLD.activated_at IS NOT NULL/);
 assert.match(body('settlement_guard'),/private.is_financial_alignment\(NEW.alignment_id\)/);
});
test('financial projection no start controls, legacy branch retained and recovery untouched',()=>{
 assert.equal((source.match(/NOT private.is_financial_alignment\(c.alignment_id\)/g)||[]).length,2);
 assert.match(source,/Do not run reveal.*canonical agreement lock/);
 assert.match(source,/private.funded_coordination_alignment\(p_need,false\)/);
 assert.match(source,/SELECT array_agg\(j.id\)/);
 assert.doesNotMatch(source,/FUNCTION public.list_my_active|FUNCTION public.create_journey_on_alignment_activation/);
 assert.match(read('supabase/migrations/0056_active_movement_coordination_recovery.sql'),/a.status = 'in_progress'/);
});
test('historical 0001–0079 normalized bytes unchanged',()=>{
 const files=fs.readdirSync('supabase/migrations').filter(f=>/^00(?:[0-6]\d|7[0-9])_/.test(f)).sort();assert.equal(files.length,79);
 assert.equal(crypto.createHash('sha256').update(files.map(f=>f+'\n'+read('supabase/migrations/'+f)).join('\n')).digest('hex'),'67b7cd51a6971351178bd514fc1b30c3b214539357753b4342459d30853ba79f');
});
test('strict RPC response and exact public-safe transport',async()=>{
 const h=service();const result=await h.openMyFundedMovementCoordination(need);
 assert.equal(JSON.stringify(result),JSON.stringify({movementNeedId:need,journeyState:'not_started',coordinationReady:true}));
 assert.equal(JSON.stringify(h.calls),JSON.stringify([['open_my_funded_movement_coordination',{p_movement_need_id:need}]]));
});
for(const value of [null,'bad',[need],{},undefined])test('bad UUID skips transport '+JSON.stringify(value),async()=>{const h=service();await assert.rejects(h.openMyFundedMovementCoordination(value),/movement_coordination_unavailable/);assert.equal(h.calls.length,0);});
for(const data of [null,[],[row,row],[null],[{...row,journey_id:need}],[{...row,journey_state:'cancelled'}],[{...row,coordination_ready:false}],[{...row,movement_need_id:'bad'}],[{...row,movement_need_id:'00000000-0000-4000-8000-000000000001'}]])test('fail closed malformed response '+JSON.stringify(data),async()=>{await assert.rejects(service({data,error:null}).openMyFundedMovementCoordination(need),/movement_coordination_unavailable/);});
test('raw backend failures hidden',async()=>{await assert.rejects(service(new Error('SECRET SQL')).openMyFundedMovementCoordination(need),/^Error: movement_coordination_unavailable$/);});
test('readiness is strict read only and supports the requester continuation',async()=>{
 const h=service({data:[{movement_need_id:need,funded_activated:true}],error:null});assert.equal(await h.getMyFundedMovementCoordinationReadiness(need),true);
 assert.equal(JSON.stringify(h.calls),JSON.stringify([['get_my_funded_movement_coordination_readiness',{p_movement_need_id:need}]]));
 assert.equal(await service({data:[],error:null}).getMyFundedMovementCoordinationReadiness(need),null);
 assert.equal(await service({data:[{movement_need_id:need,funded_activated:false}],error:null}).getMyFundedMovementCoordinationReadiness(need),false);
 for(const data of [[{movement_need_id:need,funded_activated:'false'}],[{movement_need_id:need,funded_activated:true,alignment_id:need}],null])await assert.rejects(service({data,error:null}).getMyFundedMovementCoordinationReadiness(need),/movement_coordination_unavailable/);
 assert.doesNotMatch(body('coordination_readiness'),/INSERT|UPDATE public|DELETE/);
});
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:r=>resolve(r)};}
test('entry controller explicit only, duplicate tap coalesced and navigate after success',async()=>{
 const d=deferred();let calls=0,navigation=0;const states=[];const {createFundedCoordinationEntryController:create}=load('src/state/fundedCoordinationEntryState.ts');
 const c=create(need,async(id,signal)=>{assert.equal(id,need);assert(signal instanceof AbortSignal);calls++;return d.promise;},s=>states.push(s));
 assert.equal(calls,0);const p=c.open(()=>navigation++);await c.open(()=>navigation++);assert.equal(calls,1);assert.equal(navigation,0);
 d.resolve({movementNeedId:need,journeyState:'not_started',coordinationReady:true});await p;assert.equal(navigation,1);assert.deepEqual(states,['opening','idle']);
});
test('dispose aborts and drops stale result and navigation',async()=>{
 const d=deferred();let signal,navigation=0;const {createFundedCoordinationEntryController:create}=load('src/state/fundedCoordinationEntryState.ts');
 const c=create(need,async(_id,s)=>{signal=s;return d.promise;},()=>{});const p=c.open(()=>navigation++);c.dispose();assert(signal.aborted);
 d.resolve({movementNeedId:need,journeyState:'not_started',coordinationReady:true});await p;assert.equal(navigation,0);
});
test('hook cancels entry with account foreground focus lifecycle and card awaits entry',()=>{
 const hook=read('src/hooks/useActivationPayment.ts');assert.match(hook,/coordination\?\.dispose\(\)/);assert.match(hook,/useFocusEffect/);assert.match(hook,/AppState.addEventListener/);assert.match(hook,/who !== next/);assert.match(hook,/state === 'activated'/);
 const card=read('src/components/ActivationPaymentCard.tsx');assert.match(card,/model.continueCoordination\(onContinueJourney\)/);assert.match(card,/coordinationState === 'opening'/);assert.doesNotMatch(card,/onPress=\{onContinueJourney\}/);
 for(const p of ['src/hooks/useMovementCoordination.ts','src/hooks/useMeetingJourney.ts'])if(fs.existsSync(p))assert.doesNotMatch(read(p),/openMyFundedMovementCoordination/);
});
function hookHarness(request,readiness=async()=>true) {
 let auth,app,cleanup,get;const AppState={currentState:'active',addEventListener:(_event,fn)=>{app=fn;return {remove(){}};}};
 const stubs={react:{useMemo:f=>f(),useCallback:f=>f,useSyncExternalStore:(_subscribe,read)=>{get=read;return read();}},'expo-router':{useFocusEffect:f=>{cleanup=f();}},'react-native':{AppState},'../lib/supabase':{supabase:{auth:{onAuthStateChange:f=>{auth=f;return {data:{subscription:{unsubscribe(){}}}};}}}},'../services/activationPaymentService':{requestActivationPayment:async()=> 'activation_not_ready'},'../services/movementService':{openMyFundedMovementCoordination:request,getMyFundedMovementCoordinationReadiness:readiness}};
 const model=load('src/hooks/useActivationPayment.ts',name=>stubs[name]||load('src/state/'+name.split('/').at(-1)+'.ts')).useActivationPayment(need);
 return {model,state:()=>get(),login:(id='requester')=>auth('SIGNED_IN',{user:{id}}),background(){AppState.currentState='background';app();},cleanup:()=>cleanup()};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('requester read-only readiness permits only explicit entry, no automatic construction',async()=>{
 let calls=0,navigation=0;const h=hookHarness(async()=>{calls++;return {movementNeedId:need,journeyState:'not_started',coordinationReady:true};});h.login();await flush();assert.equal(h.state().fundedActivated,true);assert.equal(calls,0);
 await h.model.continueCoordination(()=>navigation++);assert.equal(calls,1);assert.equal(navigation,1);h.cleanup();
});
test('validated legacy continuation rechecks without invoking financial construction',async()=>{
 let reads=0,entries=0,navigation=0;const h=hookHarness(async()=>{entries++;throw Error();},async()=>{reads++;return false;});
 h.login();await flush();assert.equal(h.state().legacyCoordinationReady,true);assert.equal(entries,0);await h.model.continueCoordination(()=>navigation++);assert.equal(reads,2);assert.equal(entries,0);assert.equal(navigation,1);h.cleanup();
});
for(const reason of ['account','background','cleanup'])test('entry hook '+reason+' rejects stale success/navigation',async()=>{
 const d=deferred();let signal,navigation=0;const h=hookHarness(async(_id,s)=>{signal=s;return d.promise;});h.login();await flush();const p=h.model.continueCoordination(()=>navigation++);
 if(reason==='account')h.login('other');else h[reason]();assert(signal.aborted);d.resolve({movementNeedId:need,journeyState:'not_started',coordinationReady:true});await p;assert.equal(navigation,0);h.cleanup();
});
test('failed entry remains retryable without navigation or raw error',async()=>{
 const {createFundedCoordinationEntryController:create}=load('src/state/fundedCoordinationEntryState.ts');let calls=0,navigation=0;const states=[];
 const c=create(need,async()=>{if(++calls===1)throw Error('SECRET');return {movementNeedId:need,journeyState:'not_started',coordinationReady:true};},s=>states.push(s));
 await c.open(()=>navigation++);assert.equal(navigation,0);assert.equal(states.at(-1),'unavailable');await c.open(()=>navigation++);assert.equal(navigation,1);
});
test('installed drift rejected without replacements; source clone protections pinned',()=>{
 const {expected,verifyDefinitions,selectMode}=require('../supabase/tests/0080_funded_movement_coordination_entry_harness.cjs');assert.equal(expected.length,21);assert.equal(selectMode(0,[],false),'source');assert.throws(()=>verifyDefinitions([]),/mismatch/);assert.throws(()=>selectMode(1,[],true),/mismatch/);
 for(const kind of ['behavior','concurrency']){const s=read('supabase/tests/0080_funded_movement_coordination_entry_'+kind+'.cjs');new vm.Script(s);assert.match(s,/inspect\(query\)/);assert.doesNotMatch(s,/--no-acl|db push|session_replication_role/);}
 const concurrency=read('supabase/tests/0080_funded_movement_coordination_entry_concurrency.cjs');for(const text of ['TEMPLATE template0','--format=custom','DEFAULT ACL','--use-list=','pg_blocking_pids','DROP DATABASE','verify(query, database)','fingerprint unchanged'])assert(concurrency.includes(text),text);
});
