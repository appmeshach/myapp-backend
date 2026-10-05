'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto');
const {disposable,container}=require('./0082_trusted_temporal_evidence_hardening_harness.cjs');
const {fixtures}=require('./0082_financial_movement_completion_behavior.cjs');
const {inspect}=require('./0082_financial_movement_completion_harness.cjs');
const {query}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const source=fs.readFileSync(path.join(__dirname,'../migrations/0084_completed_movement_reputation.sql'),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(callback,{preexisting=false}={}){
 assert.equal(inspect(query),'installed','0084 source testing requires verified installed 0082/0083');
 await disposable(async c=>{
  assert.equal(c.target("SELECT to_regclass('private.completed_movement_ratings') IS NULL;"),'t','Do not overwrite installed reputation');
  let ordinal=0;
  const as=(f,actor,sql)=>`SELECT set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated; ${sql} RESET ROLE;`;
  function fresh({offerer,complete=true}={}){
   const schema='reputation_fixture_'+(++ordinal);
   let setup=fixtures().replace('BEGIN;',`BEGIN; SELECT set_config('movement.fixture_scenario','${schema}',true); CREATE SCHEMA ${schema};`)
    .replaceAll('pg_temp.',schema+'.').replaceAll('CREATE TEMP TABLE','CREATE TABLE').replaceAll(' ON COMMIT DROP','');
   if(offerer){assert(/^[0-9a-f-]{36}$/.test(offerer));assert(setup.includes('offerer uuid := gen_random_uuid();'));
    setup=setup.replace('offerer uuid := gen_random_uuid();',`offerer uuid := '${offerer}';`).replace(']) ids(id);',']) ids(id) ON CONFLICT(id) DO NOTHING;');}
   c.target(setup+' COMMIT;');c.target(`BEGIN; SELECT ${schema}.prepare_completion(); COMMIT;`);
   const f=JSON.parse(c.target(`SELECT jsonb_build_object('schema','${schema}','need',a.movement_need_id,'alignment',a.id,'offerer',a.offering_member_id,'requester',a.member_needing_movement_id,'traveller',s.traveller) FROM public.alignments a JOIN ${schema}.snapshot_fixture s ON s.need=a.movement_need_id;`));
   if(complete)c.target('BEGIN; '+as(f,f.offerer,`SELECT * FROM public.request_my_funded_movement_completion('${f.need}');`)+as(f,f.requester,`SELECT * FROM public.confirm_my_funded_movement_completion('${f.need}');`)+' COMMIT;');
   return f;
  }
  class Session{
   constructor(){this.out='';this.err='';this.closed=false;this.child=cp.spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',c.database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});
    this.child.stdout.on('data',b=>this.out+=b);this.child.stderr.on('data',b=>this.err+=b);this.child.on('close',()=>this.closed=true);this.child.on('error',e=>{this.err+=e.message;this.closed=true;});this.child.stdin.on('error',e=>this.err+=e.message);c.sessions.push(this);}
   async send(sql){const marker='done_'+crypto.randomBytes(6).toString('hex');this.child.stdin.write(sql+'\n\\echo '+marker+'\n');const end=Date.now()+20000;while(!this.out.includes(marker)){if(this.closed||Date.now()>end)throw Error(this.err||'Session barrier timed out');await delay(25);}}
   async begin(){await this.send("SELECT 'PID='||pg_backend_pid(); BEGIN; SET LOCAL lock_timeout='25s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='35s';");this.pid=Number(this.out.match(/PID=(\d+)/)[1]);}
   close(){if(!this.closed)this.child.stdin.end('ROLLBACK;\n\\q\n');}
  }
  let proofs=0;
  async function blocked(a,b){const end=Date.now()+8000;while(Date.now()<end){if(c.target(`SELECT ${a.pid}=ANY(pg_blocking_pids(${b.pid}));`)==='t'){proofs++;return;}if(b.closed)throw Error(b.err);await delay(40);}throw Error('Expected actual PostgreSQL blocking relationship');}
  const rate=(f,stars,actor=f.requester)=>as(f,actor,`SELECT * FROM public.rate_my_completed_movement_person('${f.need}',1,${stars});`);
  const existing=preexisting?fresh():null;
  c.target(source);
  await callback({...c,existing,fresh,as,Session,blocked,rate,proofs:()=>proofs});
 });
}
module.exports={run,source};
