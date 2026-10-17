'use strict';
// Explicit runner. Imported by tests without performing any I/O beyond imports.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),Module=require('node:module'),assert=require('node:assert/strict');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\r\n/g,'\n');
const output=path.join(os.tmpdir(),'movement-0098-validation');
const migration=['0096_trusted_shared_segment_geographic_assessment.sql','0097_shared_segment_assessment_reuse_boundary.sql','0098_current_route_match_reuse_boundary.sql'].map(n=>read('../migrations/'+n)).join('\n');
function finalHarness() {
 const file=path.join(__dirname,'0095_requester_deadline_matching_context_repair_harness.cjs'),m=new Module(file,module);
 m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
 m.require=n=>n==='./0093_requester_route_generation_claim_boundary_harness.cjs'?{
  ...require(n),run:callback=>require(n).run(async c=>{c.target(migration);await callback(c);})
 }:require(n.startsWith('.')?path.resolve(__dirname,n):n);
 m._compile(fs.readFileSync(file,'utf8'),file);return m.exports;
}
function currentRouteMatchFixture(sql) {
 let count=0;
 const result=sql.replace(/INSERT INTO private\.movement_location_references\([^]*?RETURNING id\s+INTO (\w+);/g,(source,id)=>{
  const values=source.match(/VALUES\s*\(\s*(\w+),\s*'([^']+)',\s*'provider_resolved',\s*'resolved',\s*([\d.]+),\s*([\d.]+),\s*'test-provider',\s*'([^']+)'/);
  assert(values,'Recognized historical trusted endpoint fixture');count++;
  const [,member,label,lat,lon,ref]=values;
  return `SELECT x.resolved_location_reference_id INTO ${id} FROM public.record_attested_location_resolution_for_server(
   ${member},(SELECT v.location_reference_id FROM public.record_verified_selected_location_for_server(${member},gen_random_uuid(),'${label}','test-provider','${ref}','selection_proof_v1',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 hours') v),
   gen_random_uuid(),'test-provider','geocode','test-resolution-v1','${ref}','resolution_v1','${label}','region-lagos','Lagos',${lat},${lon},clock_timestamp(),NULL) x;`;
 });
 assert.equal(count,4);return result;
}
function requesterRunner(name) {
 const file=path.join(__dirname,name),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
 m.require=n=>{
  if(n==='./0093_requester_route_generation_claim_boundary_harness.cjs')return {...require(n),run:require('./0098_current_route_match_reuse_boundary_harness.cjs').run};
  if(n==='./0094_requester_route_generation_context_harness.cjs')return requesterRunner('0094_requester_route_generation_context_harness.cjs');
  if(n==='./0095_requester_deadline_matching_context_repair_harness.cjs')return finalHarness();
  return require(n.startsWith('.')?path.resolve(__dirname,n):n);
 };
 m._compile(read(name),file);return m.exports;
}
async function main() {
 const group=process.argv[2]||'node';fs.mkdirSync(output,{recursive:true});
 if(group==='node'||group==='supabase-node') {
  for(const [name,dir] of (group==='supabase-node'?[['supabase','supabase/tests']]:[['supabase','supabase/tests'],['root','tests']])) {
   const files=fs.readdirSync(dir).filter(f=>/\.test\.(?:cjs|mjs|js)$/.test(f)).sort().map(f=>path.join(dir,f));
   const log=path.join(output,name+'-node.txt'),fd=fs.openSync(log,'w');
   const r=cp.spawnSync(process.execPath,['--test',...files],{stdio:['ignore',fd,fd],timeout:300000,windowsHide:true});fs.closeSync(fd);
   console.log(name+': '+files.length+' files; exit '+r.status+'; '+log);console.log(fs.readFileSync(log,'utf8').split('\n').slice(-13).join('\n'));
   assert.equal(r.status,0,r.error?String(r.error):'See '+log);
  }
 } else if(group==='assessment') {
  await require('./0098_current_route_match_reuse_boundary_harness.cjs').run(async c=>{
   require('./0097_shared_segment_assessment_reuse_boundary_harness.cjs').verify(c);
   for(const file of ['0096_trusted_shared_segment_geographic_assessment_test.sql','0097_shared_segment_assessment_reuse_boundary_test.sql']){
    const result=c.target(read(file));assert.doesNotMatch(result,/\|f(?:\||$)/m);
    console.log(file+': '+result.split('\n').filter(l=>/\|t(?:\||$)/.test(l)).length+' assertions passed');
   }
  });
 } else if(group==='foundation') {
  await require('./0098_current_route_match_reuse_boundary_harness.cjs').run(async c=>{
   for(const file of ['0092_requester_route_evidence_foundation_test.sql','0093_requester_route_generation_claim_boundary_test.sql','0094_requester_route_generation_context_test.sql','0046_requester_availability_matching_context_test.sql','0047_requester_movement_interest_foundation_test.sql','0049_interest_authorized_offer_continuation_test.sql','0031_route_generation_context_test.sql','0032_route_provider_rate_limit_test.sql','0033_route_generation_claim_boundary_test.sql','0037_trusted_route_match_evidence_foundation_test.sql','0038_trusted_route_match_evidence_writer_test.sql']) {
    let sql=read(file);
    if(/^004[679]_/.test(file))sql=require('./0091_pre_departure_roster_freeze_regression.cjs').sourceSuite(
      file.replace('_test.sql',''),file.startsWith('0046')?'requester_availability_matching':'interest');
    const result=c.target(file.startsWith('0037')||file.startsWith('0038')?currentRouteMatchFixture(sql):sql);assert.doesNotMatch(result,/\|f(?:\||$)/m);fs.writeFileSync(path.join(output,file+'.txt'),result);console.log(file+': '+result.split('\n').filter(l=>/\|t(?:\||$)/.test(l)).length+' assertions passed');
   }
  });
 } else if(['requester-concurrency','requester-context-concurrency','deadline-concurrency'].includes(group)) {
  const files=group==='requester-context-concurrency'?['0094_requester_route_generation_context_concurrency.cjs']:
    group==='deadline-concurrency'?['0095_requester_deadline_matching_context_repair_concurrency.cjs']:
    ['0093_requester_route_generation_claim_boundary_concurrency.cjs','0094_requester_route_generation_context_concurrency.cjs','0095_requester_deadline_matching_context_repair_concurrency.cjs'];
  for(const file of files)await requesterRunner(file).main();
 } else if(group==='priority') {
  const h=finalHarness();
  // Use the established current-schema regression loader to retain all priority
  // assertions without reinstalling historical production bodies over final 0095.
  await h.loaded('0091_pre_departure_roster_freeze_regression.cjs').main();
 } else {
  await finalHarness().main();
 }
}
module.exports={main,finalHarness,output};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
