const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const token = 'a'.repeat(64);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=', 'base64');
const code = ts.transpileModule(fs.readFileSync('src/services/profilePhotoService.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ session = { access_token: 'user-jwt' }, status = 200, type = 'image/png', redirected = false } = {}) {
  const exports = {};
  const calls = [];
  vm.runInNewContext(code, {
    exports,
    require: () => ({ supabase: { auth: { getSession: async () => ({ data: { session }, error: null }) } } }),
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://project.invalid', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key' } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const response = new Response(status === 200 ? png : 'private upstream error', { status, headers: { 'Content-Type': type } });
      if (redirected) Object.defineProperty(response, 'redirected', { value: true });
      return response;
    },
  });
  return { load: exports.getPostActivationProfilePhoto, calls };
}

test('client sends only opaque token with user JWT and publishable key; returns bytes as Blob', async () => {
  const { load, calls } = setup();
  const blob = await load(token);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, 'https://project.invalid/functions/v1/post-activation-photo');
  assert.equal(options.headers.Authorization, 'Bearer user-jwt');
  assert.equal(options.headers.apikey, 'public-key');
  assert.deepEqual(JSON.parse(options.body), { profilePhotoToken: token });
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert(!url.includes(token));
});

test('missing user session fails before fetch', async () => {
  const { load, calls } = setup({ session: null });
  await assert.rejects(load(token), /Authentication required/);
  assert.equal(calls.length, 0);
});

test('malformed token is unavailable without fetch', async () => {
  const { load, calls } = setup();
  assert.equal(await load('../private/path'), null);
  assert.equal(calls.length, 0);
});

for (const status of [403, 404]) {
  test(`client maps ${status} to null`, async () => {
    const { load } = setup({ status });
    assert.equal(await load(token), null);
  });
}

test('invalid session response asks for authentication without exposing upstream body', async () => {
  const { load } = setup({ status: 401 });
  await assert.rejects(load(token), /^Error: Authentication required$/);
});

test('client rejects nonimage response', async () => {
  const { load } = setup({ type: 'text/html' });
  await assert.rejects(load(token), /^Error: Photo unavailable$/);
});

test('client rejects redirects even if a transport followed one', async () => {
  const { load } = setup({ redirected: true });
  await assert.rejects(load(token), /^Error: Photo unavailable$/);
});

test('ordinary vehicle types and photo helper contain no server credentials or object paths', () => {
  const helper = fs.readFileSync('src/services/profilePhotoService.ts', 'utf8');
  const types = fs.readFileSync('src/types/vehicle.ts', 'utf8');
  assert(!/SUPABASE_SERVICE_ROLE_KEY|storage_path|storagePath|signedUrl|signedURL/.test(helper));
  assert(!/plateNumber/.test(types));
});
