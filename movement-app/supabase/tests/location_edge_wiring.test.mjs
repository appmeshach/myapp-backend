import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config =
  fs.readFileSync(
    'supabase/config.toml',
    'utf8',
  );

const functions = [
  'search-movement-locations',
  'select-movement-location',
  'recover-selected-location',
  'resolve-selected-location',
];

test('all four location Edge functions are configured with JWT verification', () => {
  for (const name of functions) {
    const escaped =
      name.replace(
        /[-/\\^$*+?.()|[\]{}]/g,
        '\\$&',
      );

    const pattern =
      new RegExp(
        `\\[functions\\.${escaped}\\][\\s\\S]*?verify_jwt\\s*=\\s*true[\\s\\S]*?entrypoint\\s*=\\s*"\\.\\/functions\\/${escaped}\\/index\\.ts"`,
      );

    assert.match(config, pattern);
  }
});

test('existing callback JWT exception remains unchanged', () => {
  assert.match(
    config,
    /\[functions\.face-verification-callback\][\s\S]*?verify_jwt\s*=\s*false/,
  );
});

test('search production entry point uses unavailable provider and runtime signer', () => {
  const source =
    fs.readFileSync(
      'supabase/functions/search-movement-locations/index.ts',
      'utf8',
    );

  assert.match(
    source,
    /unavailableLocationSearchProvider/,
  );

  assert.match(
    source,
    /runtimeSelectionProofSigner\(\)/,
  );

  assert.doesNotMatch(
    source,
    /test-provider|fake|always.success/i,
  );
});

test('resolution production entry point uses unavailable resolver', () => {
  const source =
    fs.readFileSync(
      'supabase/functions/resolve-selected-location/index.ts',
      'utf8',
    );

  assert.match(
    source,
    /unavailableDurableLocationResolver/,
  );

  assert.doesNotMatch(
    source,
    /test-provider|fake|always.success/i,
  );
});

test('selection production entry point uses runtime proof signer', () => {
  const source =
    fs.readFileSync(
      'supabase/functions/select-movement-location/index.ts',
      'utf8',
    );

  assert.match(
    source,
    /runtimeSelectionProofSigner\(\)/,
  );

  assert.doesNotMatch(
    source,
    /test-only|fake|always.success/i,
  );
});

test('runtime proof signer has no hardcoded production secret', () => {
  const source =
    fs.readFileSync(
      'supabase/functions/_shared/location-selection-proof.ts',
      'utf8',
    );

  assert.match(
    source,
    /LOCATION_SELECTION_PROOF_SECRET/,
  );

  assert.doesNotMatch(
    source,
    /test-only-selection-proof-secret/,
  );
});
