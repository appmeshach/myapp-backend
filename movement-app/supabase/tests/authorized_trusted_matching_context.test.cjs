'use strict';

const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '0039_authorized_trusted_matching_context.sql'
);

const behavioralTestPath = path.join(
  process.cwd(),
  'supabase',
  'tests',
  '0039_authorized_trusted_matching_context_test.sql'
);

const raw = fs
  .readFileSync(migrationPath, 'utf8')
  .replace(/\r\n/g, '\n');

const stripComments = (value) =>
  value.replace(
    /'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith("'") ? token : ' ')
  );

const sql = stripComments(raw);

const live = stripComments(
  fs.readFileSync(
    behavioralTestPath,
    'utf8'
  )
);

const functionStart =
  sql.indexOf(
    'CREATE FUNCTION\npublic.get_authorized_trusted_matching_context_for_server'
  );

const wrapper =
  functionStart >= 0
    ? sql.slice(functionStart)
    : '';

const authorizationIndex =
  wrapper.indexOf(
    'IF p_verified_member_id'
  );

const trustedContextIndex =
  wrapper.indexOf(
    'public.get_trusted_matching_context_for_server'
  );

const checks = [];

const check = (name, passed) => {
  checks.push({
    name,
    passed: Boolean(passed),
  });
};

check(
  'transaction wrapper',
  /^\s*BEGIN;/i.test(sql)
    && /COMMIT;\s*$/i.test(sql)
);

check(
  'one authorized trusted matching context wrapper',
  (
    sql.match(
      /CREATE\s+FUNCTION\s+public\.get_authorized_trusted_matching_context_for_server/gi
    ) || []
  ).length === 1
);

check(
  'security definer',
  /SECURITY\s+DEFINER/i.test(wrapper)
);

check(
  'empty search path',
  /SET\s+search_path\s*=\s*''/i.test(wrapper)
);

check(
  'read committed required',
  /current_setting\('transaction_isolation'\)[\s\S]*?<>\s*'read committed'/i.test(
    wrapper
  )
);

check(
  'verified member input required',
  /p_verified_member_id\s+uuid/i.test(
    wrapper
  )
);

check(
  'movement need input required',
  /p_movement_need_id\s+uuid/i.test(
    wrapper
  )
);

check(
  'offering movement intent input required',
  /p_offering_movement_intent_id\s+uuid/i.test(
    wrapper
  )
);

check(
  'null participant inputs fail closed',
  /p_verified_member_id\s+IS\s+NULL[\s\S]*?p_movement_need_id\s+IS\s+NULL[\s\S]*?p_offering_movement_intent_id\s+IS\s+NULL/i.test(
    wrapper
  )
);

check(
  'requester identity derived from movement need',
  /SELECT\s+n\.member_id[\s\S]*?FROM\s+public\.movement_needs\s+n[\s\S]*?WHERE\s+n\.id\s*=\s*p_movement_need_id/i.test(
    wrapper
  )
);

check(
  'offerer identity derived from offering intent',
  /SELECT\s+i\.offering_member_id[\s\S]*?FROM\s+private\.offering_movement_intents\s+i[\s\S]*?WHERE\s+i\.id\s*=\s*p_offering_movement_intent_id/i.test(
    wrapper
  )
);

check(
  'movement need is inspected before offering intent',
  wrapper.indexOf(
    'FROM public.movement_needs n'
  ) >= 0
    && wrapper.indexOf(
      'FROM private.offering_movement_intents i'
    ) >= 0
    && wrapper.indexOf(
      'FROM public.movement_needs n'
    ) < wrapper.indexOf(
      'FROM private.offering_movement_intents i'
    )
);

check(
  'requester or offerer authorization rule',
  /p_verified_member_id[\s\S]*?IS\s+DISTINCT\s+FROM\s+v_requesting_member_id[\s\S]*?AND[\s\S]*?p_verified_member_id[\s\S]*?IS\s+DISTINCT\s+FROM\s+v_offering_member_id/i.test(
    wrapper
  )
);

check(
  'unrelated member fails with insufficient privilege',
  /ERRCODE\s*=\s*'42501'[\s\S]*?Member is not authorized for this trusted matching context/i.test(
    wrapper
  )
);

check(
  'authorization happens before trusted private context retrieval',
  authorizationIndex >= 0
    && trustedContextIndex >= 0
    && authorizationIndex < trustedContextIndex
);

check(
  'trusted matching context reused',
  /public\.get_trusted_matching_context_for_server\s*\(/i.test(
    wrapper
  )
);

check(
  'database-derived offerer identity passed to trusted context',
  /public\.get_trusted_matching_context_for_server\s*\([\s\S]*?p_movement_need_id[\s\S]*?p_offering_movement_intent_id[\s\S]*?v_offering_member_id/i.test(
    wrapper
  )
);

check(
  'service-only execute',
  /GRANT\s+EXECUTE[\s\S]*?public\.get_authorized_trusted_matching_context_for_server[\s\S]*?TO\s+service_role\s*;/i.test(
    wrapper
  )
    && /REVOKE\s+ALL[\s\S]*?public\.get_authorized_trusted_matching_context_for_server[\s\S]*?FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role\s*;/i.test(
      wrapper
    )
);

check(
  'no direct route-match evidence write',
  !/INSERT\s+INTO\s+private\.trusted_route_match_evidence/i.test(
    wrapper
  )
);

check(
  'no direct route-match evidence update',
  !/UPDATE\s+private\.trusted_route_match_evidence/i.test(
    wrapper
  )
);

check(
  'wrapper creates no alignment',
  !/INSERT\s+INTO\s+public\.alignments/i.test(
    wrapper
  )
);

check(
  'wrapper creates no journey',
  !/INSERT\s+INTO\s+public\.journeys/i.test(
    wrapper
  )
);

check(
  'no maximum-detour rule introduced',
  !/maximum_detour|max(?:imum)?_pickup_distance|max(?:imum)?_dropoff_distance/i.test(
    wrapper
  )
);

check(
  'behavioral test covers requester authorization',
  live.includes(
    '06 requester owner is authorized'
  )
);

check(
  'behavioral test covers offerer authorization',
  live.includes(
    '07 offerer owner is authorized'
  )
);

check(
  'behavioral test covers unrelated member rejection',
  live.includes(
    '08 unrelated member is rejected before trusted context is returned'
  )
);

check(
  'behavioral test covers authenticated direct-call rejection',
  live.includes(
    '09 authenticated role cannot invoke server authorization RPC directly'
  )
);

check(
  'behavioral test covers anon direct-call rejection',
  live.includes(
    '10 anon cannot invoke server authorization RPC directly'
  )
);

check(
  'behavioral test covers no route-match evidence creation',
  live.includes(
    '11 authorization lookup creates no route-match evidence'
  )
);

check(
  'behavioral test covers no operational movement creation',
  live.includes(
    '12 authorization lookup creates no alignment or journey state'
  )
);

const failed =
  checks.filter((item) => !item.passed);

for (const item of checks) {
  console.log(
    `${item.passed ? 'PASS' : 'FAIL'}  ${item.name}`
  );
}

console.log(
  `\n${checks.length} tests, `
  + `${checks.length - failed.length} passed, `
  + `${failed.length} failed`
);

if (failed.length) {
  process.exit(1);
}
