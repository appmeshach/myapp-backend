const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const raw=read('../migrations/0061_pricing_quote_foundation.sql');
const sql=raw.replace(/--[^\n]*/g,'');
const live=read('0061_pricing_quote_foundation_test.sql');
const helpers=['assert_pricing_quote_context','assert_pricing_quote','protect_pricing_quote'];
const columns=['id','version','pricing_geography_evidence_id','pricing_geography_evidence_version','movement_need_id','requesting_member_id','offering_member_id','offering_movement_intent_id','offering_intent_version','state_location_reference_id','pricing_policy_version','currency','seat_price_minor','status','created_at','expires_at'];
const body=name=>{const start=sql.indexOf('CREATE FUNCTION private.'+name+'(');assert(start>=0);return sql.slice(start,sql.indexOf('$$;',start)+3);};
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


const absent=`SELECT to_regclass('private.pricing_quotes') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('assert_pricing_quote_context','assert_pricing_quote','protect_pricing_quote'))
 AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN ('protect_pricing_quote','prevent_pricing_quote_removal'))
 AND to_regclass('private.pricing_quotes_one_current') IS NULL AS absent`;
function rollbackBatch(){
 assert.match(raw.trim(),/^BEGIN;[\s\S]*COMMIT;$/);assert.match(live.trim(),/^BEGIN;[\s\S]*ROLLBACK;$/);
 const batch='BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\n'+raw.trim().replace(/^BEGIN;/,'').replace(/COMMIT;$/,'')+'\n'+live.replace(/^BEGIN;\s*SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/,'');
 assert.doesNotMatch(batch.replace(/--[^\n]*/g,''),/\bCOMMIT\s*;/i);
 return ['\\set ON_ERROR_STOP on',absent,'\\gset','\\if :absent','\\else','\\quit 1','\\endif',
 "SELECT (SELECT max(version)='0060' FROM supabase_migrations.schema_migrations) AND to_regclass('private.pricing_geography_evidence') IS NOT NULL AS baseline",'\\gset','\\if :baseline','\\else','\\quit 1','\\endif',
 snapshot,'\\gset before_',batch,snapshot,'\\gset after_',absent,'\\gset',
 "SELECT :'before_state'::jsonb=:'after_state'::jsonb AS restored",'\\gset','\\if :restored',"SELECT 'PASS 0061 rollback: prior data definitions ACL RLS and migration history unchanged' AS result;",'\\else','\\quit 1','\\endif',
 '\\if :absent',"SELECT 'PASS 0061 table functions triggers indexes absent after ROLLBACK' AS result;",'\\else','\\quit 1','\\endif',''].join('\n');
}
if(process.argv.includes('--print-rollback')){process.stdout.write(rollbackBatch());process.exit(0);}

test('0061 one outer transaction and exact private object inventory',()=>{
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
 assert.deepEqual([...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m=>m[1]),['private.pricing_quotes']);
 assert.deepEqual([...sql.matchAll(/CREATE FUNCTION private\.(\w+)/g)].map(m=>m[1]),helpers);
 assert.deepEqual([...sql.matchAll(/CREATE TRIGGER (\w+)/g)].map(m=>m[1]),['protect_pricing_quote','prevent_pricing_quote_removal']);
 assert.deepEqual([...sql.matchAll(/CREATE UNIQUE INDEX (\w+)/g)].map(m=>m[1]),['pricing_quotes_one_current']);
 assert.doesNotMatch(sql,/CREATE OR REPLACE|CREATE FUNCTION public\.|CREATE POLICY/);
});
test('0001 through 0060 remain byte-normalized unchanged',()=>{
 const files=fs.readdirSync(path.join(__dirname,'../migrations')).filter(n=>/^00(?:[0-5]\d|60)_.*\.sql$/.test(n)).sort();assert.equal(files.length,60);
 assert.equal(crypto.createHash('sha256').update(files.map(n=>n+'\n'+read('../migrations/'+n)).join('\n')).digest('hex'),'f929b7b15b434af766b0e81107a3b8dbb94f23c3dab5bd8a3841b949a89f66ff');
});
test('exact column inventory has no speculative financial operational geometry fields',()=>{
 const table=sql.slice(sql.indexOf('CREATE TABLE'),sql.indexOf('CREATE UNIQUE INDEX'));
 assert.deepEqual([...table.matchAll(/^  (\w+) (?:uuid|integer|text|bigint|timestamptz)\b/gm)].map(m=>m[1]),columns);
 for(const c of columns.filter(c=>c!=='id'))assert.match(table,new RegExp('\\b'+c+' \\w+ NOT NULL'));
});
test('opaque nonnegative NGN amount with no executable amount calculation',()=>{
 assert.match(sql,/seat_price_minor bigint NOT NULL CHECK \(seat_price_minor>=0\)/);
 assert.match(sql,/currency text NOT NULL CHECK \(currency='NGN'\)/);
 // Its only references are its declaration and CHECK. No function can read,
 // assign, round, allocate or calculate an amount, including through dynamic SQL.
 assert.equal((sql.match(/\bseat_price_minor\b/g)||[]).length,2);
 for(const name of helpers)assert.doesNotMatch(body(name),/\bEXECUTE\b|\bseat_price_minor\b/);
 assert.doesNotMatch(sql,/\b(?:500|600|800|450|850|1600)\b|\b(?:70|30|85|15)\s*[/\*%]/);
});
test('no mutation statement or external call targets any existing table',()=>{
 assert.doesNotMatch(sql,/\bINSERT INTO\b|\bDELETE FROM\b|\bUPDATE (?:private|public)\.|\bEXECUTE\s+(?!FUNCTION)/);
 assert.deepEqual([...sql.matchAll(/ALTER TABLE ([\w.]+)/g)].map(m=>m[1]),['private.pricing_quotes']);
 assert.deepEqual([...sql.matchAll(/ON (private\.\w+)\s+FOR EACH/g)].map(m=>m[1]),['private.pricing_quotes','private.pricing_quotes']);
 assert.doesNotMatch(sql,/financial_proposal|financial_agreement|financial_component|activation_fee|settlement|http|fetch|net\.|ST_Distance|route_shape|geographic_events|MFEU|Bolt|public.transport/i);
});
test('RLS and SELECT only for service role no public client access',()=>{
 assert.match(sql,/ALTER TABLE private.pricing_quotes ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON private.pricing_quotes FROM PUBLIC,anon,authenticated,service_role/);
 assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(m=>m[0]),['GRANT SELECT ON private.pricing_quotes TO service_role;']);
});
test('private helpers have explicit definer empty search path and revoked execute',()=>{
 for(const name of helpers){assert.match(body(name),/SECURITY DEFINER SET search_path = ''/);assert.match(sql,new RegExp('REVOKE ALL ON FUNCTION private\\.'+name+'\\([^;]+FROM PUBLIC,anon,authenticated,service_role;'));}
});
test('exact evidence FK and null-safe canonical binding comparison',()=>{
 assert.match(sql,/pricing_geography_evidence_id uuid NOT NULL REFERENCES private.pricing_geography_evidence\(id\)/);
 const b=body('assert_pricing_quote_context');
 for(const c of columns.slice(3,10))assert(b.includes('p.'+c));
 assert.match(b,/IS DISTINCT FROM ROW\(e.version,e.movement_need_id/);
 assert.equal((b.match(/WHERE x.id=p.pricing_geography_evidence_id/g)||[]).length,2);
 assert.doesNotMatch(b,/ORDER BY|LIMIT|MAX\(/i);
});
test('live supported geography asserted without recalc or latest lookup',()=>{
 const b=body('assert_pricing_quote_context');
 assert.match(b,/PERFORM private.assert_pricing_geography_evidence\(e.id\)/);
 assert.match(b,/e.pricing_range_supported IS DISTINCT FROM true/);
 assert.match(b,/e.pricing_corridor_distance_meters>100000/);
 assert.doesNotMatch(sql,/\broute_distance_meters\b|latitude|longitude/);
});
test('quote timestamps finite current bounded by exact evidence',()=>{
 const b=body('assert_pricing_quote_context');
 for(const fragment of ["p.status IS DISTINCT FROM 'current'",'NOT isfinite(p.created_at)','p.created_at<e.created_at','p.created_at>clock_timestamp()','NOT isfinite(p.expires_at)','p.expires_at<=clock_timestamp()','p.expires_at>e.expires_at'])assert(b.includes(fragment));
});
test('canonical identity one current and sequential versions under inherited need lock',()=>{
 assert.match(sql,/UNIQUE \(movement_need_id,offering_movement_intent_id,version\)/);
 assert.match(sql,/ON private.pricing_quotes\(movement_need_id,offering_movement_intent_id\) WHERE status='current'/);
 const b=body('protect_pricing_quote');assert(b.indexOf('assert_pricing_quote_context(NEW)')<b.indexOf('max(x.version)'));
 assert.match(b,/coalesce\(max\(x.version\)::bigint,0\)\+1/);assert.match(b,/NEW.version IS DISTINCT FROM next_version/);
});
test('live quote locks dependencies before quote and rechecks after wait',()=>{
 const b=body('assert_pricing_quote');const first=b.indexOf('assert_pricing_quote_context(q)'),lock=b.indexOf('FOR SHARE'),second=b.indexOf('assert_pricing_quote_context(q)',first+1);
 assert(first<lock&&lock<second);
});
test('only current to superseded allowed all factual fields immutable',()=>{
 const b=body('protect_pricing_quote');
 assert.match(b,/\(to_jsonb\(NEW\)-'status'\) IS DISTINCT FROM \(to_jsonb\(OLD\)-'status'\)/);
 assert.match(b,/OLD.status IS DISTINCT FROM 'current' OR NEW.status IS DISTINCT FROM 'superseded'/);
});
test('before insert validation and statement deletion guard including no-op removal',()=>{
 assert.match(sql,/BEFORE INSERT OR UPDATE ON private.pricing_quotes\s+FOR EACH ROW/);
 assert.match(sql,/BEFORE DELETE OR TRUNCATE ON private.pricing_quotes\s+FOR EACH STATEMENT/);
 assert.match(body('protect_pricing_quote'),/IF TG_OP IN \('DELETE','TRUNCATE'\) THEN\s+RAISE EXCEPTION/);
 assert.doesNotMatch(sql,/pg_advisory|DISABLE|session_replication_role/);
});
test('policy token matches financial foundation convention without changing allocation',()=>{
 assert.match(sql,/length\(pricing_policy_version\) BETWEEN 1 AND 100/);
 assert(sql.includes("pricing_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'"));
 const old=read('../migrations/0021_financial_proposal_foundation.sql');assert.match(old,/route_evidence_id uuid CHECK \(route_evidence_id IS NULL\)/);
 assert.doesNotMatch(sql,/offering_platform_share|requester_platform_share|movement_contribution/);
});
test('rollback runner validates baseline and external data catalog preservation',()=>{
 const batch=rollbackBatch();assert.equal((batch.match(/^BEGIN;/gm)||[]).length,1);assert.equal((batch.match(/^ROLLBACK;/gm)||[]).length,1);
 assert.match(batch,/ON_ERROR_STOP on/);assert.match(batch,/gset before_/);assert.match(batch,/gset after_/);assert.match(batch,/max\(version\)='0060'/);
 assert.doesNotMatch(batch,/DISABLE TRIGGER|session_replication_role|INSERT INTO supabase_migrations/);
});
test('documentation separates evidence storage formula proposal and acceptance',()=>{
 const doc=read('../../docs/pricing-quote-foundation.md');
 for(const text of ['WE DO NOT CREATE JOURNEYS','What movement geography was proven?','immutable calculated seat price','deterministic formula','obligations are proposed','obligations become binding','does NOT set the actual price curve','15000','12000'])assert(doc.includes(text),text);
});
