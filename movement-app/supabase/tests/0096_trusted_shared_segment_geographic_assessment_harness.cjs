'use strict';
// Local Docker only. Each run uses the existing schema-only clone/fingerprint harness.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=require('./0095_requester_deadline_matching_context_repair_harness.cjs');
const {quote}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
const {emptyResult}=require('../functions/_shared/shared-segment-assessment-contracts.ts');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0096_trusted_shared_segment_geographic_assessment.sql');
const contract={namespace:'mapbox-directions-v5',product:'mapbox-directions',version:'v5-driving-geojson-full-v1'};
const context=f=>`SELECT public.get_shared_segment_geographic_assessment_context_for_server('${f.need}','${f.requester}','${f.intent}','${f.offerer}');`;
const publish=(f,s,r)=>`SELECT public.publish_shared_segment_geographic_assessment_for_server('${f.need}','${f.requester}','${f.intent}','${f.offerer}',${quote(JSON.stringify(s.context))}::jsonb,${quote(JSON.stringify(r))}::jsonb);`;
function replacement(f,side,{shape='route_shape',member,origin,destination}={}) {
 const table=side==='requester'?'requester_route_evidence':'offering_route_evidence';
 const parent=side==='requester'?'movement_need_id':'offering_movement_intent_id',owner=side==='requester'?'requesting_member_id':'offering_member_id';
 return `UPDATE private.${table} SET status='superseded' WHERE id='${f[side+'Route']}';
 INSERT INTO private.${table}(${parent},${owner},origin_location_reference_id,destination_location_reference_id,version,evidence_schema_version,
 provider_namespace,provider_product,provider_version,provider_route_reference,route_shape_format,route_shape,route_distance_meters,route_duration_seconds,generated_at,expires_at)
 SELECT ${parent},${member?quote(member):owner},${origin?quote(origin):'origin_location_reference_id'},${destination?quote(destination):'destination_location_reference_id'},version+1,evidence_schema_version,
 provider_namespace,provider_product,provider_version,provider_route_reference||'-replacement',route_shape_format,${shape},route_distance_meters,route_duration_seconds,clock_timestamp(),expires_at
 FROM private.${table} WHERE id='${f[side+'Route']}';`;
}
function fixture(c,{horizon='1 hour',requesterExpiry='2 hours',offererExpiry='2 hours',endpointExpiry='2 hours',intentExpiry='2 hours',provider=contract.namespace,requesterShape}={}) {
 const requester=c.fresh({expiry:`clock_timestamp()+interval '${endpointExpiry}'`}),off=c.fresh({expiry:`clock_timestamp()+interval '${endpointExpiry}'`});
 c.target(`UPDATE public.movement_needs SET earliest_departure_at=clock_timestamp()+interval '2 hours' WHERE id='${requester.need}';`);
 const claim=JSON.parse(c.target(c.claim(requester,contract)));
 const published=JSON.parse(c.target(c.publish(requester,claim.generation_claim_token,{...contract,...(requesterShape?{shape:JSON.stringify(requesterShape)}:{}),expiry:`clock_timestamp()+interval '${requesterExpiry}'`})));
 const f={need:requester.need,requester:requester.member,requesterRoute:published.route_evidence_id,
  intent:require('node:crypto').randomUUID(),offerer:off.member,origin:off.origin,destination:off.destination};
 c.target(`BEGIN;
 INSERT INTO private.offering_movement_intents(id,offering_member_id,intent_key,version,earliest_departure_at,expires_at)
 VALUES('${f.intent}','${f.offerer}',gen_random_uuid(),1,clock_timestamp()+interval '${horizon}',clock_timestamp()+interval '${intentExpiry}');
 INSERT INTO private.offering_movement_intent_locations VALUES('${f.intent}','origin','${f.origin}'),('${f.intent}','destination','${f.destination}');
 COMMIT;`);
 f.offererRoute=c.target(`INSERT INTO private.offering_route_evidence(offering_movement_intent_id,offering_member_id,origin_location_reference_id,destination_location_reference_id,
 version,evidence_schema_version,provider_namespace,provider_product,provider_version,provider_route_reference,route_shape_format,route_shape,route_distance_meters,route_duration_seconds,generated_at,expires_at)
 VALUES('${f.intent}','${f.offerer}','${f.origin}','${f.destination}',1,'offering_route_evidence_v1','${provider}','${contract.product}','${contract.version}',
 'route-${f.intent}','geojson_linestring_v1','{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]]}',1000,300,clock_timestamp(),clock_timestamp()+interval '${offererExpiry}') RETURNING id;`);
 return f;
}
function verify(c) {
 for(const m of migration.matchAll(/CREATE FUNCTION ((?:public|private)\.\w+)\([^]*?AS \$\$([^]*?)\$\$;/g)) {
  const row=JSON.parse(c.target(`SELECT json_build_object('body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname='${m[1]}';`));
  assert.equal(row.body.replace(/\r\n/g,'\n'),m[2]);assert.equal(row.owner,'postgres');assert.deepEqual(row.config,m[1]==='public.get_shared_segment_geographic_assessment_context_for_server'?['search_path=""','TimeZone=UTC']:['search_path=""']);
  assert.deepEqual(row.acl,m[1].startsWith('public.')?['postgres=X/postgres','service_role=X/postgres']:['postgres=X/postgres']);
  if(m[1]!=='private.shared_segment_assessment_parameters')assert(row.definer);
 }
 assert.equal(c.target("SELECT relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid) FROM pg_class c WHERE c.oid='private.shared_segment_geographic_assessments'::regclass;"),'t');
 console.log('PASS installed 0096 exact bodies, owners, empty search_path, ACLs, RLS and no policies');
}
async function run(callback) {await base.run(async c=>{c.target(migration);verify(c);await callback(c);});}
function denied(c,sql,pattern=/23514/) {assert.throws(()=>c.target(sql),pattern);}
async function main() {
 let count=0;const check=(label,fn)=>{fn();count++;console.log('PASS '+label);};
 await run(async c=>{
  const sql=c.target(read('0096_trusted_shared_segment_geographic_assessment_test.sql'));assert.doesNotMatch(sql,/\|f(?:\||$)/m);console.log(sql);
  const f=fixture(c),s=JSON.parse(c.target(context(f))),r=assessSharedSegment(s.offerer_shape,s.requester_shape);
  check('supported asymmetric provider/schema pair',()=>{assert.equal(s.input_state,'ready');assert.equal(r.geographicResult,'geometric_corridor_support');});
  const tables=JSON.parse(c.target("SELECT json_agg(n.nspname||'.'||t.relname ORDER BY n.nspname,t.relname) FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN ('public','private') AND t.relkind='r' AND t.relname<>'shared_segment_geographic_assessments';"));
  const stateSql="SELECT md5(string_agg(x::text,'|' ORDER BY x::text)) FROM ("+tables.map(table=>`SELECT jsonb_build_object('table','${table}','row',to_jsonb(t)) x FROM ${table} t`).join(' UNION ALL ')+") q;";
  // Every application table: includes finances, roster, capacity, history and journeys.
  const snap=()=>c.target(stateSql);
  const before=snap();let first;
  check('positive publication creates evidence only',()=>{first=JSON.parse(c.target(publish(f,s,r)));assert.equal(first.publication_state,'published');assert.equal(snap(),before);});
  check('lost response recovery exact identity',()=>{const second=JSON.parse(c.target(publish(f,s,r)));assert.equal(second.assessment_id,first.assessment_id);assert.equal(second.publication_state,'reuse_existing');});
  check('inconsistent valid result rejected, immutable history preserved',()=>{const changed={...r,workUnits:r.workUnits+1};denied(c,publish(f,s,changed),/nondeterminism/);assert.equal(c.target('SELECT count(*) FROM private.shared_segment_geographic_assessments;'),'1');});
  check('canonical context fields, not hash alone',()=>{denied(c,publish(f,{...s,context:{...s.context,intent_version:2}},r),/inputs changed/);});
  check('canonical context independent of session timezone',()=>assert.deepEqual(JSON.parse(c.target("SET timezone='America/Los_Angeles'; "+context(f))).context,s.context));
  for(const role of ['anon','authenticated','service_role'])check(role+' denied direct table writes/read',()=>{assert.throws(()=>c.target(`SET ROLE ${role}; SELECT * FROM private.shared_segment_geographic_assessments;`),/42501/);});
  for(const role of ['anon','authenticated'])check(role+' denied context and publication RPC',()=>{assert.throws(()=>c.target(`SET ROLE ${role}; `+context(f)),/42501/);assert.throws(()=>c.target(`SET ROLE ${role}; `+publish(f,s,r)),/42501/);});
  check('service_role narrow RPC succeeds',()=>assert.equal(JSON.parse(c.target('SET ROLE service_role; '+context(f))).input_state,'ready'));
  check('update/delete history rejected even for trusted administrator',()=>{denied(c,`UPDATE private.shared_segment_geographic_assessments SET canonical_result=canonical_result WHERE id='${first.assessment_id}';`,/immutable/);denied(c,`DELETE FROM private.shared_segment_geographic_assessments WHERE id='${first.assessment_id}';`,/immutable/);});
  check('wrong requester/offerer owners and missing pair use generic unavailable state',()=>{
   for(const wrong of [{...f,requester:f.offerer},{...f,offerer:f.requester},{...f,need:require('node:crypto').randomUUID()},{...f,intent:require('node:crypto').randomUUID()}])assert.equal(JSON.parse(c.target(context(wrong))).input_state,'evidence_unavailable');
  });
  check('earliest finite horizon includes offerer predeparture',()=>{assert.equal(s.expires_at,s.context.offerer_earliest);});
  check('evidence expiry can shorten horizon',()=>{const x=fixture(c,{requesterExpiry:'20 minutes'}),v=JSON.parse(c.target(context(x)));assert.equal(Date.parse(v.expires_at),Date.parse(v.context.requester_evidence.expires_at));});
  check('offerer evidence expiry can shorten horizon',()=>{const x=fixture(c,{offererExpiry:'20 minutes'}),v=JSON.parse(c.target(context(x)));assert.equal(Date.parse(v.expires_at),Date.parse(v.context.offerer_evidence.expires_at));});
  check('trusted endpoint expiries participate in earliest horizon',()=>{const x=fixture(c,{endpointExpiry:'20 minutes'}),v=JSON.parse(c.target(context(x)));assert.equal(Date.parse(v.expires_at),Math.min(...v.context.endpoint_references.map(e=>Date.parse(e.expires_at))));});
  check('intent expiry can shorten horizon',()=>{const x=fixture(c,{intentExpiry:'20 minutes'}),v=JSON.parse(c.target(context(x)));assert.equal(v.expires_at,v.context.intent_expiry);});
  check('unsupported provider contract explicit',()=>{const x=fixture(c,{provider:'unsupported'}),v=JSON.parse(c.target(context(x)));assert.equal(v.input_state,'evidence_invalid');assert.equal(v.reason,'unsupported_provider_contract');});
  for(const side of ['requester','offerer'])check(side+' supersession rejected and history preserved',()=>{
   const x=fixture(c),v=JSON.parse(c.target(context(x))),computed=assessSharedSegment(v.offerer_shape,v.requester_shape);
   c.target(`UPDATE private.${side==='requester'?'requester':'offering'}_route_evidence SET status='superseded' WHERE id='${x[side+'Route']}';`);
   assert.equal(JSON.parse(c.target(context(x))).input_state,'evidence_unavailable');denied(c,publish(x,v,computed),/inputs changed/);
  });
  for(const side of ['requester','offerer']) {
   check(side+' new evidence ID/version invalidates computed snapshot',()=>{
    const x=fixture(c),v=JSON.parse(c.target(context(x)));c.target('BEGIN; '+replacement(x,side)+' COMMIT;');
    const next=JSON.parse(c.target(context(x)));assert.equal(next.input_state,'ready');assert.notEqual(next.input_context_fingerprint,v.input_context_fingerprint);
    denied(c,publish(x,v,r),/inputs changed/);
   });
   check(side+' malformed geometry rejected before deferred fixture validation',()=>{
    const value=c.target('BEGIN; '+replacement(f,side,{shape:`'{"type":"LineString","coordinates":[[3.4,6.4]]}'::jsonb`})+context(f)+' ROLLBACK;');
    assert.equal(JSON.parse(value).input_state,'evidence_invalid');
   });
   check(side+' wrong evidence owner rejected before deferred fixture validation',()=>{
    const value=c.target('BEGIN; '+replacement(f,side,{member:side==='requester'?f.offerer:f.requester})+context(f)+' ROLLBACK;');
    assert.equal(JSON.parse(value).input_state,'evidence_invalid');
   });
  }
  check('changed exact endpoint binding rejects stale evidence',()=>{
   const value=c.target('BEGIN; '+replacement(f,'offerer',{origin:f.destination,destination:f.origin})+context(f)+' ROLLBACK;');
   assert.equal(JSON.parse(value).input_state,'evidence_invalid');
  });
  check('malformed/noncanonical output and forbidden authority rejected',()=>{
   for(const bad of [{...r,authorizesAdmission:true},{...r,roadTopologyVerified:true},{...r,offererSupported:r.offererTotal+1},{...r,extra:1},{...r,algorithmVersion:'v2'},{...r,supportIntervals:[]},{...r,offererFraction:2},{...r,geographicResult:'potentially_compatible'},{...r,assessmentState:null}])denied(c,publish(f,s,bad));
  });
  check('direct transient calculation failure is rejected and healthy retry publishes',()=>{
   const x=fixture(c),v=JSON.parse(c.target(context(x))),failure=emptyResult();failure.assessmentState='assessment_unavailable';failure.reasons=['calculation_failed'];
   denied(c,publish(x,v,failure));assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'0');
   const healthy=assessSharedSegment(v.offerer_shape,v.requester_shape);assert.equal(JSON.parse(c.target(publish(x,v,healthy))).publication_state,'published');
  });
  check('deterministic processing limit remains persistable and reusable',()=>{
   const x=fixture(c),v=JSON.parse(c.target(context(x))),limited=emptyResult();limited.assessmentState='assessment_unavailable';limited.reasons=['processing_limit'];
   const firstLimit=JSON.parse(c.target(publish(x,v,limited))),again=JSON.parse(c.target(publish(x,v,limited)));
   assert.equal(firstLimit.publication_state,'published');assert.equal(again.publication_state,'reuse_existing');assert.equal(again.assessment_id,firstLimit.assessment_id);
  });
  check('no-positive-support evidence does not mutate product state',()=>{
   const x=fixture(c,{requesterShape:{type:'LineString',coordinates:[[3.4,6.4],[3.401,6.399],[3.501,6.499],[3.5,6.5]]}}),v=JSON.parse(c.target(context(x)));
   const negative=assessSharedSegment(v.offerer_shape,v.requester_shape),prev=snap();c.target(publish(x,v,negative));assert.equal(snap(),prev);assert.deepEqual(negative.reasons,['no_positive_support_on_reference_route']);
  });
  check('no computation claim or partial row before publication',()=>{const x=fixture(c);c.target(context(x));assert.equal(c.target(`SELECT count(*) FROM private.shared_segment_geographic_assessments WHERE movement_need_id='${x.need}';`),'0');});
 });console.log(`0096 focused behavior: ${count}/${count} passed`);
}
module.exports={run,fixture,context,publish,verify,denied,main,read,replacement};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
