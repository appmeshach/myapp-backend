'use strict';
// Explicit local source stress. One fresh rollback transaction per path; no
// retries, persistent source installation, or migration-history manipulation.
const assert=require('node:assert/strict');
const {query,snapshot}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const {fixtures,migrationBody,timestampDiagnostics}=require('./0082_financial_movement_completion_behavior.cjs');
const fs=require('node:fs'),path=require('node:path');
const {inspect,sourceBody}=require('./0082_financial_movement_completion_harness.cjs');
const checks=`
CREATE FUNCTION pg_temp.stress_balances() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'held',coalesce((SELECT sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END) FROM private.wallet_postings p JOIN private.wallet_accounts w ON w.id=p.account_id WHERE w.member_id=f.requester AND w.account_kind='member_held' AND w.currency='NGN'),0),
 'withdrawable',coalesce((SELECT sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END) FROM private.wallet_postings p JOIN private.wallet_accounts w ON w.id=p.account_id WHERE w.member_id=f.offerer AND w.account_kind='member_withdrawable' AND w.currency='NGN'),0),
 'revenue',coalesce((SELECT sum(CASE WHEN p.direction='credit' THEN p.amount_minor::numeric ELSE -p.amount_minor::numeric END) FROM private.wallet_postings p JOIN private.wallet_accounts w ON w.id=p.account_id WHERE w.member_id IS NULL AND w.account_kind='platform_revenue' AND w.currency='NGN'),0)) FROM pg_temp.snapshot_fixture f;
$$;
CREATE FUNCTION pg_temp.stress_require(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE graph jsonb;
BEGIN
 IF ok IS NOT TRUE THEN
  SELECT jsonb_build_object('label',label,'fixture',to_jsonb(f),'agreement',to_jsonb(g),
   'alignment',(SELECT to_jsonb(a) FROM public.alignments a WHERE a.id=g.alignment_id),
   'journey',(SELECT to_jsonb(j) FROM public.journeys j WHERE j.alignment_id=g.alignment_id),
   'requests',(SELECT jsonb_agg(to_jsonb(r)) FROM private.funded_movement_completion_requests r WHERE r.alignment_id=g.alignment_id),
   'completions',(SELECT jsonb_agg(to_jsonb(r)) FROM private.funded_movement_completions r WHERE r.alignment_id=g.alignment_id),
   'components',(SELECT jsonb_agg(to_jsonb(c)) FROM private.financial_components c WHERE c.agreement_id=g.id),
   'transactions',(SELECT jsonb_agg(to_jsonb(t)) FROM private.wallet_transactions t WHERE t.alignment_id=g.alignment_id),
   'postings',(SELECT jsonb_agg(to_jsonb(p)) FROM private.wallet_postings p JOIN private.wallet_transactions t ON t.id=p.transaction_id WHERE t.alignment_id=g.alignment_id),
   'accounts',(SELECT jsonb_agg(to_jsonb(w)) FROM private.wallet_accounts w WHERE w.member_id IN(f.requester,f.offerer) OR w.member_id IS NULL),
   'balances',pg_temp.stress_balances()) INTO graph
   FROM pg_temp.snapshot_fixture f CROSS JOIN private.financial_agreements g JOIN pg_temp.funding_fixture b ON b.agreement=g.id;
  RAISE NOTICE '0082_STRESS_DIAGNOSTIC=%',graph;
  RAISE EXCEPTION 'Unexpected settlement stress result: %',label;
 END IF;
END $$;
DO $$ DECLARE f record; g private.financial_agreements%ROWTYPE; j public.journeys%ROWTYPE;
 c private.financial_components%ROWTYPE; t private.wallet_transactions%ROWTYPE;
 before jsonb; after jsonb; replay_before text; other_before text; response jsonb; retry jsonb;
 r numeric; contribution numeric; o numeric; kind text; debit_id uuid; credit_id uuid; transaction_count integer;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x JOIN pg_temp.funding_fixture b ON b.agreement=x.id;
 before:=pg_temp.stress_balances();other_before:=pg_temp.completion_other_sources();
 response:=pg_temp.completion_result();PERFORM pg_temp.funding_succeed(response);
 PERFORM pg_temp.stress_require(response#>>'{rows,0,settlement_state}'='awaiting_confirmation','offerer request response');
 PERFORM pg_temp.stress_require((SELECT count(*) FROM private.funded_movement_completion_requests WHERE alignment_id=g.alignment_id)=1,'one request receipt');
 response:=pg_temp.completion_result(true);PERFORM pg_temp.funding_succeed(response);
 SELECT x.* INTO STRICT j FROM public.journeys x WHERE x.alignment_id=g.alignment_id;
 PERFORM pg_temp.stress_require(j.status='completed' AND (SELECT status='completed' FROM public.alignments WHERE id=g.alignment_id),'completed lifecycle');
 PERFORM pg_temp.stress_require(response#>>'{rows,0,settlement_state}'='settled','requester confirmation response');
 PERFORM pg_temp.stress_require((SELECT count(*) FROM private.funded_movement_completions WHERE alignment_id=g.alignment_id AND financial_agreement_id=g.id AND journey_id=j.id AND completed_at=j.completed_at)=1,'one exact completion timestamp receipt');
 PERFORM pg_temp.stress_require((SELECT count(*) FROM private.funded_movement_completion_requests WHERE alignment_id=g.alignment_id AND financial_agreement_id=g.id AND journey_id=j.id AND requested_at=j.completion_requested_at)=1,'exact request timestamp receipt');
 SELECT max(amount_minor) FILTER(WHERE component_key='requester_platform_share'),max(amount_minor) FILTER(WHERE component_key='movement_contribution'),max(amount_minor) FILTER(WHERE component_key='offering_platform_share') INTO r,contribution,o FROM private.financial_components WHERE agreement_id=g.id;
 after:=pg_temp.stress_balances();
 PERFORM pg_temp.stress_require((after->>'held')::numeric=(before->>'held')::numeric-r-contribution,'exact held decrease');
 PERFORM pg_temp.stress_require((after->>'withdrawable')::numeric=(before->>'withdrawable')::numeric+contribution-o,'exact offerer net');
 PERFORM pg_temp.stress_require((after->>'revenue')::numeric=(before->>'revenue')::numeric+r+o,'exact platform revenue');
 FOR c IN SELECT * FROM private.financial_components WHERE agreement_id=g.id LOOP
  kind:=CASE c.component_key WHEN 'requester_platform_share' THEN 'requester_platform_charge' WHEN 'movement_contribution' THEN 'movement_contribution_settlement' ELSE 'offering_platform_charge' END;
  SELECT count(*) INTO transaction_count FROM private.wallet_transactions WHERE financial_component_id=c.id AND transaction_kind IN('requester_platform_charge','movement_contribution_settlement','offering_platform_charge');
  IF c.amount_minor=0 THEN
   PERFORM pg_temp.stress_require(transaction_count=0 AND NOT EXISTS(SELECT 1 FROM private.wallet_transactions WHERE idempotency_key=kind||':'||c.id::text),'zero component absent');
  ELSE
   PERFORM pg_temp.stress_require(transaction_count=1,'one transaction per positive component');
   SELECT * INTO STRICT t FROM private.wallet_transactions WHERE financial_component_id=c.id AND transaction_kind=kind;
   PERFORM pg_temp.stress_require(t.alignment_id=g.alignment_id AND t.currency=g.currency AND t.idempotency_key=kind||':'||c.id::text AND t.created_at=j.completed_at AND t.provider IS NULL AND t.provider_reference IS NULL,'exact transaction identity');
   SELECT id INTO STRICT debit_id FROM private.wallet_accounts WHERE currency=g.currency AND
    ((c.component_key='offering_platform_share' AND member_id=f.offerer AND account_kind='member_withdrawable') OR (c.component_key<>'offering_platform_share' AND member_id=f.requester AND account_kind='member_held'));
   SELECT id INTO STRICT credit_id FROM private.wallet_accounts WHERE currency=g.currency AND
    ((c.component_key='movement_contribution' AND member_id=f.offerer AND account_kind='member_withdrawable') OR (c.component_key<>'movement_contribution' AND member_id IS NULL AND account_kind='platform_revenue'));
   PERFORM pg_temp.stress_require((SELECT count(*)=2 AND count(*) FILTER(WHERE amount_minor=c.amount_minor AND created_at=j.completed_at AND ((account_id=debit_id AND direction='debit') OR (account_id=credit_id AND direction='credit')))=2 FROM private.wallet_postings WHERE transaction_id=t.id),'exact two positive postings');
  END IF;
 END LOOP;
 PERFORM pg_temp.stress_require((SELECT count(*) FROM private.wallet_transactions WHERE alignment_id=g.alignment_id AND transaction_kind IN('requester_platform_charge','movement_contribution_settlement','offering_platform_charge'))=(SELECT count(*) FROM private.financial_components WHERE agreement_id=g.id AND amount_minor>0),'exact total transaction count');
 PERFORM pg_temp.stress_require(NOT EXISTS(SELECT 1 FROM private.wallet_postings p JOIN private.wallet_transactions ledger ON ledger.id=p.transaction_id WHERE ledger.alignment_id=g.alignment_id AND p.amount_minor<=0),'no zero-value postings');
 PERFORM pg_temp.stress_require(NOT EXISTS(SELECT 1 FROM private.movement_settlements WHERE alignment_id=g.alignment_id),'no legacy settlement');
 PERFORM private.assert_funded_coordination_entry(g.alignment_id);
 PERFORM pg_temp.stress_require(other_before=pg_temp.completion_other_sources(),'no unrelated side effects');
 replay_before:=pg_temp.materialization_sources();retry:=pg_temp.completion_result(true);PERFORM pg_temp.funding_succeed(retry);
 PERFORM pg_temp.stress_require(response=retry AND replay_before=pg_temp.materialization_sources(),'exact zero-write confirmation replay');
 retry:=pg_temp.completion_result();PERFORM pg_temp.funding_succeed(retry);
 PERFORM pg_temp.stress_require(response->'rows'=retry->'rows' AND replay_before=pg_temp.materialization_sources(),'exact zero-write request replay');
END $$;
SELECT 'PASS_FOCUSED_SETTLEMENT'; ROLLBACK;`;
function main(){
 const mode=inspect(query);const load=mode==='source'?sourceBody(query):'';
 const historicalModes=['--discovery-only','--proposal-diagnostics','--proposal-only'];
 if(historicalModes.some(flag=>process.argv.includes(flag)))throw new Error('Pre-hardening diagnostic modes are archived; no function patching under 0082 temporal semantics');
 const before=query('postgres',snapshot);let normal=0,zeroCount=0;
 if(process.argv.includes('--temporal-audit')){
  // Catalog-only inventory. No source loading, fixtures, DDL or data mutation.
  const catalog=JSON.parse(query('postgres',`SELECT jsonb_build_object(
   'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'schema',n.nspname,'name',p.proname,'arguments',pg_get_function_arguments(p.oid),'body',p.prosrc,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role_execute',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY n.nspname,p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('private','public') AND p.prokind='f'),
   'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,'rls',c.relrowsecurity,'anon_insert',has_table_privilege('anon',c.oid,'INSERT'),'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),'service_role_insert',has_table_privilege('service_role',c.oid,'INSERT')) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private') AND c.relkind='r'),
   'write_privileges',(SELECT jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'role',r.role_name,'insert',has_table_privilege(r.role_name,c.oid,'INSERT'),'update',has_table_privilege(r.role_name,c.oid,'UPDATE'),'delete',has_table_privilege(r.role_name,c.oid,'DELETE'),'any_column_insert',has_any_column_privilege(r.role_name,c.oid,'INSERT'),'any_column_update',has_any_column_privilege(r.role_name,c.oid,'UPDATE')) ORDER BY c.oid,r.role_name) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(role_name) WHERE n.nspname IN('public','private') AND c.relkind='r'),
   'timestamp_columns',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_schema,x.table_name,x.column_name) FROM information_schema.columns x WHERE x.table_schema IN('public','private') AND x.data_type IN('timestamp with time zone','timestamp without time zone')),
   'sequences',(SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'name',sequencename,'type',data_type,'start',start_value,'increment',increment_by,'cycle',cycle,'cache',cache_size) ORDER BY schemaname,sequencename) FROM pg_sequences WHERE schemaname IN('public','private')),
   'local_face_counts',(SELECT jsonb_build_object('attempts',(SELECT count(*) FROM private.alignment_face_verifications),'activation_faces',(SELECT count(*) FROM private.funded_movement_activation_faces))),
   'ingestion_compatibility',(SELECT jsonb_build_object(
    'selection_rows',(SELECT count(*) FROM private.movement_location_selection_attestations),
    'resolution_rows',(SELECT count(*) FROM private.movement_location_resolution_evidence),
    'route_rows',(SELECT count(*) FROM private.offering_route_evidence),
    'match_rows',(SELECT count(*) FROM private.trusted_route_match_evidence),
    'resolution_incompatible',(SELECT count(*) FROM private.movement_location_resolution_evidence e JOIN private.movement_location_references t ON t.id=e.resolved_location_reference_id WHERE t.created_at IS DISTINCT FROM e.recorded_at OR t.resolved_at>e.recorded_at OR (t.expires_at IS NOT NULL AND t.expires_at<=e.recorded_at)),
    'route_incompatible',(SELECT count(*) FROM private.offering_route_evidence WHERE generated_at>created_at OR (expires_at IS NOT NULL AND expires_at<=created_at)),
    'match_incompatible',(SELECT count(*) FROM private.trusted_route_match_evidence WHERE calculated_at>created_at OR (expires_at IS NOT NULL AND expires_at<=created_at)))),
   'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid),'deferrable',c.condeferrable,'deferred',c.condeferred) ORDER BY c.conrelid,c.conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN('public','private')),
   'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgrelid,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private') AND NOT t.tgisinternal),
   'policies',(SELECT jsonb_agg(jsonb_build_object('table',p.polrelid::regclass::text,'name',p.polname,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polrelid,p.polname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private')),
   'migration_versions',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations));`));
  assert.equal(query('postgres',snapshot),before,'Read-only temporal catalog audit fingerprint unchanged');
  fs.writeFileSync(path.join(__dirname,'../../docs/0082-temporal-audit-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  console.log('PASS catalog-only temporal audit; functions='+catalog.functions.length+' timestamp_columns='+catalog.timestamp_columns.length+' fingerprint unchanged');return;
 }
 if(process.argv.includes('--discovery-provenance')){
  console.log(query('postgres',"SELECT proname||E'\\n'||pg_get_functiondef(oid) FROM pg_proc WHERE oid IN('private.assert_trusted_location_discovery_area(uuid)'::regprocedure,'private.protect_movement_context_record()'::regprocedure) OR (pronamespace='public'::regnamespace AND proname='record_location_resolution_for_server');"));
  console.log(query('postgres',"SELECT jsonb_build_object('creation_delta_microseconds',extract(epoch FROM ('2026-10-04T16:36:38.138255Z'::timestamptz-'2026-10-04T16:36:38.132917Z'::timestamptz))*1000000,'created_at_precision',(SELECT datetime_precision FROM information_schema.columns WHERE table_schema='private' AND table_name='movement_location_references' AND column_name='created_at'));"));
  assert.equal(query('postgres',snapshot),before,'Read-only provenance fingerprint unchanged');return;
 }
 if(process.argv.includes('--discovery-only')){
  let count=0;let failure;
  const endpoint=fixtures(false).match(/CREATE FUNCTION pg_temp.snapshot_state_endpoint\([^]*?END; \$\$;/)[0];
  const artifact={mode:'discovery-only',required:1000,passed:0,retries:0,restored:false};
  try{for(let run=1;run<=1000;run++){
   const scenario='discovery-only-'+run;
   const input=`BEGIN; SELECT set_config('movement.fixture_scenario','${scenario}',true);
    ${timestampDiagnostics}\n${endpoint}
    DO $$ DECLARE owner uuid:=gen_random_uuid(); location uuid; evidence uuid; t timestamptz:=clock_timestamp(); BEGIN
     INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      VALUES(owner,'authenticated','authenticated',owner::text||'@test-0082-discovery.invalid',t,'{"provider":"email","providers":["email"]}','{}',t,t);
     location:=pg_temp.snapshot_state_endpoint(owner,'Agungi, Lagos','${scenario}-'||gen_random_uuid(),6.43,3.52);
     SELECT e.id INTO STRICT evidence FROM private.movement_location_resolution_evidence e WHERE e.resolved_location_reference_id=location;
     PERFORM private.assert_movement_location_resolution_evidence(evidence);
     PERFORM private.assert_trusted_location_discovery_area(evidence);
     PERFORM private.assert_trusted_location_state_evidence(evidence);
    END $$; SELECT 'PASS_DISCOVERY_ONLY'; ROLLBACK;`;
   try{const output=query('postgres',input);assert(output.includes('PASS_DISCOVERY_ONLY'));}
   catch(e){artifact.scenario=scenario;artifact.error=e.message;
    artifact.diagnostics=Object.fromEntries([...e.message.matchAll(/(0082_[A-Z]+_DIAGNOSTIC)=(\{[^\n]+\})/g)].map(m=>[m[1],JSON.parse(m[2])]));
    artifact.diagnostic=artifact.diagnostics['0082_DISCOVERY_DIAGNOSTIC']||null;
    failure=e;break;
   }
   count++;artifact.passed=count;console.log('PASS discovery-only path='+run+'; isolated trusted endpoint, no financial graph');
  }}finally{
   let restorationError;
   try{assert.equal(query('postgres',snapshot),before,'Discovery-only source/data/catalog/ACL/RLS/history restored');artifact.restored=true;console.log('PASS discovery-only application fingerprint unchanged');}
   catch(e){restorationError=e;artifact.restoration_error=e.message;}
   try{fs.writeFileSync(path.join(__dirname,'../../docs/0082-discovery-area-stress-result.json'),JSON.stringify(artifact,null,2)+'\n');}
   catch(e){if(failure||restorationError)console.error('Diagnostic artifact write failed: '+e.stack);else throw e;}
   if(restorationError){if(failure)throw new AggregateError([failure,restorationError],'Discovery failure and restoration failure');throw restorationError;}
  }
  if(failure)throw failure;
  console.log('PASS '+count+' fresh discovery-area paths; no retries');return;
 }
 if(process.argv.includes('--proposal-diagnostics')){
  try{
   const fixture=fixtures(false);const end=fixture.indexOf('CREATE TEMP TABLE pg_temp.funding_fixture(');
   assert(end>0,'Unconsented proposal fixture boundary drift');
   const setup=fixture.slice(0,end).replace(/^BEGIN;/,()=>"BEGIN; SELECT set_config('movement.fixture_scenario','intentional-future-proposal-diagnostic',true);");
   let failure;try{query('postgres',setup+`UPDATE private.financial_proposals p SET offering_accepted_at=clock_timestamp()+interval '1 hour',
    movement_offer_id=(SELECT movement_offer FROM pg_temp.snapshot_fixture) WHERE p.id=(SELECT proposal FROM pg_temp.consent_fixture);`);}catch(e){failure=e;}
   assert(failure,'Expected intentional future consent rejection');assert.match(failure.message,/23514: Proposal evidence cannot be future-dated/);
   const captured=JSON.parse(failure.message.match(/0082_PROPOSAL_DIAGNOSTIC=(\{[^\n]+\})/)[1]);
   assert.equal(captured.failed_predicates.offering_accepted_at,true);
   assert.equal(captured.failed_predicates.requester_accepted_at,null);
   assert.equal(captured.failed_predicates.materialized_at,null);
   assert(captured.deltas_microseconds.offering_accepted_at>0);
   for(const x of ['snapshot','quote','pricing_geography','offer_binding','match','route','locations','provider_resolution','provider_state'])assert(captured.evidence_chain[x],x);
   console.log('PASS intentional future consent preserves 23514; exact failed predicate and PostgreSQL delta: '+JSON.stringify(captured));
  }finally{assert.equal(query('postgres',snapshot),before,'Proposal diagnostic source/data/catalog/ACL/RLS/history restored');console.log('PASS proposal diagnostic application fingerprint unchanged');}
  return;
 }
 if(process.argv.includes('--proposal-only')){
  let count=0;
  // Reuse the exact endpoint/need/intent/route/match/quote/consent producers,
  // stopping immediately after the inherited requester materialization setup.
  // No 0082 source DDL or completion/funding/activation/start call is required.
  const fixture=fixtures(false);
  const materialization=fixture.indexOf('INSERT INTO pg_temp.funding_fixture VALUES');
  const end=fixture.indexOf('END $$;',materialization);
  assert(materialization>0&&end>materialization,'Materialization fixture boundary drift');
  const setup=fixture.slice(0,end+'END $$;'.length)+'\nSET CONSTRAINTS ALL IMMEDIATE;\n';
  const guard=query('postgres',"SELECT prosrc FROM pg_proc WHERE oid='private.protect_financial_proposal()'::regprocedure;");
  assert(guard.includes('NEW.offering_accepted_at>clock_timestamp() OR NEW.requester_accepted_at>clock_timestamp()'));
  assert(guard.includes('OR NEW.materialized_at>clock_timestamp() THEN'));
  console.log('PASS installed proposal guard uses exact three clock_timestamp comparisons');
  try{for(let run=1;run<=500;run++){
   const input=setup.replace(/^BEGIN;/,()=>`BEGIN; SELECT set_config('movement.fixture_scenario','proposal-only-${run}',true);`)+`
    DO $$ DECLARE p private.financial_proposals%ROWTYPE; BEGIN
     SELECT x.* INTO STRICT p FROM private.financial_proposals x JOIN pg_temp.consent_fixture f ON f.proposal=x.id;
     IF p.materialized_at IS NULL THEN RAISE EXCEPTION 'Expected complete requester materialization'; END IF;
     PERFORM private.assert_financial_proposal_materialization(p);
     IF (SELECT count(*) FROM private.financial_components WHERE agreement_id=p.financial_agreement_id)<>3 THEN RAISE EXCEPTION 'Expected exactly three components'; END IF;
    END $$; SELECT 'PASS_PROPOSAL_ONLY'; ROLLBACK;`;
   const output=query('postgres',input);assert(output.includes('PASS_PROPOSAL_ONLY'));count++;
   console.log('PASS proposal-only path='+run+'; stopped at requester materialization');
  }}finally{assert.equal(query('postgres',snapshot),before,'Proposal-only source/data/catalog/ACL/RLS/history restored');console.log('PASS proposal-only application fingerprint unchanged');}
  console.log('PASS '+count+' fresh proposal materializations; no retries');return;
 }
 if(process.argv.includes('--provider-only')){
  let count=0;
  try{for(let run=1;run<=200;run++){
   const setup=fixtures(false).replace(/^BEGIN;/,()=>`BEGIN;\n${load}\nSELECT set_config('movement.fixture_scenario','provider-only-${run}',true);`);
   const output=query('postgres',setup+`DO $$ DECLARE source record; target record; resolved_count integer:=0;
    BEGIN
     FOR target IN SELECT l.* FROM private.movement_location_references l JOIN pg_temp.snapshot_fixture f ON l.owner_member_id IN(f.requester,f.offerer) WHERE l.source_kind='provider_resolved' LOOP
      SELECT l.* INTO STRICT source FROM private.movement_location_references l JOIN private.movement_location_resolution_evidence e ON e.source_location_reference_id=l.id WHERE e.resolved_location_reference_id=target.id;
      IF target.expires_at IS NULL OR NOT isfinite(target.expires_at) OR target.resolved_at IS NULL
       OR source.created_at>target.resolved_at OR target.resolved_at>target.created_at OR target.expires_at<=target.created_at
       OR target.expires_at-target.resolved_at>interval '4 hours' THEN
       RAISE NOTICE '0082_PROVIDER_GRAPH=%',jsonb_build_object('fixture',current_setting('movement.fixture_scenario'),'source',to_jsonb(source),'target',to_jsonb(target),'clock',clock_timestamp(),'transaction',transaction_timestamp(),'statement',statement_timestamp());
       RAISE EXCEPTION 'Provider fixture timestamp ordering invalid';
      END IF;
      PERFORM private.assert_movement_location_resolution_evidence((SELECT id FROM private.movement_location_resolution_evidence WHERE resolved_location_reference_id=target.id));
      PERFORM private.assert_trusted_location_state_evidence((SELECT resolution_evidence_id FROM private.trusted_location_state_evidence WHERE resolved_location_reference_id=target.id));
      resolved_count:=resolved_count+1;
     END LOOP;
     IF resolved_count<>4 THEN RAISE EXCEPTION 'Expected four exact endpoint chains, got %',resolved_count; END IF;
     IF EXISTS(SELECT 1 FROM private.funded_movement_completion_requests) OR EXISTS(SELECT 1 FROM private.funded_movement_completions) THEN RAISE EXCEPTION 'Provider-only path called completion'; END IF;
    END $$; SELECT 'PASS_PROVIDER_ONLY'; ROLLBACK;`);
   assert(output.includes('PASS_PROVIDER_ONLY'));count++;console.log('PASS provider-only path='+run+'; four fresh endpoint chains, no completion action');
  }}finally{assert.equal(query('postgres',snapshot),before,'Provider-only source/data/catalog/ACL/RLS/history restored');console.log('PASS provider-only application fingerprint unchanged');}
  console.log('PASS '+count+' fresh provider fixture paths / '+count*4+' endpoint chains; no retries');return;
 }
 if(process.argv.includes('--fixture-only')){
  let count=0;
  try{for(let run=1;run<=200;run++){
   const setup=fixtures(false).replace(/^BEGIN;/,()=>`BEGIN;\n${load}\nSELECT set_config('movement.fixture_scenario','fixture-only-${run}',true);`);
   const output=query('postgres',setup+`SELECT pg_temp.prepare_completion();
    SELECT private.assert_funded_coordination_entry(g.alignment_id) FROM private.financial_agreements g JOIN pg_temp.funding_fixture f ON f.agreement=g.id;
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM private.funded_movement_completion_requests) OR EXISTS(SELECT 1 FROM private.funded_movement_completions) THEN RAISE EXCEPTION 'Fixture-only path called completion'; END IF; END $$;
    SELECT 'PASS_FIXTURE_ONLY'; ROLLBACK;`);
   assert(output.includes('PASS_FIXTURE_ONLY'));count++;console.log('PASS fixture-only path='+run+'; no completion action');
  }}finally{assert.equal(query('postgres',snapshot),before,'Fixture-only source/data/catalog/ACL/RLS/history restored');console.log('PASS fixture-only application fingerprint unchanged');}
  console.log('PASS '+count+' fresh fixture-only paths; no retries');return;
 }
 const variants=process.argv.includes('--zero-only')?[true]:[false,true];
 try{for(const zero of variants)for(let run=1;run<=(zero?30:50);run++){
  const setup=fixtures(zero).replace(/^BEGIN;/,()=>`BEGIN;\n${load}\nSELECT set_config('movement.fixture_scenario','focused-${run}-zero-${zero}',true);`);
  const mode=run%2?'IMMEDIATE':'DEFERRED';
  const output=query('postgres',setup+`SELECT pg_temp.prepare_completion(); SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting ${mode};`+checks);
  assert(output.includes('PASS_FOCUSED_SETTLEMENT'));if(zero)zeroCount++;else normal++;
  console.log('PASS focused settlement run='+run+' zero='+zero+' wallet_mode='+mode);
 }}finally{assert.equal(query('postgres',snapshot),before,'Focused stress source/data/catalog/ACL/RLS/history restored');console.log('PASS focused stress application fingerprint unchanged');}
 console.log('PASS focused normal='+normal+' zero='+zeroCount+'; no retries');
}
if(require.main===module)try{main();}catch(e){console.error(e.stack);process.exitCode=1;}
