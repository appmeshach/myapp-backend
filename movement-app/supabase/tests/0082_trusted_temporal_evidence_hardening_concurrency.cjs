'use strict';
const cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {disposable,container,source}=require('./0082_trusted_temporal_evidence_hardening_harness.cjs');
const {fixtures}=require('./0081_financial_movement_start_behavior.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
class Session {
 constructor(c){this.out='';this.err='';this.closed=false;this.child=cp.spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',c.database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
  this.child.stdout.on('data',b=>this.out+=b);this.child.stderr.on('data',b=>this.err+=b);this.child.stdin.on('error',e=>this.err+=e.message);this.child.on('error',e=>{this.err+=e.message;this.closed=true;});this.child.on('close',()=>this.closed=true);c.sessions.push(this);}
 async send(sql){const marker='done_'+crypto.randomBytes(6).toString('hex');this.child.stdin.write(sql+'\n\\echo '+marker+'\n');const end=Date.now()+30000;while(!this.out.includes(marker)){if(this.closed)throw Error(this.err);if(Date.now()>end)throw Error('Session timeout '+this.err);await delay(25);}}
 async begin(){await this.send("SELECT 'PID='||pg_backend_pid(); BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL lock_timeout='25s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='35s';");this.pid=Number(this.out.match(/PID=(\d+)/)[1]);}
 close(){if(!this.closed)this.child.stdin.end('ROLLBACK;\n\\q\n');}
}
const outcome=p=>p.then(()=>({ok:true}),e=>({ok:false,error:e.message}));
async function main(){let result;await disposable(async c=>{
 c.install();let scenarioCount=0,blockingCount=0,fixtureNumber=0;
 const target=c.target;
 async function blocked(a,b){const end=Date.now()+8000;while(Date.now()<end){if(target(`SELECT ${a.pid}=ANY(pg_blocking_pids(${b.pid}));`)==='t'){blockingCount++;return;}if(b.closed)throw Error('Expected actual PostgreSQL blocking: '+b.err);await delay(40);}throw Error('Expected actual PostgreSQL blocking relationship');}
 function finish(a,b,name){assert.doesNotMatch(a.err+b.err,/40P01|55P03|57014|25P03|deadlock|timeout/i);a.close();b.close();scenarioCount++;console.log('PASS '+name);}
 function fresh(){const schema='temporal_fixture_'+(++fixtureNumber);target(fixtures().replace(/^BEGIN;/,'BEGIN; CREATE SCHEMA '+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','')+' COMMIT;');
  const f=JSON.parse(target(`SELECT jsonb_build_object('schema','${schema}','agreement',g.id,'version',g.version,'alignment',g.alignment_id,'requester',g.member_needing_movement_id,'need',a.movement_need_id) FROM private.financial_agreements g JOIN ${schema}.funding_fixture b ON b.agreement=g.id JOIN public.alignments a ON a.id=g.alignment_id;`));
  target(`BEGIN; SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED; SELECT public.record_wallet_top_up_for_server('${f.requester}',1000000,'NGN','temporal-race',gen_random_uuid()::text); SELECT ${schema}.prepare_activation_faces(); SELECT ${schema}.funding_succeed(${schema}.hold_result()); COMMIT;`);return f;}
 const start=f=>`SELECT public.start_alignment_face_verification_for_server('${f.alignment}','${f.requester}','temporal-race',gen_random_uuid()::text);`;
 const complete=(f,success)=>`SELECT public.complete_alignment_face_verification_for_server(x.id,x.media_id,${success},${success}) FROM private.alignment_face_verifications x WHERE x.alignment_id='${f.alignment}' AND x.member_id='${f.requester}' ORDER BY x.attempt_ordinal DESC LIMIT 1;`;
 const activate=f=>`SELECT set_config('request.jwt.claim.sub','${f.requester}',true); SET LOCAL ROLE authenticated; SELECT * FROM public.activate_my_funded_movement('${f.agreement}',${f.version}); RESET ROLE;`;
 const latest=f=>JSON.parse(target(`SELECT row_to_json(x) FROM private.alignment_face_verifications x WHERE alignment_id='${f.alignment}' AND member_id='${f.requester}' ORDER BY attempt_ordinal DESC LIMIT 1;`));
 for(const rollback of [false,true]){
  const f=fresh(),before=latest(f),a=new Session(c),b=new Session(c);await a.begin();await b.begin();await a.send(start(f));
  const pending=outcome(b.send(start(f)));await blocked(a,b);const firstOrdinal=Number(target('SELECT last_value FROM private.alignment_face_attempt_ordinal_seq;'));
  await a.send(rollback?'ROLLBACK;':'COMMIT;');assert.equal((await pending).ok,true);await b.send(complete(f,true)+' COMMIT;');
  const row=latest(f);assert(Number(row.attempt_ordinal)>firstOrdinal);assert(Number(row.attempt_ordinal)>Number(before.attempt_ordinal));
  assert.equal(Number(target(`SELECT count(*) FROM private.alignment_face_verifications WHERE alignment_id='${f.alignment}' AND member_id='${f.requester}';`)),rollback?2:3);
  finish(a,b,'serialized face creation, sequence rollback gap='+rollback);
 }
 for(const success of [false,true]){
  const f=fresh(),a=new Session(c),b=new Session(c);await a.begin();await b.begin();await a.send(start(f));const pending=outcome(b.send(activate(f)));await blocked(a,b);await a.send(complete(f,success)+' COMMIT;');
  const r=await pending;assert.equal(r.ok,success,JSON.stringify(r));if(success)await b.send('COMMIT;');else assert.match(r.error,/P0001|23514/);
  assert.equal(target(`SELECT count(*) FROM private.funded_movement_activations WHERE financial_agreement_id='${f.agreement}';`),success?'1':'0');
  if(success){assert.equal(target(`SELECT x.face_verification_id=(SELECT id FROM private.alignment_face_verifications WHERE alignment_id='${f.alignment}' AND member_id='${f.requester}' ORDER BY attempt_ordinal DESC LIMIT 1) FROM private.funded_movement_activation_faces x WHERE x.financial_agreement_id='${f.agreement}' AND x.member_id='${f.requester}';`),'t');const seq=target('SELECT last_value FROM private.alignment_face_attempt_ordinal_seq;'),before=target(`SELECT ${f.schema}.materialization_sources();`);target('BEGIN; '+activate(f)+' COMMIT;');assert.equal(target('SELECT last_value FROM private.alignment_face_attempt_ordinal_seq;'),seq);assert.equal(target(`SELECT ${f.schema}.materialization_sources();`),before);}
  finish(a,b,'activation waits for committed latest face success='+success+'; replay allocates nothing');
 }
 // New external evidence and exact concurrent duplicate/replay use normal RPCs.
 // Use an issuer-only fixture: materialized needs are correctly no longer live.
 const issuer=require('./0074_trusted_financial_proposal_issuer_behavior.cjs').fixtures();
 for(const kind of ['location','route','match']){
  const schema='temporal_ingestion_'+kind;target(issuer.replace(/^BEGIN;/,'BEGIN; CREATE SCHEMA '+schema+';').replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','')+' COMMIT;');
  let sql;
  if(kind==='location')sql=`DO $x$ DECLARE e private.movement_location_resolution_evidence%ROWTYPE; t private.movement_location_references%ROWTYPE; BEGIN SELECT x.* INTO e FROM private.movement_location_resolution_evidence x JOIN ${schema}.snapshot_fixture f ON true JOIN private.movement_location_references l ON l.id=x.resolved_location_reference_id WHERE l.owner_member_id=f.requester LIMIT 1; SELECT x.* INTO t FROM private.movement_location_references x WHERE x.id=e.resolved_location_reference_id; PERFORM public.record_location_resolution_for_server(e.source_location_reference_id,e.producer_request_id,t.provider_namespace,e.provider_product,e.provider_version,t.provider_place_reference,t.resolution_version,t.latitude,t.longitude,t.resolved_at,e.requested_expires_at); END $x$;`;
  if(kind==='route')sql=`DO $x$ DECLARE e private.offering_route_evidence%ROWTYPE; BEGIN SELECT x.* INTO e FROM private.offering_route_evidence x JOIN ${schema}.snapshot_fixture f ON x.offering_movement_intent_id=f.intent WHERE x.status='current'; PERFORM public.record_offering_route_evidence_for_server(e.offering_movement_intent_id,e.provider_namespace,e.provider_product,e.provider_version,e.provider_route_reference,e.route_shape,e.route_distance_meters,e.route_duration_seconds,e.generated_at,e.expires_at); END $x$;`;
  if(kind==='match')sql=`DO $x$ DECLARE e private.trusted_route_match_evidence%ROWTYPE; BEGIN SELECT x.* INTO e FROM private.trusted_route_match_evidence x JOIN ${schema}.snapshot_fixture f ON x.movement_need_id=f.need WHERE x.status='current'; PERFORM public.record_trusted_route_match_evidence_for_server(e.movement_need_id,e.offering_movement_intent_id,e.route_evidence_id,e.route_evidence_version,e.requester_origin_distance_to_route_meters,e.requester_destination_distance_to_route_meters,e.calculated_route_shape_length_meters,e.requester_origin_position_along_route_meters,e.requester_destination_position_along_route_meters,e.requester_origin_closest_route_latitude,e.requester_origin_closest_route_longitude,e.requester_destination_closest_route_latitude,e.requester_destination_closest_route_longitude,e.calculated_at,e.expires_at); END $x$;`;
  const request=crypto.randomUUID();
  if(kind==='location')sql=sql.replace('e.producer_request_id,',"'"+request+"'::uuid,");
  if(kind==='route')sql=sql.replace('e.provider_route_reference,',"'"+request+"',");
  if(kind==='match'){
   // A fresh trusted route gives this calculation a genuine unused identity.
   target(`BEGIN; SELECT ${schema}.snapshot_route((SELECT intent FROM ${schema}.snapshot_fixture),'temporal-new-match-${request}'); COMMIT;`);
   const route=JSON.parse(target(`SELECT jsonb_build_object('id',r.id,'version',r.version,'generated',r.generated_at) FROM private.offering_route_evidence r JOIN ${schema}.snapshot_fixture f ON r.offering_movement_intent_id=f.intent WHERE r.status='current';`));
   sql=sql.replace('e.route_evidence_id,e.route_evidence_version,',`'${route.id}'::uuid,${route.version},`).replace('e.calculated_at,e.expires_at',`'${route.generated}'::timestamptz,e.expires_at`);
  }
  const table={location:'movement_location_resolution_evidence',route:'offering_route_evidence',match:'trusted_route_match_evidence'}[kind];
  for(const replay of [false,true]){
   const before=target(`SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.${table} x;`),count=Number(target(`SELECT count(*) FROM private.${table};`));
   const a=new Session(c),b=new Session(c);await a.begin();await b.begin();await a.send(sql);const pending=outcome(b.send(sql));await blocked(a,b);await a.send('COMMIT;');assert.equal((await pending).ok,true);await b.send('COMMIT;');
   assert.equal(Number(target(`SELECT count(*) FROM private.${table};`)),count+(replay?0:1));
   if(replay)assert.equal(target(`SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.${table} x;`),before);
   finish(a,b,'concurrent exact '+kind+' ingestion replay='+replay+' no duplicate evidence');
  }
 }
 console.log(`PASS ${scenarioCount} temporal concurrency scenarios; ${blockingCount} actual PostgreSQL blocking proofs; no deadlock`);
 result={passed:scenarioCount,failed:0,blockingProofs:blockingCount,deadlocks:0};
});
 require('node:fs').writeFileSync('docs/0082-temporal-concurrency-results.json',JSON.stringify({...result,sourceSha:crypto.createHash('sha256').update(source).digest('hex'),cleanup:true,applicationFingerprintUnchanged:true},null,2)+'\n');
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
