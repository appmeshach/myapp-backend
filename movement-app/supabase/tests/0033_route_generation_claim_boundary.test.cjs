const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(
  __dirname,
  '..',
  'migrations',
  '0033_route_generation_claim_boundary.sql',
);

const sql = fs.readFileSync(
  migrationPath,
  'utf8',
);

function count(pattern) {
  return [...sql.matchAll(pattern)].length;
}

test(
  '0033 has exactly one outer transaction',
  () => {
    assert.equal(
      count(/^\s*BEGIN\s*;/gim),
      1,
    );

    assert.equal(
      count(/^\s*COMMIT\s*;/gim),
      1,
    );
  },
);

test(
  '0033 creates exactly one private route-generation claim table',
  () => {
    assert.equal(
      count(
        /\bCREATE\s+TABLE\s+private\.offering_route_generation_claims\b/gi,
      ),
      1,
    );

    assert.equal(
      count(/\bCREATE\s+TABLE\b/gi),
      1,
    );
  },
);

test(
  'route-generation claim is keyed by offering intent and has unique claim token',
  () => {
    assert.match(
      sql,
      /offering_movement_intent_id\s+uuid\s+PRIMARY\s+KEY/i,
    );

    assert.match(
      sql,
      /claim_token\s+uuid\s+NOT\s+NULL\s+UNIQUE/i,
    );
  },
);

test(
  'claim is bound to authoritative offering member',
  () => {
    assert.match(
      sql,
      /offering_member_id\s+uuid\s+NOT\s+NULL[\s\S]*REFERENCES\s+public\.members\(id\)/i,
    );

    assert.match(
      sql,
      /v_intent\.offering_member_id\s+IS\s+DISTINCT\s+FROM\s+p_offering_member_id/i,
    );
  },
);

test(
  'route-generation lease is fixed at thirty seconds',
  () => {
    assert.match(
      sql,
      /lease_expires_at\s*=\s*claimed_at\s*\+\s*interval\s*'30 seconds'/i,
    );

    assert.ok(
      count(/interval\s*'30 seconds'/gi) >= 3,
    );
  },
);

test(
  'claim table has RLS and no application table privileges',
  () => {
    assert.match(
      sql,
      /ALTER\s+TABLE\s+private\.offering_route_generation_claims\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );

    assert.match(
      sql,
      /REVOKE\s+ALL\s+ON\s+private\.offering_route_generation_claims\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i,
    );

    assert.doesNotMatch(
      sql,
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*ON\s+(?:TABLE\s+)?private\.offering_route_generation_claims/i,
    );
  },
);

test(
  'claim protection blocks deletion and immutable binding changes',
  () => {
    assert.match(
      sql,
      /IF\s+TG_OP\s*=\s*'DELETE'[\s\S]*Route generation claim cannot be deleted/i,
    );

    assert.match(
      sql,
      /NEW\.offering_movement_intent_id[\s\S]*OLD\.offering_movement_intent_id[\s\S]*NEW\.offering_member_id[\s\S]*OLD\.offering_member_id/i,
    );
  },
);

test(
  'claim RPC is security definer with empty search path',
  () => {
    assert.match(
      sql,
      /CREATE\s+FUNCTION\s+public\.claim_offering_route_generation_for_server[\s\S]*LANGUAGE\s+plpgsql[\s\S]*SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*''/i,
    );
  },
);

test(
  'claim RPC is service-role only',
  () => {
    assert.match(
      sql,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.claim_offering_route_generation_for_server\([\s\S]*?\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i,
    );

    assert.match(
      sql,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_offering_route_generation_for_server\([\s\S]*?\)\s+TO\s+service_role/i,
    );
  },
);

test(
  'claim RPC requires READ COMMITTED',
  () => {
    assert.match(
      sql,
      /Route generation claim requires READ COMMITTED/i,
    );
  },
);

test(
  'claim RPC locks offering intent before claim row',
  () => {
    const intentLock =
      sql.search(
        /FROM\s+private\.offering_movement_intents\s+i[\s\S]*?WHERE\s+i\.id\s*=\s*p_offering_movement_intent_id[\s\S]*?FOR\s+UPDATE\s*;/i,
      );

    const claimLookup =
      sql.search(
        /FROM\s+private\.offering_route_generation_claims\s+c[\s\S]*?WHERE\s+c\.offering_movement_intent_id\s*=\s*p_offering_movement_intent_id[\s\S]*?FOR\s+UPDATE\s*;/i,
      );

    assert.ok(intentLock >= 0);
    assert.ok(claimLookup > intentLock);
  },
);

test(
  'claim RPC reuses authoritative 0031 route-generation context',
  () => {
    assert.match(
      sql,
      /FROM\s+public\.get_offering_route_generation_context_for_server\(\s*p_offering_movement_intent_id,\s*p_offering_member_id\s*\)/i,
    );
  },
);

test(
  'existing valid route is checked before claim creation or renewal',
  () => {
    const existingRoute =
      sql.indexOf(
        'FROM private.offering_route_evidence e',
      );

    const claimRow =
      sql.indexOf(
        'FROM private.offering_route_generation_claims c',
      );

    assert.ok(existingRoute >= 0);
    assert.ok(claimRow > existingRoute);
  },
);

test(
  'existing route is validated through private route evidence assertion',
  () => {
    assert.match(
      sql,
      /PERFORM\s+private\.assert_offering_route_evidence\(\s*v_evidence\.id\s*\)/i,
    );
  },
);

test(
  'busy claim returns bounded positive retry without provider data',
  () => {
    assert.match(
      sql,
      /'busy'::text/i,
    );

    assert.match(
      sql,
      /GREATEST\(\s*1,\s*LEAST\(\s*30,/i,
    );
  },
);

test(
  'claimed state returns only authoritative trusted endpoint context',
  () => {
    assert.match(
      sql,
      /'claimed'::text[\s\S]*v_context\.origin_location_reference_id[\s\S]*v_context\.origin_latitude[\s\S]*v_context\.origin_longitude[\s\S]*v_context\.destination_location_reference_id[\s\S]*v_context\.destination_latitude[\s\S]*v_context\.destination_longitude/i,
    );
  },
);

test(
  'claim-bound writer is security definer and service-role only',
  () => {
    assert.match(
      sql,
      /CREATE\s+FUNCTION\s+public\.record_claimed_offering_route_evidence_for_server[\s\S]*LANGUAGE\s+plpgsql[\s\S]*SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*''/i,
    );

    assert.match(
      sql,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.record_claimed_offering_route_evidence_for_server\([\s\S]*?\)\s+TO\s+service_role/i,
    );
  },
);

test(
  'claim-bound writer validates exact member token and unexpired lease',
  () => {
    assert.match(
      sql,
      /v_claim\.offering_member_id\s+IS\s+DISTINCT\s+FROM\s+p_offering_member_id/i,
    );

    assert.match(
      sql,
      /v_claim\.claim_token\s+IS\s+DISTINCT\s+FROM\s+p_generation_claim_token/i,
    );

    assert.match(
      sql,
      /v_claim\.lease_expires_at\s*<=\s*v_now/i,
    );
  },
);

test(
  'claim-bound writer delegates authoritative evidence creation to 0025 writer',
  () => {
    assert.match(
      sql,
      /FROM\s+public\.record_offering_route_evidence_for_server\(/i,
    );

    assert.doesNotMatch(
      sql,
      /INSERT\s+INTO\s+private\.offering_route_evidence/i,
    );
  },
);

test(
  'claim stores one completed route evidence binding',
  () => {
    assert.match(
      sql,
      /completed_route_evidence_id\s+uuid\s+UNIQUE[\s\S]*REFERENCES\s+private\.offering_route_evidence\(id\)/i,
    );

    assert.match(
      sql,
      /\(completed_route_evidence_id\s+IS\s+NULL\)\s*=\s*\(completed_at\s+IS\s+NULL\)/i,
    );
  },
);

test(
  'same claim token cannot renew its lease or change completed evidence',
  () => {
    assert.match(
      sql,
      /Route generation claim lease cannot be extended/i,
    );

    assert.match(
      sql,
      /Completed route generation claim is immutable/i,
    );
  },
);

test(
  'expired claim takeover clears any prior completion binding',
  () => {
    assert.match(
      sql,
      /claim_token\s*=\s*v_claim_token[\s\S]*claimed_at\s*=\s*v_now[\s\S]*lease_expires_at[\s\S]*completed_route_evidence_id\s*=\s*NULL[\s\S]*completed_at\s*=\s*NULL/i,
    );
  },
);

test(
  'completed claim replays only the same provider route identity',
  () => {
    assert.match(
      sql,
      /IF\s+v_claim\.completed_route_evidence_id\s+IS\s+NOT\s+NULL/i,
    );

    assert.match(
      sql,
      /v_completed\.provider_namespace[\s\S]*p_provider_namespace[\s\S]*v_completed\.provider_product[\s\S]*p_provider_product[\s\S]*v_completed\.provider_version[\s\S]*p_provider_version[\s\S]*v_completed\.provider_route_reference[\s\S]*p_provider_route_reference/i,
    );

    assert.match(
      sql,
      /Completed route generation claim does not match/i,
    );

    assert.match(
      sql,
      /completed_route_evidence_id\s*=\s*v_recorded_id[\s\S]*completed_at\s*=\s*clock_timestamp\(\)/i,
    );
  },
);

test(
  '0033 introduces no routing vendor network pricing matching or journey creation',
  () => {
    assert.doesNotMatch(
      sql,
      /\bmapbox\b|\bgoogle\b|\bhere\b|\btomtom\b/i,
    );

    assert.doesNotMatch(
      sql,
      /\bfetch\s*\(|https?:\/\//i,
    );

    assert.doesNotMatch(
      sql,
      /\bINSERT\s+INTO\s+public\.journeys\b|\bCREATE\s+TABLE\s+.*payment|\bwallet\b|\bprice\b/i,
    );
  },
);