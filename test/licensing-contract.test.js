const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { resolveLicenseConfig } = require('../server/licensing/config');
const { KldClient } = require('../server/licensing/kld-client');
const { LicenseGate, STATE } = require('../server/licensing/gate');

const rootDir = path.join(__dirname, '..');

function cfgWith(keylicense) {
  return resolveLicenseConfig({ keylicense }, rootDir);
}

// A store double. The real LicenseStore writes %APPDATA%\ValorantAlert\session.json
// on every recordEntitlement, which a test must not touch.
function fakeStore({ jwt = 'jwt', lastVerifiedAt = null } = {}) {
  return {
    recorded: [],
    cleared: false,
    isLoggedIn: () => !!jwt,
    getJwt: () => jwt,
    clearSession() { this.cleared = true; },
    recordEntitlement(license, trial) { this.recorded.push({ license, trial }); },
    offlineDaysElapsed: () => (lastVerifiedAt === null ? null : lastVerifiedAt),
    publicSnapshot: () => ({ user: null, license: null, trial: null, lastVerifiedAt })
  };
}

function gateWith(kld, storeOpts) {
  return new LicenseGate({
    cfg: cfgWith({}),
    kld,
    store: fakeStore(storeOpts),
    deviceId: 'device-test',
    deviceName: 'test-host'
  });
}

// Google matches redirect_uri byte-exactly. Probing the live client id showed
// http://127.0.0.1:8750/oauth/callback/ is registered, while dropping the
// trailing slash or using "localhost" both answer redirect_uri_mismatch. The
// previous includes(':8750/') test let both of those through, so login died with
// a Google error page and no clue in the app.
test('redirectUri is derived from the port, not trusted from config', () => {
  const expected = 'http://127.0.0.1:8750/oauth/callback/';

  assert.strictEqual(cfgWith({}).redirectUri, expected, 'absent');
  assert.strictEqual(
    cfgWith({ redirectUri: 'http://localhost:8750/oauth/callback/' }).redirectUri,
    expected,
    'localhost is rejected by Google and must be replaced'
  );
  assert.strictEqual(
    cfgWith({ redirectUri: 'http://127.0.0.1:8750/oauth/callback' }).redirectUri,
    expected,
    'a missing trailing slash must be replaced'
  );
});

test('redirectUri follows a non-default loopback port', () => {
  assert.strictEqual(
    cfgWith({ loopbackPort: 9001 }).redirectUri,
    'http://127.0.0.1:9001/oauth/callback/'
  );
});

// Unscoped, KLD answers with whatever license the account last applied. For an
// existing Valorant Tweaks customer that is a tweaks key, which then fails
// activation with product_not_allowed_for_license and lands the gate on BLOCKED.
test('getAppliedLicense scopes the read to this product', async () => {
  const cfg = cfgWith({ productId: 'valorant-alert' });
  const client = new KldClient(cfg);

  const calls = [];
  client.request = (endpointPath, opts) => {
    calls.push({ endpointPath, opts });
    return Promise.resolve({ ok: true, license: null });
  };

  await client.getAppliedLicense('jwt-value');

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].endpointPath,
    '/api/me/applied-license?productId=valorant-alert'
  );
  assert.strictEqual(calls[0].opts.jwt, 'jwt-value');
});

test('getAppliedLicense percent-encodes an awkward productId', async () => {
  const client = new KldClient(cfgWith({ productId: 'a b&c' }));
  let seen = null;
  client.request = (p) => { seen = p; return Promise.resolve({}); };

  await client.getAppliedLicense('jwt');

  assert.strictEqual(seen, '/api/me/applied-license?productId=a%20b%26c');
});

// A product-scope refusal from activate means "no valorant-alert license yet",
// not "this user is blocked". Before the fix the gate landed on BLOCKED and told
// the user their license was expired/revoked/over the device limit — none of
// which is the actual cause. Revert TRIAL_FALLBACK_REASONS and this test fails.
test('a product-scope refusal from activate falls back to trial, not BLOCKED', async () => {
  const gate = gateWith({
    getAppliedLicense: async () => ({ ok: true, appliedLicenseKey: 'VT-TWEAKS-KEY' }),
    getChallenge: async () => ({ nonce: 'nonce-1' }),
    activateLicense: async () => ({ ok: false, reason: 'product_not_allowed_for_license' }),
    verifyTrial: async () => ({ ok: true, valid: true, trial: { status: 'active' } })
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.TRIAL);
  assert.strictEqual(snap.entitled, true);
});

// Same shape, but the scoped read already reports the mismatch, so there is no
// applied key to activate at all. This is the path a Valorant Tweaks customer
// actually takes now that getAppliedLicense sends productId.
test('a scoped-read mismatch falls back to trial without activating', async () => {
  let activateCalls = 0;
  const gate = gateWith({
    getAppliedLicense: async () => ({
      ok: true,
      license: null,
      reason: 'applied_license_product_mismatch'
    }),
    getChallenge: async () => ({ nonce: 'nonce-1' }),
    activateLicense: async () => { activateCalls++; return { ok: true }; },
    verifyTrial: async () => ({ ok: true, valid: true, trial: { status: 'active' } })
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.TRIAL);
  assert.strictEqual(activateCalls, 0, 'nothing to activate when no key is applied');
});

// The other half of the contract: a real denial must NOT be softened into a
// trial. If this ever passes as TRIAL, a revoked license keeps working.
test('a real denial stays BLOCKED and never reaches the trial path', async () => {
  let trialCalls = 0;
  const gate = gateWith({
    getAppliedLicense: async () => ({ ok: true, appliedLicenseKey: 'VA-REVOKED' }),
    getChallenge: async () => ({ nonce: 'nonce-1' }),
    activateLicense: async () => ({ ok: false, reason: 'license_revoked' }),
    verifyTrial: async () => { trialCalls++; return { ok: true, valid: true, trial: {} }; }
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'license_revoked');
  assert.strictEqual(snap.entitled, false);
  assert.strictEqual(trialCalls, 0);
});

// Both spellings are declared, so the set documents the contract even where the
// control flow (scoped read vs activate) decides which one shows up.
test('both product-scope spellings are declared as trial-fallback reasons', () => {
  const { TRIAL_FALLBACK_REASONS } = require('../server/licensing/gate');
  for (const reason of [
    'no_license',
    'no_applied_license',
    'applied_license_unavailable',
    'applied_license_product_mismatch',
    'product_not_allowed_for_license'
  ]) {
    assert.ok(TRIAL_FALLBACK_REASONS.has(reason), `missing fallback reason: ${reason}`);
  }
});

// appVersion is sent to KLD on every activation. It reads package.json, so a
// missing version field would silently report 0.0.0 for every install.
test('appVersion resolves from package.json, not the 0.0.0 fallback', () => {
  const cfg = cfgWith({});
  assert.notStrictEqual(cfg.appVersion, '0.0.0');
  assert.match(cfg.appVersion, /^\d+\.\d+\.\d+/);
  assert.strictEqual(cfg.appVersion, require('../package.json').version);
});
