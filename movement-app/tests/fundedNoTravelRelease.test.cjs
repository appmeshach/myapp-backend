'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),cp=require('node:child_process'),path=require('node:path');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const need='00000000-0000-4000-8000-000000000085';
function load(file,stubs={}){const exports={};vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,setTimeout,clearTimeout,require:n=>stubs[n]||{}});return exports;}
const row=(patch={})=>({journey_state:'cancelled',end_status:'mutual_no_travel',requested_by_me:false,action_required_from_me:false,requested_at:'2026-10-05T12:00:00Z',completed_at:null,funding_disposition:'released_to_me',released_minor:123,currency:'NGN',...patch});
function service(data=[row()],error=null,after){const calls=[];const api=load('src/services/movementEndService.ts',{'../lib/supabase':{supabase:{rpc:(name,args)=>{calls.push({name,args});return {abortSignal:async()=>{after?.();return {data,error};}};}}}});return {api,calls};}
const signal=()=>new AbortController().signal;
test('0085 exact existing RPC arguments contain only public need and optional human reason',async()=>{
 const h=service();for(const name of ['getMovementEndStatus','requestMovementEnd','confirmMovementEnd','declineMovementEnd'])await h.api[name](need,signal());
 assert.deepEqual(h.calls.map(c=>c.name),['get_my_movement_end_status_by_need','request_my_movement_end','confirm_my_movement_end','decline_my_movement_end']);
 for(const c of h.calls)assert.deepEqual(JSON.parse(JSON.stringify(c.args)),{p_movement_need_id:need});
 await h.api.requestMovementEnd(need,signal(),' Changed plans ');assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1).args)),{p_movement_need_id:need,p_reason:'Changed plans'});
});
test('0085 exact safe integer release and bounded actor-specific outcome parse',async()=>{
 for(const amount of [0,1,Number.MAX_SAFE_INTEGER])for(const disposition of ['released_to_me','released_to_requester']){
  const h=service([row({released_minor:amount,funding_disposition:disposition})]);const s=await h.api.getMovementEndStatus(need,signal());assert.equal(s.releasedMinor,amount);assert.equal(s.fundingDisposition,disposition);
 }
 for(const patch of [{released_minor:-1},{released_minor:1.1},{released_minor:'123'},{released_minor:null},{released_minor:Infinity},{released_minor:Number.MAX_SAFE_INTEGER+1},{currency:'USD'},{currency:null},{currency:['NGN']},{funding_disposition:'refund'},{member_id:need},{alignment_id:need},{journey_id:need},{financial_agreement_id:need},{financial_component_id:need},{wallet_transaction_id:need},{provider:'test'},{funding_disposition:'held'},{funding_disposition:'legacy'},{journey_state:'not_started'},{completed_at:'2026-10-05T12:00:00Z'}])await assert.rejects(service([row(patch)]).api.getMovementEndStatus(need,signal()),{message:'movement_end_unavailable'});
});
test('0085 neutral legacy and funded pending shapes remain distinct',async()=>{
 const legacy=row({funding_disposition:'legacy',released_minor:null,currency:null});assert.equal((await service([legacy]).api.getMovementEndStatus(need,signal())).releasedMinor,null);
 const old={...legacy};delete old.funding_disposition;delete old.released_minor;delete old.currency;assert.equal((await service([old]).api.getMovementEndStatus(need,signal())).fundingDisposition,undefined);
 const pending=row({journey_state:'not_started',end_status:'no_pending_end_request',requested_at:null,funding_disposition:'held',released_minor:null});assert.equal((await service([pending]).api.getMovementEndStatus(need,signal())).fundingDisposition,'held');
 for(const field of ['currency','released_minor','funding_disposition']){const partial={...pending};delete partial[field];await assert.rejects(service([partial]).api.getMovementEndStatus(need,signal()));}
});
test('0085 invalid selector and pre/post transport abort fail closed with generic errors',async()=>{
 for(const v of ['',null,123,'invalid']){const h=service();await assert.rejects(h.api.confirmMovementEnd(v,signal()));assert.equal(h.calls.length,0);}
 const a=new AbortController();a.abort();const h=service();await assert.rejects(h.api.requestMovementEnd(need,a.signal));assert.equal(h.calls.length,0);
 const b=new AbortController();await assert.rejects(service([row()],null,()=>b.abort()).api.confirmMovementEnd(need,b.signal));
 await assert.rejects(service(null,{message:'private SQL secret'}).api.getMovementEndStatus(need,signal()),{message:'movement_end_unavailable'});
});
test('0085 mutation outcome waits authoritative read; duplicate taps and stale clear drop success',async()=>{
 const {createMovementEndController}=load('src/state/movementEndController.ts');let confirms=0,reads=0,resolve;
 const pending={journeyState:'not_started',endStatus:'action_required_from_me',actionRequiredFromMe:true};
 const api={read:async()=>{reads++;if(reads===1)return pending;return new Promise(r=>resolve=r);},confirm:async()=>{confirms++;return {fundingDisposition:'released_to_me'};},request:async()=>{},decline:async()=>{}};
 const c=createMovementEndController(need,api);c.activate();await c.refresh();const first=c.confirmEnd();await c.confirmEnd();await new Promise(r=>setImmediate(r));assert.equal(confirms,1);assert.equal(c.getSnapshot().status,pending);c.clear();resolve({fundingDisposition:'released_to_me'});await first;assert.equal(c.getSnapshot().status,null);
});
test('0085 preserves historical committed LF bytes modulo checkout normalization',()=>{
 const prefix=cp.execFileSync('git',['rev-parse','--show-prefix'],{encoding:'utf8'}).trim();
 const names=fs.readdirSync('supabase/migrations').filter(n=>/^00(?:[0-7][0-9]|8[0-4])_.*\.sql$/.test(n));assert.equal(names.length,84);
 for(const n of names){const committed=cp.execFileSync('git',['show','HEAD:'+prefix+'supabase/migrations/'+n],{encoding:'utf8'});assert.equal(read(path.join('supabase/migrations',n)),committed.replace(/\r\n/g,'\n'),n);}
});
test('0085 narrowly extends funded guards without changing start or completion economics',()=>{
 const sql=read('supabase/migrations/0085_funded_mutual_no_travel_release.sql');
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.(?:request|confirm)_my_funded_movement_(?:start|completion)|CREATE OR REPLACE FUNCTION private\.funded_coordination_alignment|DISABLE TRIGGER|session_replication_role/);
 for(const table of ['funded_no_travel_requests','funded_no_travel_declines','funded_no_travel_closures']){
  assert(sql.includes('ALTER TABLE private.'+table+' ENABLE ROW LEVEL SECURITY'));
  assert(sql.includes('BEFORE UPDATE OR DELETE OR TRUNCATE ON private.'+table));
 }
 const original=read('supabase/migrations/0083_financial_movement_completion.sql');
 const suffix=s=>s.slice(s.indexOf(" IF NEW.transaction_kind NOT IN ('requester_platform_charge'"),s.indexOf('$settlement_actor$;',s.indexOf(" IF NEW.transaction_kind NOT IN ('requester_platform_charge'")));
 assert.equal(suffix(sql),suffix(original),'0083 settlement gate retains exact source');
 for(const name of ['get_my_movement_end_status_by_need','request_my_movement_end','confirm_my_movement_end','decline_my_movement_end']){
  const definition=sql.slice(sql.indexOf('CREATE FUNCTION public.'+name),sql.indexOf('AS $$',sql.indexOf('CREATE FUNCTION public.'+name)));
  assert.match(definition,/SECURITY DEFINER SET search_path=''/);assert.doesNotMatch(definition,/member_id|alignment_id|journey_id|wallet_|provider/);
 }
 assert.match(sql,/PERFORM private.assert_funded_completion\(a.id\)/);
 assert.match(sql,/ORDER BY x.id FOR UPDATE/);
 assert.doesNotMatch(sql,/INSERT INTO public.journeys|INSERT INTO private.funded_movement_completions|UPDATE public.members|GRANT.*service_role/);
});
