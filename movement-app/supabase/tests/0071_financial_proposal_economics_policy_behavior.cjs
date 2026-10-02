'use strict';
const assert=require('node:assert/strict');
const {read,query,psql,snapshot}=require('./0069_trusted_pricing_quote_producer_behavior.cjs');
function main(){
 assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0071';"),'1','Apply 0071 locally first');
 const before=query('postgres',snapshot+';');
 // In-transaction snapshot proves the calculator writes nothing, not just rollback.
 let sql=read('0071_financial_proposal_economics_policy_test.sql');
 assert(sql.includes('DO $$ DECLARE x record;'));
 sql=sql.replace('DO $$ DECLARE x record;', () => 'CREATE TEMP TABLE economics_before AS '+snapshot+';\nDO $$ DECLARE x record;');
 sql=sql.replace('SET CONSTRAINTS ALL IMMEDIATE;', "SELECT pg_temp.check_result('all application data schema ACL RLS unchanged before rollback',("+snapshot+")::jsonb=(SELECT state::jsonb FROM economics_before));\nSET CONSTRAINTS ALL IMMEDIATE;");
 const r=psql('postgres',sql);process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 assert.equal(query('postgres',snapshot+';'),before,'External rollback snapshot');
 console.log('PASS external rollback snapshot unchanged');
 if(r.error)throw r.error;process.exitCode=r.status??1;
}
if(require.main===module)main();
