'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const migration = 'supabase/migrations/0028_trusted_location_search_intake_boundary.sql';
const behavioral = 'supabase/tests/0028_trusted_location_search_intake_boundary_test.sql';
const raw = cleanSql(fs.readFileSync(migration, 'utf8'));
const live = cleanSql(fs.readFileSync(behavioral, 'utf8'));
const compact = raw.replace(/\s+/g, ' ').trim();
const body = tag => {
  const parts = raw.split(`$${tag}$`);
  assert.equal(parts.length, 3, `one balanced ${tag} body`);
  return parts[1];
};
const intake = body('intake');
const required = body('require');
const resolve = body('resolve');
const context = body('context');
const rpcs = [
  ['record_verified_selected_location_for_server', 'uuid,uuid,text,text,text,text,timestamptz,timestamptz'],
  ['get_verified_selected_location_for_server', 'uuid,uuid'],
  ['get_selected_location_resolution_context_for_server', 'uuid,uuid,uuid'],
  ['record_attested_location_resolution_for_server', 'uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz'],
];

// Tokenize rather than deleting comments with regex. String and identifier
// quotes preserve their contents; dollar bodies are recursively checked and
// cleaned so comments inside PL/pgSQL cannot satisfy an assertion either.
function tokens(sql) {
  const out = []; let i = 0;
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end;
      out.push({kind:'comment', text:sql.slice(start,i)}); continue;
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*',i)) { depth++; i += 2; }
        else if (sql.startsWith('*/',i)) { depth--; i += 2; }
        else i++;
      }
      assert.equal(depth,0,'closed block comment');
      out.push({kind:'comment',text:sql.slice(start,i)}); continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i++]; let closed = false;
      while (i < sql.length) {
        if (sql[i++] === q) {
          if (sql[i] === q) { i++; continue; }
          closed = true; break;
        }
      }
      assert.ok(closed,'closed SQL quote');
      out.push({kind:q === "'" ? 'string' : 'identifier',text:sql.slice(start,i)}); continue;
    }
    if (sql[i] === '$') {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      assert.ok(tag,'standalone or invalid dollar delimiter');
      const end = sql.indexOf(tag,i+tag.length);
      assert.ok(end >= 0,`unmatched dollar tag ${tag}`);
      const inner = sql.slice(i+tag.length,end);
      // All dollar strings in these files contain SQL/PLpgSQL, including
      // test-only dynamic DO statements. Recursion also checks those bodies.
      const cleaned = cleanSql(inner);
      out.push({kind:'dollar',text:tag+cleaned+tag,body:cleaned});
      i = end+tag.length; continue;
    }
    out.push({kind:'code',text:sql[i++]});
  }
  return out;
}
function cleanSql(sql) {
  return tokens(sql).map(t => t.kind === 'comment' ? ' ' : t.text).join('');
}
function executableSql(sql) {
  return tokens(sql).map(t => t.kind === 'comment' || t.kind === 'string' || t.kind === 'dollar' ? ' ' : t.text).join('');
}
function columns(tableSql) {
  const clean = cleanSql(tableSql);
  const start = clean.indexOf('(');
  assert.ok(start >= 0,'table opening parenthesis');
  let depth = 0, entry = '', entries = [];
  for (const t of tokens(clean.slice(start+1))) {
    if (t.kind === 'code' && t.text === '(') depth++;
    if (t.kind === 'code' && t.text === ')') {
      if (depth === 0) { entries.push(entry.trim()); break; }
      depth--;
    }
    if (t.kind === 'code' && t.text === ',' && depth === 0) { entries.push(entry.trim()); entry = ''; }
    else entry += t.text;
  }
  return entries.filter(e => !/^(?:CONSTRAINT|CHECK|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|EXCLUDE)\b/i.test(e))
    .map(e => { const m=e.match(/^("(?:[^"]|"")+"|[A-Za-z_][A-Za-z_0-9]*)\s+/); assert.ok(m,`column definition ${e}`); return m[1]; });
}

// Lex top-level SQL statements, respecting comments, quoted strings/identifiers
// and dollar-quoted function/DO bodies. This is structural validation, not a
// PostgreSQL parser or a substitute for executing the rollback behavioral test.
function statements(sql) {
  let text = '', result = [];
  for (const t of tokens(sql)) {
    if (t.kind === 'comment') { text += ' '; continue; }
    if (t.kind === 'dollar') { text += ' BODY '; continue; }
    if (t.kind === 'string' || t.kind === 'identifier') { text += ' QUOTED '; continue; }
    if (t.text === ';') { if (text.trim()) result.push(text.trim()); text = ''; }
    else text += t.text;
  }
  assert.equal(text.trim(), '', 'all top-level statements terminate');
  for (const s of result) {
    if (/^CREATE(?: OR REPLACE)? FUNCTION\b/i.test(s)) assert.match(s,/\bAS\s+BODY\s*$/i,'function has a dollar-quoted body');
    if (/^DO\b/i.test(s)) assert.match(s,/^DO\s+BODY\s*$/i,'DO has a dollar-quoted body');
  }
  return result;
}
test('migration has only one outer transaction', () => {
  const s = statements(raw);
  assert.equal(s[0], 'BEGIN'); assert.equal(s.at(-1), 'COMMIT');
  assert.equal(s.filter(x => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(x)).length, 2);
});
test('behavioral SQL has one rollback transaction and balanced quotes', () => {
  const s = statements(live);
  assert.equal(s[0], 'BEGIN'); assert.equal(s.at(-1), 'ROLLBACK');
  assert.equal(s.filter(x => /^COMMIT$/i.test(x)).length, 0);
});
for (const [name, signature] of rpcs) {
  test(`${name} has exact service-only ACL`, () => {
    const sql = statements(raw).map(s => s.replace(/\s+/g,' '));
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC,anon,authenticated,service_role`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO service_role`));
  });
}
for (const [name, signature] of [
  ['record_selected_location_for_member', 'uuid,text,text,text'],
  ['record_location_resolution_for_server', 'uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz'],
]) {
  test(`${name} is revoked without changing its definition`, () => {
    assert.ok(compact.includes(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC,anon,authenticated,service_role;`));
    assert.doesNotMatch(compact, new RegExp(`(?:CREATE(?: OR REPLACE)?|ALTER|DROP) FUNCTION public\\.${name}\\(`));
    assert.doesNotMatch(compact, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  });
}
test('every new function is security definer with empty search path and revoked defaults', () => {
  const definitions = [...raw.matchAll(/CREATE FUNCTION ([\w.]+)\([^]*?LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS \$\w+\$/g)];
  assert.equal(definitions.length, 7);
  assert.equal((raw.match(/CREATE FUNCTION/g) || []).length, 7);
  for (const [, name] of definitions) assert.ok(compact.includes(`REVOKE ALL ON FUNCTION ${name}(`));
});
test('only four narrowly scoped grants and no direct private table or schema grants', () => {
  const grants = statements(raw).filter(x => /^GRANT /i.test(x));
  assert.equal(grants.length, 4);
  for (const g of grants) assert.match(g, /^GRANT EXECUTE ON FUNCTION public\.\w+\([^]*\) TO service_role$/);
  assert.doesNotMatch(compact, /CREATE POLICY|GRANT .* ON SCHEMA|ALTER DEFAULT PRIVILEGES|SET ROLE/i);
});
test('attestation stores precisely six minimal fields', () => {
  const table = raw.match(/CREATE TABLE private\.movement_location_selection_attestations \(([^]*?)\n\);/)[1];
  const fields = columns(`CREATE TABLE example (${table}\n);`);
  assert.deepEqual(fields, ['selection_request_id','attestation_version','proof_version','proof_issued_at','proof_expires_at','verified_at']);
  assert.match(table, /PRIMARY KEY REFERENCES private\.movement_location_selection_receipts\(request_id\) ON DELETE RESTRICT/);
});
test('attestation RLS with explicit all-role revocation and no policies', () => {
  assert.match(compact, /ALTER TABLE private\.movement_location_selection_attestations ENABLE ROW LEVEL SECURITY/);
  assert.match(compact, /REVOKE ALL ON private\.movement_location_selection_attestations FROM PUBLIC,anon,authenticated,service_role/);
});
test('versions and acceptance timestamps are constrained', () => {
  assert.match(compact, /CHECK \(attestation_version='trusted_selection_intake_v1'\)/);
  assert.match(compact, /CHECK \(proof_version='selection_proof_v1'\)/);
  for (const f of ['proof_issued_at','proof_expires_at','verified_at']) assert.ok(compact.includes(`CHECK (isfinite(${f}))`));
  assert.match(compact, /CHECK \(proof_issued_at<=verified_at AND verified_at<proof_expires_at\)/);
});
test('no-op updates and deletes unconditionally rejected', () => {
  assert.match(compact, /BEFORE UPDATE OR DELETE ON private\.movement_location_selection_attestations/);
  assert.match(body('protect'), /BEGIN\s+RAISE EXCEPTION USING ERRCODE='23514'/);
  assert.doesNotMatch(body('protect'), /IF|IS DISTINCT FROM/);
});
test('every attestation insert validates its receipt and selected source', () => {
  assert.match(compact, /AFTER INSERT ON private\.movement_location_selection_attestations/);
  assert.match(body('validate'), /JOIN private\.movement_location_references/);
  assert.match(body('validate'), /private\.require_verified_location_selection\(s.owner_member_id,s.id\)/);
  assert.match(required, /private\.assert_movement_location_selection_receipt\(r.request_id\)/);
  assert.match(required, /a.verified_at IS DISTINCT FROM r.recorded_at OR a.verified_at IS DISTINCT FROM s.created_at/);
});
test('intake accepts no coordinates and returns only minimal selection', () => {
  const header = raw.match(/CREATE FUNCTION public.record_verified_selected_location_for_server\(([^]*?)LANGUAGE/)[1];
  assert.doesNotMatch(header, /latitude|longitude|numeric|json/i);
  assert.match(header, /RETURNS TABLE\(location_reference_id uuid,declared_label text\)/);
  assert.match(intake, /NULL,NULL,NULL,NULL,NULL,v_now/);
});
test('input and member validation is explicit', () => {
  assert.match(intake, /FROM public.members m WHERE m.id=p_verified_member_id/);
  for (const [f, max] of [['p_declared_label',300],['p_provider_namespace',100],['p_provider_place_reference',500]]) {
    assert.ok(intake.includes(`${f} IS NULL OR ${f}<>btrim(${f})`));
    assert.ok(intake.includes(`length(${f}) NOT BETWEEN 1 AND ${max}`));
  }
});
test('creation uses one subtransaction for all three records', () => {
  const block = intake.match(/IF NOT FOUND THEN\s+BEGIN([^]*?)EXCEPTION WHEN unique_violation/)[1];
  assert.equal((block.match(/INSERT INTO/g) || []).length, 3);
  for (const t of ['movement_location_references','movement_location_selection_receipts','movement_location_selection_attestations']) assert.ok(block.includes(`INSERT INTO private.${t}`));
  assert.match(block, /v_now := clock_timestamp\(\)/);
  assert.match(block, /p_proof_issued_at>v_now OR p_proof_expires_at<=v_now/);
});
test('only receipt request-key races recover after rollback with READ COMMITTED', () => {
  assert.match(intake, /current_setting\('transaction_isolation'\)<>'read committed'/);
  assert.match(intake, /GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME,v_table=TABLE_NAME,v_schema=SCHEMA_NAME/);
  assert.match(intake, /v_constraint<>'movement_location_selection_receipts_pkey'/);
  assert.match(intake, /v_table<>'movement_location_selection_receipts' OR v_schema<>'private' THEN\s+RAISE;/);
  assert.match(intake, /IF NOT FOUND THEN RAISE; END IF;/);
});
test('replay compares all payload fields and cannot upgrade legacy receipts', () => {
  for (const p of ['declared_label','provider_namespace','provider_place_reference','proof_version','proof_issued_at','proof_expires_at']) assert.ok(intake.includes(`IS DISTINCT FROM p_${p}`));
  assert.ok(intake.indexOf('IF NOT FOUND THEN') < intake.indexOf('INSERT INTO private.movement_location_selection_attestations'));
  assert.match(intake, /s := private.require_verified_location_selection\(p_verified_member_id,r.location_reference_id\)/);
});
test('recovery checks ownership and attestation but not current proof expiry', () => {
  assert.match(required, /l.id=p_source_location_reference_id AND l.owner_member_id=p_verified_member_id FOR UPDATE/);
  assert.match(required, /FROM private.movement_location_selection_attestations/);
  assert.doesNotMatch(required, /proof_expires_at.*clock_timestamp|proof_expires_at.*v_now/);
  assert.match(body('recover'), /private.require_verified_location_selection\(p_verified_member_id,v_id\)/);
});
test('resolution context binds operation to source and validates prior result', () => {
  assert.match(context, /e.source_location_reference_id IS DISTINCT FROM s.id/);
  assert.match(context, /private.assert_movement_location_resolution_evidence\(e.id\)/);
  assert.match(context, /WHERE x.producer_request_id=p_producer_request_id/);
});
test('resolution wrapper requires attestation and exact pair then delegates every parameter', () => {
  assert.match(resolve, /s := private.require_verified_location_selection/);
  assert.match(resolve, /s.provider_namespace IS DISTINCT FROM p_provider_namespace OR s.provider_place_reference IS DISTINCT FROM p_provider_place_reference/);
  assert.match(resolve.replace(/\s+/g,' '), /RETURN QUERY SELECT r\.\* FROM public.record_location_resolution_for_server\( p_source_location_reference_id,p_producer_request_id,p_provider_namespace,p_provider_product,p_provider_version, p_provider_place_reference,p_resolution_version,p_latitude,p_longitude,p_resolved_at,p_expires_at \) r;/);
  assert.doesNotMatch(resolve, /INSERT|UPDATE|DELETE/);
});
for (const [name, expected] of [
  ['0025_trusted_route_producer_boundary.sql','8739ef54c193de0646c44f5311b902835ac949ed6efaf47755d3be8e1f33ad89'],
  ['0026_trusted_location_resolution_boundary.sql','32e1bcd9f29ea451512447e90b3149ca0c179ad98f8e60192ca5536d9d90e481'],
]) test(`${name} remains byte-identical`, () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`supabase/migrations/${name}`)).digest('hex'), expected);
});
test('no old function replaced or unrelated product/network path introduced', () => {
  assert.doesNotMatch(compact, /CREATE OR REPLACE|DROP |TRUNCATE |http[s]?:|fetch\(|net\.|dblink|payment|pricing|journey|alignment|requester|offering_movement_intents/i);
  assert.doesNotMatch(compact, /(?:UPDATE|DELETE FROM) private\.movement_location_(?:references|selection_receipts)/i);
});
test('behavioral checks are uniquely named and cover expected 134 cases', () => {
  const names = [
    ...live.matchAll(
      /PERFORM\s+pg_temp\.check_verified\(\s*'([^']+)'/g,
    ),
  ].map(x => x[1]);

  assert.equal(names.length, 134);
  assert.equal(new Set(names).size, 134);
  assert.match(
    live,
    /count\(\*\) FROM pg_temp.verified_selection_results\)<>134 THEN RAISE EXCEPTION/,
  );

  for (const category of [
    'old 0026 service actual denial',
    'accepted expired proof recovery',
    'legacy replay cannot upgrade',
    'attestation owner no-op update rejected',
    'resolution foreign and missing equivalent',
    'exact resolution replay',
  ]) {
    assert.ok(names.includes(category));
  }
});
test('behavioral fixture subtransaction rolls back and checks all counts', () => {
  assert.match(live, /SET CONSTRAINTS ALL IMMEDIATE/);
  assert.match(live, /RAISE EXCEPTION USING ERRCODE='Z0028'/);
  assert.match(live, /EXCEPTION WHEN SQLSTATE 'Z0028' THEN NULL/);
  assert.match(live, /counts_before=counts_after/);
  assert.match(live, /WHERE NOT passed\) THEN RAISE EXCEPTION/);
});
test('test role switching cannot be mistaken for an expected denial', () => {
  assert.match(live, /set_config\('role',p_role,true\);\s+BEGIN/);
  assert.match(live, /set_config\('role',old_role,true\)/);
});
test('0022 sanctions only the exact new migration', () => {
  const text = fs.readFileSync('supabase/tests/movement_context.test.cjs','utf8');
  assert.ok(text.includes(`'${migration}'`));
  assert.match(text, /!sanctionedConsumers.has\(file\)/);
});

test('dollar validator rejects standalone dollars and mismatched tags', () => {
  for (const sample of [
    'LANGUAGE plpgsql AS $ BEGIN END; $;',
    'CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS $one$ BEGIN END; $two$;',
    'DO $one$ BEGIN END; $two$;',
    'DO $ BEGIN END; $;',
    'CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS BEGIN END;',
  ]) assert.throws(() => statements(sample));
  assert.doesNotThrow(() => statements('CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS $good$ BEGIN END; $good$; DO $$ BEGIN END; $$;'));
});
test('all migration and harness function and DO bodies have valid matching tags', () => {
  const migrationStatements = statements(raw);
  const liveStatements = statements(live);
  assert.equal(migrationStatements.filter(s => /^CREATE FUNCTION\b/.test(s)).length,7);
  assert.equal(liveStatements.filter(s => /^CREATE FUNCTION\b/.test(s)).length,3);
  assert.equal(liveStatements.filter(s => /^DO\b/.test(s)).length,2);
});
test('comment and string decoys cannot satisfy executable structural checks', () => {
  const decoy = "-- GRANT EXECUTE ON FUNCTION x() TO anon;\n/* REVOKE ALL ON FUNCTION x() FROM PUBLIC; /* nested */ */\nSELECT 'CREATE FUNCTION bogus; -- preserved literal';";
  assert.deepEqual(statements(decoy),['SELECT  QUOTED']);
  assert.doesNotMatch(executableSql(decoy),/GRANT|REVOKE|CREATE FUNCTION/);
  const commented = cleanSql('DO $tag$ BEGIN /* PERFORM private.guard(); */ -- PERFORM private.guard();\n END; $tag$;');
  assert.doesNotMatch(commented,/private.guard/);
  assert.match(cleanSql("SELECT '-- literal /* kept */';"),/-- literal \/\* kept \*\//);
});
test('column inventory catches extra columns regardless of SQL type', () => {
  const table = raw.match(/CREATE TABLE private\.movement_location_selection_attestations \([^]*?\n\);/)[0];
  const expected = columns(table);
  for (const type of ['jsonb','bytea','numeric(12,2)','boolean','text[]','custom_schema.custom_type']) {
    const changed = table.replace(/\n\);$/,`,\n unexpected_payload ${type}\n);`);
    assert.deepEqual(columns(changed),[...expected,'unexpected_payload']);
    assert.notDeepEqual(columns(changed),expected);
  }
});
test('every private helper has exact all-role revocation and behavioral ACL checks', () => {
  const sql=statements(raw).map(s=>s.replace(/\s+/g,' '));
  for (const [name,args] of [['protect_movement_location_selection_attestation',''],['require_verified_location_selection','uuid,uuid'],['validate_movement_location_selection_attestation','']]) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION private.${name}(${args}) FROM PUBLIC,anon,authenticated,service_role`));
    for (const role of ['PUBLIC','anon','authenticated','service_role']) assert.ok(live.includes(`${name} denies ${role}`));
  }
});
test('behavioral argument variations use explicit SQL construction only', () => {
  assert.doesNotMatch(live,/\breplace\s*\(|\bregexp_replace\s*\(|\.replace\b/i);
  assert.match(live,/format\('SELECT \* FROM public.record_attested_location_resolution_for_server/);
});
test('deployment ownership and actual successful nested execution are explicitly tested', () => {
  assert.match(live,/p.prosecdef AND has_function_privilege\(p.proowner/);
  assert.match(live,/old 0026 service actual denial/);
  assert.match(live,/attested resolution succeeds/);
  assert.match(live,/definitions_before=definitions_after/);
  const source = fs.readFileSync('supabase/migrations/0026_trusted_location_resolution_boundary.sql','utf8').split('$record_resolution$')[1].replace(/\r\n/g,'\n');
  for (const text of [source,source.replace(/\n/g,'\r\n')]) assert.ok(live.includes(crypto.createHash('md5').update(text).digest('hex')));
  assert.match(live,/SELECT md5\(p.prosrc\) IN/);
});
test('legacy denial uses authenticated member and function permission diagnostic', () => {
  assert.match(live,/valid authenticated fixture identity/);
  assert.match(live,/auth.uid\(\)=m AND auth.role\(\)='authenticated'/);
  assert.doesNotMatch(live,/record_selected_location_for_member\(NULL/);
  assert.match(live,/old 0027 authenticated actual denial',result->>'state'='42501' AND result->>'message' LIKE 'permission denied for function %'/);
});
test('malformed attestations and actual expiry/version semantics are covered', () => {
  for (const name of ['invalid attestation version rejected','whitespace proof version rejected','equal proof timestamps rejected','infinite verified timestamp rejected','unexpected location shape rejected','older exact retry remains version one','expired evidence exact retry rejected','context rejects expired evidence']) assert.ok(live.includes(name));
  assert.match(live,/PERFORM pg_sleep\(greatest\(0,extract\(epoch FROM evidence_deadline-clock_timestamp\(\)\)\)\+0.02\)/);
  assert.doesNotMatch(live,/DISABLE TRIGGER|DISABLE ROW LEVEL SECURITY|session_replication_role/i);
});
test('critical delegation and ownership checks are executable code not string decoys', () => {
  assert.match(executableSql(resolve),/s := private.require_verified_location_selection/);
  assert.match(executableSql(resolve),/RETURN QUERY SELECT r\.\* FROM public.record_location_resolution_for_server/);
  assert.match(executableSql(required),/l.owner_member_id=p_verified_member_id FOR UPDATE/);
  assert.match(executableSql(context),/PERFORM private.assert_movement_location_resolution_evidence/);
});
test('all dynamic format calls have exactly the intended argument count', () => {
  let checked = 0;
  function inspect(sql) {
    const ts = tokens(sql);
    for (const t of ts) if (t.kind === 'dollar') inspect(t.body);
    for (let i=0;i<ts.length;i++) {
      if (ts.slice(i,i+7).map(t=>t.kind === 'code' ? t.text : ' ').join('') !== 'format(') continue;
      let depth=1, commas=0, first=null, closed=false;
      for (let j=i+7;j<ts.length;j++) {
        const t=ts[j];
        if (!first && !(t.kind === 'code' && /\s/.test(t.text))) first=t;
        if (t.kind !== 'code') continue;
        if (t.text==='(') depth++;
        if (t.text===')') { depth--; if (!depth) { closed=true; break; } }
        if (t.text===',' && depth===1) commas++;
      }
      assert.ok(closed,'closed format call');
      assert.ok(first && ['string','dollar'].includes(first.kind),'literal SQL format');
      const formatText=first.kind==='dollar' ? first.body : first.text.slice(1,-1);
      const placeholders=formatText.match(/%L/g)||[];
      assert.equal(commas,placeholders.length,'format argument count'); checked++;
    }
  }
  inspect(live); assert.ok(checked>50);
});
