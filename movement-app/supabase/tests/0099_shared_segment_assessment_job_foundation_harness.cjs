'use strict';
// Inert import; database mutations occur only in fingerprinted disposable clones.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=require('./0098_current_route_match_reuse_boundary_harness.cjs');
const previous=require('./0095_requester_deadline_matching_context_repair_harness.cjs');
const assessment=require('./0096_trusted_shared_segment_geographic_assessment_harness.cjs');
const {quote}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
const {emptyResult}=require('../functions/_shared/shared-segment-assessment-contracts.ts');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0099_shared_segment_assessment_job_foundation.sql');
async function run(callback){await base.run(async c=>{c.target(migration);verify(c);await callback(c);});}
function verify(c){
 for(const m of migration.matchAll(/CREATE FUNCTION ((?:public|private)\.\w+)\([^]*?AS \$\$([^]*?)\$\$;/g)){
  const v=JSON.parse(c.target(`SELECT json_build_object('body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname='${m[1]}';`));
  assert.equal(v.body.replace(/\r\n/g,'\n'),m[2],m[1]);assert.equal(v.owner,'postgres');assert(v.definer);assert.deepEqual(v.config,['search_path=""']);
  assert.deepEqual(v.acl,m[1].startsWith('public.')?['postgres=X/postgres','service_role=X/postgres']:['postgres=X/postgres']);
 }
 assert.equal(c.target("SELECT relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid) FROM pg_class c WHERE c.oid='private.shared_segment_assessment_jobs'::regclass;"),'t');
 console.log('PASS 0099 exact installed sources, owners, empty search_path, ACLs, RLS/no policies');
}
function fixture(c,{requesterReady=true,departure='1 hour'}={}){
 const schema='jobs0099_'+crypto.randomBytes(6).toString('hex');
 let setup=previous.fixtures().replace(/^BEGIN;/,'').replace('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;','').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
 const original=setup;setup=setup.replace(/'test_router',\s*'directions',\s*'v1',/,"'mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1',");assert.notEqual(setup,original);
 c.target('BEGIN; CREATE SCHEMA '+schema+'; '+setup+' COMMIT;');
 const f=JSON.parse(c.target(`SELECT json_build_object('schema','${schema}','need',n.movement_need_id,'requester',n.member_id,'intent',a.intent_id,'offerer',a.member_id,'offererRoute',a.route_id,'availability',a.availability_id) FROM ${schema}.interest_offering_fixture('0099-job',3,interval '${departure}') a CROSS JOIN ${schema}.interest_requester_fixture('0099-job',1) n;`));
 if(requesterReady){
  const refs=JSON.parse(c.target(`SELECT json_object_agg(role,location_reference_id) FROM private.movement_need_locations WHERE movement_need_id='${f.need}';`));
  const x={need:f.need,member:f.requester,origin:refs.origin,destination:refs.destination};
  const contract={namespace:'mapbox-directions-v5',product:'mapbox-directions',version:'v5-driving-geojson-full-v1'};
  const claim=JSON.parse(c.target(c.claim(x,contract)));
  f.requesterRoute=JSON.parse(c.target(c.publish(x,claim.generation_claim_token,contract))).route_evidence_id;
 }
 return f;
}
const register=f=>`SELECT public.register_requester_availability_assessment_job_for_server('${f.requester}','${f.need}','${f.availability}');`;
const claim=()=>`SELECT public.claim_shared_segment_assessment_job_for_server();`;
const load=j=>`SELECT public.load_shared_segment_assessment_job_context_for_server('${j.job_id}','${j.lease_token}');`;
const finalize=(j,ctx,result=null,recoveryOnly=false)=>`SELECT public.finalize_shared_segment_assessment_job_for_server('${j.job_id}','${j.lease_token}',${quote(JSON.stringify(ctx))}::jsonb,${result===null?'NULL':quote(JSON.stringify(result))+'::jsonb'},${recoveryOnly});`;
const fail=(j,category)=>`SELECT public.fail_shared_segment_assessment_job_for_server('${j.job_id}','${j.lease_token}',${quote(category)});`;
const get=(c,sql)=>JSON.parse(c.target(sql));
function backend(c){const trusted=sql=>get(c,'SET ROLE service_role; '+sql);return {claim:async()=>trusted(claim()),load:async(id,token)=>trusted(load({job_id:id,lease_token:token})),
 finalize:async(id,token,ctx,r,_signal,recoveryOnly)=>trusted(finalize({job_id:id,lease_token:token},ctx,r,recoveryOnly)),fail:async(id,token,category)=>trusted(fail({job_id:id,lease_token:token},category))};}
async function main(){let count=0;await run(async c=>{
 const check=(label,fn)=>{fn();count++;console.log('PASS '+label);};
 const sql=c.target(read('0099_shared_segment_assessment_job_foundation_test.sql'));assert.doesNotMatch(sql,/\|f(?:\||$)/m);console.log(sql);
 const f=fixture(c),registered=get(c,register(f));
 check('register selected canonical miss',()=>assert.equal(registered.state,'job_registered'));
 check('duplicate registration keeps one job and attempts',()=>{assert.deepEqual(get(c,register(f)),registered);assert.equal(c.target('SELECT count(*) FROM private.shared_segment_assessment_jobs;'),'1');});
 check('missing requester evidence creates no job',()=>{const x=fixture(c,{requesterReady:false});assert.equal(get(c,register(x)).state,'not_ready');assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_assessment_jobs WHERE movement_need_id='${x.need}';`),'0');});
 check('wrong requester denied',()=>assert.throws(()=>c.target(register({...f,requester:f.offerer})),/42501/));
 check('random selected availability denied',()=>assert.throws(()=>c.target(register({...f,availability:crypto.randomUUID()})),/P0001/));
 const job=get(c,claim()),loaded=get(c,load(job));
 check('claim one job with bounded initial lease',()=>{assert.equal(job.state,'claimed');assert.equal(job.attempt_count,1);assert.equal(c.target(`SELECT lease_expires_at-updated_at<=interval '60 seconds' FROM private.shared_segment_assessment_jobs WHERE id='${job.job_id}';`),'t');});
 check('live lease prevents second claim',()=>assert.equal(get(c,claim()).state,'idle'));
 check('claimed context supplies exact snapshot',()=>{assert.equal(loaded.state,'ready');assert.equal(loaded.snapshot.context.requester_evidence.id,f.requesterRoute);assert.equal(loaded.snapshot.context.offerer_evidence.id,f.offererRoute);});
 check('wrong token receives no geometry',()=>assert.deepEqual(get(c,load({...job,lease_token:crypto.randomUUID()})),{state:'lease_invalid'}));
 const result=assessSharedSegment(loaded.snapshot.offerer_shape,loaded.snapshot.requester_shape);
 const complete=get(c,finalize(job,loaded.snapshot.context,result));
 check('publication and job completion atomic',()=>{assert.equal(complete.state,'completed');assert.equal(c.target(`SELECT status FROM private.shared_segment_assessment_jobs WHERE id='${job.job_id}';`),'completed');});
 check('completed token cannot retrieve route geometry',()=>assert.deepEqual(get(c,load(job)),{state:'lease_invalid'}));
 check('recovery-only miss cannot publish',()=>{const x=fixture(c);get(c,register(x));const j=get(c,claim()),v=get(c,load(j));
  assert.equal(get(c,finalize(j,v.snapshot.context,result,true)).state,'not_found');
  assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'0');get(c,fail(j,'invalid_evidence'));
 });
 check('lost final response recovers exact assessment without compute',()=>assert.deepEqual(get(c,finalize(job,loaded.snapshot.context)),{...complete,publication_state:'reuse_existing'}));
 check('exact hit returns reuse and creates no job',()=>{const before=c.target('SELECT count(*) FROM private.shared_segment_assessment_jobs;');assert.equal(get(c,register(f)).state,'assessment_reuse');assert.equal(c.target('SELECT count(*) FROM private.shared_segment_assessment_jobs;'),before);});
 check('changed result cannot overwrite completed assessment',()=>assert.throws(()=>c.target(finalize(job,loaded.snapshot.context,{...result,workUnits:result.workUnits+1})),/23514/));
 check('job identity cannot change',()=>assert.throws(()=>c.target(`UPDATE private.shared_segment_assessment_jobs SET input_context_fingerprint=repeat('a',64) WHERE id='${job.job_id}';`),/23514/));
 for(const role of ['anon','authenticated','service_role'])check(role+' has no direct job access',()=>assert.throws(()=>c.target(`SET ROLE ${role}; SELECT * FROM private.shared_segment_assessment_jobs;`),/42501/));
 for(const role of ['anon','authenticated'])for(const sql of [register(f),claim(),load(job),finalize(job,loaded.snapshot.context),fail(job,'transport_failure')])check(role+' denied worker RPC',()=>assert.throws(()=>c.target(`SET ROLE ${role}; ${sql}`),/42501/));
 const transient=fixture(c);get(c,register(transient));let attempt=get(c,claim());
 for(let i=1;i<=3;i++){
  check('attempt '+i+' increments without tap reset',()=>{assert.equal(attempt.attempt_count,i);assert.equal(get(c,register(transient)).attempt_count,i);});
  const failed=get(c,fail(attempt,'calculation_failed'));
  check('bounded retry '+i,()=>assert.equal(failed.state,i===3?'failed':'pending'));
  if(i<3){c.target(`UPDATE private.shared_segment_assessment_jobs SET next_attempt_at=clock_timestamp() WHERE id='${attempt.job_id}';`);attempt=get(c,claim());}
 }
 check('failed job stays terminal under registration',()=>{assert.equal(get(c,register(transient)).status,'failed');assert.equal(get(c,claim()).state,'idle');});
 const limit=fixture(c);get(c,register(limit));const limitJob=get(c,claim()),limitCtx=get(c,load(limitJob));const limitResult=emptyResult();limitResult.assessmentState='assessment_unavailable';limitResult.reasons=['processing_limit'];
 check('processing limit completes successfully',()=>assert.equal(get(c,finalize(limitJob,limitCtx.snapshot.context,limitResult)).state,'completed'));
 check('processing limit exact reuse avoids new job',()=>assert.equal(get(c,register(limit)).assessment.canonical_result.reasons[0],'processing_limit'));
 for(const mode of ['requester','offerer','availability','need','intent','capacity']){
  const x=fixture(c);get(c,register(x));const j=get(c,claim());
  if(mode==='requester'||mode==='offerer')c.target(`BEGIN; ${assessment.replacement(x,mode)} COMMIT;`);
  if(mode==='availability')c.target(`UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id='${x.availability}';`);
  if(mode==='need')c.target(`UPDATE public.movement_needs SET status='paused' WHERE id='${x.need}';`);
  if(mode==='intent')c.target(`UPDATE private.offering_movement_intents SET status='withdrawn' WHERE id='${x.intent}';`);
  if(mode==='capacity')c.target(`UPDATE private.offering_movement_availability SET remaining_places=0,status='full' WHERE id='${x.availability}';`);
  check(mode+' change fences queued geometry',()=>assert.equal(get(c,load(j)).state,'stale'));
  if(mode==='requester'){
   check('new requester identity can create a new job',()=>assert.notEqual(get(c,register(x)).job_id,j.job_id));
   get(c,fail(get(c,claim()),'invalid_evidence'));
  }
 }
 // New identity job above is unclaimed; drain it without changing evidence.
 let next=get(c,claim());if(next.state==='claimed')get(c,fail(next,'invalid_evidence'));
 const expiry=fixture(c,{departure:'20 seconds'});get(c,register(expiry));const exp=get(c,claim());
 while(c.target(`SELECT expires_at<=clock_timestamp() FROM private.shared_segment_assessment_jobs WHERE id='${exp.job_id}';`)!=='t')await new Promise(r=>setTimeout(r,100));
 check('expired dependency job supplies no geometry',()=>assert.equal(get(c,load(exp)).state,'expired'));
 const workerFixture=fixture(c);
 const tables=JSON.parse(c.target("SELECT json_agg(n.nspname||'.'||t.relname ORDER BY n.nspname,t.relname) FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN ('public','private') AND t.relkind='r' AND t.relname NOT IN ('shared_segment_assessment_jobs','shared_segment_geographic_assessments');"));
 const snap=()=>c.target("SELECT md5(string_agg(x::text,'|' ORDER BY x::text)) FROM ("+tables.map(table=>`SELECT jsonb_build_object('table','${table}','row',to_jsonb(t)) x FROM ${table} t`).join(' UNION ALL ')+") q;");
 const before=snap();get(c,register(workerFixture));
 const got=await require('../../scripts/assessment-worker/worker.cjs').executeOne(backend(c),{compute:async(...args)=>{
  assert.equal(c.target("SELECT count(*) FROM pg_locks WHERE relation IN ('public.movement_needs'::regclass,'private.shared_segment_assessment_jobs'::regclass) AND pid<>pg_backend_pid();"),'0');
  return require('../../scripts/assessment-worker/compute.cjs').calculateIsolated(...args);
 }});
 assert.equal(got.state,'completed');count++;console.log('PASS real SQL-backed isolated Node worker completes');
 check('job work leaves every other application table unchanged',()=>assert.equal(snap(),before));
 const lostFixture=fixture(c);get(c,register(lostFixture));const lostBackend=backend(c),real=lostBackend.finalize;let writes=0,computes=0;
 lostBackend.finalize=async(...args)=>{const out=await real(...args);if(args[3]!==null&&!args[5]){writes++;throw Error('response lost after COMMIT');}return out;};
 const recovered=await require('../../scripts/assessment-worker/worker.cjs').executeOne(lostBackend,{compute:async(...args)=>{computes++;return require('../../scripts/assessment-worker/compute.cjs').calculateIsolated(...args);}});
 assert.equal(recovered.state,'completed');assert.equal(writes,1);assert.equal(computes,1);count++;console.log('PASS SQL committed finalization lost response recovers with zero second compute');
 });console.log(`0099 SQL/worker behavior: ${count}/${count} passed`);}
module.exports={run,verify,fixture,register,claim,load,finalize,fail,get,backend,main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
