'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),assert=require('node:assert/strict');
const {run}=require('./0090_trusted_requester_priority_harness.cjs');
const output=path.join(os.tmpdir(),'movement-0090-validation');
async function main(){
 await run(async c=>{
  let live=fs.readFileSync(path.join(__dirname,'0045_movement_offer_availability_capacity_test.sql'),'utf8').replace(/\r\n/g,'\n');
  // Keep every original assertion; supplement only its pre-0050 endpoint
  // fixtures with today's complete verified resolution/state producer graph.
  const begin=live.indexOf('      INSERT INTO private.movement_location_references('),end=live.indexOf(' RETURNING id INTO location_id;',begin)+' RETURNING id INTO location_id;'.length;assert(begin>0&&end>begin);
  const endpoint=`      SELECT x.resolved_location_reference_id INTO location_id
      FROM public.record_attested_location_resolution_for_server(
       loc.member_id,(SELECT x.location_reference_id FROM public.record_verified_selected_location_for_server(loc.member_id,gen_random_uuid(),loc.area,'test-provider','0042-'||label||'-'||loc.kind,'selection_proof_v1',t-interval '1 minute',t+interval '4 hours') x),
       gen_random_uuid(),'test-provider','geocode','test-resolution-v1','0042-'||label||'-'||loc.kind,'resolution_v1',loc.area,loc.lat,loc.lon,clock_timestamp(),NULL) x;
      INSERT INTO private.trusted_location_state_evidence(resolution_evidence_id,resolved_location_reference_id,provider_namespace,state_provider_reference,state_name,state_key,recorded_at)
      SELECT e.id,e.resolved_location_reference_id,'test-provider','region-lagos','Lagos',private.canonical_nigerian_state_key('Lagos'),clock_timestamp() FROM private.movement_location_resolution_evidence e WHERE e.resolved_location_reference_id=location_id;`;
  live=live.slice(0,begin)+endpoint+live.slice(end);
  live=live.replace(/ROLLBACK;\s*$/,"SELECT 'COUNT='||count(*) FROM pg_temp.capacity_results; ROLLBACK;");
  const text=c.target(live);assert.doesNotMatch(text,/\|f(?:\||$)/m);console.log('PASS '+Number(text.match(/COUNT=(\d+)/)[1])+' unchanged 0045 capacity assertions with complete current endpoint fixtures');
 });
 for(const name of ['0089_trusted_movement_priority_behavior.cjs','0089_trusted_movement_priority_concurrency.cjs','0089_trusted_movement_priority_regression.cjs']){
  const filename=path.join(__dirname,name),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(__dirname);
  loaded.require=n=>n==='./0089_trusted_movement_priority_harness.cjs'?require('./0090_trusted_requester_priority_harness.cjs'):n==='node:fs'?{...fs,writeFileSync(file,...args){return fs.writeFileSync(path.join(output,path.basename(String(file))),...args);}}:require(n.startsWith('.')?path.resolve(__dirname,n):n);
  loaded._compile(fs.readFileSync(filename,'utf8'),filename);await loaded.exports.main();console.log('PASS original '+name+' unchanged against 0090');
 }
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
