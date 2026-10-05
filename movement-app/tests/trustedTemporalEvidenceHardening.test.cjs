'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const sql=read('supabase/migrations/0082_trusted_temporal_evidence_hardening.sql');
const model=require('../docs/0082-temporal-external-model.json');
const catalog=require('../docs/0082-temporal-audit-catalog.json');
const funcs=new Map([...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:private|public)\.\w+)\([^]*?AS \$function\$([^]*?)\$function\$;/g)].map(m=>[m[1],m[2]]));
test('exact audited scope; empty search paths and definer attributes retained',()=>{
 assert.deepEqual([...funcs.keys()].filter(n=>n!=='private.protect_alignment_face_attempt_ordinal').sort(),[...model.replacementFunctions].sort());
 for(const n of model.replacementFunctions){const old=catalog.functions.find(f=>f.schema+'.'+f.name===n).definition.replace(/\r\n/g,'\n');assert(sql.includes(old.slice(0,old.indexOf('AS $function$'))),n);}
});
for(const [n,event] of [['record_location_resolution_for_server','p_resolved_at'],['record_offering_route_evidence_for_server','p_generated_at'],['record_trusted_route_match_evidence_for_server','p_calculated_at']])test(n+' persists its single authoritative admission sample',()=>{
 const body=funcs.get('public.'+n);assert.equal((body.match(/v_attested_at := clock_timestamp\(\)/g)||[]).length,1);
 assert(body.includes(event+'>v_attested_at'));assert(body.includes('NOT isfinite('+event+')'));assert.match(body,/LEAST\(/);
 assert(body.indexOf('v_attested_at :=')<body.lastIndexOf('INSERT INTO private.'));assert.match(body,/v_attested_at[^]*RETURNING id/);
});
test('sequence private, CACHE 1, positive unique immutable ordinal; no backfill',()=>{
 assert.match(sql,/CREATE SEQUENCE private\.alignment_face_attempt_ordinal_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE CACHE 1/);
 assert.match(sql,/REVOKE ALL ON SEQUENCE[^;]*PUBLIC, anon, authenticated, service_role/);
 assert.match(sql,/attempt_ordinal bigint NOT NULL/);assert.match(sql,/CHECK \(attempt_ordinal>0\)/);assert.match(sql,/attempt_ordinal_unique UNIQUE/);
 assert.match(sql,/alignment_id,member_id,attempt_ordinal DESC/);assert.match(funcs.get('private.protect_alignment_face_attempt_ordinal'),/IS DISTINCT FROM OLD\.attempt_ordinal/);
 assert.doesNotMatch(sql,/UPDATE private\.alignment_face_verifications SET attempt_ordinal/);
});
test('ordinal allocated after alignment/member locks, never max plus one',()=>{
 const b=funcs.get('public.start_alignment_face_verification_for_server');assert(b.indexOf('public.alignments')<b.indexOf('public.members'));assert(b.indexOf('public.members')<b.indexOf('nextval('));assert.doesNotMatch(b,/max\(/i);
});
test('latest selectors use ordinal; historical activation validates receipt-bound face',()=>{
 for(const n of ['private.has_current_alignment_face_check','public.activate_my_funded_movement','public.get_my_alignment_face_verification_status']) {assert.match(funcs.get(n),/attempt_ordinal DESC/);assert.doesNotMatch(funcs.get(n),/ORDER BY[^\n]*started_at/);}
 const b=funcs.get('private.assert_funded_activation');assert.match(b,/f.id=x.face_verification_id/);assert.doesNotMatch(b,/newer|has_current_alignment_face_check|clock_timestamp/);assert.match(b,/f.expires_at<=receipt.activated_at/);
});
test('current eligibility retained; historical replay does not resample clock',()=>{
 for(const n of ['private.assert_pricing_quote_context','public.accept_my_financial_proposal_as_requester','public.accept_my_financial_proposal_as_offerer','private.protect_offering_route_evidence'])assert.match(funcs.get(n),/expires_at[^\n]*clock_timestamp/);
 for(const n of ['private.assert_financial_proposal_materialization','private.movement_funding_evidence','private.assert_funded_activation','private.assert_funded_coordination_entry','private.require_funded_start_actor'])assert.doesNotMatch(funcs.get(n),/>clock_timestamp\(\)/);
});
test('compatibility before cutover; no count assumptions or history mutation',()=>{
 const pre=sql.slice(0,sql.indexOf('CREATE SEQUENCE'));assert.match(pre,/Incompatible historical location attestation/);assert.match(pre,/Incompatible historical discovery attestation/);assert.match(pre,/Incompatible historical route attestation/);assert.match(pre,/Incompatible historical match attestation/);assert.match(pre,/empty face history/);
 assert.doesNotMatch(pre,/\b(?:UPDATE|DELETE|INSERT)\b/);assert.doesNotMatch(sql,/supabase_migrations|session_replication_role|DISABLE TRIGGER|pg_sleep/);
});
test('historical migrations normalized contents and paused completion unchanged',()=>{
 const inv=require('../docs/0082-temporal-audit-inventory.json');
 const historical=crypto.createHash('sha256').update(
  inv.migrations.map(m=>
   m.name+'\n'+
   read('supabase/migrations/'+m.name)
  ).join('\n')
 ).digest('hex');
 assert.equal(historical,'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations/0083_financial_movement_completion.sql'))).digest('hex'),'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
});
test('source-only clone preserves ACLs and always cleans up independently',()=>{
 const h=read('supabase/tests/0082_trusted_temporal_evidence_hardening_harness.cjs');assert.match(h,/--format=custom/);assert.match(h,/DEFAULT ACL/);assert.match(h,/--use-list=/);assert.doesNotMatch(h,/--no-acl/);assert.match(h,/TEMPLATE template0/);assert.match(h,/DROP DATABASE/);assert.match(h,/finally\{try\{command\(\['rm'/);assert.match(h,/Application data\/catalog\/ACL\/RLS\/history unchanged/);
});
