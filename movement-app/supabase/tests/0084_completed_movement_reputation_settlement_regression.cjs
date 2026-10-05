'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0084_completed_movement_reputation_harness.cjs');
const {fixtures,completionChecks}=require('./0082_financial_movement_completion_behavior.cjs');
async function main(){await run(async c=>{
 let total=0;
 for(const zero of [false,true]){
  // 0084 deliberately adds exact principal receipts/counts. Keep every wallet,
  // payment, operational and rating table in the original side-effect proof.
  // Only those new receipts and members.completed_movements are allowed here.
  const marker="('private','wallet_postings'))";
  let setup=fixtures(zero);assert.equal(setup.split(marker).length,2);
  setup=setup.replace(marker,"('private','wallet_postings'),('private','completed_movement_principals'))");
  const branch="IF (x.nspname,x.relname)=('private','financial_agreements')";
  assert.equal(setup.split(branch).length,2);
  setup=setup.replace(branch,"IF (x.nspname,x.relname)=('public','members') THEN EXECUTE 'SELECT md5(coalesce(string_agg((to_jsonb(t)-''completed_movements'')::text, '''' ORDER BY (to_jsonb(t)-''completed_movements'')::text), '''')) FROM public.members t' INTO h; ELS"+branch);
  const assertion=`DO $$ DECLARE a uuid; BEGIN
   SELECT alignment_id INTO STRICT a FROM private.financial_agreements WHERE id=(SELECT agreement FROM pg_temp.funding_fixture);
   IF (SELECT count(*) FROM private.completed_movement_principals WHERE alignment_id=a)<>2
    OR EXISTS(SELECT 1 FROM private.completed_movement_principals p JOIN public.members m ON m.id=p.member_id WHERE p.alignment_id=a AND m.completed_movements<>1)
    OR EXISTS(SELECT 1 FROM public.members m JOIN pg_temp.snapshot_fixture f ON f.traveller=m.id WHERE m.completed_movements<>0) THEN RAISE EXCEPTION 'Exact 0084 completion side effects required'; END IF;
  END $$;`;
  const output=c.target(setup+completionChecks('installed').replace(/ROLLBACK;\s*$/,()=>assertion+'\nROLLBACK;'));
  const checks=output.split('\n').filter(line=>/\|t\|/.test(line)).length;
  assert.equal(checks,zero?74:75);total+=checks;
 }
 console.log('PASS '+total+' unchanged 0083 settlement behavioral checks with 0084 source present');
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
