'use strict';
// Explicit local-only integration runner. Importing is inert. Clone schema only;
// never copy application rows or connect to a URL/linked project.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const container = 'supabase_db_movement-app';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(args, input) {
  const r = cp.spawnSync('docker', ['exec', '-i', container, ...args], {
    input, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  if (r.error || r.status !== 0) throw new Error(String(r.error || '') + r.stderr + r.stdout);
  return r.stdout.trim();
}
function query(db, sql) {
  return command(['psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],sql);
}
class Session {
  constructor(db) {
    this.out = ''; this.err = ''; this.closed = false;
    this.child = cp.spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
    this.child.stdout.on('data', b => { this.out += b; });
    this.child.stderr.on('data', b => { this.err += b; });
    this.child.stdin.on('error', e => { this.err += e.message; });
    this.child.on('error', e => { this.err += e.message; this.closed = true; });
    this.child.on('close', () => { this.closed = true; });
  }
  async send(sql) {
    const marker = 'done_' + crypto.randomBytes(6).toString('hex');
    const start = this.out.length;
    this.child.stdin.write(sql + '\n\\echo ' + marker + '\n');
    const end = Date.now() + 55000;
    while (!this.out.slice(start).includes(marker)) {
      if (this.closed) throw new Error(this.err);
      if (Date.now() > end) throw new Error('PostgreSQL session barrier timed out');
      await delay(20);
    }
    return this.out.slice(start).replace(marker,'').trim();
  }
  async begin() {
    this.pid = Number(await this.send("SELECT pg_backend_pid();"));
    await this.send("BEGIN; SET LOCAL lock_timeout='45s'; SET LOCAL statement_timeout='50s'; SET LOCAL idle_in_transaction_session_timeout='55s';");
  }
  close() { this.child.stdin.end('ROLLBACK;\n\\q\n'); }
}
const quote = value => value === null ? 'NULL' : "'" + String(value).replaceAll("'","''") + "'";
function claim(f, contract = {}) {
  const p = {namespace:'test-requester',product:'directions',version:'profile-undecided-v1',schema:'requester_route_evidence_v1',format:'geojson_linestring_v1',...contract};
  return `SELECT row_to_json(r) FROM public.claim_requester_route_generation_for_server(${quote(f.need)},${quote(f.member)},${quote(p.namespace)},${quote(p.product)},${quote(p.version)},${quote(p.schema)},${quote(p.format)}) r;`;
}
function publish(f, token, overrides = {}) {
  const p = {origin:f.origin,destination:f.destination,schema:'requester_route_evidence_v1',format:'geojson_linestring_v1',namespace:'test-requester',product:'directions',version:'profile-undecided-v1',reference:'route-'+f.need,
    shape:'{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]]}',distance:1000,duration:300,generated:'clock_timestamp()',expiry:'NULL',...overrides};
  return `SELECT row_to_json(r) FROM public.record_claimed_requester_route_evidence_for_server(${quote(f.need)},${quote(f.member)},${quote(token)},${quote(p.origin)},${quote(p.destination)},${quote(p.schema)},${quote(p.format)},${quote(p.namespace)},${quote(p.product)},${quote(p.version)},${quote(p.reference)},${quote(p.shape)}::jsonb,${p.distance},${p.duration},${p.generated},${p.expiry}) r;`;
}
function fresh(target, {expiry = "clock_timestamp()+interval '2 hours'", status='discoverable'} = {}) {
  const f = Object.fromEntries(['member','need','origin','destination'].map(k => [k,crypto.randomUUID()]));
  target(`BEGIN;
    INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES('${f.member}','authenticated','authenticated','${f.member}@test-0093.invalid','{}','{}',clock_timestamp(),clock_timestamp());
    INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,status) VALUES('${f.need}','${f.member}','Origin','Destination',clock_timestamp()+interval '1 hour','${status}');
    INSERT INTO private.movement_location_references(id,owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,provider_namespace,provider_place_reference,resolution_version,created_at,resolved_at,expires_at)
    VALUES('${f.origin}','${f.member}','Origin','provider_resolved','resolved',6.4,3.4,'test-location','origin','v1',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',${expiry}),
    ('${f.destination}','${f.member}','Destination','provider_resolved','resolved',6.5,3.5,'test-location','destination','v1',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',${expiry});
    INSERT INTO private.movement_need_locations VALUES('${f.need}','origin','${f.origin}'),('${f.need}','destination','${f.destination}'); COMMIT;`);
  return f;
}
async function run(callback) {
  assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0093';"),'1','First reset the local database through 0093');
  const db = 'requester0093_' + crypto.randomBytes(6).toString('hex');
  const archive = '/tmp/'+db+'.dump', list = '/tmp/'+db+'.list';
  const sessions = [];
  const snapshot=fs.readFileSync(path.join(__dirname,'pricing_quote_foundation.test.cjs'),'utf8').match(/const snapshot = `([\s\S]*?)`;/)[1];
  const fingerprint = () => query('postgres',snapshot);
  const before = fingerprint();
  let created = false;
  try {
    const migration=fs.readFileSync(path.join(__dirname,'../migrations/0093_requester_route_generation_claim_boundary.sql'),'utf8').replace(/\r\n/g,'\n');
    const functions=[...migration.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:private|public)\.\w+)\([^]*?AS \$\$([^]*?)\$\$;/g)];
    assert.equal(functions.length,7);
    for(const f of functions){
      const actual=JSON.parse(query('postgres',`SELECT json_build_object('body',p.prosrc,'definer',p.prosecdef,'config',p.proconfig,'owner',pg_get_userbyid(p.proowner)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=${quote(f[1])};`));
      assert.equal(actual.body.replace(/\r\n/g,'\n'),f[2],f[1]+' installed body equals final source');
      assert(actual.definer);assert.deepEqual(actual.config,['search_path=""']);assert.equal(actual.owner,'postgres');
    }
    command(['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--format=custom','--file='+archive,'--schema=public','--schema=private','--schema=auth','--schema=extensions']);
    command(['tee',list],command(['pg_restore','--list',archive]).split('\n').filter(l => !/^\d+;\s+\d+\s+\d+\s+DEFAULT ACL\s/.test(l)).join('\n')+'\n');
    query('postgres',`CREATE DATABASE ${db} TEMPLATE template0;`); created = true;
    query(db,'DROP SCHEMA public;');
    command(['pg_restore','-U','postgres','--dbname='+db,'--no-owner','--exit-on-error','--single-transaction','--use-list='+list,archive]);
    const target = sql => query(db,sql);
    await callback({db,target,fresh:options=>fresh(target,options),claim,publish,session:()=>{const s=new Session(db);sessions.push(s);return s;},async blocked(a,b){
      const end=Date.now()+8000;
      while(Date.now()<end){if(target(`SELECT ${a.pid}=ANY(pg_blocking_pids(${b.pid}));`)==='t')return; if(b.closed)throw new Error(b.err); await delay(30);}
      throw new Error('Expected actual PostgreSQL blocking relationship');
    }});
  } finally {
    for(const s of sessions)s.close();
    if(created){assert(/^requester0093_[a-f0-9]{12}$/.test(db));query('postgres',`DROP DATABASE ${db} WITH (FORCE);`);}
    command(['rm','-f','--',archive,list]);
    assert.equal(fingerprint(),before,'Local application data/catalog/ACL/RLS/history unchanged');
  }
}
async function main(){ await run(async c=>{
  for(const file of ['0093_requester_route_generation_claim_boundary_test.sql','0092_requester_route_evidence_foundation_test.sql','0033_route_generation_claim_boundary_test.sql']){
    const result=c.target(fs.readFileSync(path.join(__dirname,file),'utf8')); console.log(file+'\n'+result);
    assert(!/\|f(?:\||$)/m.test(result),'SQL regression reported a failed check');
  }
}); }
module.exports={run,claim,publish,quote,delay};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
