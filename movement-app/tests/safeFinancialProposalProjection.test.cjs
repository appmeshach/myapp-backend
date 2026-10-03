'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const read = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8').replace(/\r\n/g,'\n');
const raw = read('supabase/migrations/0075_safe_financial_proposal_projection.sql');
const sql = raw.replace(/--[^\n]*/g,'');
const source = read('src/services/movementService.ts');
const id = '00000000-0000-4000-8000-000000000075';
const row = {
  proposal_id:id, proposal_version:1, proposal_status:'current', created_at:'2026-01-01T10:00:00Z', expires_at:'2026-01-01T12:00:00Z',
  caller_role:'requester', currency:'NGN', quoted_platform_fee_total_minor:7407, quoted_movement_contribution_minor:20986,
  origin_area:'Agungi', destination_area:'Oniru', earliest_departure_at:'2026-01-01T11:00:00Z', latest_departure_at:null,
  people_count:2, seats_offered:3, vehicle_seat_capacity:4, proposed_pickup_area:null, proposed_dropoff_area:null,
  estimated_arrival_minutes:null, offering_accepted_at:null, requester_accepted_at:null,
};
function service(response={data:[row],error:null}) {
  const calls=[];
  const exports={};
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;}}})});
  return {get:exports.getMyFinancialProposal,calls};
}
test('0075 adds one atomic exact-ID read RPC with auth context and private principal predicate',()=>{
  assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(m=>m[1]),['public.get_my_financial_proposal']);
  assert.match(sql,/get_my_financial_proposal\(p_financial_proposal_id uuid\)/);
  assert.match(sql,/STABLE SECURITY DEFINER SET search_path = ''/);
  assert.match(sql,/caller uuid := auth.uid\(\)/);
  assert.match(sql,/FROM public.members m WHERE m.id=caller/);
  assert.match(sql,/WHERE p.id=p_financial_proposal_id\s+AND caller IN \(p.member_needing_movement_id,p.offering_member_id\)/);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|EXECUTE)\b(?! ON)/i);
});
test('exact safe return set, no provenance, no live eligibility filters or financial calculations',()=>{
  const fields=[...sql.match(/RETURNS TABLE \(([\s\S]*?)\)/)[1].matchAll(/(\w+)\s+(?:uuid|integer|text|timestamptz|bigint)/g)].map(m=>m[1]).sort();
  assert.deepEqual(fields,Object.keys(row).sort());
  assert.doesNotMatch(sql,/WHERE[^;]*(?:expires_at|status\s*=)/);
  assert.doesNotMatch(sql,/calculate_|pricing_quotes|movement_context_snapshots|financial_proposal_travellers/);
});
test('authenticated-only function grant preserves private table boundary',()=>{
  assert.match(sql,/REVOKE ALL ON FUNCTION public.get_my_financial_proposal\(uuid\) FROM PUBLIC,anon,authenticated,service_role/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m=>m[0]),['GRANT EXECUTE ON FUNCTION public.get_my_financial_proposal(uuid) TO authenticated;']);
});
test('service maps exact RPC and safe camelCase fields',async()=>{
  const s=service();const view=await s.get(id);
  assert.equal(JSON.stringify(s.calls),JSON.stringify([['get_my_financial_proposal',{p_financial_proposal_id:id}]]));
  assert.equal(view.proposalId,id);assert.equal(view.quotedPlatformFeeTotalMinor,7407);assert.equal(view.quotedMovementContributionMinor,20986);
  assert.equal(view.proposedPickupArea,null);assert.equal(view.offeringAcceptedAt,null);
  assert.equal(Object.keys(view).length,21);
});
test('unknown result maps to null, invalid UUID never reaches network',async()=>{
  assert.equal(await service({data:[],error:null}).get(id),null);
  for(const v of ['bad','',null,undefined,' '+id]) {
    const s=service();await assert.rejects(s.get(v),/financial_proposal_unavailable/);assert.equal(s.calls.length,0);
  }
});
test('client rejects unexpected fields, missing keys, wrong ID, malformed arrays and duplicates',async()=>{
  for(const data of [null,{},[row,row],[null],[[]],[{...row,pricing_quote_id:id}],[{...row,proposal_id:'00000000-0000-4000-8000-000000000001'}],
    [Object.fromEntries(Object.entries(row).filter(([k])=>k!=='currency'))]]) {
    await assert.rejects(service({data,error:null}).get(id),/financial_proposal_unavailable/);
  }
});
test('bounded enums and money require exact nonnegative safe integers',async()=>{
  for(const change of [{proposal_status:'accepted'},{caller_role:'traveller'},{proposal_version:0},{proposal_version:2147483648},{currency:'ngn'},
    {quoted_platform_fee_total_minor:-1},{quoted_platform_fee_total_minor:0.5},{quoted_platform_fee_total_minor:'7407'},
    {quoted_movement_contribution_minor:Number.MAX_SAFE_INTEGER+1},{quoted_movement_contribution_minor:NaN}]) {
    await assert.rejects(service({data:[{...row,...change}],error:null}).get(id),/financial_proposal_unavailable/);
  }
  assert.equal((await service({data:[{...row,quoted_platform_fee_total_minor:0}],error:null}).get(id)).quotedPlatformFeeTotalMinor,0);
});
test('timestamps reject calendar normalization and invalid lifecycle relationships',async()=>{
  for(const change of [{created_at:'2026-02-30T10:00:00Z'},{created_at:'2026-01-01'},{expires_at:'infinity'},
    {expires_at:row.created_at},{latest_departure_at:row.created_at},{offering_accepted_at:'invalid'},
    {requester_accepted_at:'2026-01-01T11:00:00Z'},{offering_accepted_at:row.expires_at},
    {earliest_departure_at:'2026-01-01T24:00:00Z'}]) {
    await assert.rejects(service({data:[{...row,...change}],error:null}).get(id),/financial_proposal_unavailable/);
  }
  assert.equal((await service({data:[{...row,proposal_status:'superseded',caller_role:'offerer'}],error:null}).get(id)).proposalStatus,'superseded');
});
test('seat relationships, capacity, optional declarations and arrival integer bounds validated',async()=>{
  for(const change of [{people_count:0},{people_count:4},{seats_offered:5},{vehicle_seat_capacity:13},
    {seats_offered:2.5},{origin_area:''},{destination_area:'bad\nlabel'},{proposed_pickup_area:42},
    {proposed_dropoff_area:''},{estimated_arrival_minutes:-1},{estimated_arrival_minutes:2147483648}]) {
    await assert.rejects(service({data:[{...row,...change}],error:null}).get(id),/financial_proposal_unavailable/);
  }
});
test('transport and database errors are replaced with stable generic message',async()=>{
  for(const response of [{data:null,error:{message:'private database detail'}},new Error('private database detail')]) {
    await assert.rejects(service(response).get(id),e=>e.message==='financial_proposal_unavailable');
  }
});
test('behavioral runner requires installation, is inert, and coverage includes privacy and history',()=>{
  const runner=read('supabase/tests/0075_safe_financial_proposal_projection_behavior.cjs');new vm.Script(runner);
  assert.match(runner,/version='0075'/);assert.match(runner,/if \(require.main === module\)/);
  assert.doesNotMatch(runner,/apply_migration|db push/);
  const live=read('supabase/tests/0075_safe_financial_proposal_projection_test.sql');
  assert.match(live,/^BEGIN;/);assert.match(live,/ROLLBACK;\s*$/);
  for(const phrase of ['invited traveller','unknown and unauthorized','historical superseded','expired proposal','NULL optional','writes no persistent','service role denied','unmapped member'])assert(live.includes(phrase),phrase);
});
test('historical migrations 0001 through 0074 unchanged',()=>{
  const dir=path.join(__dirname,'../supabase/migrations');
  const names=fs.readdirSync(dir).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&+n.slice(0,4)<=74).sort();
  assert.equal(names.length,74);
  assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read('supabase/migrations/'+n)).join('\n')).digest('hex'),'501a68f33a5efde59da627dc5604d065d31986644ce966e90f8d1f276eae0966');
});
