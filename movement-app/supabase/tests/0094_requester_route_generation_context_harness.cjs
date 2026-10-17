'use strict';
// Import is inert; schema-only disposable local databases and fingerprinting
// reuse the established 0093 harness. No application rows or remote URLs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
const contract={namespace:'mapbox-directions-v5',product:'mapbox-directions',version:'v5-driving-geojson-full-v1'};
const context=(f,token)=>`SELECT row_to_json(r) FROM public.get_claimed_requester_route_generation_context_for_server(${base.quote(f.need)},${base.quote(f.member)},${base.quote(token)}) r;`;
async function run(callback){await base.run(async c=>{
  const source=fs.readFileSync(path.join(__dirname,'../migrations/0094_requester_route_generation_context.sql'),'utf8').replace(/\r\n/g,'\n');
  const body=source.match(/AS \$\$([^]*?)\$\$;/)[1];
  const installed=JSON.parse(c.target("SELECT json_build_object('body',p.prosrc,'definer',p.prosecdef,'config',p.proconfig,'owner',pg_get_userbyid(p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_claimed_requester_route_generation_context_for_server';"));
  assert.equal(installed.body.replace(/\r\n/g,'\n'),body);assert(installed.definer);assert.deepEqual(installed.config,['search_path=""']);assert.equal(installed.owner,'postgres');
  console.log('PASS installed 0094 source/owner/definer/search_path; 0093 installed functions also verified');
  await callback({...c,context,acquire:f=>JSON.parse(c.target(c.claim(f,contract))),write:(f,token,p={})=>JSON.parse(c.target(c.publish(f,token,{...contract,...p})))});
});console.log('PASS application data/catalog/ACL/RLS/history fingerprint unchanged');}
async function main(){await run(async c=>{
  for(const file of ['0094_requester_route_generation_context_test.sql','0093_requester_route_generation_claim_boundary_test.sql','0092_requester_route_evidence_foundation_test.sql','0032_route_provider_rate_limit_test.sql','0033_route_generation_claim_boundary_test.sql']){
    const result=c.target(fs.readFileSync(path.join(__dirname,file),'utf8'));console.log(file+'\n'+result);assert(!/\|f(?:\||$)/m.test(result),'Failed SQL check');
  }
});}
module.exports={run,context,contract};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
