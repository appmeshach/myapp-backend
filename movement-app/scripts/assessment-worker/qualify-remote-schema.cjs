'use strict';
// Operator workstation only. Never shipped credentials to the worker host.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {configuration,WARNING,seal}=require('./qualification-remote.cjs');
const ROOT=path.resolve(__dirname,'../..'),DIR=path.join(ROOT,'supabase/migrations');
const files=()=>fs.readdirSync(DIR).filter(v=>/^\d{4}_.*\.sql$/.test(v)).sort();
const read=file=>fs.readFileSync(path.join(DIR,file),'utf8').replace(/\r\n/g,'\n');
function migrationDigest(){return crypto.createHash('sha256').update(files().map(v=>v+'\n'+read(v)).join('\n')).digest('hex');}
function expectedFunctions(){
 const values=new Map();for(const f of files().filter(f=>Number(f.slice(0,4))>=96))for(const m of read(f).matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+((?:public|private)\.\w+)\s*\([^]*?AS\s+(\$\w*\$)([^]*?)\2\s*;/gi))values.set(m[1],m[3]);return values;
}
function catalogSql(){
 const names=[...expectedFunctions().keys()].map(v=>"'"+v+"'").join(',');
 return `BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
 SELECT json_build_object('versions',(SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
 'functions',(SELECT json_agg(json_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'identity',pg_get_function_identity_arguments(p.oid),'acl',p.proacl)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN (${names})),
 'tables',(SELECT json_agg(json_build_object('name',c.relname,'rls',c.relrowsecurity,'policies',(SELECT count(*) FROM pg_policy WHERE polrelid=c.oid),'participantSelect',has_table_privilege('authenticated',c.oid,'SELECT') OR has_table_privilege('anon',c.oid,'SELECT'),'serviceSelect',has_table_privilege('service_role',c.oid,'SELECT'),'triggers',(SELECT json_agg(json_build_object('name',t.tgname,'enabled',t.tgenabled,'type',t.tgtype,'function',t.tgfoid::regproc::text)) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname IN ('shared_segment_assessment_jobs','shared_segment_geographic_assessments')),
 'parameters',private.shared_segment_assessment_parameters()); COMMIT;`;
}
function verifyCatalog(v){
 if(!Array.isArray(v.versions)||files().some(f=>!v.versions.includes(f.slice(0,4))))throw Error('Staging schema mismatch');
 const expected=expectedFunctions();if(!Array.isArray(v.functions))throw Error('Staging schema mismatch');
 for(const [name,body] of expected){
  const found=v.functions.filter(p=>p.name===name);if(found.length!==1||found[0].body.replace(/\r\n/g,'\n')!==body)throw Error('Staging schema mismatch');
  const p=found[0],config=name==='public.get_shared_segment_geographic_assessment_context_for_server'?['search_path=""','TimeZone=UTC']:['search_path=""'];
  if(p.owner!=='postgres'||p.definer!==(name!=='private.shared_segment_assessment_parameters')||JSON.stringify(p.config)!==JSON.stringify(config)||!Array.isArray(p.acl)||p.acl.slice().sort().join('|')!==(name.startsWith('public.')?'postgres=X/postgres|service_role=X/postgres':'postgres=X/postgres'))throw Error('Staging schema mismatch');
 }
 const workerIdentities={register_requester_availability_assessment_job_for_server:'p_verified_member_id uuid, p_movement_need_id uuid, p_availability_id uuid',claim_shared_segment_assessment_job_for_server:'',load_shared_segment_assessment_job_context_for_server:'p_job_id uuid, p_lease_token uuid',finalize_shared_segment_assessment_job_for_server:'p_job_id uuid, p_lease_token uuid, p_context jsonb, p_result jsonb, p_recovery_only boolean',fail_shared_segment_assessment_job_for_server:'p_job_id uuid, p_lease_token uuid, p_category text'};
 for(const [name,identity] of Object.entries(workerIdentities)){
  const p=v.functions.find(p=>p.name==='public.'+name);
  if(!p||p.identity!==identity||p.owner!=='postgres'||!p.definer||JSON.stringify(p.config)!==JSON.stringify(['search_path=""'])||!Array.isArray(p.acl)||p.acl.slice().sort().join('|')!=='postgres=X/postgres|service_role=X/postgres')throw Error('Staging schema mismatch');
 }
 const protections={shared_segment_assessment_jobs:'protect_shared_segment_assessment_job',shared_segment_geographic_assessments:'protect_shared_segment_geographic_assessment'};
 if(!Array.isArray(v.tables)||v.tables.length!==2)throw Error('Staging schema mismatch');
 for(const [name,trigger] of Object.entries(protections)){const t=v.tables.find(t=>t.name===name);if(!t||!t.rls||Number(t.policies)!==0||t.participantSelect||t.serviceSelect||!t.triggers?.some(v=>v.name===trigger&&v.enabled==='O'&&v.type===(name==='shared_segment_assessment_jobs'?31:27)&&v.function==='private.'+trigger))throw Error('Staging schema mismatch');}
 // Source equality already verifies persisted version/parameter implementation.
 if(typeof v.parameters!=='string'||crypto.createHash('sha256').update(v.parameters).digest('hex')!=='1625aa38ea035ad2c26a8c13a3a4df37714fc32624089fa3894f57c2ddda29d5')throw Error('Staging schema mismatch');
 return true;
}
function fixtureSql(){
 // Existing invariant-preserving builders stay session-local in pg_temp.
 let setup=fs.readFileSync(path.join(ROOT,'supabase/tests/0052_downstream_requester_movement_deadline_test.sql'),'utf8').split('DO $test$')[0];
 setup=setup.replace(/'test_router',\s*'directions',\s*'v1',/,"'mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1',");
 setup=setup.replaceAll('@test-0052.invalid','@0102-disposable.invalid');
 return setup+`
 SET LOCAL statement_timeout='30s';
 DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.members) OR EXISTS(SELECT 1 FROM private.shared_segment_assessment_jobs) THEN RAISE EXCEPTION 'Disposable environment must be empty'; END IF; END; $guard$;
 CREATE TEMP TABLE pg_temp.qualification0102_pairs(ordinal integer,requester uuid,need uuid,availability uuid) ON COMMIT DROP;
 DO $seed$ DECLARE a record;n record;cl record;origin uuid;destination uuid;BEGIN
 FOR i IN 1..4 LOOP
 SELECT * INTO a FROM pg_temp.interest_offering_fixture('0102-disposable-'||i,3,interval '4 hours');
 SELECT * INTO n FROM pg_temp.interest_requester_fixture('0102-disposable-'||i,1);
 SELECT location_reference_id INTO origin FROM private.movement_need_locations WHERE movement_need_id=n.movement_need_id AND role='origin';
 SELECT location_reference_id INTO destination FROM private.movement_need_locations WHERE movement_need_id=n.movement_need_id AND role='destination';
 SELECT * INTO cl FROM public.claim_requester_route_generation_for_server(n.movement_need_id,n.member_id,'mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1','requester_route_evidence_v1','geojson_linestring_v1');
 PERFORM public.record_claimed_requester_route_evidence_for_server(n.movement_need_id,n.member_id,cl.generation_claim_token,origin,destination,'requester_route_evidence_v1','geojson_linestring_v1','mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1','0102-synthetic-no-provider',
 '{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]]}'::jsonb,1000,300,clock_timestamp(),NULL);
 INSERT INTO pg_temp.qualification0102_pairs VALUES(i,n.member_id,n.movement_need_id,a.availability_id);
 END LOOP;END;$seed$;
 SELECT json_agg(json_build_object('requester',requester,'need',need,'availability',availability) ORDER BY ordinal) FROM pg_temp.qualification0102_pairs;
 COMMIT;`;
}
function postgresConfiguration(env,config){
 const password=env.MOVEMENT_QUALIFICATION_DB_PASSWORD;
 if(typeof password!=='string'||!password||env.MOVEMENT_QUALIFICATION_DB_HOST!==`db.${config.ref}.supabase.co`)throw Error('Operator database configuration unavailable');
 return {PGHOST:env.MOVEMENT_QUALIFICATION_DB_HOST,PGPORT:'5432',PGDATABASE:'postgres',PGUSER:'postgres',PGPASSWORD:password,PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c client_min_messages=error',
  ...(env.MOVEMENT_QUALIFICATION_DB_SSLROOTCERT?{PGSSLROOTCERT:env.MOVEMENT_QUALIFICATION_DB_SSLROOTCERT}:{}),PATH:env.PATH,SystemRoot:env.SystemRoot};
}
function psql(sql,env){
 const r=cp.spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
 if(r.status!==0)throw Error('Operator database operation unavailable');try{return JSON.parse(r.stdout.trim());}catch{throw Error('Operator database operation unavailable');}
}
function main(args=process.argv.slice(2),env=process.env){
 if(args.some(v=>!['--ack-disposable-environment'].includes(v))||new Set(args).size!==args.length)throw Error('Unknown preflight argument');
 const config=configuration(env,args.includes('--ack-disposable-environment')),pg=postgresConfiguration(env,config);
 verifyCatalog(psql(catalogSql(),pg));process.stdout.write('Disposable schema/catalog prerequisite PASS. No fixture write.\n');
 return {projectRefHash:config.projectRefHash,migrationDigest:migrationDigest(),catalogVerified:true};
}
module.exports={ROOT,migrationDigest,expectedFunctions,catalogSql,verifyCatalog,fixtureSql,postgresConfiguration,psql,main};
if(require.main===module)try{main();}catch{process.stderr.write('Disposable schema preflight unavailable\n');process.exitCode=1;}
