'use strict';
// Keep prior assertions and fixtures, changing only financial timing expectations
// superseded by 0088 and its removal of inherited 0085 wall-clock revalidation.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const adaptations=[];
function replace(source,from,to,file,reason){assert(source.includes(from),file+' adaptation source drift');const count=source.split(from).length-1;adaptations.push({file,reason,from,to,count});return source.split(from).join(to);}
const temporal=require('./0082_financial_movement_completion_behavior.cjs');
const completion={...temporal,completionChecks(mode){return replace(temporal.completionChecks(mode),' SELECT coalesce(sum(CASE WHEN p.direction=\'credit\' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) INTO held',' IF private.activation_fee_is_finalized(g.id) THEN charge:=0; END IF;\n SELECT coalesce(sum(CASE WHEN p.direction=\'credit\' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END),0) INTO held','0082_financial_movement_completion_test.sql','R is already final; completion held/revenue deltas include only C/O');},fixtures(zero){const source=temporal.fixtures(zero);
 return replace(source,"IF p_kind='closed_platform' THEN UPDATE private.wallet_accounts", "IF p_kind='closed_platform' THEN\n  IF (SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) FROM private.wallet_postings WHERE account_id=credit_id)>0 THEN\n   PERFORM pg_temp.completion_pair(credit_id,debit_id,(SELECT sum(CASE WHEN direction='credit' THEN amount_minor::numeric ELSE -amount_minor::numeric END)::bigint FROM private.wallet_postings WHERE account_id=credit_id));\n  END IF;\n  UPDATE private.wallet_accounts",'0082_financial_movement_completion_test.sql','activation R makes revenue nonzero: balanced test transfer drains it before closure, preserving the closed-account completion rejection test');}};
function adapted(name){let source=fs.readFileSync(path.join(__dirname,name),'utf8');
 if(name==='0086_funded_dispute_behavior.cjs')source=replace(source,"transaction_kind<>'movement_hold'","transaction_kind NOT IN('movement_hold','requester_platform_charge')",name,'pre-start freeze preserves already-earned R and forbids every new disposition');
 if(name==='0086_funded_dispute_concurrency.cjs')source=replace(source,'SELECT count(*) FROM private.funded_no_travel_closures WHERE alignment_id','SELECT count(*) FROM private.funded_no_travel_holds WHERE alignment_id',name,'new-policy no-travel winner has immutable held receipt, never a release receipt; same exclusive dispute/start gates');
 if(name==='0086_funded_dispute_temporal.cjs')source=replace(source,"assert.throws(()=>c.target(`SELECT private.assert_funded_no_travel('${f.alignment}');`),/Exact unstarted funded lifecycle required/)","assert.doesNotThrow(()=>c.target(`SELECT private.assert_funded_no_travel('${f.alignment}');`))",name,'0088 reuses 0086 finite immutable provenance in affected no-travel validator, so a later regressed clock must remain valid');
 if(name==='0087_funded_completion_behavior.cjs'){
  source=replace(source,"SELECT jsonb_agg(to_jsonb(x)-'completion_method' ORDER BY alignment_id) FROM private.funded_movement_completions x;","SELECT jsonb_agg(to_jsonb(x) ORDER BY alignment_id) FROM private.funded_movement_completions x;",name,'0088 starts from installed 0087: preserve every existing completion field including completion_method');
  source=replace(source,'oldBalances.held-amounts.requester_platform_share-amounts.movement_contribution','oldBalances.held-amounts.movement_contribution',name,'completion debits only C after activation R');
  source=replace(source,'oldBalances.revenue+amounts.requester_platform_share+amounts.offering_platform_share','oldBalances.revenue+amounts.offering_platform_share',name,'completion credits only O after activation R');
 }
 if(name==='0085_funded_no_travel_regression.cjs')source=source.replace('unchanged 0083 settlement checks with 0085 installed','0083 settlement checks with documented 0088 timing expectations');
 return source;
}
async function main(){
 const names=['0087_funded_completion_behavior.cjs','0087_funded_completion_temporal.cjs','0087_funded_completion_concurrency.cjs','0086_funded_dispute_behavior.cjs','0086_funded_dispute_temporal.cjs','0086_funded_dispute_concurrency.cjs','0085_funded_no_travel_behavior.cjs','0085_funded_no_travel_concurrency.cjs','0085_funded_no_travel_regression.cjs'];
 const sources=new Map(names.map(name=>[name,adapted(name)]));
 const start=process.argv[2];if(start)assert(names.includes(start),'Unknown resume program');
 for(const name of start?names.slice(names.indexOf(start)):names){
  const filename=path.join(__dirname,name),loaded=new Module(filename,module),source=sources.get(name);
  loaded.filename=filename;loaded.paths=Module._nodeModulePaths(__dirname);loaded.require=n=>{
   if(n==='node:fs'||n==='fs')return {...fs,writeFileSync(file,...args){const redirected=String(file).replace(/^docs\/0087-/, 'docs/0088-policy-regression-0087-');return fs.writeFileSync(redirected,...args);}};
   if(/^\.\/008[567]_.*harness\.cjs$/.test(n))return name==='0085_funded_no_travel_behavior.cjs'||name==='0085_funded_no_travel_concurrency.cjs'?legacyHarness(name):require('./0088_funded_activation_fee_harness.cjs');
   if(n==='./0087_funded_completion_test_support.cjs')return require('./0088_funded_activation_fee_test_support.cjs');
   if(n==='./0082_financial_movement_completion_behavior.cjs')return completion;
   return require(n.startsWith('.')?path.resolve(__dirname,n):n);
  };
  loaded._compile(source,filename);await loaded.exports.main();console.log('PASS preserved '+name+' against disposable 0088');
 }
 fs.writeFileSync('docs/0088-policy-regression-adaptations.json',JSON.stringify({adaptations,legacyFixturePolicy:'0085 original behavior/concurrency execute unchanged on genuine installed 0087 pre-install state, then 0088 applies and validates/replays every resulting legacy closure; additional pending legacy activation cannot create a future refund; new held-policy races tested separately',priorProgramHashes:Object.fromEntries(names.map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,n))).digest('hex')]))},null,2)+'\n');
}
function legacyHarness(name){const harness=require('./0088_funded_activation_fee_harness.cjs');let pending;return {...harness,run:callback=>harness.run(async c=>{
 const closures=JSON.parse(c.target('SELECT coalesce(jsonb_agg(to_jsonb(x)),\'[]\'::jsonb) FROM private.funded_no_travel_closures x;'));
 for(const d of closures){c.target(`SELECT private.assert_funded_no_travel('${d.alignment_id}'); SELECT private.assert_funded_coordination_entry('${d.alignment_id}');`);const f={need:c.target(`SELECT movement_need_id FROM public.alignments WHERE id='${d.alignment_id}';`),schema:pending.schema};const before=c.fingerprint();assert(c.result(f,'confirm_my_movement_end',d.second_principal_id).ok);assert.equal(c.fingerprint(),before,'Legacy refund history replay writes nothing');}
 const before=c.target('SELECT jsonb_build_object(\'transactions\',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_transactions x),\'postings\',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_postings x));');
 assert(c.result(pending,'request_my_movement_end',pending.offerer).ok);const held=c.result(pending,'confirm_my_movement_end',pending.requester);assert(held.ok);assert.equal(held.rows[0].funding_disposition,'held_review_required');assert.equal(held.rows[0].released_minor,null);
 assert.equal(c.target('SELECT jsonb_build_object(\'transactions\',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_transactions x),\'postings\',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.wallet_postings x));'),before,'Legacy pending no-travel cannot move any money');
 console.log('PASS '+closures.length+' exact legacy closures after 0088; pending legacy no new refund');
},{async beforeInstall(c){await callback(c);pending=c.fresh();}})};}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
