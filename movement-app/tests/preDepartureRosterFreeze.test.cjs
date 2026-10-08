'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),cp=require('node:child_process');
const root=path.join(__dirname,'..'),dir=path.join(root,'supabase/migrations');
const sql=fs.readFileSync(path.join(dir,'0091_pre_departure_roster_freeze.sql'),'utf8').replace(/\r\n/g,'\n');
const functions=[...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+((?:public|private)\.\w+)\s*\([^]*?AS (\$\w*\$)([^]*?)\2;/g)];
const body=n=>{const f=functions.find(f=>f[1]===n);assert(f,n);return f[3];};
test('0001–0090 normalized bytes retain exact audited baseline',()=>{
 const names=fs.readdirSync(dir).filter(f=>/^\d{4}_.*\.sql$/.test(f)&&+f.slice(0,4)<=90).sort();assert.equal(names.length,90);
 assert.equal(crypto.createHash('sha256').update(names.map(f=>f+'\n'+fs.readFileSync(path.join(dir,f),'utf8').replace(/\r\n/g,'\n')).join('\n')).digest('hex'),'8ce33c31c31504e5c1aa046d4130d3e408f01151fcb5b19ec09e4f27dd6a851c');
});
test('one private immutable parent receipt with finite server metadata',()=>{
 assert.match(sql,/availability_id uuid PRIMARY KEY/);assert.match(sql,/offering_movement_intent_id uuid NOT NULL UNIQUE/);
 assert.match(sql,/offering_movement_roster_freeze_v1/);assert.match(sql,/NEW\.frozen_at:=clock_timestamp\(\)/);
 assert.match(sql,/CHECK\(isfinite\(frozen_at\)\)/);assert.match(body('private.protect_offering_movement_roster_freeze'),/TG_OP<>'INSERT'/);assert.match(sql,/BEFORE TRUNCATE/);
});
test('receipt RLS has no policies and all untrusted roles lose every privilege',()=>{
 assert.match(sql,/offering_movement_roster_freezes ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON private\.offering_movement_roster_freezes FROM PUBLIC,anon,authenticated,service_role/);
 assert.doesNotMatch(sql,/CREATE POLICY|GRANT.*roster/i);
 for(const f of functions){assert.match(f[0],/SECURITY DEFINER/);assert.match(f[0],/SET search_path\s*(?:=|TO)\s*''/);}
 for(const f of functions.filter(f=>f[1].startsWith('private.')&&!f[0].startsWith('CREATE OR REPLACE'))){assert(sql.includes('REVOKE ALL ON FUNCTION '+f[1]+'('));}
});
test('funded and legacy public signatures remain identical',()=>{
 for(const [name,file] of [['public.request_my_funded_movement_start','0081_financial_movement_start.sql'],['public.request_journey_start','0080_funded_movement_coordination_entry.sql'],['public.get_trusted_matching_context_for_server','0050_state_bound_movement_matching.sql']]){
  const old=fs.readFileSync(path.join(dir,file),'utf8');const match=[...old.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+((?:public|private)\.\w+)\s*\([^]*?LANGUAGE/g)].find(m=>m[1]===name);
  const signature=s=>s.slice(s.indexOf(name),s.indexOf('LANGUAGE')).replace(/\s+/g,' ').trim();
  assert.equal(signature(functions.find(f=>f[1]===name)[0]),signature(match[0]));
 }
});
test('freeze serializes after established start graph locks and before clock sample',()=>{
 const b=body('public.request_my_funded_movement_start');assert(b.indexOf('FOR SHARE')<b.indexOf('parent:=private.lock_start_roster_parent'));
 assert(b.indexOf('parent:=private.lock_start_roster_parent')<b.indexOf('stamp:=clock_timestamp()'));
 const p=body('private.lock_start_roster_parent');assert(p.indexOf('offering_movement_intents i')<p.indexOf('offering_route_evidence r'));assert(p.indexOf('offering_route_evidence r')<p.indexOf('WHERE x.id=b.availability_id FOR UPDATE'));
 assert.doesNotMatch(p,/movement_needs|assert_offering_movement_availability/);
});
test('freeze never consumes unused capacity or rewrites terminal parent state',()=>{
 const b=body('private.construct_offering_movement_roster_freeze');assert.match(b,/IF av.status='open' THEN/);assert.match(b,/SET status='unavailable'/);
 assert.doesNotMatch(b,/SET remaining_places|status='full'/);assert.match(b,/assert_offering_movement_roster_freeze\(p_parent\); RETURN/);
 assert.match(body('private.protect_offering_movement_availability'),/NEW.remaining_places<>OLD.remaining_places OR NOT EXISTS/);
});
test('graph authority has no cross-transaction wall-clock membership comparisons',()=>{
 const b=body('private.assert_offering_movement_roster_freeze');assert.doesNotMatch(b,/clock_timestamp|accepted_at\s*[<>]|frozen_at\s*[<>]|assert_offering_movement_availability/);
 assert.match(b,/j.start_requested_at=f.initiating_requested_at/);assert.match(b,/sr.requested_at=f.initiating_requested_at/);
 assert.match(b,/e.route_evidence_id=r.id/);assert.match(body('private.protect_offering_movement_roster_freeze'),/auth.uid\(\) IS DISTINCT FROM a.offering_member_id/);
});
test('atomic completeness uses named constraints and covers direct trusted construction',()=>{
 assert.doesNotMatch(sql.replace(/--[^\n]*/g,''),/SET CONSTRAINTS ALL/);for(const n of ['roster_freeze_complete','roster_availability_complete','roster_journey_complete','roster_funded_request_complete'])assert.match(sql,new RegExp('CREATE CONSTRAINT TRIGGER '+n));
 assert.match(body('public.request_my_funded_movement_start'),/roster_freeze_complete[^;]*DEFERRED/);assert.match(body('public.request_my_funded_movement_start'),/roster_freeze_complete[^;]*IMMEDIATE/);
 assert.match(sql,/guard_new_roster_alignment BEFORE INSERT/);assert.match(sql,/guard_new_roster_offer BEFORE UPDATE/);
 assert.match(sql,/guard_roster_start_actor BEFORE INSERT OR UPDATE/);assert.match(body('private.guard_new_roster_admission'),/auth.uid\(\) IS DISTINCT FROM actor/);
});
test('live admission and intent matching preserve 0090 narrow eligibility contract',()=>{
 for(const n of ['private.assert_offering_movement_availability','public.get_trusted_matching_context_for_server','private.guard_new_roster_admission']){assert.match(body(n),/offering_movement_roster_freezes/);assert.match(body(n),/Availability is not open and eligible/);}
 const priority=fs.readFileSync(path.join(dir,'0090_trusted_requester_movement_priority_integration.sql'),'utf8');assert.match(priority,/WHEN check_violation THEN/);assert.match(priority,/IF SQLERRM IN/);assert.match(priority,/END IF;\s*RAISE;/);assert.doesNotMatch(priority,/WHEN check_violation(?: OR no_data_found)? THEN\s*CONTINUE/);
});
test('preflight rejects actual modern starts without fabricating history',()=>{assert.match(sql,/JOIN private.movement_offer_availability_bindings b/);assert.match(sql,/j.start_requested_at IS NOT NULL OR j.started_at IS NOT NULL/);assert.match(sql,/0091 preflight:/);assert.doesNotMatch(sql,/INSERT INTO[^;]*SELECT[^;]*start_requested_at/is);});
test('no new finance implementation, paid provider, or production client change',()=>{
 assert.doesNotMatch(sql,/CREATE(?: OR REPLACE)? FUNCTION[^\n]*(?:settle|pricing|priority|funding|activation|completion)/i);
 assert.doesNotMatch(sql,/INSERT INTO private\.(?:wallet|financial_components)|https?:\/\//i);
 assert.equal(cp.execFileSync('git',['diff','9308aa06b09a7af83ada68bc111b98254b896854','--','src','package.json','package-lock.json'],{cwd:root,encoding:'utf8'}),'');
});
