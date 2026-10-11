'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const source=read('supabase/migrations/0095_requester_deadline_matching_context_repair.sql');
const historical=read('supabase/migrations/0091_pre_departure_roster_freeze.sql');
const definition=s=>s.match(/CREATE OR REPLACE FUNCTION\s+public\.get_trusted_matching_context_for_server\([^]*?\$trusted_matching_context\$;/)[0];
const guard=/  IF COALESCE\(\n    v_need\.latest_departure_at,\n    v_need\.earliest_departure_at\n  \) <= clock_timestamp\(\) THEN\n    RAISE EXCEPTION USING\n      ERRCODE = '23514',\n      MESSAGE = 'Movement need is not available for matching';\n  END IF;\n\n/g;
test('0095 differs from complete effective 0091 definition only by two exact 0052 guards',()=>{
 assert.equal((source.match(guard)||[]).length,2);assert.equal(definition(source).replace(guard,''),definition(historical));
 const lost=read('supabase/migrations/0052_downstream_requester_movement_deadline.sql').match(guard);assert.equal(lost.length,2);assert.deepEqual(source.match(guard),lost);
});
test('early guard follows locked need/status; final wall clock guard follows state checks immediately before return',()=>{
 const guards=[...source.matchAll(guard)];assert.match(source.slice(0,guards[0].index),/FOR SHARE;[^]*IF v_need.status <> 'discoverable' THEN[^]*END IF;\s*$/);
 assert.match(source.slice(0,guards[1].index).replace(/--[^\n]*/g,''),/PERFORM private.assert_state_bound_matching_context\([^]*?\);\s*$/);
 assert.match(source.slice(guards[1].index+guards[1][0].length),/^  RETURN QUERY/);
});
test('single surgical replacement and unchanged service-only security contract',()=>{
 assert.match(source,/^BEGIN;/);assert.match(source,/COMMIT;\s*$/);assert.equal((source.match(/CREATE OR REPLACE FUNCTION/g)||[]).length,1);
 assert.match(source,/SECURITY DEFINER\s+SET search_path = ''/);assert.match(source,/FROM PUBLIC, anon, authenticated, service_role/);assert.match(source,/TO service_role/);
 assert.doesNotMatch(source,/\b(?:INSERT|DELETE|ALTER|DROP|CREATE TABLE|CREATE TRIGGER)\b|pg_sleep|pg_temp|statement_timestamp|transaction_timestamp/i);
});
test('all 94 historical migrations equal HEAD modulo CRLF/LF checkout conversion',()=>{
 const prefix=cp.execFileSync('git',['rev-parse','--show-prefix'],{encoding:'utf8'}).trim();
 const files=fs.readdirSync('supabase/migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))<=94);assert.equal(files.length,94);
 for(const f of files){const p='supabase/migrations/'+f;assert.equal(read(p),cp.execFileSync('git',['show','HEAD:'+prefix+p],{encoding:'utf8',maxBuffer:4*1024*1024}).replace(/\r\n/g,'\n'),p);}
});
test('local integration runners import inertly and concurrency proves actual database blocking',()=>{
 assert.equal(typeof require('./0095_requester_deadline_matching_context_repair_harness.cjs').run,'function');
 assert.equal(typeof require('./0095_requester_deadline_matching_context_repair_concurrency.cjs').main,'function');
 const s=read('supabase/tests/0095_requester_deadline_matching_context_repair_concurrency.cjs');assert.match(s,/await c.blocked\(a,b\)/);assert.match(s,/earliest_departure_at<=clock_timestamp/);assert.doesNotMatch(s,/instrument|DISABLE TRIGGER|session_replication_role/);
});
