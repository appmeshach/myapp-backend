'use strict';
// Offline audit evidence tests. No database access or source installation.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const catalog=require('../docs/0082-temporal-audit-catalog.json');
const evidence=require('../docs/0082-temporal-focused-evidence.json');
const first=require('../docs/0082-temporal-audit-inventory.json');
const fn=name=>catalog.functions.find(f=>f.name===name);
test('all historical migration normalized contents match the first audit scope',()=>{
 assert.equal(first.migrations.length,81);
 const historical=crypto.createHash('sha256').update(
  first.migrations.map(m=>
   m.name+'\n'+
   fs.readFileSync(path.join(root,'supabase/migrations',m.name),'utf8').replace(/\r\n/g,'\n')
  ).join('\n')
 ).digest('hex');
 assert.equal(historical,'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
});
test('paused completion bytes are exactly preserved',()=>{
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations/0083_financial_movement_completion.sql'))).digest('hex'),'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
});
test('resolved private writers exclude direct API table and column writes',()=>{
 const resolved=evidence.rows.filter(r=>r.final_origin!=='D');
 assert.equal(resolved.length,14);
 for(const r of resolved){assert.equal(r.privileges.length,3,r.field);for(const p of r.privileges)assert.equal(p.insert||p.update||p.any_column_insert||p.any_column_update,false,r.field+' '+p.role);}
});
test('bounded external expiry is classified B rather than trusted default C',()=>{
 for(const field of ['private.movement_location_references.expires_at','private.offering_route_evidence.expires_at','private.trusted_route_match_evidence.expires_at'])assert.equal(evidence.rows.find(r=>r.field===field).final_origin,'B');
 assert.equal(evidence.rows.find(r=>r.field==='private.movement_funding_holds.fully_held_at').final_origin,'D');
 assert.match(fn('hold_my_movement_funds').body,/coalesce\(funding_at,clock_timestamp\(\)\)/);
});
test('server timestamp ingestion boundaries are inaccessible to client roles',()=>{
 for(const f of catalog.functions.filter(f=>/^record_/.test(f.name)&&/timestamp with time zone/.test(f.arguments))){assert.equal(f.anon_execute,false,f.signature);assert.equal(f.authenticated_execute,false,f.signature);}
 assert.equal(fn('record_location_resolution_for_server').service_role_execute,false);
 assert.equal(fn('record_verified_selected_location_for_server').service_role_execute,true);
 for(const name of ['record_location_resolution_for_server','record_offering_route_evidence_for_server','record_trusted_route_match_evidence_for_server'])assert.match(fn(name).body,/isfinite\(p_(resolved|generated|calculated)_at\)/,name);
});
test('private explicit quota clocks are not public server inputs',()=>{
 for(const family of ['location','route']){
  const helper=fn('consume_'+family+'_provider_quota_at');
  assert.equal(helper.anon_execute||helper.authenticated_execute||helper.service_role_execute,false);
  assert.match(fn('consume_'+family+'_provider_quota_for_server').body,/NULL::timestamptz/);
 }
});
test('geography trusted producer uses one authoritative sample for both fields',()=>{
 const body=fn('record_pricing_geography_evidence_for_server').body;
 assert.match(body,/e\.generated_at:=clock_timestamp\(\);\s*e\.created_at:=e\.generated_at;/);
 assert.match(body,/INSERT INTO private\.pricing_geography_evidence SELECT e\.\*/);
});
test('installed face selectors exhibit the regressing-time counterexample',()=>{
 assert.match(fn('has_current_alignment_face_check').body,/ORDER BY latest\.started_at DESC,latest\.id DESC/);
 assert.match(fn('activate_my_funded_movement').body,/ORDER BY f\.started_at DESC,f\.id DESC/);
 const attempts=[{ordinal:1,started:1005,status:'succeeded'},{ordinal:2,started:1000,status:'failed'}];
 const byTime=[...attempts].sort((a,b)=>b.started-a.started)[0];
 const byOrdinal=[...attempts].sort((a,b)=>b.ordinal-a.ordinal)[0];
 assert.equal(byTime.status,'succeeded');assert.equal(byOrdinal.status,'failed');
 const inverse=attempts.map(a=>({...a,status:a.status==='succeeded'?'failed':'succeeded'}));
 assert.equal([...inverse].sort((a,b)=>b.started-a.started)[0].status,'failed');
 assert.equal([...inverse].sort((a,b)=>b.ordinal-a.ordinal)[0].status,'succeeded');
});
test('attempt production owns alignment then member lock before insertion',()=>{
 const body=fn('start_alignment_face_verification_for_server').body;
 const alignment=body.indexOf('FROM public.alignments'),member=body.indexOf('FROM public.members'),insert=body.indexOf('INSERT INTO private.alignment_face_verifications');
 assert.ok(alignment>=0&&alignment<member&&member<insert);
 assert.match(body,/status='pending'/);
 assert.match(fn('assert_funded_activation').body,/ROW\(newer\.started_at,newer\.id\)>ROW\(f\.started_at,f\.id\)/);
});
test('snapshot capture mode remains SELECT-only and exits before source loading',()=>{
 const body=fs.readFileSync(path.join(root,'supabase/tests/0082_financial_movement_completion_settlement_stress.cjs'),'utf8');
 const mode=body.slice(body.indexOf("if(process.argv.includes('--temporal-audit'))"),body.indexOf("if(process.argv.includes('--discovery-provenance'))"));
 assert.match(mode,/SELECT jsonb_build_object/);
 assert.match(mode,/Read-only temporal catalog audit fingerprint unchanged/);
 assert.match(mode,/return;/);
 assert.doesNotMatch(mode,/\b(?:CREATE|ALTER|DROP|UPDATE|INSERT|DELETE|TRUNCATE)\s+(?:TABLE|FUNCTION|INTO|FROM|DATABASE|private\.|public\.)/);
});
const externalModel=require('../docs/0082-temporal-external-model.cjs');
test('selection proof has an existing Edge skew allowance while DB remains strict',()=>{
 const source=fs.readFileSync(path.join(root,'supabase/functions/_shared/location-selection-proof.ts'),'utf8');
 assert.match(source,/MAX_FUTURE_SKEW_MS = 30_000/);
 assert.match(source,/MAX_PROOF_LIFETIME_MS = 5 \* 60_000/);
 assert.match(source,/issued <= nowMs \+ MAX_FUTURE_SKEW_MS/);
 assert.match(fn('record_verified_selected_location_for_server').body,/p_proof_issued_at>v_now/);
 assert.equal(externalModel.families.find(f=>f.name==='selection').maxDBFutureMs,0);
});
test('actual external adapter timestamps are server observations rather than provider claims',()=>{
 const location=fs.readFileSync(path.join(root,'supabase/functions/_shared/mapbox-geocoding-provider.ts'),'utf8');
 const route=fs.readFileSync(path.join(root,'supabase/functions/_shared/mapbox-directions-provider.ts'),'utf8');
 const match=fs.readFileSync(path.join(root,'supabase/functions/_shared/route-match-orchestration.ts'),'utf8');
 assert.match(location,/const resolvedAt\s*=\s*now\(\)/);
 assert.match(route,/const generatedAt\s*=\s*now\(\)/);
 assert.match(match,/const calculatedAt\s*=\s*new Date\(\)\.toISOString\(\)/);
 assert.equal(externalModel.families.find(f=>f.name==='resolution').meaning,'server_received_time');
 assert.equal(externalModel.families.find(f=>f.name==='route').meaning,'server_received_time');
});
test('existing attestation columns and immutable private boundaries can be reused',()=>{
 for(const field of ['private.movement_location_selection_attestations.verified_at','private.movement_location_resolution_evidence.recorded_at','private.offering_route_evidence.created_at','private.trusted_route_match_evidence.created_at']){
  const [schema,table,column]=field.split('.');
  assert.ok(catalog.timestamp_columns.some(c=>c.table_schema===schema&&c.table_name===table&&c.column_name===column),field);
  for(const p of catalog.write_privileges.filter(p=>p.table===schema+'.'+table))assert.equal(p.insert||p.update||p.any_column_insert||p.any_column_update,false,field+' '+p.role);
 }
 for(const name of ['protect_movement_location_selection_attestation','protect_movement_location_resolution_evidence','protect_offering_route_evidence','protect_trusted_route_match_evidence'])assert.match(fn(name).body,/immutable|cannot be deleted/);
});
test('provider-free timestamp families really have no external timestamp arguments',()=>{
 for(const name of externalModel.noExternalTimestampFamilies)assert.doesNotMatch(fn(name).arguments,/timestamp|timestamptz/,name);
});
test('current location route and match writers show the captured sample separation',()=>{
 const location=fn('record_location_resolution_for_server').body;
 assert.ok(location.indexOf('p_resolved_at>v_now')<location.lastIndexOf('v_now := clock_timestamp()'));
 for(const name of ['record_offering_route_evidence_for_server','record_trusted_route_match_evidence_for_server']){
  const insert=fn(name).body.split(/INSERT INTO private\./).at(-1).split(')')[0];
  assert.doesNotMatch(insert,/\bcreated_at\b/);
 }
 assert.equal(externalModel.families.filter(f=>!f.sameSampleNow).length,3);
});
test('authored attestation model separates ingestion history and live expiry',()=>{
 // Model arithmetic only: no claim that production validators implement this yet.
 const ingest=(event,reference,expiry)=>Number.isFinite(event)&&Number.isFinite(reference)&&event<=reference&&(expiry==null||Number.isFinite(expiry)&&expiry>reference);
 const history=record=>ingest(record.event,record.attestation,record.expiry);
 const live=(record,now)=>history(record)&&(record.expiry==null||record.expiry>now);
 const record=Object.freeze({event:1000,attestation:1005.338,expiry:2000});
 assert.equal(ingest(1001,1000,2000),false);
 assert.equal(history(record),true);
 assert.equal(live(record,1000),true); // later reference is below original attestation
 assert.equal(live(record,2000),false);
 assert.equal(history(record),true); // original validity remains after expiry
 assert.equal(ingest(Infinity,1000,2000),false);
 assert.equal(history({...record,event:1010}),false);
});
test('exact forward replacement list names existing functions and only one new guard',()=>{
 assert.equal(new Set(externalModel.replacementFunctions).size,32);
 for(const name of externalModel.replacementFunctions){const [schema,base]=name.split('.');assert.equal(catalog.functions.filter(f=>f.schema===schema&&f.name===base).length,1,name);}
 assert.equal(externalModel.newFunction,'private.protect_alignment_face_attempt_ordinal');
 assert.equal(externalModel.face.sequenceCache,1);
 assert.equal(externalModel.face.replayAllocates,false);
});
test('route claim completion chronology is metadata not lease or token authority',()=>{
 const check=catalog.constraints.find(c=>c.name==='offering_route_generation_claims_check2');
 assert.match(check.definition,/completed_at >= claimed_at/);
 assert.match(fn('record_claimed_offering_route_evidence_for_server').body,/v_claim\.lease_expires_at <= v_now/);
 assert.match(fn('protect_offering_route_generation_claim').body,/Completed route generation claim is immutable/);
 assert.ok(externalModel.constraintChanges.includes('private.offering_route_generation_claims.offering_route_generation_claims_check2'));
});
