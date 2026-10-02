'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const dir=path.join(__dirname,'../supabase/migrations');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const raw=read(path.join(dir,'0069_trusted_pricing_quote_producer_boundary.sql'));
const sql=raw.replace(/--[^\n]*/g,'');
test('0069 creates exactly one narrow RPC with no schema or trigger changes',()=>{
  assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.deepEqual([...sql.matchAll(/CREATE FUNCTION ([\w.]+)/g)].map(x=>x[1]),['public.record_pricing_quote_for_server']);
  assert.deepEqual(fs.readdirSync(dir).filter(x=>/^0069_/.test(x)),['0069_trusted_pricing_quote_producer_boundary.sql']);
  assert.doesNotMatch(sql,/CREATE (?:TABLE|TRIGGER|POLICY)|ALTER |DROP |CREATE OR REPLACE/);
  assert.match(sql,/p_pricing_geography_evidence_id uuid,\s*p_expected_pricing_geography_evidence_version integer,\s*p_pricing_policy_version text,\s*p_seat_price_minor numeric\s*\)/);
});
test('0069 is hardened service-only with no table write grants',()=>{
  assert.match(sql,/SECURITY DEFINER SET search_path = ''/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public.record_pricing_quote_for_server\(uuid,integer,text,numeric\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.deepEqual([...sql.matchAll(/GRANT[^;]+;/g)].map(x=>x[0]),['GRANT EXECUTE ON FUNCTION public.record_pricing_quote_for_server(uuid,integer,text,numeric)\n  TO service_role;']);
});
test('only exact positive numeric amounts and one infrastructure policy are accepted',()=>{
  for(const s of ["'trusted_server_result_infrastructure_v1'","('NaN','Infinity','-Infinity')",'p_seat_price_minor <= 0','9223372036854775807::numeric','p_seat_price_minor <> trunc(p_seat_price_minor)',"q.currency:='NGN'"])assert(sql.includes(s),s);
  assert(sql.indexOf('trunc(p_seat_price_minor)')<sql.indexOf('p_seat_price_minor::bigint'));
  assert.doesNotMatch(sql,/\b(?:float|double|real|round)\b|surge|demand|weather|scarcity|rush|activation_fee|70\s*[/\*%]|30\s*[/\*%]/i);
});
test('source-derived bindings and evidence expiry have no caller override',()=>{
  for(const field of ['movement_need_id','requesting_member_id','offering_member_id','offering_movement_intent_id','offering_intent_version','state_location_reference_id'])assert(sql.includes(`q.${field}:=e.${field};`));
  assert.match(sql,/q.expires_at:=e.expires_at;/);
  assert.match(sql,/q.created_at:=clock_timestamp\(\);/);
});
test('upstream validation precedes quote history locking and is repeated afterward',()=>{
  const first=sql.indexOf('PERFORM private.assert_pricing_quote_context(q);');
  const lock=sql.indexOf('ORDER BY x.version FOR UPDATE;');
  const second=sql.indexOf('PERFORM private.assert_pricing_quote_context(q);',first+1);
  assert(first>0&&first<lock&&lock<second);
  assert.match(sql,/current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed'/);
  assert(sql.indexOf('max(x.version)')>lock);
  assert.match(sql,/next_version > 2147483647/);
});
test('exact replay scans terminal history and preserves all returned timestamps',()=>{
  assert.match(sql,/IF replay_count > 1 THEN/);
  const block=sql.slice(sql.indexOf('SELECT count(*) INTO replay_count'),sql.indexOf('SELECT coalesce(max'));
  for(const key of ['pricing_geography_evidence_id','pricing_geography_evidence_version','pricing_policy_version'])assert(block.includes(key));
  assert.doesNotMatch(block,/AND x.status/);
  assert.match(block,/Pricing quote replay payload mismatch/);
  assert.match(block,/private.assert_pricing_quote\(previous.id\)/);
  assert.match(block,/RETURN QUERY SELECT previous.id,previous.version,previous.created_at,previous.expires_at/);
});
test('only quote history can be mutated; no generic or operational writer',()=>{
  assert.deepEqual([...sql.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM) ((?:private|public)\.\w+)/g)].map(x=>x[1]),['private.pricing_quotes','private.pricing_quotes']);
  assert.doesNotMatch(sql,/\bEXECUTE\b(?! ON)|wallet_|financial_|movement_offers|alignments|journeys|payment|settlement|refund|withdrawal|http|fetch/i);
});
test('behavioral SQL ends in rollback and forces constraints',()=>{
  const live=read(path.join(__dirname,'../supabase/tests/0069_trusted_pricing_quote_producer_test.sql'));
  assert.match(live,/^BEGIN;/);assert.match(live,/ROLLBACK;\s*$/);assert.match(live,/SET CONSTRAINTS ALL IMMEDIATE;/);
  assert.doesNotMatch(live.replace(/--[^\n]*/g,''),/\bCOMMIT\s*;|DISABLE TRIGGER|session_replication_role/);
});

test('historical migrations 0001 through 0068 remain unchanged',()=>{
 const names=fs.readdirSync(dir).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&Number(n.slice(0,4))<=68).sort();
 assert.equal(names.length,68);
 assert.equal(crypto.createHash('sha256').update(names.map(n=>n+'\n'+read(path.join(dir,n))).join('\n')).digest('hex'),'b7e1aba5103cbe01be721f68cfb23f5ea468ccf2fcfa074cf3a889c809ab9a77');
});
