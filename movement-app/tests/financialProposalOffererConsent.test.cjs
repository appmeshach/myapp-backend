'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const crypto=require('node:crypto');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8').replace(/\r\n/g,'\n');
const raw=read('supabase/migrations/0076_financial_proposal_offerer_consent.sql');
const sql=raw.replace(/--[^\n]*/g,'');
const consent=sql.match(/AS \$consent\$([\s\S]*?)\$consent\$/)[1];
const cutover=sql.match(/AS \$cutover\$([\s\S]*?)\$cutover\$/)[1];
const source=read('src/services/movementService.ts');
const id='00000000-0000-4000-8000-000000000076', offer='00000000-0000-4000-8000-000000000077';
const input={financialProposalId:id,expectedProposalVersion:2,movementOfferId:offer};
const row={proposal_id:id,proposal_version:2,proposal_status:'current',movement_offer_id:offer,offering_accepted_at:'2026-10-02T10:00:00.123456+00:00'};
function service(response={data:[row],error:null}) {
 const calls=[],exports={};
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;}}})});
 return {accept:exports.acceptMyFinancialProposalAsOfferer,calls};
}
test('0076 atomic exact member RPC signature and minimal response',()=>{
 assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
 assert.match(sql,/accept_my_financial_proposal_as_offerer\(\s*p_financial_proposal_id uuid,\s*p_expected_proposal_version integer,\s*p_movement_offer_id uuid\s*\)/);
 const fields=[...sql.match(/RETURNS TABLE \(([\s\S]*?)\)/)[1].matchAll(/(\w+)\s+(?:uuid|integer|text|timestamptz)/g)].map(m=>m[1]);
 assert.deepEqual(fields,Object.keys(row));
 assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/g)||[]).length,2);
 assert.doesNotMatch(sql,/CREATE (?:TABLE|TRIGGER|POLICY)|ALTER TABLE|DISABLE|session_replication_role|advisory/i);
});
test('auth.uid alone, member mapping and own offering principal required',()=>{
 assert.match(consent,/caller uuid := auth.uid\(\)/);
 assert.match(consent,/FROM public.members m WHERE m.id=caller/);
 assert.equal((consent.match(/p.offering_member_id IS DISTINCT FROM caller/g)||[]).length,2);
 assert.match(consent,/p_expected_proposal_version<1/);
 for(const param of ['p_financial_proposal_id','p_expected_proposal_version','p_movement_offer_id'])assert(consent.includes(param+' IS NULL'));
 assert.match(consent,/p.version IS DISTINCT FROM p_expected_proposal_version/);
});
test('exact immutable offer identity precedes locking and is rechecked after waits',()=>{
 const guard=consent.indexOf('s.movement_offer_id IS DISTINCT FROM p_movement_offer_id');
 assert(guard>=0 && guard<consent.indexOf('assert_movement_offer_availability_binding'));
 assert.equal((consent.match(/s.movement_offer_id IS DISTINCT FROM p_movement_offer_id/g)||[]).length,2);
 for(const fn of ['assert_financial_proposal_quote_binding','assert_financial_proposal_movement_context_binding','assert_financial_proposal_source_compatibility',
  'assert_movement_context_snapshot_offer_binding','assert_financial_proposal_snapshot_roster','assert_financial_proposal_context'])assert(consent.includes('private.'+fn));
});
test('strong dependency locks before proposal history, then fresh live validation',()=>{
 assert.match(consent,/transaction_isolation.*'read committed'/);
 const lock=consent.indexOf('ORDER BY x.version FOR UPDATE');
 let previous=-1;
 for(const fn of ['assert_movement_offer_availability_binding','assert_pricing_quote','assert_movement_context_snapshot_offer_binding','assert_movement_context_snapshot(s.id)']) {
  const at=consent.indexOf(fn);assert(at>previous&&at<lock);previous=at;
 }
 const after=consent.slice(lock);
 assert.match(after,/SELECT x\.\* INTO STRICT p/);
 for(const fn of ['assert_movement_offer_availability_binding','assert_pricing_quote','assert_movement_context_snapshot(s.id)','assert_financial_proposal_context'])assert(after.includes(fn));
 for(const field of ['requester_accepted_at','alignment_id','financial_agreement_id','materialized_at'])assert(after.includes('p.'+field+' IS NOT NULL'));
 assert.match(after,/p.expires_at<=clock_timestamp\(\)/);
 assert.match(after,/a.status IN \('awaiting_activation_payment','activated','in_progress','completed'\)/);
});
test('write set is one atomic pair, exact deferred validation, no downstream effects',()=>{
 assert.deepEqual([...consent.matchAll(/UPDATE\s+([\w.]+)\s+x\s+SET\s+([\s\S]*?)\s+WHERE/g)].map(m=>[m[1],m[2].trim()]),
  [['private.financial_proposals','movement_offer_id=p_movement_offer_id, offering_accepted_at=accepted_at']]);
 assert.match(consent,/SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_movement_context_complete IMMEDIATE;/);
 assert.match(consent,/SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_movement_context_complete DEFERRED;/);
 assert.doesNotMatch(consent,/SET CONSTRAINTS ALL|\b(?:INSERT|DELETE|MERGE|TRUNCATE)\b|UPDATE public\.|calculate_financial/i);
});
test('replay returns stored evidence before any update and enforces live status and timestamp',()=>{
 const replay=consent.indexOf('IF p.offering_accepted_at IS NOT NULL THEN');
 const update=consent.indexOf('UPDATE private.financial_proposals');
 assert(replay>0&&replay<update);
 assert.match(consent.slice(replay,update),/RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.offering_accepted_at;\s*RETURN;/);
 assert.match(consent,/accepted_at:=clock_timestamp\(\)/);
 assert.match(consent,/accepted_at<p.created_at OR accepted_at>=p.expires_at/);
 assert.match(consent,/p.offering_accepted_at>accepted_at/);
});
test('authenticated-only ACLs and relocated legacy internal are not callable by clients',()=>{
 for(const fn of ['public.accept_my_financial_proposal_as_offerer(uuid,integer,uuid)','public.accept_movement_offer(uuid)','private.accept_movement_offer_legacy_internal(uuid)'])
  assert(sql.includes('REVOKE ALL ON FUNCTION '+fn));
 assert.equal((sql.match(/FROM PUBLIC,anon,authenticated,service_role/g)||[]).length,3);
 const grants=[...sql.matchAll(/GRANT[^;]+;/g)].map(m=>m[0]);
 assert.deepEqual(grants,['GRANT EXECUTE ON FUNCTION public.accept_my_financial_proposal_as_offerer(uuid,integer,uuid) TO authenticated;',
  'GRANT EXECUTE ON FUNCTION public.accept_movement_offer(uuid) TO authenticated;']);
});
test('need-level legacy guard preserves body but blocks all financial history including competing offers',()=>{
 assert.match(sql,/ALTER FUNCTION public.accept_movement_offer\(uuid\) SET SCHEMA private/);
 assert.match(sql,/RENAME TO accept_movement_offer_legacy_internal/);
 const lock=cutover.indexOf('FOR UPDATE');const guard=cutover.indexOf('FROM private.financial_proposals');const delegate=cutover.indexOf('RETURN QUERY');
 assert(lock>0&&guard>lock&&delegate>guard);
 assert.match(cutover,/WHERE p.movement_need_id=need_id\)/);
 assert.doesNotMatch(cutover,/p\.status|p\.expires_at|p\.movement_offer_id|FOR SHARE|INSERT|UPDATE public\./);
 assert.match(cutover,/private.accept_movement_offer_legacy_internal\(p_movement_offer_id\)/);
});
test('client sends exactly three selectors and parses minimal consent evidence',async()=>{
 const s=service(),v=await s.accept(input);
 assert.equal(JSON.stringify(s.calls),JSON.stringify([['accept_my_financial_proposal_as_offerer',{
  p_financial_proposal_id:id,p_expected_proposal_version:2,p_movement_offer_id:offer}]]));
 assert.equal(JSON.stringify(v),JSON.stringify({proposalId:id,proposalVersion:2,proposalStatus:'current',movementOfferId:offer,offeringAcceptedAt:row.offering_accepted_at}));
});
test('client rejects invalid identifiers and versions before RPC',async()=>{
 for(const i of [null,undefined,{}, {...input,financialProposalId:'bad'}, {...input,movementOfferId:' '+offer},
  ...[null,undefined,0,-1,2.5,'2',NaN,Infinity,2147483648].map(v=>({...input,expectedProposalVersion:v}))]) {
  const s=service();await assert.rejects(s.accept(i),/financial_proposal_consent_unavailable/);assert.equal(s.calls.length,0);
 }
});
test('client exact keys, row cardinality, current status and matching identities fail closed',async()=>{
 for(const data of [null,{},[],[row,row],[null],[[]], [{...row,proposal_id:offer}],[{...row,movement_offer_id:id}],
  [{...row,proposal_version:1}],[{...row,proposal_version:'2'}],[{...row,proposal_status:'superseded'}],
  [{...row,requester_accepted_at:null}],[Object.fromEntries(Object.entries(row).filter(([k])=>k!=='movement_offer_id'))]])
  await assert.rejects(service({data,error:null}).accept(input),/financial_proposal_consent_unavailable/);
});
test('client accepts offset timestamp but rejects invalid calendar/time and infinity',async()=>{
 for(const timestamp of [null,12,'infinity','2026-02-30T10:00:00Z','2026-10-02','2026-10-02T24:00:00Z','2026-10-02T10:00:00+25:00'])
  await assert.rejects(service({data:[{...row,offering_accepted_at:timestamp}],error:null}).accept(input),/financial_proposal_consent_unavailable/);
 assert.equal((await service({data:[{...row,offering_accepted_at:'2024-02-29T10:00:00-07:00'}],error:null}).accept(input)).proposalVersion,2);
});
test('client exact retries preserve evidence and hide transport/database errors',async()=>{
 const s=service();assert.equal(JSON.stringify(await s.accept(input)),JSON.stringify(await s.accept(input)));
 for(const response of [{data:null,error:{message:'private source mismatch'}},new Error('private table')])
  await assert.rejects(service(response).accept(input),e=>e.message==='financial_proposal_consent_unavailable');
});
test('inert DB runners require installation and retain clone/fingerprint/cleanup protections',()=>{
 const live=read('supabase/tests/0076_financial_proposal_offerer_consent_test.sql');
 assert.match(live,/^BEGIN;/);assert.match(live,/ROLLBACK;\s*$/);
 for(const phrase of ['legacy operational behavior retained','requester denied','invited traveller','anon execute denied','service role execute denied',
  'exact retry returns same timestamp','retry performs no additional writes','expired proposal rejected','active alignment blocks','different genuine offer',
  'no wallet ledger payment obligation journey','economics provenance roster','write-once consent'])assert(live.includes(phrase),phrase);
 for(const suffix of ['behavior','concurrency']) {
  const runner=read('supabase/tests/0076_financial_proposal_offerer_consent_'+suffix+'.cjs');new vm.Script(runner);
  assert.match(runner,/version='0076'/);assert.match(runner,/if \(require.main === module\)/);
  assert.doesNotMatch(runner,/apply_migration|db push|--no-acl/);
 }
 const races=read('supabase/tests/0076_financial_proposal_offerer_consent_concurrency.cjs');
 for(const phrase of ['pg_blocking_pids','DEFAULT ACL','--use-list=','--format=custom','TEMPLATE template0','DROP DATABASE','fingerprint unchanged',
  'duplicateRace','issuanceRace','withdrawalRace','legacyRace','issuanceBeforeLegacy','noDeadlock','AggregateError','rm'])assert(races.includes(phrase),phrase);
 const prior=read('supabase/tests/0074_trusted_financial_proposal_issuer_concurrency.cjs');
 assert.match(prior,/const cutover = kind === 'acceptance'/);
 assert.match(prior,/checkResult\(result, !cutover\)/);
 assert.match(prior,/assert.match\(result.error, \/financial requester materialization\/\)/);
 assert.match(prior,/await blocked\(a, b\)/);
 const {filterDefaultAcls}=require('../supabase/tests/0076_financial_proposal_offerer_consent_concurrency.cjs');
 const toc='1; 0 0 ACL private TABLE financial_proposals postgres\n2; 0 0 DEFAULT ACL public postgres\n3; 0 0 ACL public COLUMN offers.description postgres\n';
 assert.equal(filterDefaultAcls(toc),'1; 0 0 ACL private TABLE financial_proposals postgres\n3; 0 0 ACL public COLUMN offers.description postgres\n\n');
});
test('historical production migrations 0001 through 0075 unchanged',()=>{
 const dir=path.join(__dirname,'../supabase/migrations');
 const names=fs.readdirSync(dir).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&+n.slice(0,4)<=75).sort();assert.equal(names.length,75);
 assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read('supabase/migrations/'+n)).join('\n')).digest('hex'),
  '4660049be9d1877e6d3bada78c0f3df3464ca7e049279379d406f93363c4c32d');
});
