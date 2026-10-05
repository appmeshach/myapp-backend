'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const sql=read('supabase/migrations/0084_completed_movement_reputation.sql');
const need='00000000-0000-4000-8000-000000000084';
const row=(patch={})=>({person_number:1,person_role:'offering_member',first_name:'Ada',rating:null,completed_movements:1,already_rated:false,my_stars:null,...patch});
function load(file,stubs={}){const exports={};vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,setTimeout,clearTimeout,require:n=>stubs[n]||{}});return exports;}
function service(data=[row()],error=null){const calls=[];const api=load('src/services/completedMovementReputationService.ts',{'./coordinationService':{validMovementNeed:v=>v===need},'../lib/supabase':{supabase:{rpc:(name,args)=>{calls.push({name,args});return {abortSignal:async()=>({data,error})};}}}});return {api,calls};}
const signal=()=>new AbortController().signal;
test('ratings have no client UUID selector and both safe projections exclude internal IDs',()=>{
 for(const name of ['get_my_completed_movement_rating_targets','rate_my_completed_movement_person']){
  const def=sql.slice(sql.indexOf('CREATE FUNCTION public.'+name),sql.indexOf('AS $$',sql.indexOf('CREATE FUNCTION public.'+name)));
  assert.doesNotMatch(def,/reviewer_member_id|reviewed_member_id|alignment_id|journey_id|financial_agreement_id/);
  assert.match(def,/SECURITY DEFINER SET search_path=''/);
 }
 assert.match(sql,/p_movement_need_id uuid,p_person_number integer,p_stars integer/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE|DISABLE TRIGGER|session_replication_role/);
});
test('immutable private receipts RLS and narrow execute only',()=>{
 for(const table of ['completed_movement_principals','completed_movement_ratings']){
  assert(sql.includes('ALTER TABLE private.'+table+' ENABLE ROW LEVEL SECURITY'));
  assert(sql.includes('BEFORE UPDATE OR DELETE OR TRUNCATE ON private.'+table));
 }
 assert.match(sql,/PRIMARY KEY\(alignment_id,reviewer_member_id,reviewed_member_id\)/);
 assert.match(sql,/CHECK\(reviewer_member_id<>reviewed_member_id\)/);
 assert.doesNotMatch(sql,/GRANT.*(?:TABLE|private\.)/);
});
test('completion graph authority, no live roster invention, compatibility guard',()=>{
 assert.match(sql,/PERFORM private.assert_funded_coordination_entry\(p_alignment\)/);
 assert.match(sql,/REFERENCES private.funded_movement_completions/);
 assert.match(sql,/CREATE CONSTRAINT TRIGGER completed_movement_reputation[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
 assert.doesNotMatch(sql,/INSERT INTO public.journeys|invited_participant'|UPDATE private.wallet|INSERT INTO private.wallet/);
 assert.match(sql,/Existing reputation requires reviewed reconciliation/);
 assert.match(sql,/FOR receipt IN SELECT alignment_id FROM private.funded_movement_completions ORDER BY alignment_id/);
});
test('numeric deterministic aggregates and canonical locking before writes',()=>{
 assert.match(sql,/round\(avg\(r.stars::numeric\),2\)/);
 assert.match(sql,/ORDER BY m.id FOR UPDATE/);
 assert.match(sql,/AFTER INSERT ON private.completed_movement_ratings/);
 const write=sql.slice(sql.indexOf('CREATE FUNCTION public.rate_my_completed_movement_person'));
 assert(write.indexOf('private.completed_movement_rating_alignment')<write.indexOf('INSERT INTO private.completed_movement_ratings'));
 assert.match(write,/IF prior IS NULL THEN\s+INSERT/);
 assert.match(write,/prior<>p_stars/);
});
test('historical SQL raw and normalized integrity',()=>{
 const dir='supabase/migrations/',hash=b=>crypto.createHash('sha256').update(b).digest('hex'),inv=require('../docs/0082-temporal-audit-inventory.json');
 for(const m of inv.migrations)assert.equal(hash(fs.readFileSync(dir+m.name)),m.sha256);
 assert.equal(hash(inv.migrations.map(m=>m.name+'\n'+read(dir+m.name)).join('\n')),'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
 assert.equal(hash(require('./support/historicalMigrationBytes.cjs').historicalMigrationBytes('0082_trusted_temporal_evidence_hardening.sql')),'75cba03be6dc31d9869861ba53e50623d9756028d2b0be281ddac903d3b15351');
 assert.equal(hash(require('./support/historicalMigrationBytes.cjs').historicalMigrationBytes('0083_financial_movement_completion.sql')),'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
});
test('principal roles and submitted state parse without fabricated values',async()=>{
 for(const role of ['offering_member','primary_requester'])for(const stars of [null,1,2,3,4,5]){
  const h=service([row({person_role:role,my_stars:stars,already_rated:stars!==null})]);
  const result=await h.api.getCompletedMovementRatingTargets(need,signal());assert.equal(result[0].myStars,stars);assert.equal(result[0].personRole,role);
 }
});
for(const patch of [{member_id:need},{reviewer_member_id:need},{alignment_id:need},{journey_id:need},{financial_agreement_id:need},
 {person_number:2},{person_number:0},{person_number:'1'},{person_role:'invited_participant'},{person_role:['offering_member']},
 {rating:0},{rating:6},{rating:Infinity},{rating:'4.5'},{rating:4.123},{completed_movements:0},{completed_movements:1.2},
 {already_rated:'false'},{already_rated:true},{my_stars:4},{my_stars:0,already_rated:true},{my_stars:6,already_rated:true},
 {first_name:need+'\n'},{first_name:{}},{my_stars:1.5,already_rated:true}])test('fail closed projection '+JSON.stringify(patch),async()=>{
 await assert.rejects(()=>service([row(patch)]).api.getCompletedMovementRatingTargets(need,signal()),/^Error: unavailable$/);
});
for(const stars of [0,6,1.2,NaN,Infinity,'5',null])test('invalid stars never call RPC '+stars,async()=>{
 const h=service();await assert.rejects(()=>h.api.rateCompletedMovementPerson(need,1,stars,signal()));assert.equal(h.calls.length,0);
});
test('explicit submit narrow arguments and authoritative replay response',async()=>{
 const h=service([row({already_rated:true,my_stars:4,rating:4})]);await h.api.rateCompletedMovementPerson(need,1,4,signal());
 assert.equal(h.calls[0].name,'rate_my_completed_movement_person');assert.equal(JSON.stringify(h.calls[0].args),JSON.stringify({p_movement_need_id:need,p_person_number:1,p_stars:4}));
 await assert.rejects(()=>service().api.rateCompletedMovementPerson(need,1,4,signal()));
});
test('unknown movement/person, abort, database failure fail closed',async()=>{
 const h=service();await assert.rejects(()=>h.api.getCompletedMovementRatingTargets('bad',signal()));await assert.rejects(()=>h.api.rateCompletedMovementPerson(need,2,4,signal()));
 const a=new AbortController();a.abort();await assert.rejects(()=>h.api.getCompletedMovementRatingTargets(need,a.signal));assert.equal(h.calls.length,0);
 await assert.rejects(()=>service(null,{message:'private SQL UUID SECRET'}).api.getCompletedMovementRatingTargets(need,signal()),/^Error: unavailable$/);
});
test('controller selection never submits, duplicate guard and account change erase stale result',async()=>{
 const make=load('src/state/completedMovementReputationController.ts').createCompletedMovementReputationController;
 let calls=0,resolve,used;const pending=new Promise(r=>resolve=r);
 const target={personNumber:1,personRole:'offering_member',firstName:'Ada',rating:null,completedMovements:1,alreadyRated:false,myStars:null};
 const c=make(need,{read:async()=>[target],rate:async(_need,_person,_stars,s)=>{calls++;used=s;return pending;}});
 c.activate();c.setAccount('A');await new Promise(r=>setTimeout(r,0));c.select(4);assert.equal(calls,0);
 const p=c.submit();await c.submit();assert.equal(calls,1);c.setAccount(null);assert(used.aborted);resolve([{...target,alreadyRated:true,myStars:4}]);await p;assert.equal(c.getSnapshot().target,null);c.dispose();
});
test('submitted rating is never editable or resubmitted by controller',async()=>{
 const make=load('src/state/completedMovementReputationController.ts').createCompletedMovementReputationController;let n=0;
 const c=make(need,{read:async()=>[{alreadyRated:true,myStars:5}],rate:async()=>{n++;}});c.activate();c.setAccount('A');await new Promise(r=>setTimeout(r,0));c.select(1);await c.submit();assert.equal(n,0);assert.equal(c.getSnapshot().selected,5);c.dispose();
});
test('UI lazy loading explicit five choices explicit submit and submitted state',()=>{
 const component=read('src/components/CompletedMovementReputation.tsx');assert.match(component,/useState\(false\)/);assert.match(component,/\[1, 2, 3, 4, 5\]/);assert.match(component,/onPress=\{\(\) => select\(stars\)\}/);
 assert.match(component,/onPress=\{\(\) => \{ void submit\(\); \}\}/);assert.match(component,/target.alreadyRated \?/);assert.match(component,/Submitted:/);
 assert(read('src/components/CompletedMovements.tsx').includes('<CompletedMovementReputation movementNeedId={row.movementNeedId} />'));
 assert.doesNotMatch(component,/member_id|alignment_id|journey_id|financial_agreement_id/);
});
test('rendered UI selects without sending and submits explicitly; immutable submitted UI',()=>{
 let selected=0,submitted=0;
 function render(rated){
  const element=(type,props)=>typeof type==='function'?type(props):({type,props});
  return load('src/components/CompletedMovementReputation.tsx',{'react':{useState:()=>[true,()=>{}]},'react/jsx-runtime':{jsx:element,jsxs:element},'react-native':{View:'View',Text:'Text',Pressable:'Pressable'},
   '../hooks/useCompletedMovementReputation':{useCompletedMovementReputation:()=>({state:{target:{firstName:'Ada',personRole:'offering_member',alreadyRated:rated,myStars:rated?4:null},selected:rated?4:3,busy:false,error:false},select:n=>selected=n,submit:async()=>{submitted++;},refresh:async()=>{}})}}).CompletedMovementReputation({movementNeedId:need});
 }
 function nodes(e){if(!e||typeof e!=='object')return [];if(Array.isArray(e))return e.flatMap(nodes);return [e,...nodes(e.props?.children)];}
 function text(e){if(typeof e==='string'||typeof e==='number')return String(e);if(!e||typeof e!=='object')return '';if(Array.isArray(e))return e.map(text).join(' ');return text(e.props?.children);}
 const buttons=nodes(render(false)).filter(e=>e.type==='Pressable');assert.equal(buttons.length,6);
 buttons[1].props.onPress();assert.equal(selected,2);assert.equal(submitted,0);buttons[5].props.onPress();assert.equal(submitted,1);
 const done=render(true);assert.match(text(done),/Submitted:.*4/);assert.equal(nodes(done).filter(e=>e.type==='Pressable').length,0);
});
