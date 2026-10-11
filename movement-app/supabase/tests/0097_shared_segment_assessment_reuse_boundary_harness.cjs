'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=require('./0096_trusted_shared_segment_geographic_assessment_harness.cjs');
const {assessSharedSegment}=require('../functions/_shared/shared-segment-assessment-geometry.ts');
const {emptyResult}=require('../functions/_shared/shared-segment-assessment-contracts.ts');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0097_shared_segment_assessment_reuse_boundary.sql');
const lookup=f=>`SELECT public.get_current_shared_segment_geographic_assessment_for_server('${f.need}','${f.requester}','${f.intent}','${f.offerer}');`;
async function run(callback){await base.run(async c=>{c.target(migration);await callback(c);});}
function verify(c){
 const row=JSON.parse(c.target("SELECT json_build_object('body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_current_shared_segment_geographic_assessment_for_server';"));
 const body=migration.match(/AS \$\$([^]*?)\$\$;/)[1];assert.equal(row.body.replace(/\r\n/g,'\n'),body);
 assert.equal(row.owner,'postgres');assert.equal(row.definer,true);assert.deepEqual(row.config,['search_path=""']);assert.deepEqual(row.acl,['postgres=X/postgres','service_role=X/postgres']);
}
async function main(){let count=0;const check=(label,fn)=>{fn();count++;console.log('PASS '+label);};await run(async c=>{
 verify(c);console.log('PASS installed 0097 exact body, owner, empty search_path and service-only ACL');const sql=c.target(read('0097_shared_segment_assessment_reuse_boundary_test.sql'));assert.doesNotMatch(sql,/\|f(?:\||$)/m);
 const assertMiss=(v,state='not_found')=>{assert.equal(v.lookup_state,state);assert.equal(v.assessment_id,null);assert.equal(v.algorithm_version,null);assert.equal(v.parameter_fingerprint,null);assert.equal(v.canonical_result,null);};
 const f=base.fixture(c);check('ready pair without assessment is an exact lookup miss',()=>assertMiss(JSON.parse(c.target(lookup(f)))));
 const s=JSON.parse(c.target(base.context(f))),result=assessSharedSegment(s.offerer_shape,s.requester_shape),published=JSON.parse(c.target(base.publish(f,s,result)));
 check('exact current assessment returns only its validated current algorithm identity',()=>{const v=JSON.parse(c.target(lookup(f))),stored=JSON.parse(c.target(`SELECT json_build_object('algorithm_version',algorithm_version,'parameter_fingerprint',parameter_fingerprint) FROM private.shared_segment_geographic_assessments WHERE id='${published.assessment_id}';`));assert.equal(v.lookup_state,'reuse_existing');assert.equal(v.assessment_id,published.assessment_id);assert.equal(v.algorithm_version,s.context.algorithm_version);assert.equal(v.parameter_fingerprint,s.context.parameter_fingerprint);assert.equal(v.algorithm_version,stored.algorithm_version);assert.equal(v.parameter_fingerprint,stored.parameter_fingerprint);assert.deepEqual(v.canonical_result,result);assert.deepEqual(Object.keys(v).sort(),['algorithm_version','assessment_id','canonical_result','lookup_state','parameter_fingerprint']);});
 for(const role of ['anon','authenticated'])check(role+' denied lookup',()=>assert.throws(()=>c.target(`SET ROLE ${role}; ${lookup(f)}`),/42501/));
 check('service role may use lookup but cannot read private table',()=>{assert.equal(JSON.parse(c.target(`SET ROLE service_role; ${lookup(f)}`)).lookup_state,'reuse_existing');assert.throws(()=>c.target('SET ROLE service_role; SELECT * FROM private.shared_segment_geographic_assessments;'),/42501/);});
 check('mismatched pair fails privately',()=>{const x={...f,requester:crypto.randomUUID()};assertMiss(JSON.parse(c.target(lookup(x))),'not_ready');});
 check('requester supersession makes old assessment history only',()=>{const x=base.fixture(c),v=JSON.parse(c.target(base.context(x))),r=assessSharedSegment(v.offerer_shape,v.requester_shape);c.target(base.publish(x,v,r));c.target(`BEGIN; ${base.replacement(x,'requester')} COMMIT;`);assert.equal(JSON.parse(c.target(lookup(x))).lookup_state,'not_found');});
 check('offerer supersession makes old assessment history only',()=>{const x=base.fixture(c),v=JSON.parse(c.target(base.context(x))),r=assessSharedSegment(v.offerer_shape,v.requester_shape);c.target(base.publish(x,v,r));c.target(`BEGIN; ${base.replacement(x,'offerer')} COMMIT;`);assert.equal(JSON.parse(c.target(lookup(x))).lookup_state,'not_found');});
 check('processing_limit is a reusable completed assessment',()=>{const x=base.fixture(c),v=JSON.parse(c.target(base.context(x))),r=emptyResult();r.assessmentState='assessment_unavailable';r.reasons=['processing_limit'];const p=JSON.parse(c.target(base.publish(x,v,r))),got=JSON.parse(c.target(lookup(x)));assert.equal(got.lookup_state,'reuse_existing');assert.equal(got.assessment_id,p.assessment_id);assert.deepEqual(got.canonical_result,r);});
 const corrupt=(column,value,extra='')=>c.target(`BEGIN; ALTER TABLE private.shared_segment_geographic_assessments DISABLE TRIGGER USER; ${extra} UPDATE private.shared_segment_geographic_assessments SET ${column}=${value} WHERE id='${published.assessment_id}'; ${lookup(f)} ROLLBACK;`);
 check('wrong route evidence id is not reused',()=>{const other=base.fixture(c);assert.equal(JSON.parse(corrupt('requester_route_evidence_id',`'${other.requesterRoute}'`)).lookup_state,'not_found');});
 check('wrong route version is not reused',()=>assert.equal(JSON.parse(corrupt('requester_route_version','2')).lookup_state,'not_found'));
 check('wrong parameter fingerprint returns no algorithm identity',()=>assertMiss(JSON.parse(corrupt('parameter_fingerprint',`'${'b'.repeat(64)}'`))));
 check('wrong context fingerprint is not reused',()=>assert.equal(JSON.parse(corrupt('input_context_fingerprint',`'${'c'.repeat(64)}'`)).lookup_state,'not_found'));
 check('wrong canonical context is not reused',()=>assert.equal(JSON.parse(corrupt('canonical_context',`canonical_context||'{"test":true}'::jsonb`)).lookup_state,'not_found'));
 check('expired assessment is not reused',()=>assert.equal(JSON.parse(corrupt('expires_at',"clock_timestamp()-interval '1 minute'","UPDATE private.shared_segment_geographic_assessments SET generated_at=clock_timestamp()-interval '2 minutes',created_at=clock_timestamp()-interval '2 minutes' WHERE id='"+published.assessment_id+"';")).lookup_state,'not_found'));
 check('wrong algorithm version returns no algorithm identity',()=>assertMiss(JSON.parse(corrupt('algorithm_version',"'shared_segment_geographic_assessment_v2'",'ALTER TABLE private.shared_segment_geographic_assessments DROP CONSTRAINT shared_segment_geographic_assessments_algorithm_version_check;'))));
 });console.log(`0097 focused reuse behavior: ${count}/${count} passed`);}
module.exports={run,lookup,verify,main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
