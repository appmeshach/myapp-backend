'use strict';
// No remote endpoints. Existing harness enforces fixed local schema-only clone.
const assert=require('node:assert/strict'),fs=require('node:fs');
const h=require('./0099_shared_segment_assessment_job_foundation_harness.cjs');
const admin=require('../../scripts/assessment-worker/qualify-remote-schema.cjs');
const {bridge}=require('../../scripts/assessment-worker/qualification-integration.cjs');
const {remote,hash,processTest}=require('../../scripts/assessment-worker/qualification-remote.cjs');
const {createAssessmentJobBackend}=require('../functions/_shared/shared-segment-assessment-job-runtime.ts');
async function main(){await h.run(async c=>{
 const sql=admin.catalogSql().replace("(SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)","'"+JSON.stringify(fs.readdirSync('supabase/migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort().map(f=>f.slice(0,4)))+"'::json");
 // Clone intentionally excludes migration-history rows. Only the history input
 // is supplied here; all bodies, ACLs, signatures, triggers/RLS come from SQL.
 const catalog=JSON.parse(c.target(sql));admin.verifyCatalog(catalog);
 assert.throws(()=>admin.verifyCatalog({...catalog,versions:[]}));
 for(const tweak of [v=>{v.functions.find(p=>p.name==='public.claim_shared_segment_assessment_job_for_server').acl.push('anon=X/postgres');},v=>{v.tables[0].triggers[0].enabled='D';},v=>{v.functions[0].body+=' ';},v=>{v.tables[0].rls=false;},v=>{v.parameters='{}';}]){const v=structuredClone(catalog);tweak(v);assert.throws(()=>admin.verifyCatalog(v));}
 console.log('PASS installed relevant catalog, signatures, sources, parameter fingerprint, ACL/RLS/triggers; mismatch refusals');
 const pairs=JSON.parse(c.target(admin.fixtureSql()));assert.equal(pairs.length,4);
 console.log('PASS operator synthetic fixture SQL commits four pairs with session-local helpers; no provider/job insert');
 const b=await bridge(c);try{
  // Existing 0101 HTTP bridge intentionally exposes only execution RPCs. Keep
  // it unchanged; adapt registration in this local test to actual service SQL
  // while still passing the production runtime response/identity parser.
  const backend=createAssessmentJobBackend(b.url,b.secret,async(url,options)=>{
   if(String(url).endsWith('/register_requester_availability_assessment_job_for_server')){
    const args=JSON.parse(options.body);assert.deepEqual(Object.keys(args).sort(),['p_availability_id','p_movement_need_id','p_verified_member_id']);
    const p={requester:args.p_verified_member_id,need:args.p_movement_need_id,availability:args.p_availability_id};assert(pairs.some(f=>f.need===p.need&&f.requester===p.requester&&f.availability===p.availability));
    return new Response(JSON.stringify(await b.query(h.register(p))),{status:200,headers:{'Content-Type':'application/json'}});
   }
   return await fetch(url,options);
  });
  const processCheck=(config,abandon)=>processTest(config,abandon,{entryPath:require('node:path').join(__dirname,'fixtures/0102-remote-process.cjs')});
  const report=await remote({url:b.url,secret:b.secret,ref:'abcdefghijklmnopqrst',projectRefHash:hash('abcdefghijklmnopqrst')},{pairs},{backend,processCheck});
  assert.equal(report.failure,null,JSON.stringify(report));assert.equal(report.jobsCompleted,3);assert.equal(report.newComputes,3);
  for(const key of ['jobExecution','exactReuse','staleFencing','childCrash','claimedLeaseRecovery','lostAcknowledgementRecovery'])assert.equal(report.measurements[key],true,key);
  assert.equal(c.target("SELECT count(*) FROM private.shared_segment_assessment_jobs;"),'4');
  assert.equal(c.target("SELECT count(*) FROM private.shared_segment_geographic_assessments;"),'3');
  assert.equal(c.target("SELECT count(*) FROM private.shared_segment_assessment_jobs WHERE status='pending' AND last_failure='compute_terminated' AND assessment_id IS NULL;"),'1');
  for(const table of ['shared_segment_assessment_jobs','shared_segment_geographic_assessments'])assert.throws(()=>c.target(`BEGIN; DELETE FROM private.${table} WHERE id=(SELECT id FROM private.${table} LIMIT 1); ROLLBACK;`));
  console.log('PASS actual SQL worker completion/reuse, lost acknowledgement, unchanged real lease, stale fencing, killed child, four jobs/three publications, immutable guards');
 }finally{await b.close();}
});}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
