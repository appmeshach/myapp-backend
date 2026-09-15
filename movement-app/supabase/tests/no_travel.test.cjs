const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync('supabase/migrations/0019_mutual_no_travel_closure.sql', 'utf8');
const old = fs.readFileSync('supabase/migrations/0012_mutual_movement_completion.sql', 'utf8');
const live = fs.readFileSync('supabase/tests/0019_mutual_no_travel_closure_test.sql', 'utf8');
function body(source, name) {
  const start = source.indexOf('FUNCTION ' + name + '(');
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('$$;', start));
}
const normalize = s => s.replace(/\s+/g, ' ').trim();
test('migration transactional and changes only four existing RPCs', () => {
  assert.match(sql, /^BEGIN;/); assert.match(sql, /COMMIT;\s*$/);
  assert.deepEqual([...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map(m => m[1]),
    ['request_movement_end','confirm_movement_end','decline_movement_end','get_my_movement_end_status']);
  assert.doesNotMatch(sql, /DISABLE|DROP FUNCTION|UPDATE private\.alignment_activation_payments/);
});
for (const name of ['request_movement_end','confirm_movement_end']) {
  test(name + ' preserves signature and uses locks before no-travel decisions', () => {
    const b = body(sql,'public.'+name), original = body(old,'public.'+name);
    assert.equal(normalize(b.split('AS $$')[0]), normalize(original.split('AS $$')[0]));
    const journeyLock=b.indexOf('FROM public.journeys j'), alignmentLock=b.indexOf('FROM public.alignments a');
    assert(journeyLock < alignmentLock);
    assert(b.indexOf('FOR UPDATE;',journeyLock)<alignmentLock);
    assert(b.indexOf('FOR UPDATE;',alignmentLock)<b.indexOf("v_journey_record.status='cancelled'"));
    assert.match(b,/v_alignment_record.status='activated' AND v_journey_record.status='not_started' THEN\s+PERFORM private.close_mutual_no_travel\(p_journey_id\);\s+RETURN QUERY[\s\S]*?RETURN;\s+END IF;/);
  });
  test(name + ' keeps ordinary completion and settlement block byte-equivalent ignoring whitespace', () => {
    const b=body(sql,'public.'+name), original=body(old,'public.'+name);
    const marker=name==='request_movement_end'?'-- Complete the movement':'-- Confirm the end request';
    assert.equal(normalize(b.slice(b.indexOf(marker))),normalize(original.slice(original.indexOf(marker))));
  });
}
test('private helper checks exact state, timestamps, identities and existing settlement before mutations',()=>{
  const b=body(sql,'private.close_mutual_no_travel');
  for(const text of ['caller IS NULL','j.end_requested_by_member_id=caller','j.end_requested_at IS NULL',"a.status<>'activated'", "j.status<>'not_started'",'j.started_at IS NOT NULL','j.completed_at IS NOT NULL','a.activated_at IS NULL']) assert(b.includes(text));
  assert(b.indexOf('FROM private.movement_settlements')<b.indexOf('UPDATE public.journeys'));
  assert.doesNotMatch(b,/INSERT INTO private\.movement_settlements|DELETE|SET started_at|SET completed_at/);
  assert.match(b,/start_requested_at=NULL/);
  assert.match(b,/VALUES\(j.id,j.end_requested_by_member_id,caller,j.end_requested_at,closed_time,j.start_requested_at\)/);
});
test('audit is minimal, private and service-read-only',()=>{
  const table=sql.slice(sql.indexOf('CREATE TABLE'),sql.indexOf('CREATE FUNCTION'));
  assert.match(table,/journey_id uuid PRIMARY KEY REFERENCES public.journeys\(id\)/);
  assert.match(table,/ENABLE ROW LEVEL SECURITY/);
  assert.match(table,/REVOKE ALL .* FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(table,/GRANT SELECT .* TO service_role/);
  assert.doesNotMatch(table,/alignment_id|amount|currency|provider|refund|payout/);
});
test('all new helpers are inaccessible and all functions pin search_path',()=>{
  for(const name of ['close_mutual_no_travel(uuid)','protect_no_travel_journey()','protect_no_travel_alignment()'])
    assert(sql.includes('REVOKE ALL ON FUNCTION private.'+name+' FROM PUBLIC,anon,authenticated,service_role;'));
  assert.equal((sql.match(/SECURITY DEFINER/g)||[]).length,7);
  assert.equal((sql.match(/SET search_path = ''/g)||[]).length,7);
  for(const sig of ['request_movement_end(uuid, text)','confirm_movement_end(uuid)','decline_movement_end(uuid)','get_my_movement_end_status(uuid)']) {
    assert(sql.includes('REVOKE ALL ON FUNCTION public.'+sig+' FROM PUBLIC;'));
    assert(sql.includes('REVOKE ALL ON FUNCTION public.'+sig+' FROM anon;'));
    assert(sql.includes('GRANT EXECUTE ON FUNCTION public.'+sig+' TO authenticated;'));
  }
});
test('decline protects terminal consent and status reports no pending action',()=>{
  const decline=body(sql,'public.decline_movement_end');
  assert(decline.indexOf("IN ('completed','cancelled','failed')")<decline.indexOf('UPDATE public.journeys'));
  assert.match(body(sql,'public.get_my_movement_end_status'),/v_end_status := 'mutual_no_travel';\s+v_requested_by_me := false;\s+v_action_required_from_me := false;/);
});
test('terminal guards cover journey evidence and alignment lifecycle',()=>{
  assert.match(sql,/CREATE TRIGGER protect_no_travel_journey BEFORE UPDATE ON public.journeys/);
  assert.match(sql,/CREATE TRIGGER protect_no_travel_alignment BEFORE UPDATE OF status ON public.alignments/);
  assert.match(body(sql,'private.protect_no_travel_journey'),/to_jsonb\(NEW\)-'updated_at'/);
  assert.match(body(sql,'private.protect_no_travel_alignment'),/NEW.status IS DISTINCT FROM OLD.status/);
});
test('rollback harness uses role/JWT, real payment and face RPCs, no production replacement',()=>{
  assert.match(live,/^BEGIN;/);assert.match(live,/ROLLBACK;\s*$/);
  assert.doesNotMatch(live,/CREATE OR REPLACE|DISABLE TRIGGER|DISABLE ROW LEVEL SECURITY/);
  for(const text of ["set_config('role'",'start_movement_face_verification_for_server','complete_face_verification_callback_for_server','mark_alignment_activation_payment_succeeded','FOR scenario IN 1..4 LOOP','functions or permissions'])assert(live.includes(text));
});
test('rollback scenarios cover no-travel, start-first, privacy, refusal, audit and retries',()=>{
  for(const text of ['first End leaves lifecycle active','same principal retry stays pending','cannot confirm own consent','nonprincipal request denied','nonprincipal confirm denied','start wins before second consent','legacy RPC returns no travel','no normal settlement','exactly one audit row','consents and invalidated start preserved','legacy start cannot reopen','movement start cannot reopen','terminal decline rejected','person reveal stays closed','plate reveal stays closed','ordinary completion preserved','ordinary settlement preserved','audit remains unchanged after retries','payment history unchanged','activation timestamp unchanged','raw audit denied']) assert(live.includes(text),text);
});
test('start confirmation still takes journey then alignment locks and rejects cancellation',()=>{
  const start=body(fs.readFileSync('supabase/migrations/0008_journey_lifecycle.sql','utf8'),'public.confirm_journey_start');
  assert(start.indexOf('FROM public.journeys j')<start.indexOf('FROM public.alignments a'));
  assert.match(start,/v_journey_record.status <> 'not_started'/);
  assert.match(start,/v_alignment_record.status <> 'activated'/);
});
test('no-travel requires matching successful payment before any mutation',()=>{
  const b=body(sql,'private.close_mutual_no_travel');
  for(const text of ["p.status='succeeded'",'p.succeeded_at IS NOT NULL','p.alignment_id=a.id',
    'p.payer_member_id=a.offering_member_id','p.amount_minor=a.activation_fee_minor','p.currency=a.activation_currency']) assert(b.includes(text),text);
  assert(b.indexOf('Successful activation payment required')<b.indexOf('UPDATE public.journeys'));
  assert.doesNotMatch(b.slice(b.indexOf('FROM private.alignment_activation_payments')),/FOR UPDATE/);
});
test('rollback includes preactivation, invalid evidence and expanded authorization negatives',()=>{
  for(const text of ['preactivation request denied','preactivation confirmation denied','preactivation produces no closure or settlement',
    'no-travel requires succeeded payment evidence','nonprincipal decline denied','cancelled cannot create payment',
    'payment replay cannot reactivate','completed decline rejected','exact legacy signatures with no alternate overloads',
    'no PUBLIC execute','old one-sided completion remains revoked','service cannot mutate audit']) assert(live.includes(text),text);
  assert.match(live,/ARRAY\[traveller,outsider,declined,removed,invited\]/);
  assert.match(live,/EXCEPTION WHEN SQLSTATE 'ZX019' THEN NULL;/);
  assert.match(live,/payment_gate_ok:=r->>'ok'='false' AND r->>'state'='P0001'/);
});
