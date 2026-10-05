'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const source=read('supabase/migrations/0079_funded_movement_activation.sql');
const body=tag=>source.match(new RegExp('AS \\$'+tag+'\\$([\\s\\S]*?)\\$'+tag+'\\$'))[1];
const activate=body('activate'),historical=body('historical'),projection=body('projection'),selector=body('selector');
const agreement='00000000-0000-4000-8000-000000000079',alignment='00000000-0000-4000-8000-000000000080';
const row={financial_agreement_id:agreement,agreement_version:1,alignment_id:alignment,alignment_status:'activated',activated_at:'2026-10-03T10:00:00.123456+00:00'};
function service(response={data:[row],error:null}){const exports={},calls=[];vm.runInNewContext(ts.transpileModule(read('src/services/movementService.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;}}})});return {...exports,calls};}

test('narrow requester activation and bounded truthful projection, hardened privileges',()=>{
 assert.match(source,/activate_my_funded_movement\(p_financial_agreement_id uuid,p_expected_agreement_version integer\)/);
 assert.match(selector,/caller uuid:=auth.uid\(\)/);assert.match(selector,/member_needing_movement_id IS DISTINCT FROM caller/);
 assert.match(selector,/p_version<1 OR g.version<>p_version/);assert.match(selector,/read committed/);
 assert.match(source,/FROM PUBLIC,anon,authenticated,service_role/);assert.match(source,/TO authenticated/);
 assert.doesNotMatch(activate,/p_(?:member|alignment|amount|currency|provider|status|activated)/);
});
test('forward migration receipts bind exact agreement alignment instant and required face evidence',()=>{
 for(const table of ['funded_movement_activations','funded_movement_activation_faces']) {assert(source.includes('ALTER TABLE private.'+table+' ENABLE ROW LEVEL SECURITY'));assert(source.includes('BEFORE UPDATE OR DELETE OR TRUNCATE ON private.'+table));}
 assert.match(source,/alignment_id uuid NOT NULL UNIQUE/);assert.match(source,/PRIMARY KEY\(financial_agreement_id,member_id\)/);
 assert.match(historical,/movement_context_snapshot_travellers/);assert.match(historical,/EXCEPT/);assert.match(historical,/face_verification_id/);
});
test('graph and funding reuse authoritative complete historical validators',()=>{
 assert.match(selector,/private.movement_funding_agreement\(p_id,caller,p_version\)/);
 for(const text of ['private.movement_funding_evidence(g)','evidence.fully_held_at IS NULL','evidence.held_minor<>evidence.required_minor'])assert(activate.includes(text));
 assert.doesNotMatch(activate,/sum\(|activation_fee_minor|amount_minor|wallet_accounts|provider_reference/);
});
test('face gate unchanged, precise post-wait instant and exact-current predicate rechecked',()=>{
 assert.match(activate,/private.assert_alignment_face_ready\(a.id\)/);
 assert(activate.indexOf('stamp:=clock_timestamp()')>activate.indexOf('private.assert_alignment_face_ready'));
 assert.match(activate,/private.has_current_alignment_face_check\(a.id,r.member_id,stamp\)/);
 assert.match(activate,/ORDER BY f.started_at DESC,f.id DESC/);
 assert.match(activate,/SET status='activated',activated_at=stamp,updated_at=stamp/);
});
test('agreement SHARE before alignment UPDATE avoids upgrade and supersession cycles',()=>{
 assert(selector.indexOf('FOR SHARE')<selector.indexOf('FOR UPDATE'));
 assert.match(selector,/IF p_lock THEN/);assert.match(activate,/Current pre-activation agreement required/);
 assert.doesNotMatch(activate,/FOR UPDATE.*financial_proposals|pg_advisory|wallet_postings/);
});
test('historical replay precedes live gate and does not require current expiry or face flags',()=>{
 assert(activate.indexOf('RETURN QUERY')<activate.indexOf('assert_alignment_face_ready'));
 for(const field of ['receipt.activated_at IS DISTINCT FROM a.activated_at','f.completed_at>receipt.activated_at','f.expires_at<=receipt.activated_at','newer.started_at<=receipt.activated_at'])assert(historical.includes(field));
 assert.doesNotMatch(historical,/mm.is_current|profile_media_verified|f.expires_at>clock_timestamp/);
 for(const state of ['activated','in_progress','completed','cancelled'])assert(historical.includes("'"+state+"'"));
 assert.match(activate,/SELECT g.id,g.version,a.id,a.status,a.activated_at/);
});
test('legacy payment create success read and direct writers fail closed for financial graph',()=>{
 for(const name of ['create_alignment_activation_payment','mark_alignment_activation_payment_succeeded','get_my_activation_payment_status']) {
  const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name),end=source.indexOf('$$;',start);assert(source.slice(start,end).includes('private.is_financial_alignment'));
 }
 assert.match(source,/BEFORE INSERT OR UPDATE ON private.alignment_activation_payments/);
 assert.match(body('alignment_guard'),/Funded activation receipt required/);
 assert.match(body('payment_guard'),/Financial movement requires funded activation/);
});
test('financial activation creates no journey, monetary or downstream side effects',()=>{
 assert.doesNotMatch(activate,/INSERT INTO (?:public.journeys|private.wallet|private.movement_settlements|private.alignment_activation_payments)|UPDATE private.wallet/);
 assert.match(source,/IF private.is_financial_alignment\(NEW.id\) THEN RETURN NEW/);
 assert.match(source,/LEFT JOIN public.journeys/);assert.match(source,/NOT private.is_financial_alignment\(a.id\) AND EXISTS/);
 assert.match(source,/private.has_funded_activation\(a.id\)/);
});
test('client exact inputs and exact result keys with generic errors',async()=>{
 const s=service();assert.equal((await s.activateMyFundedMovement(agreement,1)).activatedAt,row.activated_at);
 assert.equal(JSON.stringify(s.calls),JSON.stringify([['activate_my_funded_movement',{p_financial_agreement_id:agreement,p_expected_agreement_version:1}]]));
 for(const [id,v] of [['bad',1],[null,1],[agreement,0],[agreement,null],[agreement,'1'],[agreement,1.1],[agreement,2147483648]]){const s=service();await assert.rejects(s.activateMyFundedMovement(id,v),/movement_activation_unavailable/);assert.equal(s.calls.length,0);}
 for(const change of [{financial_agreement_id:alignment},{agreement_version:2},{alignment_id:'bad'},{activated_at:null},{activated_at:'infinity'},{activated_at:'2026-02-30T10:00:00Z'},{activated_at:'2026-01-01T24:00:00Z'},{alignment_status:'failed'},{alignment_status:'awaiting_activation_payment'},{provider:'private'}])await assert.rejects(service({data:[{...row,...change}],error:null}).activateMyFundedMovement(agreement,1),/movement_activation_unavailable/);
 for(const response of [{data:[],error:null},{data:[row,row],error:null},{data:[row],error:{message:'raw database'}},new Error('raw')])await assert.rejects(service(response).activateMyFundedMovement(agreement,1),e=>e.message==='movement_activation_unavailable');
});
test('client accepts authoritative supported lifecycle replay and readiness projections only',async()=>{
 for(const status of ['activated','in_progress','completed','cancelled'])assert.equal((await service({data:[{...row,alignment_status:status}],error:null}).activateMyFundedMovement(agreement,1)).alignmentStatus,status);
 for(const state of ['funding_required','identity_required','ready_to_activate']){const s=service({data:[{...row,alignment_status:'awaiting_activation_payment',activated_at:null,activation_status:state}],error:null});assert.equal((await s.getMyMovementActivationStatus(agreement,1)).activationStatus,state);}
 assert.equal((await service({data:[{...row,activation_status:'activated'}],error:null}).getMyMovementActivationStatus(agreement,1)).activationStatus,'activated');
 for(const change of [{activation_status:'paid'},{activation_status:'funding_required'},{alignment_status:'awaiting_activation_payment'}])await assert.rejects(service({data:[{...row,activation_status:'activated',...change}],error:null}).getMyMovementActivationStatus(agreement,1),/movement_activation_unavailable/);
});
test('historical migrations 0001 through 0078 byte-normalized unchanged',()=>{
 const names=fs.readdirSync('supabase/migrations').filter(n=>/^\d{4}_.*\.sql$/.test(n)&&+n.slice(0,4)<=78).sort();assert.equal(names.length,78);
 assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read('supabase/migrations/'+n)).join('\n')).digest('hex'),'04bcf74154170dd9b786b075fb986250385c96c4b797a014d8b1b40c70f9d16e');
});
test('runners support both states, fingerprint installed source, retain blocking and cleanup guards',()=>{
 const {finalExpected:expected,selectMode,verifyDefinitions}=require('../supabase/tests/0079_funded_movement_activation_harness.cjs');
 assert.equal(selectMode(0,[],false),'source');
 const rows=expected.map(e=>({...e,owner:'postgres',definer:true,config:['search_path=""'],kind:'f',strict:false,parallel:'u',grantable:0,acl:['public.activate_my_funded_movement','public.get_my_movement_activation_status','public.get_my_activation_payment_status'].includes(e.name)?['authenticated']:['public.create_alignment_activation_payment','public.mark_alignment_activation_payment_succeeded'].includes(e.name)?['service_role']:null}));
 assert.equal(selectMode(1,rows,true),'installed');assert.throws(()=>selectMode(1,rows,false),/Incomplete/);assert.throws(()=>verifyDefinitions(rows.map((r,i)=>i? r:{...r,body:'drift'})),/mismatch/);
 for(const f of ['behavior','concurrency']){const text=read('supabase/tests/0079_funded_movement_activation_'+f+'.cjs');new vm.Script(text);assert.match(text,/require.main/);assert.doesNotMatch(text,/--no-acl|db push|session_replication_role/);assert.match(text,/inspect\(query\)/);}
 const concurrency=read('supabase/tests/0079_funded_movement_activation_concurrency.cjs');for(const text of ['TEMPLATE template0','--format=custom','DEFAULT ACL','--use-list=','DROP DATABASE','pg_blocking_pids','noDeadlock','verify(query, database)','Application DB data/catalog/ACL/RLS/history fingerprint unchanged'])assert(concurrency.includes(text),text);
 assert.match(read('supabase/tests/0079_funded_movement_activation_test.sql'),/ROLLBACK;\s*$/);
});
