'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const raw=read('supabase/migrations/0078_requester_movement_funding_hold.sql'),sql=raw.replace(/--[^\n]*/g,'');
const hold=sql.match(/AS \$hold\$([\s\S]*?)\$hold\$/)[1],evidence=sql.match(/AS \$evidence\$([\s\S]*?)\$evidence\$/)[1],status=sql.match(/AS \$status\$([\s\S]*?)\$status\$/)[1];
const id='00000000-0000-4000-8000-000000000078',alignment='00000000-0000-4000-8000-000000000079';
const row={financial_agreement_id:id,agreement_version:1,alignment_id:alignment,funding_status:'held',required_minor:123,held_minor:123,currency:'NGN',fully_held_at:'2026-10-03T10:00:00.123456+00:00'};
function service(response={data:[row],error:null}) {const exports={},calls=[];vm.runInNewContext(ts.transpileModule(read('src/services/movementService.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;}}})});return {...exports,calls};}
test('forward-only exact selectors, two narrow public RPCs and hardened ACLs',()=>{
 assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
 assert.deepEqual([...sql.matchAll(/CREATE FUNCTION public\.(\w+)/g)].map(x=>x[1]),['hold_my_movement_funds','get_my_movement_funding_status']);
 assert.match(sql,/hold_my_movement_funds\(p_financial_agreement_id uuid,p_expected_agreement_version integer\)/);
 assert.equal((sql.match(/SECURITY DEFINER SET search_path=''/g)||[]).length,4);
 assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);assert.match(sql,/TO authenticated;/);
 assert.doesNotMatch(sql,/GRANT (?:ALL|INSERT|UPDATE|DELETE|SELECT)|CREATE POLICY|DISABLE|session_replication_role|SET CONSTRAINTS ALL|CREATE OR REPLACE/);
});
test('durable component uniqueness and immutable completion receipt include zero-only history',()=>{
 assert.match(sql,/UNIQUE INDEX wallet_transactions_one_initial_component_hold[\s\S]*financial_component_id[\s\S]*transaction_kind='movement_hold'/);
 assert.match(sql,/financial_agreement_id uuid PRIMARY KEY REFERENCES private.financial_agreements/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.match(sql,/BEFORE UPDATE OR DELETE OR TRUNCATE[\s\S]*protect_wallet_ledger_row/);
 assert.match(hold,/coalesce\(funding_at,clock_timestamp\(\)\)/);
});
test('only exact requester and authoritative accepted materialized agreement can fund',()=>{
 for(const text of ['auth.uid()','member_needing_movement_id IS DISTINCT FROM p_caller','Exact agreement version required','Authoritative materialized agreement required','assert_financial_proposal_materialization(p)','g.offering_accepted_at IS NULL','g.requester_accepted_at IS NULL'])assert(sql.includes(text),text);
 assert.match(hold,/g.status<>'current'/);assert.match(hold,/a.status='awaiting_activation_payment' AND a.activated_at IS NULL/);
});
test('monetary authority is exact stored requester components with no recalculation',()=>{
 assert.match(evidence,/sum\(x.amount_minor::numeric\)/);
 assert.match(hold,/component_key IN \('requester_platform_share','movement_contribution'\) AND x.amount_minor>0/);
 assert.match(hold,/VALUES\(transaction_id,available_id,'debit',c.amount_minor\),\(transaction_id,held_id,'credit',c.amount_minor\)/);
 assert.doesNotMatch(sql,/calculate_financial|seat_price|people_count|0\.3|0\.15|0\.7|activation_fee_minor/);
});
test('lock order matches member-gated wallet writers and closure, no proposal lock upgrade',()=>{
 assert.match(hold,/requires READ COMMITTED/);
 assert(hold.indexOf('movement_funding_agreement')<hold.indexOf('FROM public.members'));
 assert(hold.indexOf('FROM public.members')<hold.indexOf('ORDER BY x.id FOR UPDATE'));
 assert.match(sql,/FROM private.financial_agreements x WHERE x.id=p_id FOR SHARE/);
 assert.doesNotMatch(sql,/advisory|FROM private.financial_proposals[^;]*FOR UPDATE/);
});
test('numeric-safe balances check insufficiency and overflow before first write, missing wallet never provisioned',()=>{
 assert.match(hold,/amount_minor::numeric ELSE -wp.amount_minor::numeric/);
 assert.match(hold,/held_balance\+evidence.required_minor>9223372036854775807::numeric/);
 assert(hold.indexOf('available_balance<evidence.required_minor')<hold.indexOf('INSERT INTO private.wallet_transactions'));
 assert.match(hold,/total<>3 OR active_count<>3/);assert.doesNotMatch(hold,/ensure_ngn|INSERT INTO private.wallet_accounts|top_up/);
});
test('historical replay checks exact component transactions/accounts/postings, not balances or live state',()=>{
 for(const text of ['t.financial_component_id IS DISTINCT FROM c.id','t.alignment_id IS DISTINCT FROM g.alignment_id','t.currency<>g.currency','t.provider IS NOT NULL','posting_count<>2 OR matching_count<>2','x.amount_minor=c.amount_minor','available_id','held_id','assert_wallet_transaction_balanced','Partial funding history cannot be repaired'])assert(evidence.includes(text),text);
 const replay=hold.slice(hold.indexOf('IF evidence.fully_held_at IS NOT NULL'),hold.indexOf("IF g.status<>"));
 assert.match(replay,/RETURN QUERY/);assert.doesNotMatch(replay,/INSERT|available_balance|awaiting_activation|expires_at/);
 assert.doesNotMatch(evidence,/a.status='active'|expires_at|sum\(.*wallet_postings/);
});
test('zero components skip transactions, positive holds atomically construct and drain exact ledger triggers',()=>{
 assert.match(evidence,/IF c.amount_minor=0 THEN/);assert.match(evidence,/Zero obligation must have no hold transaction/);
 assert.equal((hold.match(/INSERT INTO private.wallet_transactions/g)||[]).length,1);
 assert.match(hold,/wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting IMMEDIATE/);
});
test('read projection is requester-only read-only and serializes with the member wallet gate',()=>{
 assert.match(status,/auth.uid\(\)/);assert.match(status,/FROM public.members m WHERE m.id=g.member_needing_movement_id FOR SHARE/);
 assert.doesNotMatch(status,/INSERT|UPDATE|ensure_ngn/);assert.match(status,/'not_held' ELSE 'held'/);
});
test('no operational or downstream writes, offering platform share excluded',()=>{
 assert.doesNotMatch(sql,/INSERT INTO public\.|UPDATE public\.|UPDATE private\.|activation_payments|platform_revenue|member_withdrawable'\s*,|movement_settlements|paystack|stripe|https?:|pg_notify/);
 assert.deepEqual([...hold.matchAll(/INSERT INTO (private\.\w+)/g)].map(x=>x[1]),['private.wallet_transactions','private.wallet_postings','private.movement_funding_holds']);
});
test('client sends exact selector keys and preserves bounded eight-field evidence',async()=>{
 const s=service(),r=await s.holdMyMovementFunds(id,1);assert.equal(r.financialAgreementId,id);assert.equal(r.heldMinor,123);
 assert.equal(JSON.stringify(s.calls),JSON.stringify([['hold_my_movement_funds',{p_financial_agreement_id:id,p_expected_agreement_version:1}]]));
 const readService=service({data:[{...row,funding_status:'not_held',held_minor:0,fully_held_at:null}],error:null});assert.equal((await readService.getMyMovementFundingStatus(id)).fundingStatus,'not_held');
 assert.equal(JSON.stringify(readService.calls),JSON.stringify([['get_my_movement_funding_status',{p_financial_agreement_id:id}]]));
});
test('client rejects malformed selectors before transport',async()=>{
 for(const [p,v] of [['bad',1],[null,1],[id,0],[id,2.2],[id,null],[id,'1'],[id,2147483648]]) {const s=service();await assert.rejects(s.holdMyMovementFunds(p,v),/movement_funding_unavailable/);assert.equal(s.calls.length,0);}
});
test('client fails closed on malformed money, status, identity, fields, timestamps and errors',async()=>{
 for(const change of [{agreement_version:2},{financial_agreement_id:alignment},{alignment_id:'bad'},{currency:'USD'},{held_minor:122},{required_minor:Number.MAX_SAFE_INTEGER+1},{required_minor:-1},{held_minor:'123'},{funding_status:'paid'},{fully_held_at:'2026-02-30T10:00:00Z'},{fully_held_at:null},{fully_held_at:'infinity'},{fully_held_at:'2026-01-01T24:00:00Z'},{wallet_account_id:id}])await assert.rejects(service({data:[{...row,...change}],error:null}).holdMyMovementFunds(id,1),/movement_funding_unavailable/);
 for(const data of [[],[row,row],null,{},[null],[Object.fromEntries(Object.entries(row).filter(([k])=>k!=='currency'))]])await assert.rejects(service({data,error:null}).holdMyMovementFunds(id,1),/movement_funding_unavailable/);
 for(const response of [new Error('private SQL'),{data:null,error:{message:'private ledger'}}])await assert.rejects(service(response).holdMyMovementFunds(id,1),e=>e.message==='movement_funding_unavailable');
});
test('successful client retries preserve evidence and zero obligations parse without zero postings',async()=>{
 const s=service();assert.equal(JSON.stringify(await s.holdMyMovementFunds(id,1)),JSON.stringify(await s.holdMyMovementFunds(id,1)));
 assert.equal((await service({data:[{...row,required_minor:0,held_minor:0}],error:null}).holdMyMovementFunds(id,1)).heldMinor,0);
});
test('historical migrations 0001 through 0077 unchanged',()=>{
 const names=fs.readdirSync('supabase/migrations').filter(n=>/^\d{4}_.*\.sql$/.test(n)&&+n.slice(0,4)<=77).sort();assert.equal(names.length,77);
 assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read('supabase/migrations/'+n)).join('\n')).digest('hex'),'7ecda99f85e0b393b691221fc47e6dcaf6f6ceec1c64d1df479cfe4acf48fa36');
});

test('real DB suites are inert, rollback or clone only, preserve ACLs and prove real blocking',()=>{
 const behavior=read('supabase/tests/0078_requester_movement_funding_hold_behavior.cjs');
 const concurrency=read('supabase/tests/0078_requester_movement_funding_hold_concurrency.cjs');
 for(const script of [behavior,concurrency]) {new vm.Script(script);assert.match(script,/require.main===module|require.main === module/);assert.doesNotMatch(script,/--no-acl|db push|session_replication_role/);}
 assert.match(behavior,/application data\/catalog\/ACL\/history fully restored/);assert.match(behavior,/for\(const zero of \[false,true\]\)/);
 for(const text of ['--format=custom','DEFAULT ACL','--use-list=','TEMPLATE template0','DROP DATABASE','pg_blocking_pids','noDeadlock','duplicateRace','topUpRace','closureRace','supersessionRace','lifecycleRace','activationLockRace','projectionRace','Application DB data/catalog/ACL/RLS/history fingerprint unchanged'])assert(concurrency.includes(text),text);
 const {filterDefaultAcls}=require('../supabase/tests/0078_requester_movement_funding_hold_concurrency.cjs');
 assert.equal(filterDefaultAcls('1; 0 0 ACL private TABLE wallet_postings postgres\n2; 0 0 DEFAULT ACL public postgres'),'1; 0 0 ACL private TABLE wallet_postings postgres\n');
 const live=read('supabase/tests/0078_requester_movement_funding_hold_test.sql');assert.match(live,/ROLLBACK;\s*$/);
 for(const lifecycle of ['activated','in_progress','completed','cancelled'])assert(live.includes('historical '+lifecycle+' replay independently succeeds no writes'));
 assert.match(live,/PERFORM pg_temp.funding_succeed\(retry\)/);
});

test('0078 harness distinguishes absent and installed state and fails closed on source or ACL drift',()=>{
 const {expected,selectMode,verifyDefinitions}=require('../supabase/tests/0078_requester_movement_funding_hold_harness.cjs');
 const rows=expected.map(e=>({...e,definer:true,language:'plpgsql',config:['search_path=""'],kind:'f',volatility:'v',strict:false,parallel:'u',grantable:0,acl:e.name.startsWith('public.')?['authenticated']:null}));
 assert.equal(selectMode(0,[],false),'source');assert.equal(selectMode(1,rows,true),'installed');
 assert.throws(()=>selectMode(0,rows,true),/Incomplete/);assert.throws(()=>selectMode(1,[],true),/mismatch/);assert.throws(()=>selectMode(1,rows,false),/Incomplete/);
 for(const change of [{body:'different source'},{args:'wrong uuid'},{result:'integer'},{definer:false},{config:['search_path=public']},{acl:['anon']},{grantable:1}])assert.throws(()=>verifyDefinitions(rows.map((r,i)=>i===0?{...r,...change}:r)),/mismatch/);
 const behavior=read('supabase/tests/0078_requester_movement_funding_hold_behavior.cjs');
 assert.match(behavior,/const mode=inspect\(query\)/);assert.match(behavior,/mode==='source'\?fixtures\(zero\)\.replace[^\n]+:fixtures\(zero\)/);
 const concurrency=read('supabase/tests/0078_requester_movement_funding_hold_concurrency.cjs');
 assert.match(concurrency,/if \(mode === 'source'\) target\(/);assert.match(concurrency,/verify\(query, database\)/);
 const harness=read('supabase/tests/0078_requester_movement_funding_hold_harness.cjs');
 assert.doesNotMatch(harness,/CREATE OR REPLACE|INSERT INTO|UPDATE |DELETE FROM|ALTER FUNCTION/);
 assert.match(harness,/pg_get_function_arguments/);assert.match(harness,/pg_get_function_result/);assert.match(harness,/p\.prosrc/);assert.match(harness,/aclexplode/);
});
