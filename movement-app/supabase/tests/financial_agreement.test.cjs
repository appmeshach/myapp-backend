'use strict';

const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/0020_financial_agreement_foundation.sql','utf8');
const norm=s=>s.replace(/\r\n/g,'\n');
const body=name=>{const re=new RegExp(`CREATE FUNCTION private\\.${name}\\([^)]*\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`);const m=sql.match(re);assert.ok(m,`${name} body`);return m[1];};

test('0020 is additive and transactional with exactly two private tables',()=>{
  assert.equal((sql.match(/\bBEGIN;/g)||[]).length,1);assert.equal((sql.match(/\bCOMMIT;/g)||[]).length,1);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE private\.(\w+)/g)].map(m=>m[1]),['financial_agreements','financial_components']);
  assert.doesNotMatch(sql,/\b(?:ALTER|DROP|TRUNCATE) TABLE public\./);
});

test('explicit fixed model and allocation policy with constrained pricing identifier',()=>{
  assert.match(sql,/financial_model_version text NOT NULL[\s\S]*financial_model_version = 'shared_platform_fee_v1'/);
  assert.match(sql,/platform_fee_allocation_policy_version text NOT NULL[\s\S]*equal_split_requester_remainder_v1/);
  assert.match(sql,/pricing_policy_version text NOT NULL[\s\S]*length\(pricing_policy_version\) BETWEEN 1 AND 100[\s\S]*\^\[A-Za-z0-9\]/);
});

test('current uniqueness and immutable history support replacing a version without deleting it',()=>{
  assert.match(sql,/UNIQUE \(alignment_id,version\)/);assert.match(sql,/financial_agreements_one_current[\s\S]*WHERE status='current'/);
  assert.match(sql,/Financial agreement history cannot be deleted/);
});

test('money stays bigint, zero allowed, currency inherited, total is not a component',()=>{
  assert.match(sql,/quoted_platform_fee_total_minor bigint NOT NULL CHECK \(quoted_platform_fee_total_minor >= 0\)/);
  assert.match(sql,/amount_minor bigint NOT NULL CHECK \(amount_minor >= 0\)/);
  assert.doesNotMatch(sql,/\b(?:real|double precision|numeric|decimal)\b/i);
  assert.match(sql,/currency text NOT NULL CHECK \(length\(currency\)=3 AND currency ~ '\^\[A-Z\]\{3\}\$'\)/);
  assert.doesNotMatch(sql,/component_key IN \([\s\S]*quoted_platform_fee_total/);
});

test('component keys and beneficiary kinds prohibit fourth obligation and platform member beneficiaries',()=>{
  assert.match(sql,/component_key text NOT NULL CHECK \(component_key IN \([\s\S]*'offering_platform_share'[\s\S]*'requester_platform_share'[\s\S]*'movement_contribution'[\s\S]*\)\)/);
  assert.match(sql,/beneficiary_kind text NOT NULL CHECK \(beneficiary_kind IN \('platform','member'\)\)/);
  assert.match(sql,/component_key IN \('offering_platform_share','requester_platform_share'\)[\s\S]*beneficiary_kind='platform' AND beneficiary_member_id IS NULL/);
  assert.match(sql,/component_key='movement_contribution'[\s\S]*beneficiary_kind='member' AND beneficiary_member_id IS NOT NULL/);
});

test('deferred validation on both insertion paths rejects missing components even after supersession',()=>{
  assert.equal((sql.match(/CREATE CONSTRAINT TRIGGER financial_/g)||[]).length,2);
  assert.equal((sql.match(/DEFERRABLE INITIALLY DEFERRED/g)||[]).length,2);
  assert.match(body('validate_financial_agreement'),/IF component_count<>3 THEN/);
  assert.doesNotMatch(body('validate_financial_agreement'),/IF a\.status='current'/);
});

test('principals and beneficiaries derive from authoritative immutable alignment bindings',()=>{
  const b=body('validate_financial_agreement');
  assert.match(b,/FROM public\.alignments x WHERE x\.id=a\.alignment_id FOR SHARE/);
  assert.match(b,/a\.offering_member_id IS DISTINCT FROM alignment_offering/);
  assert.match(b,/a\.member_needing_movement_id IS DISTINCT FROM alignment_requester/);
  assert.match(b,/responsible_member_id IS DISTINCT FROM CASE WHEN c\.component_key='offering_platform_share'/);
  assert.match(b,/component_key='movement_contribution' AND c\.beneficiary_member_id IS DISTINCT FROM a\.offering_member_id/);
});

test('launch allocation uses nonnegative integer quotient and explicit requester remainder',()=>{
  const b=body('validate_financial_agreement');
  assert.match(b,/offering_share IS DISTINCT FROM a\.quoted_platform_fee_total_minor \/ 2/);
  assert.match(b,/requester_share IS DISTINCT FROM a\.quoted_platform_fee_total_minor - a\.quoted_platform_fee_total_minor \/ 2/);
});

test('all published fields immutable except controlled status and write-once acceptance',()=>{
  const b=body('protect_financial_agreement');
  assert.match(b,/to_jsonb\(NEW\)-ARRAY\['status','offering_accepted_at','requester_accepted_at'\]/);
  assert.match(b,/Published financial agreement terms are immutable/);
  assert.match(b,/Financial acceptance is write-once/);
  assert.match(b,/Superseded financial agreement is immutable/);
  assert.match(b,/Accept the current version before superseding it/);
});

test('component mutations and delete blocked; construction serialized against parent updates',()=>{
  const b=body('protect_financial_component');
  assert.match(b,/IF TG_OP<>'INSERT'/);assert.match(b,/Published financial components are immutable/);
  assert.match(b,/WHERE id=NEW\.agreement_id FOR UPDATE/);
});

test('RLS, service read-only, no client policies and no helper execution leaks',()=>{
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,2);
  assert.match(sql,/REVOKE ALL ON private\.financial_agreements,private\.financial_components\s+FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql,/GRANT SELECT ON private\.financial_agreements,private\.financial_components TO service_role/);
  assert.doesNotMatch(sql,/CREATE POLICY/);
  assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION private\./);
});

test('no payment collection, legacy price reading, wallet or financial disposition machinery',()=>{
  assert.doesNotMatch(sql,/alignment_activation_payments|activation_fee_minor|provider_reference|wallet|settlement|payout|refund/i);
  assert.doesNotMatch(sql,/INSERT INTO public\.|UPDATE public\.|DELETE FROM public\./);
});

test('rollback forces commit-time validation without committing and restores failed mutations',()=>{
  const t=fs.readFileSync('supabase/tests/financial_agreement_behavioral.sql','utf8');
  assert.match(t,/BEGIN;/);assert.match(t,/SET CONSTRAINTS ALL IMMEDIATE/);assert.match(t,/ROLLBACK;/);assert.doesNotMatch(t,/\bCOMMIT;/);
});

test('rollback exercises missing/extra keys, role substitution, rounding, version history and boundaries',()=>{
  const t=fs.readFileSync('supabase/tests/financial_agreement_behavioral.sql','utf8');
  for(const s of ['missing component','extra component','wrong responsible','wrong beneficiary','odd split','zero split','superseded','immutable']) assert.match(t,new RegExp(s,'i'));
});

test('history foreign keys have no cascading deletion and delete guards cover both tables',()=>{
  assert.doesNotMatch(sql,/REFERENCES (?:public|private)\.[^(]+\([^)]*\) ON DELETE CASCADE/);
  assert.match(body('protect_financial_agreement'),/TG_OP='DELETE'/);
  assert.match(body('protect_financial_component'),/IF TG_OP<>'INSERT'/);
});

test('rollback constructs components in separate inserts and tests missing sets and all split boundaries',()=>{
  const t=fs.readFileSync('supabase/tests/financial_agreement_behavioral.sql','utf8');
  assert.match(t,/INSERT INTO private\.financial_components[\s\S]*INSERT INTO private\.financial_components/);
  assert.match(t,/missing[\s_-]*all|no components/i);
  for(const n of ['0','1','2','3']) assert.match(t,new RegExp(`quoted_platform_fee_total_minor[^;]{0,300}\\b${n}\\b`,'i'));
});

test('rollback covers beneficiary shape, identity immutability, acceptance and explicit ACLs',()=>{
  const t=fs.readFileSync('supabase/tests/financial_agreement_behavioral.sql','utf8');
  assert.match(t,/beneficiary/i);assert.match(t,/immutable/i);assert.match(t,/accept/i);assert.match(t,/service_role/i);
});

test('deferred validator only reads final state, cannot recursively enqueue mutations',()=>{
  const b=body('validate_financial_agreement');
  assert.doesNotMatch(b,/\b(?:INSERT INTO|DELETE FROM|UPDATE private\.|UPDATE public\.)/);
  assert.match(b,/SELECT \* INTO STRICT a/);
  assert.match(b,/RETURN NULL/);
  assert.doesNotMatch(sql,/CREATE (?:CONSTRAINT )?TRIGGER[\s\S]*?ON public\./);
});

test('pre-0020 migrations and unreviewed operational callers do not consume the agreement tables',()=>{
  function walk(dir) {
    return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
  }
  for(const file of [...walk('supabase/migrations'),...walk('src'),...walk('supabase/functions')]) {
    // 0021's private proposal validators and 0064's private wallet ledger are
    // separately reviewed, non-client consumers of the 0020 linkage contract.
    if(file.includes('/0020_') || file==='supabase/migrations/0021_financial_proposal_foundation.sql'
      || file==='supabase/migrations/0064_wallet_ledger_foundation.sql'
      || !/\.(sql|ts|tsx)$/.test(file)) continue;
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/\bfinancial_agreements\b|\bfinancial_components\b/,file);
  }
});