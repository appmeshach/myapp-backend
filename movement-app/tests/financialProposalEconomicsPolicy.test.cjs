'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.join(__dirname,'../supabase/migrations');const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const raw=read(path.join(dir,'0071_financial_proposal_economics_policy_foundation.sql')),sql=raw.replace(/--[^\n]*/g,'');
test('0071 one transaction and one exact private calculator only',()=>{
 assert.match(sql.trim(),/^BEGIN;[\s\S]*COMMIT;$/);assert.equal((sql.match(/\bBEGIN;/g)||[]).length,1);assert.equal((sql.match(/\bCOMMIT;/g)||[]).length,1);
 assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(x=>x[1]),['private.calculate_financial_proposal_economics']);
 assert.match(sql,/p_seat_price_minor bigint,\s*p_people_count integer,\s*p_financial_model_version text,\s*p_platform_fee_allocation_policy_version text/);
});
test('immutable definer empty search path and all application EXECUTE revoked',()=>{
 assert.match(sql,/IMMUTABLE SECURITY DEFINER SET search_path = ''/);
 assert.match(sql,/REVOKE ALL ON FUNCTION private.calculate_financial_proposal_economics\(bigint,integer,text,text\)\s*FROM PUBLIC,anon,authenticated,service_role;/);
 assert.doesNotMatch(sql,/\bGRANT\b/);
});
test('pure arithmetic has no tables DML locks public RPC or integrations',()=>{
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|TABLESPACE|EXECUTE|PERFORM|CALL)\b|\bCREATE TABLE\b|\bpublic\.|\bFROM\s+(?:public|private)\.|wallet|journey|provider|http|route|surge|scarcity|weather/i);
});
test('occupied people multiply exact price before one HALF-UP platform operation',()=>{
 assert.match(sql,/g:=p_seat_price_minor::numeric \* p_people_count::numeric;/);
 assert.match(sql,/f:=div\(g\*3\+5,10\);/);
 assert.equal((sql.match(/f:=/g)||[]).length,1);
 assert.doesNotMatch(sql,/seats_offered|\b(?:real|float|double precision)\b|0\.(?:15|70|85)|\*\s*(?:15|70|85)\b/i);
});
test('existing allocation and exact residual identities prohibit added fees',()=>{
 assert.match(sql,/o:=div\(f,2\);\s*r:=f-o;\s*c:=g-r;\s*net:=c-o;/);
 assert.match(sql,/shared_platform_fee_v1/);assert.match(sql,/equal_split_requester_remainder_v1/);
 assert.doesNotMatch(sql,/trusted_server_result_infrastructure_v1/);
});
test('all inputs required and positive, all outputs checked before casts',()=>{
 for(const p of ['p_seat_price_minor','p_people_count','p_financial_model_version','p_platform_fee_allocation_policy_version'])assert(sql.includes(p+' IS NULL'));
 assert.match(sql,/p_seat_price_minor<=0 OR p_people_count<=0/);
 assert.match(sql,/FOREACH amount IN ARRAY ARRAY\[g,f,o,r,c,net\]/);
 assert(sql.indexOf('amount>9223372036854775807::numeric')<sql.indexOf('g::bigint'));
 assert.equal((sql.slice(sql.indexOf('RETURNS TABLE'),sql.indexOf('LANGUAGE')).match(/bigint/g)||[]).length,6);
});
test('behavioral harness uses rollback and independent oracle with all roles',()=>{
 const live=read(path.join(__dirname,'../supabase/tests/0071_financial_proposal_economics_policy_test.sql'));
 assert.match(live,/^BEGIN;/);assert.match(live,/ROLLBACK;\s*$/);assert.match(live,/round\(s::numeric\*n\*0.30\)/);
 assert.match(live,/ARRAY\['anon','authenticated','service_role'\]/);
});
test('historical migrations 0001 through 0070 unchanged',()=>{
 const names=fs.readdirSync(dir).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&+n.slice(0,4)<=70).sort();assert.equal(names.length,70);
 assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read(path.join(dir,n))).join('\n')).digest('hex'),'88bd3d90515f8567e5ae06d5c8dc892347b6104e9beef2b2f64a10cbaa067135');
});
