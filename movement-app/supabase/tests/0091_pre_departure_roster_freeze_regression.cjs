'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),assert=require('node:assert/strict');
const harness=require('./0091_pre_departure_roster_freeze_harness.cjs'),output=path.join(os.tmpdir(),'movement-0091-validation');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\r\n/g,'\n');
const state=`INSERT INTO private.trusted_location_state_evidence(resolution_evidence_id,resolved_location_reference_id,provider_namespace,state_provider_reference,state_name,state_key,recorded_at) SELECT e.id,e.resolved_location_reference_id,l.provider_namespace,'region-lagos','Lagos',private.canonical_nigerian_state_key('Lagos'),clock_timestamp() FROM private.movement_location_resolution_evidence e JOIN private.movement_location_references l ON l.id=e.resolved_location_reference_id WHERE NOT EXISTS(SELECT 1 FROM private.trusted_location_state_evidence s WHERE s.resolution_evidence_id=e.id);`;
const counts={};
function loaded(name,source,extra={}){
 const file=path.join(__dirname,name),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
 m.require=n=>{
  if(n==='node:fs'||n==='fs')return {...fs,readFileSync(file,...args){
   const base=path.basename(String(file));if(['0048_offerer_interest_inbox_test.sql','0049_interest_authorized_offer_continuation_test.sql'].includes(base))return sourceSuite(base.replace('_test.sql',''),base.startsWith('0048')?'inbox':'interest');
   return fs.readFileSync(file,...args);
  },writeFileSync(file,...args){fs.mkdirSync(output,{recursive:true});return fs.writeFileSync(path.join(output,path.basename(String(file))),...args);}};
  if(extra[n])return extra[n];
  if(/^\.\/00(?:8[5-9]|90)_.*harness\.cjs$/.test(n))return {...harness,run:(callback,{beforeInstall}={})=>harness.run(async c=>{if(beforeInstall)await beforeInstall(c);await callback(c);})};
  return require(n.startsWith('.')?path.resolve(__dirname,n):n);
 };m._compile(source||read(name),file);return m.exports;
}
function sourceSuite(name,prefix){
 let sql=read(name+'_test.sql');
 sql=sql.replace(/FROM public\.record_attested_location_resolution_for_server\([^]*?\) x;/g,m=>m+'\n'+state);
 // Preserve every test. New unavailable fixtures now have genuine accepted
 // graph/start provenance rather than bypassing the stronger table protection.
 sql=sql.replace(/WHEN 'unavailable' THEN\s*UPDATE private\.offering_movement_availability\s+SET status\s*=\s*'unavailable'\s+WHERE id\s*=\s*([^;]+);/g,"WHEN 'unavailable' THEN PERFORM pg_temp.freeze_roster_parent($1);");
 if(name.startsWith('0045')){
  const begin=sql.indexOf('      INSERT INTO private.movement_location_references('),marker=' RETURNING id INTO location_id;',end=sql.indexOf(marker,begin)+marker.length;assert(begin>0&&end>begin);
  const endpoint=`      SELECT x.resolved_location_reference_id INTO location_id FROM public.record_attested_location_resolution_for_server(
   loc.member_id,(SELECT x.location_reference_id FROM public.record_verified_selected_location_for_server(loc.member_id,gen_random_uuid(),loc.area,'test-provider','0042-'||label||'-'||loc.kind,'selection_proof_v1',t-interval '1 minute',t+interval '4 hours') x),
   gen_random_uuid(),'test-provider','geocode','test-resolution-v1','0042-'||label||'-'||loc.kind,'resolution_v1',loc.area,'region-lagos','Lagos',loc.lat,loc.lon,clock_timestamp(),NULL) x;`;
  sql=sql.slice(0,begin)+endpoint+sql.slice(end);
 }
 // Older producer overloads deliberately lack state claims. Supplement only
 // those fixtures before their match/context call, retaining all live guards.
 if(/00(?:47|48|49)/.test(name)){
  const marker='  SELECT version INTO STRICT v_version FROM private.offering_route_evidence WHERE id=p_route;';assert(sql.includes(marker),name);sql=sql.replace(marker,state+'\n'+marker);
 }
 if(name.startsWith('0046')){
  const marker='DO $test$';assert(sql.includes(marker));sql=sql.replace(marker,state+'\n'+marker);
 }
 sql=sql.replace(/^BEGIN;/,'BEGIN;\n'+read('0091_roster_regression_support.sql'));
 sql=sql.replace(/ROLLBACK;\s*$/,`SELECT 'COUNT='||count(*) FROM pg_temp.${prefix}_results; ROLLBACK;`);
 return sql;
}
async function admission(){await harness.run(async c=>{
 for(const [name,prefix] of [
  ['0044_offering_movement_availability_foundation','availability'],['0045_movement_offer_availability_capacity','capacity'],
  ['0046_requester_availability_matching_context','requester_availability_matching'],['0047_requester_movement_interest_foundation','interest'],
  ['0048_offerer_interest_inbox','inbox'],['0049_interest_authorized_offer_continuation','interest'],
  ['0054_offerer_open_availability_recovery','recovery'],['0055_offerer_alignment_continuation_recovery','offerer_continuation'],['0056_active_movement_coordination_recovery','active_recovery']
 ]){const text=c.target(sourceSuite(name,prefix));assert.doesNotMatch(text,/\|f(?:\||$)/m);counts[name]=Number(text.match(/COUNT=(\d+)/)[1]);console.log('PASS '+counts[name]+' composed '+name+' assertions');}
 });}
async function priority(){for(const name of ['0089_trusted_movement_priority_behavior.cjs','0089_trusted_movement_priority_concurrency.cjs','0089_trusted_movement_priority_regression.cjs','0090_trusted_requester_priority_behavior.cjs','0090_trusted_requester_priority_concurrency.cjs']){await loaded(name).main();console.log('PASS unchanged '+name+' against 0091');}}
async function finance(){
 // Reuse the documented 0088 R-at-activation / C,O-at-completion expectation
 // adaptations. No SQL assertions or economic implementation are removed.
 const policy=loaded('0088_funded_activation_fee_regression.cjs',read('0088_funded_activation_fee_regression.cjs')+'\nmodule.exports={adapted,completion};');
 for(const name of ['0087_funded_completion_behavior.cjs','0087_funded_completion_temporal.cjs','0087_funded_completion_concurrency.cjs','0086_funded_dispute_behavior.cjs','0086_funded_dispute_temporal.cjs','0086_funded_dispute_concurrency.cjs','0085_funded_no_travel_regression.cjs']){
  await loaded(name,policy.adapted(name),{'./0087_funded_completion_test_support.cjs':require('./0088_funded_activation_fee_test_support.cjs'),'./0082_financial_movement_completion_behavior.cjs':policy.completion}).main();console.log('PASS '+name+' with documented current-policy expectations against 0091');
 }
}
async function foundation(){await harness.run(async c=>{
 const full=require('./0082_financial_movement_completion_behavior.cjs').fixtures(false).replace(/\r\n/g,'\n');
 for(const [id,name,cut,marker] of [
  [74,'0074_trusted_financial_proposal_issuer','-- Requires the reviewed 0074 normal-producer fixture prefix','-- ISSUER_0074_TESTS:'],
  [76,'0076_financial_proposal_offerer_consent','CREATE FUNCTION pg_temp.requester_accept','DO $tests$'],
  [77,'0077_financial_proposal_requester_materialization','CREATE FUNCTION pg_temp.hold_result','DO $tests$'],
  [78,'0078_requester_movement_funding_hold','CREATE FUNCTION pg_temp.activation_result','-- FUNDING_0078_TESTS:']
 ]){
  const end=full.indexOf(cut);assert(end>0,name+' fixture cutoff');let setup=full.slice(0,end),live=read(name+'_test.sql');const start=live.indexOf(marker);assert(start>0);
  if(id===78){
   setup=full;
   const begin=setup.indexOf('CREATE FUNCTION pg_temp.advance_funding_lifecycle('),finish=setup.indexOf('END $$;',begin)+'END $$;'.length;assert(begin>0&&finish>begin);
   const advance=`CREATE FUNCTION pg_temp.advance_funding_lifecycle(p_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; a uuid; r jsonb; BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT alignment_id INTO STRICT a FROM private.financial_agreements WHERE id=(SELECT agreement FROM pg_temp.funding_fixture);
 PERFORM pg_temp.prepare_activation_faces();
 PERFORM pg_temp.funding_succeed(pg_temp.activation_result());
 IF p_state<>'activated' THEN
  PERFORM pg_temp.funding_succeed(pg_temp.coordination_result());
  IF p_state='held_review_required' THEN
   PERFORM pg_temp.funding_succeed(pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.request_my_movement_end(%L)',f.need)));
   PERFORM pg_temp.funding_succeed(pg_temp.coordination_as(f.requester,format('SELECT * FROM public.confirm_my_movement_end(%L)',f.need)));
  ELSE
   PERFORM pg_temp.funding_succeed(pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''0078 current-policy fixture'',NULL)',f.need)));
   PERFORM pg_temp.funding_succeed(pg_temp.start_result());
   PERFORM pg_temp.funding_succeed(pg_temp.start_result(true));
   IF p_state='completed' THEN
    PERFORM pg_temp.funding_succeed(pg_temp.completion_result());
    PERFORM pg_temp.funding_succeed(pg_temp.completion_result(true));
   END IF;
  END IF;
 END IF;
 IF p_state='held_review_required' THEN
  IF NOT EXISTS(SELECT 1 FROM private.funded_no_travel_holds WHERE alignment_id=a) OR (SELECT status FROM public.alignments WHERE id=a)<>'activated' THEN RAISE EXCEPTION 'Expected genuine held-review graph'; END IF;
 ELSIF (SELECT status FROM public.alignments WHERE id=a) IS DISTINCT FROM p_state THEN RAISE EXCEPTION 'Expected genuine current funded lifecycle %',p_state; END IF;
END $$;`;
   setup=setup.slice(0,begin)+advance+setup.slice(finish);
   // 0088 deliberately replaced new financial cancellation/refund with held
   // review. Keep the no-write exact funding-receipt replay assertion intact.
   live=live.replaceAll("advance_funding_lifecycle(''cancelled'')","advance_funding_lifecycle(''held_review_required'')").replace('historical cancelled replay independently succeeds no writes','held-review replay independently succeeds no writes');
  }
  const text=c.target(setup+live.slice(start));assert.doesNotMatch(text,/\|f(?:\||$)/m);counts[name]=text.split('\n').filter(l=>/\|t\|/.test(l)).length;console.log('PASS '+counts[name]+' composed '+id+' assertions');
 }
 });}
async function start(){await harness.run(async c=>{
 const fixtures=require('./0082_financial_movement_completion_behavior.cjs').fixtures;
 for(const zero of [false,true]){
  let full=fixtures(zero).replace(/\r\n/g,'\n'),end=full.indexOf('CREATE FUNCTION pg_temp.completion_result');assert(end>0);let setup=full.slice(0,end);
  // Retain an all-table fingerprint. Mask ONLY the initiating parent status /
  // updated_at and its new receipt; remaining places and every sibling row
  // still participate. The 0091 behavior suite checks those exact allowed rows.
  const begin=setup.indexOf('CREATE FUNCTION pg_temp.start_other_sources()'),finish=setup.indexOf('END $$;',begin)+'END $$;'.length;assert(begin>0&&finish>begin);
  const old=setup.slice(begin,finish),exec="  EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',r.nspname,r.relname) INTO h;";assert(old.includes(exec));
  const adapted=old.replace(exec,`  IF (r.nspname,r.relname)=('private','offering_movement_availability') THEN
   SELECT md5(coalesce(string_agg((CASE WHEN t.id=(SELECT availability FROM pg_temp.snapshot_fixture) THEN to_jsonb(t)-'status'-'updated_at' ELSE to_jsonb(t) END)::text,'' ORDER BY t.id),'')) INTO h FROM private.offering_movement_availability t;
  ELSIF (r.nspname,r.relname)=('private','offering_movement_roster_freezes') THEN
   SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY t.availability_id),'')) INTO h FROM private.offering_movement_roster_freezes t WHERE t.availability_id<>(SELECT availability FROM pg_temp.snapshot_fixture);
  ELSE
${exec}
  END IF;`);
  setup=setup.slice(0,begin)+adapted+setup.slice(finish);
  const live=read('0081_financial_movement_start_test.sql'),text=c.target(setup+live.slice(live.indexOf('-- START_0081_TESTS:')));assert.doesNotMatch(text,/\|f(?:\||$)/m);const count=text.split('\n').filter(l=>/\|t\|/.test(l)).length;counts['0081_zero_'+zero]=count;console.log('PASS '+count+' composed 0081 zero='+zero+' assertions');
 }
 });}
async function activation(){
 let source=read('0088_funded_activation_fee_behavior.cjs'),begin=source.indexOf(' check(h.state(),legacyState'),end=source.indexOf(' for(const zero of [false,true])');assert(begin>0&&end>begin);
 source=source.slice(0,begin)+source.slice(end);
 const hook=source.indexOf(' },{beforeInstall(c)');assert(hook>0);const tail=source.indexOf('if(require.main',hook);source=source.slice(0,hook)+' });}\n'+source.slice(tail);
 await loaded('0088_funded_activation_fee_behavior.cjs',source).main();console.log('PASS all 0088 current-policy behavior/security assertions; historical upgrade-only cases remain in original suite');
 await loaded('0088_funded_activation_fee_concurrency.cjs').main();
}
async function stateBound(){await harness.run(async c=>{
 let sql=read('0050_state_bound_movement_matching_test.sql');const begin=sql.indexOf('CREATE FUNCTION pg_temp.make_state_endpoint('),end=sql.indexOf('$endpoint$;',begin)+'$endpoint$;'.length;assert(begin>0&&end>begin);
 const endpoint=`CREATE FUNCTION pg_temp.make_state_endpoint(p_owner_member_id uuid,p_label text,p_provider_place_reference text,p_latitude numeric,p_longitude numeric,p_state_provider_reference text,p_state_name text)
RETURNS uuid LANGUAGE plpgsql AS $endpoint$
DECLARE source uuid; target uuid; anchor timestamptz:=clock_timestamp(); BEGIN
 SELECT x.location_reference_id INTO source FROM public.record_verified_selected_location_for_server(p_owner_member_id,gen_random_uuid(),p_label,'test-provider',p_provider_place_reference,'selection_proof_v1',anchor-interval '1 minute',anchor+interval '4 hours') x;
 SELECT x.resolved_location_reference_id INTO target FROM public.record_attested_location_resolution_for_server(p_owner_member_id,source,gen_random_uuid(),'test-provider','test-geocoder','v1',p_provider_place_reference,'test-resolution-v1',p_label,p_state_provider_reference,p_state_name,p_latitude,p_longitude,clock_timestamp(),NULL) x;
 RETURN target; END; $endpoint$;`;
 sql=sql.slice(0,begin)+endpoint+sql.slice(end);sql=sql.replace(/ROLLBACK;\s*$/,"SELECT 'COUNT='||count(*) FROM pg_temp.state_bound_results; ROLLBACK;");const text=c.target(sql);assert.doesNotMatch(text,/\|f(?:\||$)/m);counts['0050_state_bound']=Number(text.match(/COUNT=(\d+)/)[1]);console.log('PASS '+counts['0050_state_bound']+' original state-bound assertions with current trusted endpoint producers');
 });}
async function main(){const group=process.argv[2]||'admission';assert(['admission','priority','finance','foundation','start','activation','state'].includes(group));await ({admission,priority,finance,foundation,start,activation,state:stateBound}[group])();console.log(JSON.stringify({group,counts}));}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main,loaded,sourceSuite};
