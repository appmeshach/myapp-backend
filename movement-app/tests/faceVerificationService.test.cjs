const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const need = '44444444-4444-4444-8444-444444444444';
const time = '2099-01-01T00:00:00Z';

const source = fs.readFileSync('src/services/faceVerificationService.ts', 'utf8');
function service(result) {
  const calls = [];
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require: () => ({ supabase: { rpc: async (...args) => { calls.push(args); return result; } } }),
  });
  return { api: exports, calls };
}

test('submission helper projects only safe fields even if an upstream row contains extras', async () => {
  const { api, calls } = service({ data: [{ status: 'ready', submitted_at: time, processed_at: null,
    current_photo_verified: false, member_id: 'private', storage_path: 'private', provider_reference: 'private' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(await api.getMyProfilePhotoSubmissionStatus())), {
    status: 'ready', submittedAt: time, processedAt: null, currentPhotoVerified: false,
  });
  assert.equal(calls[0][0], 'get_my_profile_photo_submission_status');
  assert.equal(calls[0].length, 1);
});

test('face status uses only need ID and returns no private identifiers', async () => {
  const { api, calls } = service({ data: [{ status: 'succeeded', completed_at: time, expires_at: time,
    ready_for_activation: true, media_id: 'private', provider_reference: 'private', member_id: 'private' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(await api.getMyAlignmentFaceVerificationStatus(need))), {
    status: 'succeeded', completedAt: time, expiresAt: time, readyForActivation: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['get_my_alignment_face_verification_status', { p_movement_need_id: need }]]);
});

for (const name of ['getMyProfilePhotoSubmissionStatus', 'getMyAlignmentFaceVerificationStatus']) {
  test(`${name}: no authorized row returns null`, async () => {
    const { api } = service({ data: [] });
    assert.equal(await api[name](...(name === 'getMyAlignmentFaceVerificationStatus' ? [need] : [])), null);
  });
  test(`${name}: errors do not echo internal upstream details`, async () => {
    const { api } = service({ error: { message: 'secret path/provider/UUID', details: 'sensitive' } });
    await assert.rejects(api[name](...(name === 'getMyAlignmentFaceVerificationStatus' ? [need] : [])), error => /unavailable/.test(error.message) && !/secret|sensitive/.test(error.message));
  });
}

test('status helpers never invoke a trusted mutation or access Storage', () => {
  assert.doesNotMatch(source, /service_role|\.storage\b|_for_server['"]|\.from\(/);
});

// Local lint only: runtime RLS/transaction behavior is tested by the rollback SQL.
const migration = fs.readFileSync('supabase/migrations/0016_secure_profile_photo_submissions.sql', 'utf8');
const sql = migration.replace(/--[^\n]*/g, '');
test('status and readiness select the same latest attempt ordering without filtering historical status', () => {
  const ready = sql.match(/SELECT latest\.id[\s\S]*?LIMIT 1/)[0];
  const status = sql.match(/SELECT s\.\* FROM private\.alignment_face_verifications s[\s\S]*?LIMIT 1/)[0];
  assert.match(ready, /latest\.alignment_id=f\.alignment_id AND latest\.member_id=f\.member_id/);
  assert.match(status, /s\.alignment_id=a\.id AND s\.member_id=auth\.uid\(\)/);
  for (const [query, alias] of [[ready, 'latest'], [status, 's']]) {
    assert(query.includes(`ORDER BY ${alias}.started_at DESC,${alias}.id DESC LIMIT 1`));
    assert(!query.includes(`${alias}.status`));
  }
});
test('expiry fixture shifts the whole scoped timeline and asserts ordering preservation', () => {
  const testSql = fs.readFileSync('supabase/tests/0016_secure_profile_photo_submissions_test.sql', 'utf8');
  assert.match(testSql, /started_at=started_at-expiry_shift, completed_at=completed_at-expiry_shift,\s*expires_at=expires_at-expiry_shift WHERE alignment_id=alignment2 AND member_id=driver/);
  assert.match(testSql, /attempt_order=\(SELECT array_agg\(id ORDER BY started_at DESC,id DESC\)/);
  assert.doesNotMatch(testSql, /started_at=clock_timestamp\(\)-interval '20 minutes',completed_at=clock_timestamp/);
});
test('0016 is transactional and replaces only payment creation', () => {
  assert.match(sql.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
  assert.doesNotMatch(sql, /DISABLE (?:TRIGGER|ROW LEVEL SECURITY)/i);
  assert.deepEqual([...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)/g)].map(m => m[1]),
    ['public.create_alignment_activation_payment']);
  for (const path of fs.readdirSync('supabase/migrations').filter(p => /^00(?:0[1-9]|1[0-5])_/.test(p))) {
    const previous = fs.readFileSync(`supabase/migrations/${path}`, 'utf8');
    for (const match of sql.matchAll(/CREATE FUNCTION\s+([\w.]+)\s*\(/g)) {
      assert(!new RegExp(`CREATE (?:OR REPLACE )?FUNCTION\\s+${match[1].replaceAll('.', '\\.')}\\s*\\(`, 'i').test(previous), match[1]);
    }
  }
});
test('payment creation preserves original validation, idempotency and ACLs around the new mandatory gate', () => {
  const original = fs.readFileSync('supabase/migrations/0007_activation_payment_foundation.sql', 'utf8');
  const extract = text => text.match(/CREATE OR REPLACE FUNCTION public\.create_alignment_activation_payment\([\s\S]*?GRANT EXECUTE ON FUNCTION public\.create_alignment_activation_payment\([^;]*TO service_role;/)[0];
  const normalize = text => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const revised = extract(migration);
  const gate = 'PERFORM private.assert_alignment_face_ready(p_alignment_id);';
  assert.equal(revised.split(gate).length, 2);
  assert.equal(normalize(revised.replace(gate, '')), normalize(extract(original)));
  assert(revised.indexOf(gate) < revised.indexOf('IF FOUND THEN'));
  assert(revised.indexOf(gate) < revised.indexOf('INSERT INTO private.alignment_activation_payments'));
});
test('creation and activation share the authoritative gate; duplicate-photo preflight never repairs rows', () => {
  assert.match(sql, /CREATE TRIGGER require_face_ready_payment_insert BEFORE INSERT ON private\.alignment_activation_payments/);
  const activation = sql.match(/CREATE FUNCTION private\.require_alignment_face_verification\([\s\S]*?\$\$;/)[0];
  assert.match(activation, /PERFORM private\.assert_alignment_face_ready\(NEW.id\)/);
  const gate = sql.match(/CREATE FUNCTION private\.assert_alignment_face_ready\([\s\S]*?\$\$;/)[0];
  assert(gate.indexOf('clock_timestamp()') > gate.lastIndexOf('FOR UPDATE'));
  assert.match(gate, /private\.has_current_alignment_face_check/);
  const preflight = sql.match(/DO \$\$[\s\S]*?\$\$;/)[0];
  assert.match(preflight, /GROUP BY member_id HAVING count\(\*\)>1/);
  assert.match(preflight, /RAISE EXCEPTION/);
  assert.doesNotMatch(preflight, /UPDATE|DELETE|INSERT/i);
});
test('every new function has definer isolation and explicit client revocation', () => {
  for (const match of sql.matchAll(/CREATE FUNCTION\s+([\w.]+)([\s\S]*?)\$\$;/g)) {
    assert.match(match[2], /SECURITY DEFINER SET search_path = ''/);
    assert(sql.includes(`REVOKE ALL ON FUNCTION ${match[1]}(`), match[1]);
    if (match[1].endsWith('_for_server')) {
      const escaped = match[1].replaceAll('.', '\\.');
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${escaped}\\([^;]*FROM PUBLIC,anon,authenticated;`));
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${escaped}\\([^;]*TO service_role;`));
    }
  }
});
test('session start, completion and payment readiness all require prepared-media provenance', () => {
  for (const name of ['public.start_alignment_face_verification_for_server',
    'public.complete_alignment_face_verification_for_server', 'private.has_current_alignment_face_check']) {
    const body = sql.match(new RegExp(`CREATE FUNCTION ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\$\\$;`))[0];
    assert.match(body, /JOIN private\.profile_photo_submissions ps ON ps\.media_id=mm\.id AND ps\.member_id=mm\.member_id/);
    assert.match(body, /ps\.status='ready' AND ps\.processed_at IS NOT NULL/);
    assert.match(body, /mm\.is_current/);
  }
  const completion = sql.match(/CREATE FUNCTION public\.complete_alignment_face_verification_for_server\([\s\S]*?\$\$;/)[0];
  assert(completion.indexOf("ps.status='ready'") < completion.indexOf("v_session.status='succeeded'"));
  assert.match(completion, /p_matched_media_id IS DISTINCT FROM v_session\.media_id/);
  assert.doesNotMatch(completion, /UPDATE private\.profile_photo_submissions/);
});
test('rollback test never changes production functions or disables security', () => {
  const rollback = fs.readFileSync('supabase/tests/0016_secure_profile_photo_submissions_test.sql', 'utf8').replace(/--[^\n]*/g, '');
  assert.match(rollback.trim(), /^BEGIN;[\s\S]*ROLLBACK;$/);
  assert.doesNotMatch(rollback, /COMMIT;|\bDISABLE\s+(?:TRIGGER|ROW LEVEL SECURITY)|CREATE (?:OR REPLACE )?FUNCTION (?:public|private)\./i);
  assert.match(rollback, /SELECT test_name,passed FROM pg_temp.face_test_results/);
});
test('media replacement revocation and new attempts preserve successful verification evidence', () => {
  for (const name of ['prepare_profile_photo_submission_for_server', 'revoke_current_profile_photo_for_server',
    'start_alignment_face_verification_for_server']) {
    const body = sql.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];
    const mutation = body.match(/UPDATE private\.alignment_face_verifications[\s\S]*?;/)[0];
    assert.match(mutation, /SET status='superseded'/);
    assert.match(mutation, /AND status='pending';$/);
    assert.doesNotMatch(mutation, /succeeded|completed_at|media_id|provider_reference|liveness_passed|face_match_passed/);
  }
  const ready = sql.match(/CREATE FUNCTION private\.has_current_alignment_face_check\([\s\S]*?\$\$;/)[0];
  assert.match(ready, /f\.id=\(SELECT latest\.id/);
  assert.match(ready, /ORDER BY latest\.started_at DESC,latest\.id DESC LIMIT 1/);
  assert.match(ready, /mm\.is_current AND mm\.verified/);
});
