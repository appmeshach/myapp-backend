'use strict';
// Development-only source builder. Exact replacements fail closed on audit drift.
const fs=require('node:fs'),assert=require('node:assert/strict');
const catalog=require('./0082-temporal-audit-catalog.json');
const model=require('./0082-temporal-external-model.json');
const definitions=new Map(model.replacementFunctions.map(n=>[n,catalog.functions.find(f=>f.schema+'.'+f.name===n).definition.replace(/\r\n/g,'\n')]));
function edit(n,from,to){const s=definitions.get(n);assert(s.includes(from),n+' missing '+from);definitions.set(n,s.replaceAll(from,to));}
function remove(n,from){edit(n,from,'');}
edit('private.protect_movement_context_record','NEW.created_at>clock_timestamp() OR ','NOT isfinite(NEW.created_at) OR ');
edit('private.protect_movement_context_record','NEW.resolved_at>clock_timestamp()','NEW.resolved_at IS NOT NULL AND (NOT isfinite(NEW.resolved_at) OR NEW.resolved_at>NEW.created_at)');
remove('private.require_verified_location_selection','a.verified_at>clock_timestamp() OR ');
remove('private.assert_movement_location_resolution_evidence',' OR e.recorded_at>v_now');
for(const [n,a] of [['assert_trusted_location_discovery_area','d'],['assert_trusted_location_state_evidence','s']]) {
 remove('private.'+n,`    OR ${a}.recorded_at < e.recorded_at\n`);
 remove('private.'+n,`    OR ${a}.recorded_at > clock_timestamp()\n`);
}
for(const n of ['protect_movement_need_creation_receipt','protect_offering_movement_intent_creation_receipt']) edit('private.'+n,'NEW.recorded_at > clock_timestamp()','NOT isfinite(NEW.recorded_at)');
for(const [n,event] of [['protect_offering_route_evidence','generated_at'],['protect_trusted_route_match_evidence','calculated_at']]) {
 edit('private.'+n,'NEW.created_at > clock_timestamp()','NOT isfinite(NEW.created_at)');
 edit('private.'+n,`NEW.${event} > clock_timestamp()`,`NOT isfinite(NEW.${event}) OR NEW.${event} > NEW.created_at`);
}
edit('private.protect_pricing_geography_evidence','NEW.created_at>clock_timestamp()','NOT isfinite(NEW.created_at)');
edit('private.assert_pricing_geography_context','p.generated_at<m.calculated_at OR p.generated_at>clock_timestamp()','p.generated_at IS DISTINCT FROM p.created_at');
remove('private.assert_pricing_quote_context','    OR p.created_at<e.created_at OR p.created_at>clock_timestamp()\n');
for(const n of ['protect_offering_movement_availability','protect_requester_movement_interest']) edit('private.'+n,'NEW.created_at>clock_timestamp()','NOT isfinite(NEW.created_at)');
edit('private.protect_financial_proposal','NEW.created_at > clock_timestamp()','NOT isfinite(NEW.created_at)');
edit('private.protect_financial_proposal',`NEW.offering_accepted_at>clock_timestamp() OR NEW.requester_accepted_at>clock_timestamp()
      OR NEW.materialized_at>clock_timestamp()`,`(NEW.offering_accepted_at IS NOT NULL AND NOT isfinite(NEW.offering_accepted_at))
      OR (NEW.requester_accepted_at IS NOT NULL AND NOT isfinite(NEW.requester_accepted_at))
      OR (NEW.materialized_at IS NOT NULL AND NOT isfinite(NEW.materialized_at))`);
for(const n of ['public.accept_my_financial_proposal_as_offerer','public.accept_my_financial_proposal_as_requester']) {
 remove(n,' OR p.created_at>clock_timestamp()');
}
remove('public.accept_my_financial_proposal_as_offerer','accepted_at<p.created_at OR ');
remove('public.accept_my_financial_proposal_as_offerer',' OR p.offering_accepted_at<p.created_at');
remove('public.accept_my_financial_proposal_as_offerer',' OR p.offering_accepted_at>accepted_at');
remove('public.accept_my_financial_proposal_as_requester','    OR p.offering_accepted_at<p.created_at OR p.offering_accepted_at>clock_timestamp()\n');
remove('public.accept_my_financial_proposal_as_requester','accepted_at<p.offering_accepted_at OR ');
remove('public.accept_my_financial_proposal_as_requester','completed_at<accepted_at OR ');
remove('private.assert_financial_proposal_materialization','    OR p.offering_accepted_at<p.created_at OR p.requester_accepted_at<p.offering_accepted_at\n');
remove('private.assert_financial_proposal_materialization',' OR p.materialized_at<p.requester_accepted_at');
remove('private.assert_financial_proposal_materialization',' OR p.materialized_at>clock_timestamp()');
// All three historical action stamps must remain finite and within their original deadline.
edit('private.assert_financial_proposal_materialization','OR p.requester_accepted_at>=p.expires_at','OR p.offering_accepted_at>=p.expires_at OR p.requester_accepted_at>=p.expires_at');
remove('private.movement_funding_evidence',' OR t.created_at<g.requester_accepted_at OR t.created_at>clock_timestamp()');
edit('private.movement_funding_evidence','receipt.fully_held_at<g.requester_accepted_at OR receipt.fully_held_at>clock_timestamp()','NOT isfinite(receipt.fully_held_at)');
edit('private.assert_funded_activation','evidence.fully_held_at>receipt.activated_at OR receipt.activated_at>clock_timestamp()','NOT isfinite(receipt.activated_at)');
remove('private.assert_funded_activation',' OR f.completed_at<f.started_at OR f.completed_at>receipt.activated_at');
edit('private.assert_funded_activation',`OR f.expires_at<=receipt.activated_at OR NOT isfinite(f.completed_at) OR NOT isfinite(f.expires_at)
   OR EXISTS(SELECT 1 FROM private.alignment_face_verifications newer WHERE newer.alignment_id=a.id AND newer.member_id=x.member_id
    AND newer.started_at<=receipt.activated_at AND ROW(newer.started_at,newer.id)>ROW(f.started_at,f.id)))`,`OR f.completed_at>=f.expires_at OR f.expires_at<=receipt.activated_at
   OR NOT isfinite(f.started_at) OR NOT isfinite(f.completed_at) OR NOT isfinite(f.expires_at)
   OR f.attempt_ordinal IS NULL OR f.attempt_ordinal<=0)`);
edit('private.assert_funded_coordination_entry',' OR r.created_at<a.activated_at OR r.created_at>clock_timestamp()',' OR NOT isfinite(r.created_at)');
edit('private.assert_funded_coordination_entry','request.requested_at<r.created_at OR request.requested_at>clock_timestamp()','NOT isfinite(request.requested_at)');
edit('private.assert_funded_coordination_entry','started.started_at<request.requested_at OR started.started_at>clock_timestamp()','NOT isfinite(started.started_at)');
edit('private.require_funded_start_actor','NEW.requested_at<j.created_at OR NEW.requested_at>clock_timestamp()','NOT isfinite(NEW.requested_at)');
edit('private.require_funded_start_actor','NEW.started_at<request.requested_at OR NEW.started_at>clock_timestamp()','NOT isfinite(NEW.started_at)');
edit('private.assert_movement_context_snapshot_offer_binding','IF p.created_at < o.created_at\n    OR p.expires_at IS NULL','IF p.expires_at IS NULL');
remove('private.assert_financial_proposal_quote_binding',' OR p.created_at<q.created_at');
remove('private.assert_financial_proposal_movement_context_binding',' OR p.created_at<s.created_at');
// Ingestion: retain preliminary checks/replay; final admission uses one persisted sample.
const loc='public.record_location_resolution_for_server';
edit(loc,'  v_now timestamptz;','  v_now timestamptz;\n  v_attested_at timestamptz;');
edit(loc,`  v_now := clock_timestamp();
  -- PostgreSQL LEAST`,`  v_attested_at := clock_timestamp();
  IF NOT isfinite(p_resolved_at) OR p_resolved_at<v_source.created_at OR p_resolved_at>v_attested_at
    OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_attested_at)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution timestamps are invalid';
  END IF;
  -- PostgreSQL LEAST`);
edit(loc,'v_expiry<=v_now','v_expiry<=v_attested_at');
edit(loc,'p_resolution_version,p_resolved_at,v_now,v_expiry','p_resolution_version,p_resolved_at,v_attested_at,v_expiry');
edit(loc,"'movement_location_resolution_v1',p_expires_at,v_now","'movement_location_resolution_v1',p_expires_at,v_attested_at");
const route='public.record_offering_route_evidence_for_server';
edit(route,'  v_now timestamptz;','  v_now timestamptz;\n  v_attested_at timestamptz;');
edit(route,'  INSERT INTO private.offering_route_evidence(',`  v_attested_at := clock_timestamp();
  IF NOT isfinite(p_generated_at) OR p_generated_at>v_attested_at
    OR p_generated_at<v_intent.created_at OR p_generated_at<v_origin.resolved_at OR p_generated_at<v_destination.resolved_at
    OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_attested_at))
    OR (v_effective_expires_at IS NOT NULL AND v_effective_expires_at<=v_attested_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence attestation time is invalid';
  END IF;
  INSERT INTO private.offering_route_evidence(`);
edit(route,'    generated_at, expires_at, status','    generated_at, expires_at, status, created_at');
edit(route,"    p_generated_at, v_effective_expires_at, 'current'","    p_generated_at, v_effective_expires_at, 'current', v_attested_at");
const match='public.record_trusted_route_match_evidence_for_server';
edit(match,'  v_now timestamptz;','  v_now timestamptz;\n  v_attested_at timestamptz;');
edit(match,'  INSERT INTO private.trusted_route_match_evidence (',`  v_attested_at := clock_timestamp();
  IF NOT isfinite(p_calculated_at) OR p_calculated_at>v_attested_at OR p_calculated_at<v_context.route_generated_at
    OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_attested_at))
    OR (v_effective_expires_at IS NOT NULL AND v_effective_expires_at<=v_attested_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route-match attestation time is invalid';
  END IF;
  INSERT INTO private.trusted_route_match_evidence (`);
edit(match,'    expires_at,\n    status\n  )','    expires_at,\n    status,\n    created_at\n  )');
edit(match,"    v_effective_expires_at,\n    'current'\n  )","    v_effective_expires_at,\n    'current',\n    v_attested_at\n  )");
remove('public.activate_my_funded_movement','evidence.fully_held_at>stamp OR ');
edit('public.activate_my_funded_movement','ORDER BY f.started_at DESC,f.id DESC','ORDER BY f.attempt_ordinal DESC');
edit('private.has_current_alignment_face_check','ORDER BY latest.started_at DESC,latest.id DESC','ORDER BY latest.attempt_ordinal DESC');
edit('private.has_current_alignment_face_check','f.completed_at<=p_at','f.completed_at IS NOT NULL AND isfinite(f.started_at) AND isfinite(f.completed_at) AND isfinite(f.expires_at) AND f.completed_at<f.expires_at');
edit('public.get_my_alignment_face_verification_status','ORDER BY s.started_at DESC,s.id DESC','ORDER BY s.attempt_ordinal DESC');
edit('public.start_alignment_face_verification_for_server','provider_reference,started_at,expires_at)','provider_reference,started_at,expires_at,attempt_ordinal)');
edit('public.start_alignment_face_verification_for_server',"v_now,v_now+interval '10 minutes')","v_now,v_now+interval '10 minutes',nextval('private.alignment_face_attempt_ordinal_seq'::regclass))");
const prefix=fs.readFileSync('docs/0082-temporal-schema.sql','utf8');
fs.writeFileSync('supabase/migrations/0082_trusted_temporal_evidence_hardening.sql',prefix+'\n'+[...definitions].map(([n,s])=>'-- Audited replacement: '+n+'\n'+s.trimEnd().replace(/[ \t]+$/gm,'')+';\n').join('\n')+'\nCOMMIT;\n');
