'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8').replace(/\r\n/g,'\n');
const raw=read('supabase/migrations/0077_financial_proposal_requester_materialization.sql'),sql=raw.replace(/--[^\n]*/g,'');
const body=sql.match(/AS \$materialize\$([\s\S]*?)\$materialize\$/)[1],graph=sql.match(/AS \$graph\$([\s\S]*?)\$graph\$/)[1];
const source=read('src/services/movementService.ts'),id='00000000-0000-4000-8000-000000000077';
const row={proposal_id:id,proposal_version:2,proposal_status:'current',movement_offer_id:'00000000-0000-4000-8000-000000000078',
 alignment_id:'00000000-0000-4000-8000-000000000079',alignment_status:'awaiting_activation_payment',
 financial_agreement_id:'00000000-0000-4000-8000-000000000080',requester_accepted_at:'2026-10-02T10:00:00.123456+00:00',materialized_at:'2026-10-02T10:00:00.223456+00:00'};
function service(response={data:[row],error:null}) {
 const exports={},calls=[];
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;}}})});
 return {accept:exports.acceptMyFinancialProposalAsRequester,calls};
}
test('0077 one transaction, exact RPC/selectors, private graph helper and safe result',()=>{
 assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
 assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(m=>m[1]),
  ['private.assert_financial_proposal_materialization','public.accept_my_financial_proposal_as_requester']);
 assert.match(sql,/accept_my_financial_proposal_as_requester\(\s*p_financial_proposal_id uuid,\s*p_expected_proposal_version integer\s*\)/);
 assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/g)||[]).length,2);
 const fields=[...sql.match(/RETURNS TABLE \(([\s\S]*?)\)/)[1].matchAll(/(\w+)\s+(?:uuid|integer|text|timestamptz)/g)].map(m=>m[1]);
 assert.deepEqual(fields,Object.keys(row));
});
test('authenticated-only execution, no direct grants or protection changes',()=>{
 assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m=>m[0]),
  ['GRANT EXECUTE ON FUNCTION public.accept_my_financial_proposal_as_requester(uuid,integer) TO authenticated;']);
 assert.equal((sql.match(/FROM PUBLIC,anon,authenticated,service_role/g)||[]).length,2);
 assert.doesNotMatch(sql,/CREATE (?:TABLE|TRIGGER|POLICY)|ALTER|DROP|DISABLE|session_replication_role|SET CONSTRAINTS ALL|pg_notify|advisory/i);
});
test('caller mapped from auth.uid, exact requester and authoritative need owner only',()=>{
 assert.match(body,/caller uuid:=auth.uid\(\)/);assert.match(body,/FROM public.members m WHERE m.id=caller/);
 assert.match(body,/p.member_needing_movement_id IS DISTINCT FROM caller/);
 assert.match(body,/n.member_id IS DISTINCT FROM caller/);
 assert.match(body,/p_financial_proposal_id IS NULL OR p_expected_proposal_version IS NULL/);
 assert.match(body,/p_expected_proposal_version<1/);assert.match(body,/p.version IS DISTINCT FROM p_expected_proposal_version/);
});
test('first construction follows strong support then history, with fresh revalidation',()=>{
 assert.match(body,/transaction_isolation.*'read committed'/);
 const first=body.indexOf('PERFORM private.assert_movement_offer_availability_binding');
 const history=body.indexOf('ORDER BY x.version FOR UPDATE',first);
 let prior=first-1;
 for(const name of ['assert_movement_offer_availability_binding','assert_pricing_quote','assert_movement_context_snapshot_offer_binding','assert_movement_context_snapshot(s.id)']) {
  const at=body.indexOf(name,first);assert(at>prior&&at<history);prior=at;
 }
 const after=body.slice(history);
 for(const name of ['SELECT x.* INTO STRICT p','assert_movement_offer_availability_binding','assert_pricing_quote','assert_movement_context_snapshot(s.id)',
  'assert_financial_proposal_quote_binding','assert_financial_proposal_source_compatibility','assert_financial_proposal_context','assert_financial_proposal_snapshot_roster'])assert(after.includes(name),name);
 for(const field of ['requester_accepted_at','alignment_id','financial_agreement_id','materialized_at'])assert(after.includes('p.'+field+' IS NOT NULL'));
 assert.match(after,/p.offering_accepted_at IS NULL/);assert.match(after,/p.expires_at<=clock_timestamp\(\)/);
});
test('reuse existing operational authority only after financial revalidation, never call public bypass',()=>{
 const operational=body.indexOf('private.accept_movement_offer_legacy_internal(p.movement_offer_id)');
 assert(operational>body.indexOf('private.assert_financial_proposal_context(p.id)'));
 const snapshotDrain=body.indexOf('SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete IMMEDIATE');
 assert(snapshotDrain>body.indexOf('private.assert_financial_proposal_context(p.id)')&&snapshotDrain<operational);
 assert.doesNotMatch(body,/public.accept_movement_offer\(|INSERT INTO public\.|UPDATE public\./);
 assert.match(body,/operational.movement_offer_id IS DISTINCT FROM p.movement_offer_id/);
 assert.match(body,/operational.alignment_status IS DISTINCT FROM 'awaiting_activation_payment'/);
 // Effective relocated body still implements exact operational semantics.
 const legacy=read('supabase/migrations/0045_movement_offer_availability_capacity.sql').split('CREATE OR REPLACE FUNCTION public.accept_movement_offer')[1];
 for(const text of ["'awaiting_activation_payment'","status = 'accepted'","status = 'closed'","status = 'rejected'",'remaining_places-v_need_record.people_count'])assert(legacy.includes(text),text);
});
test('agreement publishes unaccepted, constructs exactly three components, then copies consent',()=>{
 assert.match(body,/coalesce\(max\(x.version\)::bigint,0\)\+1[\s\S]*WHERE x.alignment_id=operational.alignment_id/);
 assert.match(body,/agreement_version<>1/);
 const insert=body.match(/INSERT INTO private.financial_agreements\(([\s\S]*?)\)\s*VALUES\(([\s\S]*?)RETURNING/);
 assert(!insert[1].includes('accepted_at'));
 for(const name of ['financial_model_version','pricing_policy_version','platform_fee_allocation_policy_version','currency','quoted_platform_fee_total_minor'])assert(insert[2].includes('p.'+name));
 assert.match(body,/UPDATE private.financial_agreements x SET offering_accepted_at=p.offering_accepted_at,requester_accepted_at=accepted_at/);
 const components=body.slice(body.indexOf('INSERT INTO private.financial_components'),body.indexOf('UPDATE private.financial_agreements'));
 assert.equal((components.match(/\(created_agreement_id,/g)||[]).length,3);
 assert.match(components,/'offering_platform_share',p.quoted_platform_fee_total_minor\/2,p.offering_member_id,'platform',NULL/);
 assert.match(components,/'requester_platform_share',p.quoted_platform_fee_total_minor-p.quoted_platform_fee_total_minor\/2,p.member_needing_movement_id,'platform',NULL/);
 assert.match(components,/'movement_contribution',p.quoted_movement_contribution_minor,p.member_needing_movement_id,'member',p.offering_member_id/);
 assert.doesNotMatch(body,/calculate_financial|seat_price|0\.3|0\.15|0\.7|surge/);
});
test('one proposal update supplies all four materialization fields, no other stored proposal mutation',()=>{
 assert.deepEqual([...body.matchAll(/UPDATE private.financial_proposals x SET ([\s\S]*?) WHERE x.id=p.id/g)].map(m=>m[1].replace(/\s+/g,' ').trim()),
  ['requester_accepted_at=accepted_at,alignment_id=operational.alignment_id, financial_agreement_id=created_agreement_id,materialized_at=completed_at']);
 assert.match(body,/accepted_at:=clock_timestamp\(\)/);assert.match(body,/completed_at:=clock_timestamp\(\)/);
 assert.match(body,/completed_at<accepted_at OR completed_at>=p.expires_at/);
 assert.match(body,/SET CONSTRAINTS private.financial_agreement_complete,private.financial_components_complete DEFERRED/);
 assert.match(body,/private.financial_proposal_complete,private.financial_proposal_movement_context_complete IMMEDIATE/);
});
test('historical replay releases construction locks, validates graph and writes nothing',()=>{
 assert.match(body,/EXCEPTION WHEN SQLSTATE 'Z7701' THEN\s*NULL;/);
 assert.equal((body.match(/ERRCODE='Z7701'/g)||[]).length,2);
 const replay=body.slice(body.indexOf("EXCEPTION WHEN SQLSTATE 'Z7701'"));
 assert.match(replay,/FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id FOR UPDATE/);
 assert.match(replay,/assert_financial_proposal_materialization\(p\)/);
 assert.doesNotMatch(replay,/INSERT|UPDATE private\.|UPDATE public\.|assert_movement_offer_availability|assert_pricing_quote|FOR UPDATE[^;]*movement_needs/);
 assert.doesNotMatch(graph,/\b(?:INSERT|UPDATE|DELETE|SET CONSTRAINTS)\b/);
 const alignment=graph.indexOf('FROM public.alignments x'),offer=graph.indexOf('FROM public.movement_offers x'),agreement=graph.indexOf('FROM private.financial_agreements x');
 assert(alignment<offer&&offer<agreement);
});
test('historical replay ignores elapsed expiry while construction and recorded evidence stay bounded',()=>{
 const replay=body.slice(body.indexOf("EXCEPTION WHEN SQLSTATE 'Z7701'"));
 assert.doesNotMatch(replay,/p.expires_at\s*(?:<=|>)\s*clock_timestamp/);
 assert.match(replay,/p.status<>'current'/);
 const construction=body.slice(0,body.indexOf("EXCEPTION WHEN SQLSTATE 'Z7701'"));
 assert.equal((construction.match(/p.expires_at<=clock_timestamp\(\)/g)||[]).length,2);
 assert.match(construction,/accepted_at>=p.expires_at/);assert.match(construction,/completed_at>=p.expires_at/);
 const fresh=construction.slice(construction.indexOf('SELECT x.* INTO STRICT p FROM private.financial_proposals'));
 assert(fresh.indexOf("ERRCODE='Z7701'")<fresh.indexOf('p.expires_at<=clock_timestamp()'));
 for(const check of ['NOT isfinite(p.created_at)','NOT isfinite(p.expires_at)','p.expires_at<=p.created_at',
  'p.offering_accepted_at<p.created_at','p.requester_accepted_at<p.offering_accepted_at',
  'p.requester_accepted_at>=p.expires_at','p.materialized_at<p.requester_accepted_at','p.materialized_at>=p.expires_at'])assert(graph.includes(check),check);
 const protection=read('supabase/migrations/0021_financial_proposal_foundation.sql');
 assert.match(protection,/OLD.materialized_at IS NOT NULL AND NEW IS DISTINCT FROM OLD/);
 assert.match(read('supabase/migrations/0074_trusted_financial_proposal_issuer.sql'),/Progressed financial proposal cannot be superseded/);
 const live=read('supabase/tests/0077_financial_proposal_requester_materialization_test.sql');
 for(const label of ['naturally expired offerer-consented proposal rejected','exact replay preserves authoritative IDs and timestamps',
  'historical retry after original expiry','Expired replay changed persisted graph','Expired replay duplicated materialization'])assert(live.includes(label),label);
});

test('replay rejects partial graph and wrong principals/economics/components',()=>{
 for(const text of ['p.requester_accepted_at IS NULL','p.alignment_id IS NULL','p.financial_agreement_id IS NULL','p.materialized_at IS NULL',
  "a.status NOT IN ('awaiting_activation_payment','activated','in_progress','completed','cancelled')", "g.status NOT IN ('current','superseded')",'g.version<>1',
  'g.offering_accepted_at,g.requester_accepted_at','count(*) FROM private.financial_components','EXCEPT','p.quoted_movement_contribution_minor'])assert(graph.includes(text),text);
 assert.match(graph,/p.materialized_at<p.requester_accepted_at/);
});
test('historical lifecycle and agreement supersession preserve replay, initial shape remains strict',()=>{
 assert.doesNotMatch(graph,/a.activated_at|a.activation_fee_minor/);
 assert.match(graph,/x.id<>p.alignment_id AND x.status IN/);
 assert.doesNotMatch(graph,/count\(\*\) FROM private.financial_agreements/);
 const initial=body.slice(body.indexOf('PERFORM x.id FROM public.alignments x WHERE x.id=operational.alignment_id'),body.indexOf('SELECT coalesce(max(x.version)'));
 for(const exact of ["x.status='awaiting_activation_payment'",'x.activated_at IS NULL','x.activation_fee_minor IS NULL',
  "x.activation_currency='NGN'",'IF NOT FOUND THEN','Exact initial pre-payment alignment required'])assert(initial.includes(exact),exact);
 for(const [file,status] of [['0007_activation_payment_foundation.sql','activated'],['0008_journey_lifecycle.sql','in_progress'],
  ['0012_mutual_movement_completion.sql','completed'],['0019_mutual_no_travel_closure.sql','cancelled']]) {
  assert.match(read('supabase/migrations/'+file),new RegExp("status\\s*=\\s*'"+status+"'"));
  assert(graph.includes("'"+status+"'"));
 }
 const agreement=read('supabase/migrations/0020_financial_agreement_foundation.sql');
 assert.match(agreement,/NEW.status='superseded' AND[\s\S]*?ROW\(NEW.offering_accepted_at,NEW.requester_accepted_at\)/);
 const live=read('supabase/tests/0077_financial_proposal_requester_materialization_test.sql');
 assert(live.includes('historical superseded agreement replay has zero writes'));
 assert(live.includes('malformed alignment binding rejected'));
});

test('no downstream wallet, payment, funding, activation, journey or notification side effects',()=>{
 assert.doesNotMatch(sql,/wallet_|payment_|journeys|settlement|withdrawal|refund|pg_notify|net\.|http\.|INSERT INTO public\./i);
 assert.deepEqual([...body.matchAll(/(?:INSERT INTO|UPDATE) (private\.\w+)/g)].map(m=>m[1]),
  ['private.financial_agreements','private.financial_components','private.financial_agreements','private.financial_proposals']);
});
test('client maps exact selectors and nine safe camelCase fields',async()=>{
 const s=service(),result=await s.accept(id,2);
 assert.equal(JSON.stringify(s.calls),JSON.stringify([['accept_my_financial_proposal_as_requester',{p_financial_proposal_id:id,p_expected_proposal_version:2}]]));
 assert.equal(Object.keys(result).length,9);assert.equal(result.alignmentId,row.alignment_id);assert.equal(result.financialAgreementId,row.financial_agreement_id);
 assert.equal(result.materializedAt,row.materialized_at);
});
test('RPC returns authoritative construction and same locked historical alignment status',()=>{
 const replay=body.slice(body.indexOf("EXCEPTION WHEN SQLSTATE 'Z7701'"));
 assert.match(sql,/RETURNS text LANGUAGE plpgsql[\s\S]*?AS \$graph\$/);
 assert.match(graph,/FROM public.alignments x WHERE x.id=p.alignment_id FOR SHARE/);
 assert.match(graph,/RETURN a.status;/);
 assert.match(replay,/replay_alignment_status:=private.assert_financial_proposal_materialization\(p\)/);
 assert.match(replay,/RETURN QUERY[\s\S]*?replay_alignment_status,p.financial_agreement_id/);
 assert.doesNotMatch(replay,/FROM public.alignments|awaiting_activation_payment|UPDATE public/);
 assert.match(body,/RETURN QUERY[\s\S]*?operational.alignment_status,p.financial_agreement_id/);
 assert.match(body,/operational.alignment_status IS DISTINCT FROM 'awaiting_activation_payment'/);
});

test('client preserves every supported replay lifecycle status and rejects unsupported statuses',async()=>{
 for(const status of ['awaiting_activation_payment','activated','in_progress','completed','cancelled']) {
  const s=service({data:[{...row,alignment_status:status}],error:null});
  const result=await s.accept(id,2);assert.equal(result.alignmentStatus,status);
  assert.equal(result.alignmentId,row.alignment_id);assert.equal(result.materializedAt,row.materialized_at);
 }
 for(const status of ['failed','unknown','',null,42,'ACTIVATED'])
  await assert.rejects(service({data:[{...row,alignment_status:status}],error:null}).accept(id,2),/financial_proposal_materialization_unavailable/);
});

test('client input rejects UUID/version before transport',async()=>{
 for(const [p,v] of [['bad',2],[null,2],[id,0],[id,-1],[id,2.5],[id,'2'],[id,null],[id,NaN],[id,2147483648]]) {
  const s=service();await assert.rejects(s.accept(p,v),/financial_proposal_materialization_unavailable/);assert.equal(s.calls.length,0);
 }
});
test('parser rejects cardinality, private extras, missing fields and mismatched identities/versions/status',async()=>{
 for(const data of [null,{},[],[row,row],[null],[[]],[{...row,proposal_id:row.alignment_id}],[{...row,proposal_version:1}],
  [{...row,proposal_status:'superseded'}],[{...row,alignment_status:'failed'}],[{...row,offering_member_id:id}],
  [Object.fromEntries(Object.entries(row).filter(([k])=>k!=='financial_agreement_id'))]])
  await assert.rejects(service({data,error:null}).accept(id,2),/financial_proposal_materialization_unavailable/);
 for(const k of ['movement_offer_id','alignment_id','financial_agreement_id'])
  await assert.rejects(service({data:[{...row,[k]:'bad'}],error:null}).accept(id,2),/financial_proposal_materialization_unavailable/);
});
test('timestamp calendars fail closed; server-validated regressed materialization is accepted',async()=>{
 for(const change of [{requester_accepted_at:null},{materialized_at:'infinity'},{materialized_at:'2026-02-30T10:00:00Z'},
  {requester_accepted_at:'2026-10-02'},{materialized_at:'2026-10-02T24:00:00Z'}])
  await assert.rejects(service({data:[{...row,...change}],error:null}).accept(id,2),/financial_proposal_materialization_unavailable/);
 for(const materialized_at of [row.requester_accepted_at,'2026-10-02T10:00:00.118118+00:00'])
  assert.equal((await service({data:[{...row,materialized_at}],error:null}).accept(id,2)).materializedAt,materialized_at);
});
test('exact client retries preserve evidence; raw transport/DB errors never leak',async()=>{
 const s=service();assert.equal(JSON.stringify(await s.accept(id,2)),JSON.stringify(await s.accept(id,2)));
 for(const response of [{data:null,error:{message:'private financial schema'}},new Error('private SQL')])
  await assert.rejects(service(response).accept(id,2),e=>e.message==='financial_proposal_materialization_unavailable');
});
test('real DB suites are inert and require installation, with normal fixtures and complete rollback',()=>{
 const live=read('supabase/tests/0077_financial_proposal_requester_materialization_test.sql');assert.match(live,/^BEGIN;/);assert.match(live,/ROLLBACK;\s*$/);
 for(const text of ['exact requester succeeds','unconsented and unbound','naturally expired','vehicle access loss','roster drift',
  'exactly three financial components','exact replay preserves','replay has zero','partial materialization','no wallet payment hold',
  'same-transaction materialization','legacy cutover remains blocked'])assert(live.includes(text),text);
 for(const suffix of ['behavior','concurrency']) {
  const runner=read('supabase/tests/0077_financial_proposal_requester_materialization_'+suffix+'.cjs');new vm.Script(runner);
  assert.match(runner,/version='0077'/);assert.match(runner,/if \(require.main === module\)/);assert.doesNotMatch(runner,/apply_migration|db push|--no-acl/);
 }
 const races=read('supabase/tests/0077_financial_proposal_requester_materialization_concurrency.cjs');
 for(const text of ['pg_blocking_pids','duplicateRace','supersessionRace','issuanceRace','invalidationRace','legacyRace','offererReplayRace',
  'committedReplayRace','expiryRace','competingFinancialRace','activationLockOrderRace','noDeadlock','--format=custom','DEFAULT ACL','--use-list=',
  'TEMPLATE template0','DROP DATABASE','fingerprint unchanged','AggregateError'])assert(races.includes(text),text);
 const {filterDefaultAcls}=require('../supabase/tests/0077_financial_proposal_requester_materialization_concurrency.cjs');
 assert.equal(filterDefaultAcls('1; 0 0 ACL private TABLE financial_proposals postgres\n2; 0 0 DEFAULT ACL public postgres'),
  '1; 0 0 ACL private TABLE financial_proposals postgres\n');
});
test('replay ownership alias is unambiguous and every comparison proves success',()=>{
 const replay=body.slice(body.indexOf("EXCEPTION WHEN SQLSTATE 'Z7701'"));
 assert.match(replay,/public.movement_needs replay_need WHERE replay_need.id=p.movement_need_id AND replay_need.member_id=caller/);
 assert.doesNotMatch(replay,/movement_needs n WHERE n.id/);
 const live=read('supabase/tests/0077_financial_proposal_requester_materialization_test.sql');
 assert.match(live,/immediate replay independently succeeds/);
 assert.match(live,/original->>''ok'' IS DISTINCT FROM ''true''/);
 assert.match(live,/again->>''ok'' IS DISTINCT FROM ''true''/);
 assert.equal((live.match(/retry_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Expected successful replay/g)||[]).length,2);
 const {sourceDefinitions}=require('../supabase/tests/0077_financial_proposal_requester_materialization_behavior.cjs');
 const overlay=sourceDefinitions();
 assert.equal((overlay.match(/CREATE OR REPLACE FUNCTION/g)||[]).length,2);
 assert(overlay.includes('replay_need.id=p.movement_need_id'));
 assert.doesNotMatch(overlay,/\b(?:GRANT|REVOKE|ALTER|DROP|COMMIT)\b|schema_migrations/);
 const runner=read('supabase/tests/0077_financial_proposal_requester_materialization_behavior.cjs');
 assert.match(runner,/fixtures\(\).replace\(\/\^BEGIN;\//);
 assert.match(runner,/finally.*assert.equal\(query\('postgres', snapshot\), before/);
});

test('concurrency source verification commits only in disposable clone and checks every session',()=>{
 const runner=read('supabase/tests/0077_financial_proposal_requester_materialization_concurrency.cjs');
 assert.match(runner,/target\('BEGIN; '\+sourceDefinitions\(\)\+' COMMIT;'\)/);
 assert.match(runner,/Concurrent session sees corrected committed 0077 definitions/);
 assert.match(runner,/await this.send\(functionFingerprint\)/);
 assert.doesNotMatch(runner,/query\('postgres',[^;]*sourceDefinitions/);
 assert.match(runner,/DROP DATABASE/);assert.match(runner,/Application DB data\/catalog\/ACL\/RLS\/history fingerprint unchanged/);
});

test('historical migrations 0001–0076 including legacy cutover remain byte-normalized unchanged',()=>{
 const dir=path.join(__dirname,'../supabase/migrations'),names=fs.readdirSync(dir).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&+n.slice(0,4)<=76).sort();assert.equal(names.length,76);
 assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read('supabase/migrations/'+n)).join('\n')).digest('hex'),
  '3db2a711b40a4ee5b496dddf6d10ec37902afb326ec14ca78ac74e085e7c0335');
});
