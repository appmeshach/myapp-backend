const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = fs.readFileSync('supabase/migrations/0059_pricing_geography_evidence_foundation.sql','utf8');
const sql = source.replace(/--[^\r\n]*/g,'');
const doc = fs.readFileSync('docs/pricing-geography-evidence-foundation.md','utf8');
const body = name => {
  const start=sql.indexOf('CREATE FUNCTION private.'+name+'(');
  assert(start>=0,name);
  return sql.slice(start,sql.indexOf('$$;',start)+3);
};


const live = fs.readFileSync('supabase/tests/0059_pricing_geography_evidence_foundation_test.sql','utf8').replace(/\r\n/g,'\n');
// Snapshot existing data and catalog definitions/ACLs outside the install transaction.
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
const absence = `SELECT to_regclass('private.pricing_geography_evidence') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('assert_pricing_geography_events','assert_pricing_geography_context','assert_pricing_geography_evidence','protect_pricing_geography_evidence'))
 AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname LIKE '%pricing_geography%')
 AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='protect_pricing_geography_evidence') AS absent`;
function rollbackBatch() {
 assert.match(source.trim(),/^BEGIN;[\s\S]*COMMIT;$/);
 assert.match(live.trim(),/^BEGIN;[\s\S]*ROLLBACK;$/);
 const batch='BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\n'+source.trim().replace(/^BEGIN;/,'').replace(/COMMIT;$/,'')+'\n'+live.replace(/^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/,'');
 assert.doesNotMatch(batch.replace(/--[^\n]*/g,''),/\bCOMMIT\s*;/i);
 return ['\\set ON_ERROR_STOP on',absence,'\\gset','\\if :absent','\\else','\\echo Refusing: 0059 objects already exist','\\quit 1','\\endif',
 snapshot,'\\gset before_',batch,snapshot,'\\gset after_',absence,'\\gset',
 "SELECT :'before_state'::jsonb = :'after_state'::jsonb AS restored",'\\gset',
 '\\if :restored',"SELECT 'PASS K preexisting schemas data functions privileges RLS triggers indexes and migration history restored' AS result;",'\\else','\\quit 1','\\endif',
 '\\if :absent',"SELECT 'PASS K 0059 table functions triggers and indexes absent after ROLLBACK' AS result;",'\\else','\\quit 1','\\endif',
 "SELECT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0059') AS history_clean",'\\gset',
 '\\if :history_clean',"SELECT 'PASS K migration history has no 0059' AS result;",'\\else','\\quit 1','\\endif',''].join('\n');
}
if (process.argv.includes('--print-rollback')) { process.stdout.write(rollbackBatch()); process.exit(0); }

test('0059 creates only its private foundation in one transaction',()=>{
  assert.match(sql.trim(),/^BEGIN;[\s\S]*COMMIT;$/);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m=>m[1]),['private.pricing_geography_evidence']);
  assert.doesNotMatch(sql,/CREATE (?:OR REPLACE )?FUNCTION public\.|CREATE OR REPLACE|CREATE POLICY/);
  assert.deepEqual([...sql.matchAll(/ALTER TABLE ([\w.]+)/g)].map(m=>m[1]),['private.pricing_geography_evidence']);
});
test('0059 does not change any historical migration through 0058',()=>{
  const old=fs.readdirSync('supabase/migrations').filter(n=>/^00(?:[0-4]\d|5[0-8])_.*\.sql$/.test(n)).sort();
  assert.equal(old.length,58);
  const hash=crypto.createHash('sha256').update(old.map(n=>n+'\n'+fs.readFileSync('supabase/migrations/'+n,'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex');
  assert.equal(hash,'4a2f3c43cdc7d347afff85e23aea7574d2c71797029665a0f7ff0a14ddc409e9');
});
test('no operational writer, financial mutation or existing function replacement',()=>{
  assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE private\.|UPDATE public\.|DELETE FROM|TRUNCATE|DROP)\b/i);
  assert.doesNotMatch(sql,/accept_movement_offer|financial_proposal|financial_agreement|activation_payment|movement_settlements/);
  assert.doesNotMatch(sql,/\b(?:naira|NGN|450|850|surge|demand|Bolt|fare|contribution|allocation|percentage)\b/i);
  assert.doesNotMatch(sql,/http|fetch|net\.|edge_function/i);
});
test('exact numeric distance and supported boundary retain unsupported evidence',()=>{
  assert.match(sql,/pricing_corridor_distance_meters bigint NOT NULL CHECK \(pricing_corridor_distance_meters>0\)/);
  assert.match(sql,/pricing_range_supported boolean NOT NULL/);
  assert.match(sql,/CHECK \(pricing_range_supported = \(pricing_corridor_distance_meters<=100000\)\)/);
  assert.equal((sql.match(/100000/g)||[]).length,1);
  assert.doesNotMatch(sql,/route_distance_meters|LEAST\(.*100000|pricing_corridor_distance_meters bigint[^\r\n]*DEFAULT/i);
});
test('all exact source identities and versions are null-safe compared',()=>{
  const b=body('assert_pricing_geography_context');
  for(const field of ['route_match_evidence_version','requesting_member_id','offering_member_id','offering_movement_intent_id','offering_intent_version','route_evidence_id','route_evidence_version','state_location_reference_id']) assert(b.includes('p.'+field),field);
  assert.match(b,/m.movement_need_id IS DISTINCT FROM p.movement_need_id/);
  assert.match(b,/IS DISTINCT FROM ROW\(m.version,m.requesting_member_id,m.offering_member_id/);
  for(const table of ['trusted_route_match_evidence','offering_route_evidence','offering_movement_intents','trusted_location_state_evidence']) assert(sql.includes('REFERENCES private.'+table));
  assert.doesNotMatch(sql,/movement_need_id uuid NOT NULL REFERENCES/);
});
test('state anchor is provider evidence for exact requester origin, not arbitrary text',()=>{
  assert.match(sql,/REFERENCES private.trusted_location_state_evidence\(resolved_location_reference_id\)/);
  assert.match(body('assert_pricing_geography_context'),/m.requester_origin_location_reference_id\)/);
  assert.match(sql,/private.assert_trusted_route_match_evidence\(m.id\)/);
  assert.doesNotMatch(sql,/state_key text|state_name|state_provider_reference text|canonical_nigerian_state_key/);
  const canonical=fs.readFileSync('supabase/migrations/0052_downstream_requester_movement_deadline.sql','utf8');
  assert.match(canonical,/private.assert_state_bound_matching_context\(/);
});
test('existing context owns locks; need before canonical assertion before match',()=>{
  const b=body('assert_pricing_geography_context');
  assert.match(b,/IS DISTINCT FROM 'read committed'/);
  assert(b.indexOf('WHERE n.id=p.movement_need_id FOR UPDATE')<b.indexOf('private.assert_trusted_route_match_evidence(m.id)'));
  assert(b.indexOf('private.assert_trusted_route_match_evidence(m.id)')<b.indexOf('WHERE e.id=p.route_match_evidence_id FOR SHARE'));
  assert.doesNotMatch(sql,/private.assert_offering_route_evidence|pg_advisory|LOCK TABLE/);
});
test('live assertion rechecks source and own lifecycle, including after row waits',()=>{
  const b=body('assert_pricing_geography_evidence');
  assert.equal((b.match(/private.assert_pricing_geography_context\(e\)/g)||[]).length,2);
  assert(b.indexOf('private.assert_pricing_geography_context(e)')<b.indexOf('WHERE x.id=p_evidence_id FOR SHARE'));
  assert.match(b,/e.status<>'current' OR e.expires_at<=clock_timestamp\(\)/);
  assert.match(body('assert_pricing_geography_context'),/m.status<>'current'/);
  assert.match(body('assert_pricing_geography_context'),/m.expires_at<=clock_timestamp\(\)/);
});
test('provenance is bounded, fixed schema version and no event counts or geometry copy',()=>{
  for(const f of ['classifier_name','classifier_version','transport_geography_version']) {
    assert(sql.includes(f+' text NOT NULL CHECK ('+f+" ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$')"));
  }
  assert.match(sql,/evidence_schema_version='pricing_geography_evidence_v1'/);
  assert.doesNotMatch(sql,/event_count|route_shape|latitude|longitude|geometry|geography\(/);
});
test('finite timestamps and dependency-bounded expiry are mandatory',()=>{
  for(const f of ['generated_at','created_at','expires_at']) assert(sql.includes('CHECK (isfinite('+f+'))'));
  assert.match(sql,/CHECK \(generated_at<=created_at AND expires_at>created_at\)/);
  const b=body('assert_pricing_geography_context');
  for(const guard of ['p.expires_at>deadline','p.expires_at>m.expires_at','p.generated_at<m.calculated_at','p.generated_at>clock_timestamp()','p.expires_at<=clock_timestamp()']) assert(b.includes(guard));
  assert.match(b,/coalesce\(n.latest_departure_at,n.earliest_departure_at\)/);
});
test('events reject SQL/JSON null, scalar, missing keys, unknown types and extra payloads',()=>{
  const b=body('assert_pricing_geography_events');
  for(const check of ["jsonb_typeof(p_events) IS DISTINCT FROM 'array'","jsonb_typeof(event) IS DISTINCT FROM 'object'","jsonb_typeof(event->'event_type') IS DISTINCT FROM 'string'","jsonb_typeof(event->'position_meters') IS DISTINCT FROM 'number'","(event-'event_type'-'position_meters')<>'{}'::jsonb","NOT IN ('core_stage_entry','major_transport_transition')"]) assert(b.includes(check),check);
  assert(b.indexOf("jsonb_typeof(p_events)")<b.indexOf('jsonb_array_elements(p_events)'));
  assert.doesNotMatch(b,/continuous_corridor|jsonb_array_length\(p_events\).*<.*1/);
});
test('events validate integral corridor-relative ordered positions and duplicate rejection',()=>{
  const b=body('assert_pricing_geography_events');
  for(const check of ['event_position<>trunc(event_position)','event_position<0','event_position>p_distance','event_position<previous_position','seen @> jsonb_build_array(event)']) assert(b.includes(check));
  assert.match(b,/previous_position:=event_position/);
});
test('history is immutable and only terminal lifecycle transitions are allowed',()=>{
  const b=body('protect_pricing_geography_evidence');
  assert.match(b,/TG_OP='DELETE'[\s\S]*RAISE EXCEPTION/);
  assert.match(b,/\(to_jsonb\(NEW\)-'status'\) IS DISTINCT FROM \(to_jsonb\(OLD\)-'status'\)/);
  assert.match(b,/OLD.status<>'current' OR NEW.status NOT IN \('superseded','expired'\)/);
  assert.match(b,/NEW.status='expired' AND NEW.expires_at>clock_timestamp\(\)/);
});
test('insertion validates before FK locks; no source-table triggers',()=>{
  assert.match(sql,/CREATE TRIGGER protect_pricing_geography_evidence BEFORE INSERT OR UPDATE OR DELETE\s+ON private.pricing_geography_evidence/);
  const b=body('protect_pricing_geography_evidence');
  assert.match(b,/NEW.status IS DISTINCT FROM 'current'/);
  assert.match(b,/private.assert_pricing_geography_context\(NEW\)/);
  assert.match(b,/private.assert_pricing_geography_events\(NEW.geographic_events,NEW.pricing_corridor_distance_meters\)/);
  assert.equal((sql.match(/CREATE TRIGGER/g)||[]).length,1);
});
test('unique versions and one current evidence row per requester/intent pair',()=>{
  assert.match(sql,/UNIQUE \(movement_need_id,offering_movement_intent_id,version\)/);
  assert.match(sql,/CREATE UNIQUE INDEX pricing_geography_evidence_one_current[\s\S]*WHERE status='current'/);
});
test('RLS and privileges provide minimum service read and no application path',()=>{
  assert.match(sql,/ALTER TABLE private.pricing_geography_evidence ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON private.pricing_geography_evidence FROM PUBLIC, anon, authenticated, service_role/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m=>m[0]),['GRANT SELECT ON private.pricing_geography_evidence TO service_role;']);
  const helpers=[...sql.matchAll(/CREATE FUNCTION private.([a-z_]+)\(/g)].map(m=>m[1]);
  assert.equal(helpers.length,4);
  for(const name of helpers) {
    assert.match(body(name),/SECURITY DEFINER SET search_path = ''/);
    assert(sql.includes('REVOKE ALL ON FUNCTION private.'+name));
  }
  assert.equal((sql.match(/FROM PUBLIC, anon, authenticated, service_role/g)||[]).length,5);
});
test('documentation states unresolved classifier criteria, consumer contract and exclusions',()=>{
  for(const phrase of ['No naira pricing','\u20a6450/\u20a6850','70/30','No financial proposal issuance','No payment/activation change','No external provider call','No client writer','No live demand/surge/traffic/weather pricing','No public-transport or Bolt fare dependency','No multi-leg pricing','No >100 km','future classifier decision','same READ COMMITTED transaction','Static Node tests']) assert(doc.includes(phrase),phrase);
});

test('0059 behavioral batch installs only inside one rollback transaction',()=>{
 const batch=rollbackBatch();
 assert.equal((batch.match(/^BEGIN;/gm)||[]).length,1);
 assert.equal((batch.match(/^ROLLBACK;/gm)||[]).length,1);
 assert.doesNotMatch(batch,/DISABLE TRIGGER|session_replication_role|INSERT INTO supabase_migrations/);
 assert.match(batch,/ON_ERROR_STOP on/);
 assert.match(batch,/gset before_/);
 assert.match(batch,/gset after_/);
 assert.match(batch,/history_clean/);
});
