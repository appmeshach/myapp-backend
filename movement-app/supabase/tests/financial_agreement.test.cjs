const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync('supabase/migrations/0020_financial_agreement_foundation.sql', 'utf8');
const live = fs.readFileSync('supabase/tests/0020_financial_agreement_foundation_test.sql', 'utf8');
function body(name) {
  const start=sql.indexOf('CREATE FUNCTION private.'+name+'(');
  assert(start>=0);
  return sql.slice(start,sql.indexOf('$$;',start));
}
test('0020 is additive and transactional with exactly two private tables',()=>{
  assert.match(sql,/^BEGIN;/); assert.match(sql,/COMMIT;\s*$/);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE ([\w.]+)/g)].map(m=>m[1]),
    ['private.financial_agreements','private.financial_components']);
  assert.doesNotMatch(sql,/CREATE OR REPLACE|CREATE FUNCTION public\.|ALTER TABLE public\.|INSERT INTO public\.|UPDATE public\.|DELETE FROM public\.|DISABLE/);
  assert.doesNotMatch(sql,/INSERT INTO private\.|UPDATE private\.|DELETE FROM private\./);
});
test('explicit fixed model and allocation policy with constrained pricing identifier',()=>{
  assert.match(sql,/financial_model_version = 'shared_platform_fee_v1'/);
  assert.match(sql,/platform_fee_allocation_policy_version = 'equal_split_requester_remainder_v1'/);
  assert.match(sql,/length\(pricing_policy_version\) BETWEEN 1 AND 100/);
  assert.match(sql,/version >= 1/);
});
test('current uniqueness and immutable history support replacing a version without deleting it',()=>{
  assert.match(sql,/UNIQUE \(alignment_id,version\)/);
  assert.match(sql,/CREATE UNIQUE INDEX financial_agreements_one_current[\s\S]*WHERE status='current'/);
  const b=body('protect_financial_agreement');
  assert.match(b,/TG_OP='DELETE'/);
  assert.match(b,/OLD.status='superseded' AND NEW IS DISTINCT FROM OLD/);
  assert.match(b,/NEW.status<>'current'/);
});
test('money stays bigint, zero allowed, currency inherited, total is not a component',()=>{
  assert.match(sql,/quoted_platform_fee_total_minor bigint NOT NULL CHECK \(quoted_platform_fee_total_minor >= 0\)/);
  assert.match(sql,/amount_minor bigint NOT NULL CHECK \(amount_minor >= 0\)/);
  assert.match(sql,/length\(currency\)=3 AND currency ~ '\^\[A-Z\]\{3\}\$'/);
  const table=sql.slice(sql.indexOf('CREATE TABLE private.financial_components'),sql.indexOf('ALTER TABLE'));
  assert.doesNotMatch(table,/currency|platform_fee_total/);
  assert.doesNotMatch(sql,/\b(double precision|real|numeric|decimal|float)\b/i);
});
test('component keys and beneficiary kinds prohibit fourth obligation and platform member beneficiaries',()=>{
  assert.match(sql,/UNIQUE \(agreement_id,component_key\)/);
  assert.match(sql,/component_key IN \(\s*'offering_platform_share','requester_platform_share','movement_contribution'\)/);
  assert.match(sql,/beneficiary_kind='platform' AND beneficiary_member_id IS NULL/);
  assert.match(sql,/beneficiary_kind='member' AND beneficiary_member_id IS NOT NULL/);
});
test('deferred validation on both insertion paths rejects missing components even after supersession',()=>{
  assert.equal((sql.match(/DEFERRABLE INITIALLY DEFERRED/g)||[]).length,2);
  assert.match(sql,/AFTER INSERT OR UPDATE ON private.financial_agreements/);
  assert.match(sql,/AFTER INSERT ON private.financial_components/);
  assert.match(body('validate_financial_agreement'),/IF component_count<>3 THEN/);
  assert.doesNotMatch(body('validate_financial_agreement'),/a.status|status='current'/);
});
test('principals and beneficiaries derive from authoritative immutable alignment bindings',()=>{
  const b=body('validate_financial_agreement');
  assert.match(b,/x.offering_member_id,x.member_needing_movement_id/);
  assert.match(b,/FROM public.alignments x WHERE x.id=a.alignment_id FOR SHARE/);
  assert.match(b,/a.offering_member_id IS DISTINCT FROM alignment_offering/);
  assert.match(b,/a.member_needing_movement_id IS DISTINCT FROM alignment_requester/);
  assert.match(b,/THEN a.offering_member_id ELSE a.member_needing_movement_id END/);
  assert.match(b,/c.beneficiary_member_id IS DISTINCT FROM a.offering_member_id/);
});
test('launch allocation uses nonnegative integer quotient and explicit requester remainder',()=>{
  assert.match(sql,/offering_share IS DISTINCT FROM a.quoted_platform_fee_total_minor \/ 2/);
  assert.match(sql,/requester_share IS DISTINCT FROM a.quoted_platform_fee_total_minor - a.quoted_platform_fee_total_minor \/ 2/);
  assert.doesNotMatch(sql,/sum\(c.amount_minor\)/); // no overflowing bigint addition on bad inputs
});
test('all published fields immutable except controlled status and write-once acceptance',()=>{
  const b=body('protect_financial_agreement');
  assert.match(b,/to_jsonb\(NEW\)-ARRAY\['status','offering_accepted_at','requester_accepted_at'\]/);
  for(const col of ['offering_accepted_at','requester_accepted_at'])
    assert(b.includes(`OLD.${col} IS NOT NULL AND NEW.${col} IS DISTINCT FROM OLD.${col}`));
  assert.match(b,/Accept the current version before superseding it/);
});
test('component mutations and delete blocked; construction serialized against parent updates',()=>{
  const b=body('protect_financial_component');
  assert.match(b,/IF TG_OP<>'INSERT' THEN/);
  assert.match(b,/WHERE a.id=NEW.agreement_id FOR UPDATE/);
  assert.match(b,/agreement_status IS DISTINCT FROM 'current'/);
});
test('RLS, service read-only, no client policies and no helper execution leaks',()=>{
  for(const table of ['financial_agreements','financial_components'])
    assert(sql.includes('ALTER TABLE private.'+table+' ENABLE ROW LEVEL SECURITY;'));
  assert.match(sql,/REVOKE ALL ON private.financial_agreements,private.financial_components\s+FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql,/GRANT SELECT ON private.financial_agreements,private.financial_components TO service_role/);
  assert.doesNotMatch(sql,/CREATE POLICY|GRANT (?:ALL|INSERT|UPDATE|DELETE|EXECUTE)/);
  for(const name of ['protect_financial_agreement','protect_financial_component','validate_financial_agreement']) {
    assert.match(body(name),/SECURITY DEFINER SET search_path = ''/);
    assert(sql.includes('REVOKE ALL ON FUNCTION private.'+name+'() FROM PUBLIC,anon,authenticated,service_role;'));
  }
  assert.doesNotMatch(sql,/EXECUTE\s+(?:format|')/);
});
test('no payment collection, legacy price reading, wallet or financial disposition machinery',()=>{
  const definitions=[...sql.matchAll(/CREATE (?:TABLE|FUNCTION|(?:CONSTRAINT )?TRIGGER) ([\w.]+)/g)].map(m=>m[1]);
  assert(definitions.every(name=>/financial/.test(name)));
  assert.doesNotMatch(sql,/activation_fee_minor|activation_currency|movement_settlements|alignment_activation_payments/);
});
test('rollback forces commit-time validation without committing and restores failed mutations',()=>{
  assert.match(live,/^BEGIN;/); assert.match(live,/ROLLBACK;\s*$/);
  assert.doesNotMatch(live,/^COMMIT;/m);
  assert.match(live,/SET CONSTRAINTS ALL IMMEDIATE/);
  assert.match(live,/RAISE EXCEPTION USING ERRCODE='ZX020'/);
  assert.match(live,/observed=p_state/);
  assert.doesNotMatch(live,/CREATE OR REPLACE|DISABLE TRIGGER|DISABLE ROW LEVEL SECURITY/);
});
test('rollback exercises missing/extra keys, role substitution, rounding, version history and boundaries',()=>{
  for(const label of ['incomplete component set rejected','superseding cannot hide incomplete','wrong offering principal',
    'wrong requester principal','wrong offering responsibility','wrong requester responsibility','wrong contribution responsibility',
    'contribution cannot benefit requester','contribution cannot benefit unrelated','reversed odd remainder',
    '201 splits into 100 and 101','even total splits equally','integer boundary valid','fourth collectible total rejected',
    'two current versions rejected','superseded cannot reopen','superseded acceptance immutable','legacy payment history untouched',
    'legacy settlements untouched','alignment and legacy price untouched']) assert(live.includes(label),label);
});

test('history foreign keys have no cascading deletion and delete guards cover both tables',()=>{
  assert.match(sql,/alignment_id uuid NOT NULL REFERENCES public\.alignments\(id\)/);
  assert.match(sql,/agreement_id uuid NOT NULL REFERENCES private\.financial_agreements\(id\)/);
  assert.doesNotMatch(sql,/ON DELETE CASCADE|ON DELETE SET NULL|TRUNCATE/);
  for(const label of ['unaccepted agreement cannot be deleted','agreement cannot be deleted',
    'superseded agreement cannot be deleted','all components cannot be deleted',
    'alignment deletion cannot cascade financial history']) assert(live.includes(label),label);
});

test('rollback constructs components in separate inserts and tests missing sets and all split boundaries',()=>{
  const builder=live.slice(live.indexOf('CREATE FUNCTION pg_temp.financial_publish'),live.indexOf('REVOKE ALL ON FUNCTION pg_temp.financial_publish'));
  assert.equal((builder.match(/INSERT INTO private.financial_components/g)||[]).length,3);
  for(const label of ['one component rejected','two components rejected','both shares rounded up rejected',
    'oversized malformed shares rejected without overflow']) assert(live.includes(label),label);
  assert.match(live,/ARRAY\[0::bigint,1::bigint,2::bigint,3::bigint,9223372036854775807::bigint\]/);
});

test('rollback covers beneficiary shape, identity immutability, acceptance and explicit ACLs',()=>{
  for(const label of ['offering share cannot benefit member kind','requester share cannot benefit member kind',
    'contribution cannot benefit platform','contribution requires member beneficiary','component identity',
    'component created timestamp','agreement identity','offering acceptance does not accept for requester',
    'new version may use new pricing identifier','unaccepted superseded version cannot gain acceptance',
    'invalid agreement status rejected','PUBLIC has no table privileges','RLS enabled without policies',
    'helper private definer configuration']) assert(live.includes(label),label);
});

test('deferred validator only reads final state, cannot recursively enqueue mutations',()=>{
  const b=body('validate_financial_agreement');
  assert.doesNotMatch(b,/\b(?:INSERT INTO|DELETE FROM|UPDATE private\.|UPDATE public\.)/);
  assert.match(b,/SELECT \* INTO STRICT a/);
  assert.match(b,/RETURN NULL/);
  assert.doesNotMatch(sql,/CREATE (?:CONSTRAINT )?TRIGGER[\s\S]*?ON public\./);
});

test('pre-0020 migrations and operational callers do not consume the agreement tables',()=>{
  function walk(dir) {
    return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
  }
  for(const file of [...walk('supabase/migrations'),...walk('src'),...walk('supabase/functions')]) {
    // 0021's private, non-operational proposal validators reference the 0020
    // tables for linkage integrity. Its separate suite enforces no live hooks.
    if(file.includes('/0020_') || file==='supabase/migrations/0021_financial_proposal_foundation.sql'
      || !/\.(sql|ts|tsx)$/.test(file)) continue;
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/\bfinancial_agreements\b|\bfinancial_components\b/,file);
  }
});
