const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const raw=read('../migrations/0060_trusted_pricing_geography_producer_boundary.sql');
const sql=raw.replace(/--[^\n]*/g,'');
const live=read('0060_trusted_pricing_geography_producer_test.sql');
const rpc='public.record_pricing_geography_evidence_for_server';
const snapshot = `SELECT jsonb_build_object(
 'data',(SELECT jsonb_object_agg(n.nspname||'.'||c.relname,
 query_to_xml(format('SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',n.nspname,c.relname),false,true,'')::text)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN ('public','private','auth','supabase_migrations')),
 'relations',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'name',c.relname,'acl',c.relacl,'owner',c.relowner,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','supabase_migrations')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'def',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','auth','supabase_migrations') AND p.prokind='f'),
 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','private','auth','supabase_migrations')),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','supabase_migrations')),
 'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','supabase_migrations')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','supabase_migrations'))
) AS state`;

const absent="SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='record_pricing_geography_evidence_for_server') AS absent";
function rollbackBatch(){
 assert.match(raw.trim(),/^BEGIN;[\s\S]*COMMIT;$/);
 assert.match(live.trim(),/^BEGIN;[\s\S]*ROLLBACK;$/);
 const batch=raw.trim().replace(/COMMIT;$/,'')+'\n'+live.replace(/^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/,'SET TRANSACTION ISOLATION LEVEL READ COMMITTED;');
 assert.doesNotMatch(batch.replace(/--[^\n]*/g,''),/\bCOMMIT\s*;/i);
 return ['\\set ON_ERROR_STOP on',absent,'\\gset','\\if :absent','\\else','\\quit 1','\\endif',
 "SELECT to_regclass('private.pricing_geography_evidence') IS NOT NULL AND (SELECT max(version)='0059' FROM supabase_migrations.schema_migrations) AS baseline",'\\gset','\\if :baseline','\\else','\\quit 1','\\endif',
 snapshot,'\\gset before_',batch,snapshot,'\\gset after_',absent,'\\gset',
 "SELECT :'before_state'::jsonb=:'after_state'::jsonb AS restored",'\\gset','\\if :restored',"SELECT 'PASS 0060 rollback: prior data catalog ACL RLS and migration history unchanged' AS result;",'\\else','\\quit 1','\\endif',
 '\\if :absent',"SELECT 'PASS 0060 producer absent after ROLLBACK; installed 0059 preserved' AS result;",'\\else','\\quit 1','\\endif',''].join('\n');
}
if(process.argv.includes('--print-rollback')){process.stdout.write(rollbackBatch());process.exit(0);}

test('0060 one transaction and one narrow new RPC only',()=>{
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
 assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(x=>x[1]),[rpc]);
 assert.doesNotMatch(sql,/CREATE OR REPLACE|CREATE TABLE|CREATE TRIGGER|CREATE POLICY|ALTER TABLE/);
});
test('0001 through 0059 byte-normalized historical migrations unchanged',()=>{
 const files=fs.readdirSync(path.join(__dirname,'../migrations')).filter(x=>/^00(?:[0-4]\d|5\d)_.*\.sql$/.test(x)).sort();assert.equal(files.length,59);
 assert.equal(crypto.createHash('sha256').update(files.map(n=>n+'\n'+read('../migrations/'+n)).join('\n')).digest('hex'),'c1f092c596d77b9b858658d6599c802a03b6f1de0ce199fdb32d1d39aaa5570f');
});
test('only exact source selectors normalized facts and provenance accepted',()=>{
 const params=sql.slice(sql.indexOf('(')+1,sql.indexOf(')\nRETURNS'));
 assert.deepEqual([...params.matchAll(/\b(p_\w+)\s/g)].map(m=>m[1]),['p_route_match_evidence_id','p_expected_route_match_evidence_version','p_expected_route_evidence_id','p_expected_route_evidence_version','p_pricing_corridor_distance_meters','p_geographic_events','p_classifier_name','p_classifier_version','p_transport_geography_version']);
 assert.doesNotMatch(params,/member|state|supported|expires|generated|pricing_geography_evidence_version/);
});
test('SECURITY DEFINER empty search path service-only execute no direct grants',()=>{
 assert.match(sql,/SECURITY DEFINER SET search_path = ''/);
 assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
 assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m=>m[0]),[`GRANT EXECUTE ON FUNCTION ${rpc}(uuid,integer,uuid,integer,bigint,jsonb,text,text,text)\n  TO service_role;`]);
});
test('explicit isolation missing input provenance and event validation',()=>{
 assert.match(sql,/current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed'/);
 assert.match(sql,/ERRCODE='22004'/);assert.match(sql,/p_classifier_name !~/);assert.match(sql,/p_classifier_version !~/);assert.match(sql,/p_transport_geography_version !~/);
 assert.match(sql,/PERFORM private.assert_pricing_geography_events\(p_geographic_events,p_pricing_corridor_distance_meters\)/);
});
test('exact source checks reject mismatch without latest-source lookup',()=>{
 assert.match(sql,/ROW\(m.version,m.route_evidence_id,m.route_evidence_version\)\s+IS DISTINCT FROM ROW\(p_expected_route_match_evidence_version,p_expected_route_evidence_id,p_expected_route_evidence_version\)/);
 assert.equal((sql.match(/WHERE x.id=p_route_match_evidence_id/g)||[]).length,2);
 assert.doesNotMatch(sql,/FROM private.offering_route_evidence/);
});
test('database derives authoritative identity state schema support and expiry',()=>{
 for(const f of ['route_match_evidence_id:=m.id','route_match_evidence_version:=m.version','movement_need_id:=m.movement_need_id','requesting_member_id:=m.requesting_member_id','offering_member_id:=m.offering_member_id','offering_movement_intent_id:=m.offering_movement_intent_id','offering_intent_version:=m.offering_intent_version','route_evidence_id:=m.route_evidence_id','route_evidence_version:=m.route_evidence_version','state_location_reference_id:=m.requester_origin_location_reference_id'])assert(sql.includes('e.'+f));
 assert.match(sql,/e.evidence_schema_version:='pricing_geography_evidence_v1'/);
 assert.match(sql,/e.expires_at:=least\(deadline,m.expires_at\)/);
 assert.match(sql,/e.pricing_range_supported:=\(p_pricing_corridor_distance_meters<=100000\)/);
 assert.match(sql,/e.pricing_corridor_distance_meters:=p_pricing_corridor_distance_meters/);
 assert.doesNotMatch(sql,/\broute_distance_meters\b/);
});
test('need lock then canonical context then ordered pricing locks then fresh check',()=>{
 const need=sql.indexOf('FOR UPDATE'),context=sql.indexOf('PERFORM private.assert_pricing_geography_context(e)'),pricing=sql.indexOf('ORDER BY x.version FOR UPDATE'),recheck=sql.indexOf('PERFORM private.assert_pricing_geography_context(e)',context+1);
 assert(need<context&&context<pricing&&pricing<recheck);
 assert.match(sql,/PERFORM private.assert_pricing_geography_evidence\(e.id\)/);
});
test('replay spans terminal history and exact facts with live check before return',()=>{
 assert.match(sql,/IF replay_count>1 THEN/);
 assert.match(sql,/x.route_match_evidence_id=m.id AND x.classifier_name=p_classifier_name/);
 assert.match(sql,/x.classifier_version=p_classifier_version/);assert.match(sql,/x.transport_geography_version=p_transport_geography_version/);
 assert.match(sql,/to_jsonb\(previous\)[\s\S]*IS DISTINCT FROM \(to_jsonb\(e\)/);
 assert.match(sql,/PERFORM private.assert_pricing_geography_evidence\(previous.id\);\s+RETURN QUERY/);
});
test('version allocation and supersession write only private pricing evidence',()=>{
 assert.match(sql,/coalesce\(max\(x.version\),0\)\+1 INTO e.version/);
 assert.deepEqual([...sql.matchAll(/(?:INSERT INTO|UPDATE) (private\.\w+|public\.\w+)/g)].map(x=>x[1]),['private.pricing_geography_evidence','private.pricing_geography_evidence']);
 assert.match(sql,/SET status='superseded'/);assert.doesNotMatch(sql,/DELETE FROM/);
});
test('no classifier heuristics money provider runtime or operational side effects',()=>{
 assert.doesNotMatch(sql,/\b(?:Ologolo|Lekki|Ikoyi|VI|Victoria Island|Obalande|Ikeja|Ikorodu|Ajah|Sangotedo|Bolt|surge|traffic|weather|naira|NGN|450|850|MFEU)\b/i);
 assert.doesNotMatch(sql,/financial_proposal|financial_agreement|movement_offers|movement_alignments|journeys|payments|settlements|http|fetch|net\./i);
});
test('minimal return contains no geometry or member coordinates',()=>{
 const returns=sql.slice(sql.indexOf('RETURNS TABLE'),sql.indexOf('LANGUAGE plpgsql'));
 assert.deepEqual([...returns.matchAll(/\b(pricing_\w+)\s/g)].map(x=>x[1]),['pricing_geography_evidence_id','pricing_geography_evidence_version','pricing_geography_evidence_status','pricing_geography_evidence_expires_at']);
});
test('generated SQL batch is rollback-only with external preservation checks',()=>{
 const batch=rollbackBatch();assert.equal((batch.match(/^BEGIN;/gm)||[]).length,1);assert.equal((batch.match(/^ROLLBACK;/gm)||[]).length,1);
 assert.doesNotMatch(batch,/DISABLE TRIGGER|session_replication_role|INSERT INTO supabase_migrations/);
 assert.match(batch,/ON_ERROR_STOP on/);assert.match(batch,/gset before_/);assert.match(batch,/gset after_/);
});
test('documentation keeps runtime and money out of recording boundary',()=>{
 const d=read('../../docs/trusted-pricing-geography-producer-boundary.md');
 for(const phrase of ['WE DO NOT CREATE JOURNEYS','0059','0060','classifier criteria remain unresolved','deterministic map/network data','Pricing Policy v1','12,000','15,000','READ COMMITTED'])assert(d.includes(phrase),phrase);
});
