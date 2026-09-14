import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPhotoHandler } from '../functions/post-activation-photo/handler.ts';

// Network is injected and fully mocked. No Supabase credentials or .env loading.
const token = 'a'.repeat(64);
const viewer = '11111111-1111-4111-8111-111111111111';
const privatePath = `${viewer}/private-photo.png`;
const secret = 'sb_secret_server_only_test_key';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=', 'base64');
const config = { supabaseUrl: 'https://project.invalid', serviceRoleKey: secret };

function request(payload = { profilePhotoToken: token }, headers = {}) {
  return new Request('https://project.invalid/functions/v1/post-activation-photo', {
    method: 'POST', headers: { Authorization: 'Bearer normal-user-jwt', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

function setup(overrides = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    if (url.endsWith('/auth/v1/user')) {
      assert.equal(options.headers.Authorization, 'Bearer normal-user-jwt');
      return overrides.auth?.() ?? Response.json({ id: viewer, role: 'authenticated' });
    }
    if (url.endsWith('/rest/v1/rpc/resolve_post_activation_photo_for_server')) {
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.apikey, secret);
      assert.deepEqual(JSON.parse(options.body), { p_photo_token: token, p_viewer_member_id: viewer });
      return overrides.resolve?.() ?? Response.json([{ storage_path: privatePath }]);
    }
    assert.equal(url, `${config.supabaseUrl}/storage/v1/object/verified-profile-photos/${privatePath}`);
    assert.equal(options.headers.Authorization, undefined);
    return overrides.storage?.() ?? new Response(png, { headers: {
      'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600',
      'Location': 'https://project.invalid/storage/v1/object/sign/private?token=SECRET',
      'Content-Disposition': `inline; filename="${privatePath}"`, 'ETag': viewer,
    } });
  };
  return { calls, handler: createPhotoHandler(config, fetcher) };
}

async function safeFailure(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Location'), null);
  const body = await response.text();
  assert.equal(body, status === 401 ? 'Authentication required' : 'Photo unavailable');
  for (const sensitive of [secret, privatePath, viewer, 'storage_path', 'storage/v1', 'signedURL']) {
    assert(!body.includes(sensitive));
    assert(!JSON.stringify([...response.headers]).includes(sensitive));
  }
}

test('missing Authorization is rejected before any network request', async () => {
  const { handler, calls } = setup();
  const req = request(); req.headers.delete('Authorization');
  await safeFailure(await handler(req), 401);
  assert.equal(calls.length, 0);
});

test('malformed Authorization is rejected before any network request', async () => {
  const { handler, calls } = setup();
  await safeFailure(await handler(request(undefined, { Authorization: 'Basic credentials' })), 401);
  assert.equal(calls.length, 0);
});

test('invalid JWT rejected by Auth cannot reach resolver or Storage', async () => {
  const { handler, calls } = setup({ auth: () => Response.json({ message: secret }, { status: 401 }) });
  await safeFailure(await handler(request()), 401);
  assert.equal(calls.length, 1);
});

test('Auth must return a valid authenticated member identity', async () => {
  const { handler, calls } = setup({ auth: () => Response.json({ id: 'not-a-uuid', role: 'service_role' }) });
  await safeFailure(await handler(request()), 401);
  assert.equal(calls.length, 1);
});

test('client-supplied viewer UUID is rejected, never passed to resolver', async () => {
  const { handler, calls } = setup();
  await safeFailure(await handler(request({ profilePhotoToken: token, memberId: viewer })), 404);
  assert.equal(calls.length, 1);
});

test('malformed photo token is unavailable', async () => {
  const { handler, calls } = setup();
  await safeFailure(await handler(request({ profilePhotoToken: '../private/path' })), 404);
  assert.equal(calls.length, 1);
});

// 0014 deliberately gives all these conditions the same zero-row result. These
// cases assert that the HTTP layer preserves that contract, not reimplements it.
for (const reason of ['invalid token', 'expired token', 'another viewer token', 'ineligible participant', 'noncurrent or unverified photo']) {
  test(`${reason}: resolver no-row result is a uniform 404 with no Storage request`, async () => {
    const { handler, calls } = setup({ resolve: () => Response.json([]) });
    await safeFailure(await handler(request()), 404);
    assert.equal(calls.length, 2);
  });
}

test('valid participant token delivers exactly the image bytes and Content-Type', async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.method, 'POST');
});

test('successful responses do not forward paths, identities, signed URLs or upstream headers', async () => {
  const { handler } = setup();
  const response = await handler(request());
  for (const header of ['Location', 'Content-Disposition', 'ETag']) assert.equal(response.headers.get(header), null);
  const outgoing = JSON.stringify([...response.headers]) + Buffer.from(await response.arrayBuffer()).toString();
  for (const value of [privatePath, viewer, secret, 'verified-profile-photos', 'storage_path', '/storage/v1', '?token=SECRET']) {
    assert(!outgoing.includes(value));
  }
});

test('resolver errors do not expose upstream error bodies', async () => {
  const { handler, calls } = setup({ resolve: () => Response.json({ storage_path: privatePath, key: secret }, { status: 500 }) });
  await safeFailure(await handler(request()), 404);
  assert.equal(calls.length, 2);
});

test('ambiguous multiple resolver rows are unavailable', async () => {
  const { handler } = setup({ resolve: () => Response.json([{ storage_path: privatePath }, { storage_path: privatePath }]) });
  await safeFailure(await handler(request()), 404);
});

for (const path of ['https://evil.invalid/photo', '../photo.png', 'folder/%2e%2e/photo.png', '/photo.png', 'folder\\photo.png', 'photo.png?token=secret']) {
  test(`unsafe resolver path is rejected: ${path}`, async () => {
    const { handler, calls } = setup({ resolve: () => Response.json([{ storage_path: path }]) });
    await safeFailure(await handler(request()), 404);
    assert.equal(calls.length, 2);
  });
}

test('Storage error body is not returned', async () => {
  const { handler } = setup({ storage: () => Response.json({ storage_path: privatePath }, { status: 404 }) });
  await safeFailure(await handler(request()), 404);
});

test('Storage redirect is not returned or followed', async () => {
  const { handler } = setup({ storage: () => new Response(null, { status: 302, headers: { Location: 'https://evil.invalid' } }) });
  await safeFailure(await handler(request()), 404);
});

test('SVG and HTML cannot be served as profile photos', async () => {
  for (const type of ['image/svg+xml', 'text/html']) {
    const { handler } = setup({ storage: () => new Response('<script/>', { headers: { 'Content-Type': type } }) });
    await safeFailure(await handler(request()), 404);
  }
});

test('image content must match its MIME signature', async () => {
  const { handler } = setup({ storage: () => new Response('not an image', { headers: { 'Content-Type': 'image/png' } }) });
  await safeFailure(await handler(request()), 404);
});

test('oversized image is rejected even with no Content-Length header', async () => {
  const bytes = new Uint8Array(5 * 1024 * 1024 + 1); bytes.set(png);
  const { handler } = setup({ storage: () => new Response(bytes, { headers: { 'Content-Type': 'image/png' } }) });
  await safeFailure(await handler(request()), 404);
});

test('unexpected fetch exception does not expose credentials or paths', async () => {
  const handler = createPhotoHandler(config, async () => { throw new Error(`${secret}: ${privatePath}`); });
  await safeFailure(await handler(request()), 404);
});

test('oversized request body fails without calling resolver', async () => {
  const { handler, calls } = setup();
  await safeFailure(await handler(request({ profilePhotoToken: 'a'.repeat(2048) })), 404);
  assert.equal(calls.length, 1);
});

test('tokens are not accepted in query parameters or GET requests', async () => {
  const { handler, calls } = setup();
  await safeFailure(await handler(new Request(`https://project.invalid/photo?profilePhotoToken=${token}`)), 405);
  assert.equal(calls.length, 0);
});

test('CORS preflight grants no image access and is not cached', async () => {
  const { handler, calls } = setup();
  const response = await handler(new Request('https://project.invalid/photo', { method: 'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(calls.length, 0);
});

test('missing server secret fails closed', async () => {
  const handler = createPhotoHandler({ ...config, serviceRoleKey: '' }, async () => { throw new Error('must not fetch'); });
  await safeFailure(await handler(request()), 503);
});

test('private bucket foundation and gateway auth remain restrictive (static SQL/config check)', () => {
  const sql = readFileSync(new URL('../migrations/0015_private_profile_photo_storage.sql', import.meta.url), 'utf8');
  assert(sql.startsWith('BEGIN;') && sql.trimEnd().endsWith('COMMIT;'));
  assert(sql.includes("'verified-profile-photos', 'verified-profile-photos', false"));
  assert(sql.includes('public = false'));
  assert.equal((sql.match(/AS RESTRICTIVE FOR ALL TO anon, authenticated/g) ?? []).length, 2);
  const executableSql = sql.replace(/--.*$/gm, '');
assert(!/CREATE (?:OR REPLACE )?FUNCTION|GRANT\s/i.test(executableSql));
  assert(readFileSync(new URL('../config.toml', import.meta.url), 'utf8').includes('verify_jwt = true'));
});
