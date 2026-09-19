import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const config =
  fs.readFileSync(
    'supabase/config.toml',
    'utf8',
  );

test('route generation Edge function is configured with JWT verification', () => {
  assert.match(
    config,
    /\[functions\.generate-offering-route\][\s\S]*?verify_jwt\s*=\s*true[\s\S]*?entrypoint\s*=\s*"\.\/functions\/generate-offering-route\/index\.ts"/,
  );
});

test('route production entry point uses Mapbox directions provider', () => {
  const source =
    fs.readFileSync(
      'supabase/functions/generate-offering-route/index.ts',
      'utf8',
    );

  assert.match(
    source,
    /createMapboxDirectionsProvider/,
  );

  assert.match(
    source,
    /Deno\.env\.get\(\s*['"]MAPBOX_ACCESS_TOKEN['"]\s*,?\s*\)/,
  );

  assert.match(
    source,
    /createRouteGenerationHandler/,
  );

  assert.match(
    source,
    /runtimeRouteBackend\(\)/,
  );

  assert.doesNotMatch(
    source,
    /unavailableRouteProvider/,
  );

  assert.doesNotMatch(
    source,
    /test-provider|fake|always.success/i,
  );
});

test('route production entry point uses only shared runtime orchestration and provider modules', () => {
  const source =
    fs.readFileSync(
      'supabase/functions/generate-offering-route/index.ts',
      'utf8',
    );

  assert.match(
    source,
    /'\.\.\/_shared\/mapbox-directions-provider\.ts'/,
  );

  assert.match(
    source,
    /'\.\.\/_shared\/route-orchestration\.ts'/,
  );

  assert.match(
    source,
    /'\.\.\/_shared\/route-runtime\.ts'/,
  );

  assert.match(
    source,
    /'\.\.\/_shared\/face-runtime\.ts'/,
  );
});