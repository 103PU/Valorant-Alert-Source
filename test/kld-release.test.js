const test = require('node:test');
const assert = require('node:assert');
const { buildKldPayload, publishKldRelease } = require('../scripts/publish-kld-release');

test('buildKldPayload: formats semver versions and defaults', () => {
  const payload = buildKldPayload({
    version: 'v1.2.3',
    releaseNotes: 'Fixed issues and improved sound engine'
  });

  assert.strictEqual(payload.version, '1.2.3');
  assert.strictEqual(payload.minimumVersion, '1.2.3');
  assert.strictEqual(payload.forceUpdate, false);
  assert.strictEqual(payload.releaseNotes, 'Fixed issues and improved sound engine');
});

test('buildKldPayload: respects explicit minimumVersion and forceUpdate', () => {
  const payload = buildKldPayload({
    version: ' 2.0.0 ',
    minimumVersion: 'v1.5.0',
    forceUpdate: true,
    releaseNotes: 'Major breaking update'
  });

  assert.strictEqual(payload.version, '2.0.0');
  assert.strictEqual(payload.minimumVersion, '1.5.0');
  assert.strictEqual(payload.forceUpdate, true);
  assert.strictEqual(payload.releaseNotes, 'Major breaking update');
});

test('publishKldRelease: throws if adminToken is missing', async () => {
  await assert.rejects(async () => {
    await publishKldRelease({
      adminToken: '',
      payload: { version: '1.0.0' }
    });
  }, /adminToken is required/);
});

test('publishKldRelease: sends valid POST request with X-Admin-Token header', async () => {
  let calledUrl = '';
  let calledOpts = null;

  const mockFetch = async (url, opts) => {
    calledUrl = url;
    calledOpts = opts;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, version: { currentVersion: '1.2.3' } })
    };
  };

  const result = await publishKldRelease({
    serverUrl: 'https://kld.test',
    adminToken: 'secret-admin-token-123',
    payload: { version: '1.2.3', minimumVersion: '1.2.3', forceUpdate: false, releaseNotes: 'Highlights' },
    fetchFn: mockFetch
  });

  assert.strictEqual(calledUrl, 'https://kld.test/api/admin/app-version/publish-release');
  assert.strictEqual(calledOpts.method, 'POST');
  assert.strictEqual(calledOpts.headers['X-Admin-Token'], 'secret-admin-token-123');
  assert.strictEqual(calledOpts.headers['Content-Type'], 'application/json; charset=utf-8');

  const parsedBody = JSON.parse(calledOpts.body);
  assert.strictEqual(parsedBody.version, '1.2.3');
  assert.strictEqual(parsedBody.releaseNotes, 'Highlights');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.version.currentVersion, '1.2.3');
});

test('publishKldRelease: throws meaningful error on non-200 HTTP response', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => JSON.stringify({ error: 'invalid_token' })
  });

  await assert.rejects(async () => {
    await publishKldRelease({
      serverUrl: 'https://kld.test',
      adminToken: 'wrong-token',
      payload: { version: '1.0.0' },
      fetchFn: mockFetch
    });
  }, /KLD publish failed \(HTTP 401\)/);
});
