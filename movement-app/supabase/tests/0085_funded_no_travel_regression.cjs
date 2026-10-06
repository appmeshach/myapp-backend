'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {run}=require('./0085_funded_no_travel_harness.cjs');
const {fixtures,completionChecks}=require('./0082_financial_movement_completion_behavior.cjs');
async function main(){await run(async c=>{
 let total=0;
 for(const zero of [false,true]){
  // Same 0084 regression allowances: only its intentional principals/counts
  // are excluded from the original 0083 unrelated-source assertion.
  let setup=fixtures(zero),marker="('private','wallet_postings'))";
  assert.equal(setup.split(marker).length,2);
  setup=setup.replace(marker,"('private','wallet_postings'),('private','completed_movement_principals'))");
  const branch="IF (x.nspname,x.relname)=('private','financial_agreements')";
  assert.equal(setup.split(branch).length,2);
  setup=setup.replace(branch,"IF (x.nspname,x.relname)=('public','members') THEN EXECUTE 'SELECT md5(coalesce(string_agg((to_jsonb(t)-''completed_movements'')::text, '''' ORDER BY (to_jsonb(t)-''completed_movements'')::text), '''')) FROM public.members t' INTO h; ELS"+branch);
  const output=c.target(setup+completionChecks('installed'));
  const count=output.split('\n').filter(line=>/\|t\|/.test(line)).length;assert.equal(count,zero?74:75);total+=count;
 }
 console.log('PASS '+total+' unchanged 0083 settlement checks with 0085 installed in disposable database');
 const f=c.fresh({started:true}),pending=c.fresh({started:true});
 c.target('BEGIN; '+c.action(f,'request_my_funded_movement_completion',f.offerer)+c.action(f,'confirm_my_funded_movement_completion',f.requester)+' COMMIT;');
 const reputation=fs.readFileSync(path.join(__dirname,'0084_completed_movement_reputation_test.sql'),'utf8')
  .replaceAll('__SCHEMA__',f.schema).replaceAll('__NEED__',f.need).replaceAll('__ALIGNMENT__',f.alignment)
  .replaceAll('__REQUESTER__',f.requester).replaceAll('__OFFERER__',f.offerer).replaceAll('__TRAVELLER__',f.traveller)
  .replaceAll('__PENDING__',pending.need).replaceAll('__PENDING_REQUESTER__',pending.requester);
 console.log(c.target(reputation));
 const legacy=fs.readFileSync(path.join(__dirname,'0019_mutual_no_travel_closure_test.sql'),'utf8');
 const legacyProjection=`DO $$ DECLARE x record; status record; BEGIN
  FOR x IN SELECT a.movement_need_id,n.first_principal_id FROM private.mutual_no_travel_closures n JOIN public.journeys j ON j.id=n.journey_id JOIN public.alignments a ON a.id=j.alignment_id LOOP
   PERFORM set_config('request.jwt.claim.sub',x.first_principal_id::text,true);
   SELECT * INTO STRICT status FROM public.get_my_movement_end_status_by_need(x.movement_need_id);
   IF status.funding_disposition<>'legacy' OR status.released_minor IS NOT NULL OR status.currency IS NOT NULL THEN RAISE EXCEPTION 'Legacy financial proof was fabricated'; END IF;
  END LOOP;
 END $$;`;
 const legacyOutput=c.target(legacy.replace(/ROLLBACK;\s*$/,()=>legacyProjection+' ROLLBACK;'));
 assert.doesNotMatch(legacyOutput,/\|f(?:\||$)/m);console.log('PASS '+legacyOutput.split('\n').filter(l=>/\|t$/.test(l)).length+' legacy 0019 checks; old no-travel projection has no fabricated financial proof');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
