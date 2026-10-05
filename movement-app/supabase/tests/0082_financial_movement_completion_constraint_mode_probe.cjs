'use strict';
// Explicit rollback-only integration runner. Same-schema/name mirror triggers
// share SET CONSTRAINTS selection with the real triggers and expose timing by
// raising on a controlled later insert. No catalog inference of current mode.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const {query,snapshot,container}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const {fixtures,migrationBody}=require('./0082_financial_movement_completion_behavior.cjs');
const {inspect,sourceBody}=require('./0082_financial_movement_completion_harness.cjs');
const constraints=['private.wallet_transaction_balanced_after_transaction','private.wallet_transaction_balanced_after_posting','private.funded_completion_request_complete','private.funded_completion_complete','private.funded_completion_transaction_complete','private.funded_completion_posting_complete','public.funded_start_journey_complete','public.funded_start_alignment_complete'];
const profiles=['default','immediate','deferred','wallet_immediate','wallet_deferred','completion_immediate','completion_deferred','mixed'];
const oracle=`
CREATE TABLE private.completion_mode_oracle(constraint_name text);
CREATE TABLE public.completion_mode_oracle(constraint_name text);
CREATE FUNCTION pg_temp.mode_oracle_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='ZX002',MESSAGE='immediate mode oracle'; END $$;
CREATE TEMP TABLE mode_expected(name text PRIMARY KEY,mode text);
DO $$ DECLARE name text; schema_name text; trigger_name text; initial_deferred boolean;
BEGIN
 FOREACH name IN ARRAY ARRAY[${constraints.map(n=>"'"+n+"'").join(',')}] LOOP
  schema_name:=split_part(name,'.',1);trigger_name:=split_part(name,'.',2);
  SELECT t.tginitdeferred INTO STRICT initial_deferred FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=schema_name AND t.tgname=trigger_name;
  EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON %I.completion_mode_oracle DEFERRABLE INITIALLY %s FOR EACH ROW WHEN (NEW.constraint_name=%L) EXECUTE FUNCTION pg_temp.mode_oracle_trigger()',trigger_name,schema_name,CASE WHEN initial_deferred THEN 'DEFERRED' ELSE 'IMMEDIATE' END,name);
  INSERT INTO mode_expected VALUES(name,CASE WHEN initial_deferred THEN 'deferred' ELSE 'immediate' END);
 END LOOP;
END $$;
CREATE FUNCTION pg_temp.observed_mode(name text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
 BEGIN
  EXECUTE format('INSERT INTO %I.completion_mode_oracle VALUES($1)',split_part(name,'.',1)) USING name;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='deferred oracle rollback';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN result:='deferred'; WHEN SQLSTATE 'ZX002' THEN result:='immediate'; END;
 RETURN result;
END $$;
CREATE FUNCTION pg_temp.check_modes(phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE x record; actual text;
BEGIN
 FOR x IN SELECT * FROM mode_expected ORDER BY name LOOP
  actual:=pg_temp.observed_mode(x.name);
  IF actual<>x.mode THEN RAISE EXCEPTION 'Caller mode changed: phase=% constraint=% expected=% actual=%',phase,x.name,x.mode,actual; END IF;
 END LOOP;
END $$;
CREATE FUNCTION pg_temp.real_wallet_mode(posting boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t uuid; account_id uuid; result text;
BEGIN
 BEGIN
  IF posting THEN SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction DEFERRED; END IF;
  INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key)
   VALUES('internal_transfer','NGN','mode-probe:'||gen_random_uuid()) RETURNING id INTO t;
  IF posting THEN
   SELECT w.id INTO STRICT account_id FROM private.wallet_accounts w JOIN pg_temp.snapshot_fixture f ON w.member_id=f.requester
    WHERE w.account_kind='member_available' AND w.currency='NGN';
   INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(t,account_id,'credit',1);
  END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='deferred wallet rollback';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN result:='deferred'; WHEN check_violation THEN
  IF SQLERRM<>'Wallet transaction must contain balanced debit and credit postings' THEN RAISE; END IF;
  result:='immediate';
 END;
 RETURN result;
END $$;
`;
function settings(profile){return constraints.map((name,index)=>{
 let mode;
 if(profile==='immediate'||profile==='deferred')mode=profile;
 else if(profile==='mixed')mode=index%2?'deferred':'immediate';
 else if(profile.startsWith('wallet_')&&index<2)mode=profile.slice(7);
 else if(profile.startsWith('completion_')&&index>=2)mode=profile.slice(11);
 return mode?`SET CONSTRAINTS ${name} ${mode.toUpperCase()}; UPDATE mode_expected SET mode='${mode}' WHERE name='${name}';`:'';
}).join('\n');}
const exercise=`DO $$ DECLARE before text; result jsonb; x record;
BEGIN
 PERFORM pg_temp.check_modes('before request');
 FOR x IN SELECT * FROM mode_expected WHERE name LIKE 'private.wallet_transaction_balanced%' LOOP
  IF pg_temp.real_wallet_mode(x.name LIKE '%posting')<>x.mode THEN RAISE EXCEPTION 'Real wallet oracle differs: %',x.name; END IF;
 END LOOP;
 before:=pg_temp.materialization_sources();
 result:=pg_temp.completion_result(true);PERFORM pg_temp.consent_rejected(result,'23514');
 IF before<>pg_temp.materialization_sources() THEN RAISE EXCEPTION 'Premature failure wrote rows'; END IF;
 PERFORM pg_temp.check_modes('premature failure');
 result:=pg_temp.completion_result(false,(SELECT requester FROM pg_temp.snapshot_fixture));PERFORM pg_temp.consent_rejected(result,'42501');
 IF before<>pg_temp.materialization_sources() THEN RAISE EXCEPTION 'Wrong-requester failure wrote rows'; END IF;
 PERFORM pg_temp.check_modes('request authorization failure');
 PERFORM pg_temp.funding_succeed(pg_temp.completion_result());
 PERFORM pg_temp.check_modes('request success');
 before:=pg_temp.materialization_sources();PERFORM pg_temp.funding_succeed(pg_temp.completion_result());
 IF before<>pg_temp.materialization_sources() THEN RAISE EXCEPTION 'Request replay wrote rows'; END IF;
 PERFORM pg_temp.check_modes('request replay');
 BEGIN
  INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES(NULL,'platform_revenue','NGN')
   ON CONFLICT(account_kind,currency) WHERE member_id IS NULL DO NOTHING;
  UPDATE private.wallet_accounts SET status='closed' WHERE member_id IS NULL AND account_kind='platform_revenue' AND currency='NGN';
  result:=pg_temp.completion_result(true);PERFORM pg_temp.consent_rejected(result,'23514');
  PERFORM pg_temp.check_modes('late confirmation failure');
  RAISE EXCEPTION USING ERRCODE='ZX003',MESSAGE='failure setup rollback';
 EXCEPTION WHEN SQLSTATE 'ZX003' THEN NULL; END;
 IF before<>pg_temp.materialization_sources() THEN RAISE EXCEPTION 'Late failure leaked provisioning/setup'; END IF;
 BEGIN
  PERFORM pg_temp.funding_succeed(pg_temp.completion_result(true));
  RAISE EXCEPTION USING ERRCODE='ZX003',MESSAGE='confirmation rollback';
 EXCEPTION WHEN SQLSTATE 'ZX003' THEN NULL; END;
 IF before<>pg_temp.materialization_sources() THEN RAISE EXCEPTION 'Confirmation rollback wrote rows'; END IF;
 PERFORM pg_temp.check_modes('confirmation rollback');
 PERFORM pg_temp.funding_succeed(pg_temp.completion_result(true));
 PERFORM pg_temp.check_modes('confirmation success');
 before:=pg_temp.materialization_sources();
 PERFORM pg_temp.funding_succeed(pg_temp.completion_result(true));PERFORM pg_temp.funding_succeed(pg_temp.completion_result());
 IF before<>pg_temp.materialization_sources() THEN RAISE EXCEPTION 'Completed replay wrote rows'; END IF;
 PERFORM pg_temp.check_modes('completed replays');
 FOR x IN SELECT * FROM mode_expected WHERE name LIKE 'private.wallet_transaction_balanced%' LOOP
  IF pg_temp.real_wallet_mode(x.name LIKE '%posting')<>x.mode THEN RAISE EXCEPTION 'Post-confirm real wallet oracle differs: %',x.name; END IF;
 END LOOP;
END $$;
SELECT 'PASS_MODE_MATRIX'; ROLLBACK;`;
function main(){
 const mode=inspect(query);const load=mode==='source'?sourceBody(query):'';
 const before=query('postgres',snapshot);let cases=0;
 try{for(const zero of [false,true])for(const profile of profiles){
  const setup=fixtures(zero).replace(/^BEGIN;/,()=>`BEGIN;\n${load}\nSELECT set_config('movement.fixture_scenario','mode-${profile}-zero-${zero}',true);`);
  const output=query('postgres',setup+oracle+'SELECT pg_temp.prepare_completion();\n'+settings(profile)+exercise);
  assert(output.includes('PASS_MODE_MATRIX'));cases++;console.log('PASS mode matrix profile='+profile+' zero='+zero+'; 8 constraints, 9 phases, real wallet oracle');
 }}finally{assert.equal(query('postgres',snapshot),before,'Mode probe source/data/catalog/ACL/RLS/history restored');console.log('PASS mode matrix application fingerprint unchanged');}
 console.log('PASS '+cases+' mode cases; '+cases*8*9+' behavior-based mode assertions');
}
module.exports={constraints,profiles};
function diagnostics(){
 throw new Error('Pre-hardening diagnostics are archived; unavailable under 0082 temporal semantics');
 const before=query('postgres',snapshot);const load='';
 try{
  const setup=fixtures().replace(/^BEGIN;/,()=>`BEGIN;\n${migrationBody}\nSELECT set_config('movement.fixture_scenario','intentional-future-resolution-diagnostic',true);`);
  const input=setup+`DO $$ DECLARE selected uuid; owner uuid; rejected boolean:=false; rejected_creation boolean:=false; BEGIN
   SELECT requester INTO owner FROM pg_temp.snapshot_fixture;
   SELECT x.location_reference_id INTO STRICT selected FROM public.record_verified_selected_location_for_server(owner,gen_random_uuid(),'Diagnostic area','test-provider','diagnostic-'||gen_random_uuid(),'selection_proof_v1',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 hours') x;
   BEGIN
    PERFORM public.record_attested_location_resolution_for_server(owner,selected,gen_random_uuid(),'test-provider','geocode','v1',(SELECT provider_place_reference FROM private.movement_location_references WHERE id=selected),'test-resolution-v1','Lagos meeting area','region-lagos','Lagos',6.4,3.3,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '4 hours');
   EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'Trusted provider resolution timestamps are invalid' THEN RAISE; END IF;rejected:=true;
   END;
   IF NOT rejected THEN RAISE EXCEPTION 'Future resolution was accepted'; END IF;
   BEGIN
    INSERT INTO private.movement_location_references(owner_member_id,declared_label,source_kind,resolution_status,provider_namespace,provider_place_reference,created_at)
     VALUES(owner,'Diagnostic future creation','member_selected','unresolved','test-provider','diagnostic-creation-'||gen_random_uuid(),clock_timestamp()+interval '1 hour');
   EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'Movement context creation time or expiry is invalid' THEN RAISE; END IF;rejected_creation:=true;
   END;
   IF NOT rejected_creation THEN RAISE EXCEPTION 'Future creation was accepted'; END IF;
  END $$; SELECT 'PASS_TIMESTAMP_DIAGNOSTICS'; ROLLBACK;`;
  const result=cp.spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input,encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,windowsHide:true});
  assert.equal(result.status,0,result.stderr+result.stdout);assert(result.stdout.includes('PASS_TIMESTAMP_DIAGNOSTICS'));
  const captured=JSON.parse(result.stderr.match(/0082_LOCATION_DIAGNOSTIC=(\{[^\n]+\})/)[1]);
  for(const name of ['fixture','source_id','selected_created_at','resolved_at','producer_v_now','expires_at','clock_timestamp','transaction_timestamp','statement_timestamp','isolation'])assert(captured[name],name);
  assert.equal(captured.fixture,'intentional-future-resolution-diagnostic');assert.equal(captured.isolation,'read committed');
  assert(Date.parse(captured.resolved_at)>Date.parse(captured.producer_v_now));
  const creation=JSON.parse(result.stderr.match(/0082_CREATION_DIAGNOSTIC=(\{[^\n]+\})/)[1]);
  assert(Date.parse(creation.row.created_at)>Date.parse(creation.creation_check_clock));
  assert.equal(creation.table,'private.movement_location_references');assert.equal(creation.expiry_check_clock,'');
  console.log('PASS intentional timestamp rejection retained 23514; exact diagnostic clocks captured: '+JSON.stringify(captured));
  console.log('PASS intentional creation rejection retained 23514; exact predicate clock captured: '+JSON.stringify(creation));
 }finally{assert.equal(query('postgres',snapshot),before);console.log('PASS timestamp diagnostic application fingerprint unchanged');}
}
if(require.main===module)try{process.argv.includes('--diagnostics')?diagnostics():main();}catch(e){console.error(e.stack);process.exitCode=1;}
