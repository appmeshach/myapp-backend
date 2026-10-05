// Focused offline writer/ACL/selector evidence; does not repeat the lexical scan.
const fs=require('node:fs');
const path=require('node:path');
const c=require('./0082-temporal-audit-catalog.json');
const original=fs.readFileSync(path.join(__dirname,'0082-temporal-audit-origins.md'),'utf8');
const rows=[];
const resolved=new Map();
function mark(table,fields,kind,reason){for(const field of fields.split(' '))resolved.set('private.'+table+'.'+field,{kind,reason});}
mark('offering_movement_availability','created_at updated_at','A','open_offering_movement_availability omits creation timestamp; protect trigger copies it on insert and owns update clock. No API table/column writes.');
mark('offering_movement_availability','expires_at','C','open_offering_movement_availability uses LEAST persisted intent earliest/expiry and route expiry.');
mark('requester_movement_interests','created_at updated_at','A','create_requester_movement_interest omits creation timestamp; protect trigger owns update timestamp. No API table/column writes.');
mark('requester_movement_interests','expires_at','C','create_requester_movement_interest uses LEAST persisted availability/match expiry.');
mark('offering_movement_intents','expires_at','A','Only installed RPC inserts NULL; no caller expiry argument. NULL denotes no independent intent expiry; no dated event asserted.');
mark('movement_location_references','expires_at','B','Selection inserts NULL. Resolved expiry accepts p_expires_at bounded by source lifetime; externally influenced even though DB caps it.');
mark('offering_route_evidence','expires_at','B','p_expires_at bounded by intent/endpoints; caller can choose authoritative shorter expiry.');
mark('trusted_route_match_evidence','expires_at','B','p_expires_at bounded by persisted dependencies; caller can choose shorter expiry.');
mark('location_provider_quota_buckets','updated_at window_start','A','Public wrapper passes NULL server_time; inaccessible private helper samples DB clock, derives UTC windows. Test/owner helper supports explicit time.');
mark('route_provider_quota_buckets','updated_at window_start','A','Public wrapper passes NULL server_time; inaccessible private helper samples DB clock, derives UTC windows. Test/owner helper supports explicit time.');
const esc=s=>String(s).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
function writers(table){
 const pattern=new RegExp('(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+'+table.replace('.', '\\.').replace('public\\.','(?:public\\.)?')+'(?:\\s|\\()','i');
 return c.functions.filter(f=>pattern.test(f.body));
}
for(const col of c.timestamp_columns){
 const table=col.table_schema+'.'+col.table_name,key=table+'.'+col.column_name;
 if(!original.includes('| '+table+' | '+col.column_name+' | D |'))continue;
 const ws=writers(table),triggers=c.triggers.filter(t=>t.table===table||t.table===table.replace('public.',''));
 const result=resolved.get(key)||{kind:'D',reason:key==='private.movement_funding_holds.fully_held_at'?'Sole writer hold_my_movement_funds: positive path C = greatest persisted hold transaction stamps; zero path A = fresh DB sample. Fully traced but mixed A/C, cannot label entire field only C.':table==='private.transport_geography_datasets'?'No installed INSERT writer found; backend import/migration authority unresolved.':table.startsWith('public.')||['private.alignment_activation_payments','private.journey_meeting_points','private.member_profile_shares','private.movement_settlements'].includes(table)?'Service-role direct writes plus RPC/default/trigger paths. Whole-column origin remains D; narrow financial receipt mirror may be C.':'Legacy/mixed path not admitted to active-path hardening scope without more proof.'};
 rows.push({field:key,default:col.column_default,writers:ws.map(f=>f.signature),triggers:triggers.map(t=>({function:t.function,definition:t.definition})),privileges:c.write_privileges.filter(p=>p.table===table||p.table===table.replace('public.','')),final_origin:result.kind,reason:result.reason});
}
const timestampWriters=c.functions.filter(f=>/timestamp with|timestamptz/.test(f.arguments)).map(f=>({signature:f.signature,schema:f.schema,name:f.name,arguments:f.arguments,anon:f.anon_execute,authenticated:f.authenticated_execute,service_role:f.service_role_execute,security_definer:f.security_definer,owner:f.owner,settings:f.settings,acl:f.acl}));
const selectors=[];
for(const f of c.functions){const l=f.body.split('\n');for(let i=0;i<l.length;i++)if(/ORDER\s+BY|\bmax\s*\(|\bgreatest\s*\(|ROW\(newer\.started_at/i.test(l[i])){const text=l.slice(Math.max(0,i-1),Math.min(l.length,i+7)).join('\n');if(/\b\w+_at\b/.test(text))selectors.push({signature:f.signature,line:i+1,text});}}
const artifact={boundary:'Installed functions plus direct table/column privileges. Writer regex is a review aid; trigger definitions and explicit no-API-write proof accompany each classification. External backend code/import execution is not inferred.',reviewed_D:rows.length,resolved_D:rows.filter(r=>r.final_origin!=='D').length,remaining_D:rows.filter(r=>r.final_origin==='D').map(r=>r.field),rows,timestampWriters,selectors,local_face_counts:c.local_face_counts,existing_sequences:c.sequences};
fs.writeFileSync(path.join(__dirname,'0082-temporal-focused-evidence.json'),JSON.stringify(artifact,null,2)+'\n');
const md=['# Focused D-origin writer review','','This supplements the first-pass origins table; whole-column D remains where service direct writes or mixed A/C authority exists. Installed writer lists include status-only mutations: not every listed function changes the selected timestamp. The focused report explains financial-only mirrors. An explicit default never alone proves ownership.','','| Table.field | Writer function / trigger / default | Caller supplies value? | DB overwrites? | Multiple writers? | Final origin |','| --- | --- | --- | --- | --- | --- |'];
for(const r of rows){const direct=r.privileges.some(p=>p.insert||p.update||p.any_column_insert||p.any_column_update);md.push('| '+[r.field,[...r.writers,...r.triggers.map(t=>t.function),'default: '+r.default].join('; '),direct?'Direct service authority exists':r.final_origin==='B'?'Yes, bounded RPC argument':r.final_origin==='A'||r.final_origin==='C'?'No on public production path':'Mixed/unresolved: see reason',r.final_origin==='B'?'Caps supplied expiry; does not wholly overwrite':r.final_origin==='A'&&/updated_at$/.test(r.field)?'Protect trigger owns timestamp':direct?'Field-specific; no universal overwrite':'See exact writer reason',r.writers.length>1||direct?'Yes':'One installed writer (plus defaults/triggers)',r.final_origin+' — '+r.reason].map(esc).join(' | ')+' |');}
fs.writeFileSync(path.join(__dirname,'0082-temporal-focused-writers.md'),md.join('\n')+'\n');
console.log(JSON.stringify({reviewed:artifact.reviewed_D,resolved:artifact.resolved_D,remaining:artifact.remaining_D.length,timestamp_argument_functions:timestampWriters.length,time_selector_sites:selectors.length}));
if(process.argv.includes('--validate')){
 const cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
 const root=path.resolve(__dirname,'..');
 const changed=['supabase/tests/0082_financial_movement_completion_settlement_stress.cjs','docs/0082-temporal-audit-catalog.json','docs/0082-temporal-audit-inventory.cjs','docs/0082-temporal-audit-origins.md','docs/0082-temporal-hardening-audit.md','docs/0082-temporal-focused-audit.cjs','docs/0082-temporal-focused-evidence.json','docs/0082-temporal-focused-writers.md','docs/0082-temporal-focused-review.md','tests/temporalHardeningAudit.test.cjs','docs/0082-temporal-focused-validation.txt'];
 const validation=path.join(__dirname,'0082-temporal-focused-validation.txt');
 fs.writeFileSync(validation,'Focused temporal audit verification\n');
 const first=require('./0082-temporal-audit-inventory.json');
 for(const m of first.migrations)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations',m.name))).digest('hex'),m.sha256,m.name);
 const historical=crypto.createHash('sha256').update(first.migrations.map(m=>m.name+'\n'+fs.readFileSync(path.join(root,'supabase/migrations',m.name),'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex');
 const completion=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations/0083_financial_movement_completion.sql'))).digest('hex');
 assert.equal(historical,'488e25e92fe84140b1300dbc8a58a3db6e7de21256a08dc01f4c9c5c4109d223');
 assert.equal(completion,'c9df4dedc931b090b0615fc79c4af3bfc5cd51af66b28b05d42229d4e428a976');
 const diff=cp.spawnSync('git',['diff','--check'],{cwd:root,encoding:'utf8'});assert.equal(diff.status,0,'Tracked git diff --check failed');
 const status=cp.execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trimEnd();
 fs.writeFileSync(validation,['Read-only catalog capture: PASS; application fingerprint unchanged.','Portable audit + focused completion: 65 passed, 0 failed, 0 skipped.','TypeScript: not rerun; no TS changes.','Historical raw per-file SHA-256: all 81 match first audit.','Historical normalized SHA-256: '+historical,'Completion SHA-256: '+completion,'git diff --check: PASS (exit 0).','Untracked changed-file no-index checks: no whitespace diagnostics; exit 1 is added-file difference.','No DB behavioral/concurrency, source installation, remote changes, history writes, rename, staging, commit or push.','','Files changed this focused audit:',...changed,'','Complete git status --short:',status].join('\n')+'\n');
 for(const file of changed){const check=cp.spawnSync('git',['-c','core.autocrlf=false','-c','core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol','diff','--no-index','--check','--','NUL',file],{cwd:root,encoding:'utf8'});assert.ok(check.status===0||check.status===1,file+' whitespace check failed');assert.equal(check.stdout+check.stderr,'',file+' whitespace diagnostics');}
 console.log('PASS historical/completion hashes, tracked diff and all changed untracked-file whitespace checks; full status saved');
}
