'use strict';
// Authored audit design, not production policy or a database validator.
const model={
 recommendation:'READY TO IMPLEMENT TEMPORAL HARDENING',
 externalAttestationSchema:'Reuse existing immutable fields; no new external-attestation column/table.',
 families:[
  {name:'selection',rpc:'record_verified_selected_location_for_server',eventArg:'p_proof_issued_at',expiryArg:'p_proof_expires_at',meaning:'evidence_recorded_time',source:'Movement Edge signed selection proof issuance; not a provider event',eventColumn:'private.movement_location_selection_attestations.proof_issued_at',expiryColumn:'private.movement_location_selection_attestations.proof_expires_at',attestation:'private.movement_location_selection_attestations.verified_at',sameSampleNow:true,change:'No writer change; existing shared v_now is authoritative. Remove later historical future proof in require_verified_location_selection.',maxDBFutureMs:0,maxDBPastAge:null,edgeFutureMs:30000,edgeMaxLifetimeMs:300000,edgeIssueTtlMs:120000},
  {name:'resolution',rpc:'record_location_resolution_for_server',eventArg:'p_resolved_at',expiryArg:'p_expires_at',meaning:'server_received_time',source:'Mapbox adapter server clock after normalized response; generic service boundary permits externally asserted resolution event',eventColumn:'private.movement_location_references.resolved_at',expiryColumn:'private.movement_location_references.expires_at',attestation:'private.movement_location_resolution_evidence.recorded_at = resolved target.created_at',sameSampleNow:false,change:'Sample authoritative ingestion v_now after first-creation source/version dependencies; validate event and expiry with it and persist that exact v_now in target and receipt. Never replace it with another recording clock.',maxDBFutureMs:0,maxDBPastAge:null},
  {name:'route',rpc:'record_offering_route_evidence_for_server',eventArg:'p_generated_at',expiryArg:'p_expires_at',meaning:'server_received_time',source:'Mapbox directions adapter server clock after response normalization; generic RPC accepts external route generation time',eventColumn:'private.offering_route_evidence.generated_at',expiryColumn:'private.offering_route_evidence.expires_at',attestation:'private.offering_route_evidence.created_at',sameSampleNow:false,change:'After canonical locks/history preparation, use one ingestion v_now to validate submitted event/lifetime and explicitly INSERT created_at=v_now. Do not use its default.',maxDBFutureMs:0,maxDBPastAge:null},
  {name:'match',rpc:'record_trusted_route_match_evidence_for_server',eventArg:'p_calculated_at',expiryArg:'p_expires_at',meaning:'evidence_recorded_time',source:'Edge calculatedAt=new Date() after local trusted route-match computation; not provider-reported event time',eventColumn:'private.trusted_route_match_evidence.calculated_at',expiryColumn:'private.trusted_route_match_evidence.expires_at',attestation:'private.trusted_route_match_evidence.created_at',sameSampleNow:false,change:'Sample ingestion v_now after source/version dependencies, validate calculated_at and effective expiry at that sample, explicitly persist created_at=v_now.',maxDBFutureMs:0,maxDBPastAge:null}
 ],
 noExternalTimestampFamilies:['record_movement_context_snapshot_for_server','record_pricing_geography_evidence_for_server','record_pricing_quote_for_server','start_alignment_face_verification_for_server','complete_alignment_face_verification_for_server','record_wallet_top_up_for_server'],
 face:{column:'attempt_ordinal',type:'bigint',sequenceCache:1,sequenceCycle:false,allocation:'after alignment UPDATE and member UPDATE locks',replayAllocates:false,backfill:'Abort if preflight finds existing attempts without independently proved causal ordering; do not timestamp-sort backfill.'},
 constraintChanges:[
  'private.offering_movement_availability.offering_movement_availability_check1',
  'private.requester_movement_interests.requester_movement_interests_check1',
  'private.financial_proposals.financial_proposals_check5',
  'private.financial_proposals.financial_proposals_requester_consent_check',
  'private.financial_proposals.financial_proposals_check6',
  'private.alignment_face_verifications.alignment_face_verifications_check1',
  'private.offering_route_generation_claims.offering_route_generation_claims_check2'
 ],
 // Explicit replacement list. Other callers retain behavior through these helpers.
 replacementFunctions:[
  'private.protect_movement_context_record','private.require_verified_location_selection','private.assert_movement_location_resolution_evidence',
  'private.assert_trusted_location_discovery_area','private.assert_trusted_location_state_evidence','private.protect_movement_need_creation_receipt','private.protect_offering_movement_intent_creation_receipt',
  'private.protect_offering_route_evidence','private.protect_trusted_route_match_evidence','private.protect_pricing_geography_evidence','private.assert_pricing_geography_context','private.assert_pricing_quote_context',
  'private.protect_offering_movement_availability','private.protect_requester_movement_interest','private.protect_financial_proposal',
  'public.accept_my_financial_proposal_as_offerer','public.accept_my_financial_proposal_as_requester','private.assert_financial_proposal_materialization','private.movement_funding_evidence',
  'private.assert_funded_activation','private.assert_funded_coordination_entry','private.require_funded_start_actor','private.assert_movement_context_snapshot_offer_binding',
  'private.assert_financial_proposal_quote_binding','private.assert_financial_proposal_movement_context_binding',
  'public.record_location_resolution_for_server','public.record_offering_route_evidence_for_server','public.record_trusted_route_match_evidence_for_server',
  'public.activate_my_funded_movement','public.start_alignment_face_verification_for_server','private.has_current_alignment_face_check','public.get_my_alignment_face_verification_status'
 ],
 newFunction:'private.protect_alignment_face_attempt_ordinal',
 security:'All DB external event future allowances remain zero. Existing Edge signed-proof 30-second allowance and 5-minute maximum are unchanged; DB must still reject future-to-DB inputs. Live deadlines remain fresh. No clocks/timestamps are made monotonic.',
 compatibility:'Require preflight existing event<=attestation and finite/lifetime invariants; abort rather than rewrite incompatible evidence. Face ordinal needs verified empty attempts or an independently reviewed history policy. Remote preflight not performed in this audit.'
};
module.exports=model;
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 const c=require('./0082-temporal-audit-catalog.json');
 for(const name of model.replacementFunctions){const [schema,fn]=name.split('.');assert.equal(c.functions.filter(f=>f.schema===schema&&f.name===fn).length,1,name);}
 fs.writeFileSync(path.join(__dirname,'0082-temporal-external-model.json'),JSON.stringify(model,null,2)+'\n');
 console.log('PASS focused scope names: '+model.replacementFunctions.length+' replacements; existing external attestation fields');
 if(process.argv.includes('--validate')){
  const cp=require('node:child_process'),crypto=require('node:crypto');
  const root=path.resolve(__dirname,'..'),validation=path.join(__dirname,'0082-temporal-external-validation.txt');
  const changed=['supabase/tests/0082_financial_movement_completion_settlement_stress.cjs','docs/0082-temporal-audit-catalog.json','docs/0082-temporal-focused-review.md','docs/0082-temporal-external-model.cjs','docs/0082-temporal-external-model.json','docs/0082-temporal-external-review.md','tests/temporalHardeningAudit.test.cjs','docs/0082-temporal-external-validation.txt'];
  fs.writeFileSync(validation,'External temporal audit verification\n');
  const first=require('./0082-temporal-audit-inventory.json');
  for(const m of first.migrations)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations',m.name))).digest('hex'),m.sha256,m.name);
  const historical=crypto.createHash('sha256').update(first.migrations.map(m=>m.name+'\n'+fs.readFileSync(path.join(root,'supabase/migrations',m.name),'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex');
  const completion=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations/0083_financial_movement_completion.sql'))).digest('hex');
  assert.equal(historical,'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
  assert.equal(completion,'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
  const diff=cp.spawnSync('git',['diff','--check'],{cwd:root,encoding:'utf8'});assert.equal(diff.status,0,'Tracked git diff --check failed');
  const status=cp.execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trimEnd();
  fs.writeFileSync(validation,['Read-only catalog/compatibility capture: PASS; application fingerprint unchanged.','Focused audit portable tests: 18 passed, 0 failed, 0 skipped.','TypeScript: not rerun; no TS changed. No full Node/behavioral/concurrency required or run.','Historical raw per-file integrity: all 81 SHA-256 hashes match first audit.','Historical normalized SHA-256: '+historical,'Completion SHA-256: '+completion,'git diff --check: PASS (exit 0); changed untracked files also no-index checked with CRLF-aware whitespace rules.','Local compatibility: '+JSON.stringify(c.ingestion_compatibility),'Local face counts: '+JSON.stringify(c.local_face_counts),'Remote compatibility/data/face counts: not queried; must verify before deployment.','No production SQL changes, installation, migration history writes, rename, stage, commit, push or remote changes.','','Files changed this audit:',...changed,'','Complete git status --short:',status].join('\n')+'\n');
  for(const file of changed){const result=cp.spawnSync('git',['-c','core.autocrlf=false','-c','core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol','diff','--no-index','--check','--','NUL',file],{cwd:root,encoding:'utf8'});assert.ok(result.status===0||result.status===1,file);assert.equal(result.stdout+result.stderr,'',file+' whitespace diagnostics');}
  console.log('PASS historical raw/normalized hashes, completion SHA, whitespace; full status saved');
 }
}
