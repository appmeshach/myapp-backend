'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.join(__dirname,'../supabase/migrations');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const raw=read(path.join(dir,'0070_financial_proposal_quote_binding_foundation.sql'));
const clean=s=>s.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim();
const sql=clean(raw),old=read(path.join(dir,'0021_financial_proposal_foundation.sql'));
test('0070 is one transaction with a locked fail-closed legacy precondition',()=>{
 assert.deepEqual(fs.readdirSync(dir).filter(n=>n.startsWith('0070_')),['0070_financial_proposal_quote_binding_foundation.sql']);
 assert.match(sql,/^BEGIN;.*COMMIT;$/);assert(sql.indexOf('LOCK TABLE')<sql.indexOf('IF EXISTS'));
 assert(sql.indexOf('IF EXISTS')<sql.indexOf('ALTER TABLE'));
 assert.match(sql,/LOCK TABLE private.financial_proposals IN ACCESS EXCLUSIVE MODE/);
 assert.match(sql,/IF EXISTS \(SELECT 1 FROM private.financial_proposals\) THEN RAISE EXCEPTION/);
});
test('exact mandatory quote fields and FK have no fabricated defaults',()=>{
 assert.match(sql,/ADD COLUMN pricing_quote_id uuid NOT NULL REFERENCES private.pricing_quotes\(id\)/);
 assert.match(sql,/ADD COLUMN pricing_quote_version integer NOT NULL CHECK \(pricing_quote_version>=1\)/);
 assert.doesNotMatch(sql,/\bDEFAULT\b|\bGRANT\b|\bPOLICY\b|DISABLE|DROP|route_evidence_id/i);
});
test('only private hardened helpers are created or replaced',()=>{
 assert.deepEqual([...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)/g)].map(m=>m[1]),['private.assert_financial_proposal_quote_binding','private.protect_financial_proposal']);
 assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/g)||[]).length,2);
 for(const name of ['assert_financial_proposal_quote_binding','protect_financial_proposal'])assert.match(sql,new RegExp('REVOKE ALL ON FUNCTION private\\.'+name+'\\([^)]*\\) FROM PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role'));
});
test('immutable provenance matches exact version need principals currency and policy',()=>{
 assert.match(sql,/ROW\(p.pricing_quote_version,p.movement_need_id,p.member_needing_movement_id, p.offering_member_id,p.currency,p.pricing_policy_version\) IS DISTINCT FROM ROW\(q.version,q.movement_need_id,q.requesting_member_id, q.offering_member_id,q.currency,q.pricing_policy_version\)/);
 assert.match(sql,/p.created_at<q.created_at/);assert.match(sql,/p.expires_at>q.expires_at/);
 assert.match(sql,/p.expires_at IS NULL OR NOT isfinite\(p.expires_at\)/);
});
test('historical assertion takes no locks and does not require live status',()=>{
 const body=sql.slice(sql.indexOf('CREATE FUNCTION'),sql.indexOf('CREATE OR REPLACE FUNCTION'));
 assert.doesNotMatch(body,/FOR SHARE|FOR UPDATE|assert_pricing_quote\(|clock_timestamp|q.status/);
});
test('live assertion is only in INSERT branch and before every FK check',()=>{
 assert.equal((sql.match(/PERFORM private.assert_pricing_quote\(/g)||[]).length,1);
 assert.match(sql,/IF TG_OP='INSERT' THEN PERFORM private.assert_financial_proposal_quote_binding\(NEW\); PERFORM private.assert_pricing_quote\(NEW.pricing_quote_id\);/);
 assert.doesNotMatch(sql,/CREATE (?:CONSTRAINT )?TRIGGER|validate_financial_proposal\(/);
});
test('every original protection guard is preserved; new fields remain immutable',()=>{
 const extract=s=>s.slice(s.indexOf('FUNCTION private.protect_financial_proposal()'),s.indexOf('REVOKE ALL ON FUNCTION private.protect_financial_proposal()'));
 const revised=clean(extract(raw)).replace(' PERFORM private.assert_financial_proposal_quote_binding(NEW);','').replace(' PERFORM private.assert_pricing_quote(NEW.pricing_quote_id);','');
 assert.equal(revised,clean(extract(old)));
 assert.doesNotMatch(revised,/ARRAY\[[^\]]*pricing_quote/);
});
test('no issuer monetary calculation or operational DML',()=>{
 assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE|DELETE FROM) (?:public|private)\./);
 assert.doesNotMatch(sql,/seat_price_minor|quoted_platform_fee_total_minor|quoted_movement_contribution_minor|accept_movement_offer|wallet_|\bpublic\./);
});
test('behavior is rollback-only and tests actual migration precondition',()=>{
 const live=read(path.join(__dirname,'../supabase/tests/0070_financial_proposal_quote_binding_test.sql'));
 assert.match(live,/^BEGIN;/);assert.match(live,/ROLLBACK;\s*$/);assert.match(live,/SET CONSTRAINTS ALL IMMEDIATE/);
 assert.doesNotMatch(clean(live),/DISABLE TRIGGER|session_replication_role|\bCOMMIT;/);
 const runner=read(path.join(__dirname,'../supabase/tests/0070_financial_proposal_quote_binding_behavior.cjs'));
 assert.match(runner,/migration.slice\(migration.indexOf\('LOCK TABLE'\),migration.indexOf\('ALTER TABLE'\)\)/);
});
test('all 69 historical migrations remain unchanged modulo line endings',()=>{
 const names=fs.readdirSync(dir).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&+n.slice(0,4)<=69).sort();assert.equal(names.length,69);
 assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read(path.join(dir,n))).join('\n')).digest('hex'),'3a705c6d9cc41bd10a68bfc2988027c3e78d002fe2bbe40319a894354a712dda');
});
