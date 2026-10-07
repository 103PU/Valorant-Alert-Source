const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { getDeviceId } = require('../server/licensing/device-id');
const { resolveLicenseConfig } = require('../server/licensing/config');
const { LicenseGate, STATE } = require('../server/licensing/gate');
const { isPlanAllowed } = require('../server/licensing/policy');
const { Licensing } = require('../server/licensing');
const { checkDownloadResolver } = require('../server/licensing/app-version');

const rootDir = path.join(__dirname, '..');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'valert-test-'));
}

test('device-id: generates a 64-char lowercase hex SHA-256 hash and caches it', () => {
  const tmpDir = createTempDir();
  try {
    const id1 = getDeviceId(tmpDir);
    assert.strictEqual(typeof id1, 'string');
    assert.strictEqual(id1.length, 64);
    assert.match(id1, /^[a-f0-9]{64}$/);

    const cachedFile = path.join(tmpDir, 'device-id');
    assert.ok(fs.existsSync(cachedFile));
    assert.strictEqual(fs.readFileSync(cachedFile, 'utf8').trim(), id1);

    // Second call reads cache
    const id2 = getDeviceId(tmpDir);
    assert.strictEqual(id1, id2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('policy: valorant-alert plan is allowed and unlocks 100% features', () => {
  assert.strictEqual(isPlanAllowed('valorant-alert'), true);
  assert.strictEqual(isPlanAllowed('Valorant-Alert'), true);
  assert.strictEqual(isPlanAllowed('single'), true);
  assert.strictEqual(isPlanAllowed('lifetime'), true);
  assert.strictEqual(isPlanAllowed(null), true);
  assert.strictEqual(isPlanAllowed(''), true);
});

test('gate: verify-public with active key transitions to LICENSED', async () => {
  let verifyArgs = null;
  const fakeStore = {
    key: 'VA-TEST-KEY',
    entitlements: [],
    getLicenseKey() { return this.key; },
    setLicenseKey(k) { this.key = k; },
    isLoggedIn() { return false; },
    recordEntitlement(ent) { this.entitlements.push(ent); },
    publicSnapshot() { return { user: null, license: { key: this.key }, trial: null, lastVerifiedAt: null }; },
    offlineDaysElapsed() { return 0; }
  };

  const fakeKld = {
    verifyPublic: async (args) => {
      verifyArgs = args;
      return {
        valid: true,
        status: 'active',
        plan: 'valorant-alert',
        expiresAt: null,
        maxDevices: 1,
        deviceCount: 1
      };
    }
  };

  const gate = new LicenseGate({
    cfg: resolveLicenseConfig({}, rootDir),
    kld: fakeKld,
    store: fakeStore,
    deviceId: 'test-device-id-64char',
    deviceName: 'PC-TEST'
  });

  const snap = await gate.check();
  assert.ok(verifyArgs);
  assert.strictEqual(verifyArgs.licenseKey, 'VA-TEST-KEY');
  assert.strictEqual(verifyArgs.deviceId, 'test-device-id-64char');
  assert.strictEqual(verifyArgs.productId, 'valorant-alert');
  assert.strictEqual(snap.state, STATE.LICENSED);
  assert.strictEqual(snap.entitled, true);
});

test('gate: verify-public with outdated version transitions to BLOCKED with reason app_outdated', async () => {
  const fakeStore = {
    key: 'VA-OLD-KEY',
    getLicenseKey() { return this.key; },
    isLoggedIn() { return false; },
    publicSnapshot() { return { user: null, license: null, trial: null, lastVerifiedAt: null }; },
    offlineDaysElapsed() { return 0; }
  };

  const fakeKld = {
    verifyPublic: async () => ({
      valid: false,
      status: 'outdated',
      plan: 'valorant-alert'
    })
  };

  const gate = new LicenseGate({
    cfg: resolveLicenseConfig({}, rootDir),
    kld: fakeKld,
    store: fakeStore,
    deviceId: 'test-dev',
    deviceName: 'PC-TEST'
  });

  const snap = await gate.check();
  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'app_outdated');
  assert.strictEqual(snap.entitled, false);
});

test('gate: verify-public with banned device transitions to BLOCKED with reason device_banned', async () => {
  const fakeStore = {
    key: 'VA-BANNED-KEY',
    getLicenseKey() { return this.key; },
    isLoggedIn() { return false; },
    publicSnapshot() { return { user: null, license: null, trial: null, lastVerifiedAt: null }; },
    offlineDaysElapsed() { return 0; }
  };

  const fakeKld = {
    verifyPublic: async () => ({
      valid: false,
      status: 'banned',
      plan: 'valorant-alert'
    })
  };

  const gate = new LicenseGate({
    cfg: resolveLicenseConfig({}, rootDir),
    kld: fakeKld,
    store: fakeStore,
    deviceId: 'test-dev',
    deviceName: 'PC-TEST'
  });

  const snap = await gate.check();
  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'device_banned');
  assert.strictEqual(snap.entitled, false);
});

test('licensing: applyKey performs challenge-response activation and unlocks app', async () => {
  let challengeCalled = false;
  let activateArgs = null;

  const fakeKld = {
    getChallengePublic: async (productId) => {
      challengeCalled = true;
      assert.strictEqual(productId, 'valorant-alert');
      return { nonce: 'nonce-uuid-1234', expiresAt: Date.now() + 300000 };
    },
    activatePublic: async (args) => {
      activateArgs = args;
      return {
        success: true,
        status: 'active',
        plan: 'valorant-alert',
        message: 'Kích hoạt thành công!'
      };
    },
    verifyPublic: async () => ({
      valid: true,
      status: 'active',
      plan: 'valorant-alert'
    })
  };

  const testFolderName = 'ValAlertTest_' + Date.now();
  const licensing = new Licensing({
    rawConfig: { keylicense: { productId: 'valorant-alert', appDataFolderName: testFolderName } },
    rootDir
  });

  try {
    // Inject fake KldClient
    licensing.kld = fakeKld;
    licensing.gate.kld = fakeKld;

    const result = await licensing.applyKey('VA-NEW-1234-5678');
    assert.strictEqual(challengeCalled, true);
    assert.ok(activateArgs);
    assert.strictEqual(activateArgs.licenseKey, 'VA-NEW-1234-5678');
    assert.strictEqual(activateArgs.nonce, 'nonce-uuid-1234');
    assert.strictEqual(activateArgs.productId, 'valorant-alert');
    assert.strictEqual(licensing.store.getLicenseKey(), 'VA-NEW-1234-5678');
    assert.strictEqual(result.state, STATE.LICENSED);
    assert.strictEqual(result.entitled, true);
  } finally {
    try {
      fs.rmSync(licensing.cfg.appDataDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

test('app-version: checkDownloadResolver parses recommended and portable downloads', async () => {
  const cfg = resolveLicenseConfig({}, rootDir);
  const client = {
    getDownloadInfo: async (productId) => {
      assert.strictEqual(productId, 'valorant-alert');
      return {
        version: '1.0.5',
        releasePageUrl: 'https://github.com/103PU/Valorant-Alert-Release/releases/tag/v1.0.5',
        recommended: {
          kind: 'installer',
          fileName: 'ValorantAlert-Setup.exe',
          url: 'https://github.com/103PU/Valorant-Alert-Release/releases/download/v1.0.5/ValorantAlert-Setup.exe',
          sizeBytes: 85000000
        },
        portable: {
          kind: 'portable',
          fileName: 'ValorantAlert-v1.0.5-win-x64.zip',
          url: 'https://github.com/103PU/Valorant-Alert-Release/releases/download/v1.0.5/ValorantAlert-v1.0.5-win-x64.zip',
          sizeBytes: 78000000
        }
      };
    }
  };

  const res = await checkDownloadResolver(cfg, client);
  assert.strictEqual(res.source, 'kld_download');
  assert.strictEqual(res.latestVersion, '1.0.5');
  assert.strictEqual(res.recommended.fileName, 'ValorantAlert-Setup.exe');
  assert.strictEqual(res.portable.fileName, 'ValorantAlert-v1.0.5-win-x64.zip');
});

test('policy: supports dynamic plans and multi-product wildcard matching', () => {
  const { isProductAllowed } = require('../server/licensing/policy');
  assert.strictEqual(isPlanAllowed('starter'), true);
  assert.strictEqual(isPlanAllowed('standard'), true);
  assert.strictEqual(isPlanAllowed('premium'), true);
  assert.strictEqual(isPlanAllowed('alert-pro'), true);
  assert.strictEqual(isPlanAllowed('monthly'), true);

  assert.strictEqual(isProductAllowed('valorant-alert', 'valorant-alert'), true);
  assert.strictEqual(isProductAllowed('*', 'valorant-alert'), true);
  assert.strictEqual(isProductAllowed('all', 'valorant-alert'), true);
  assert.strictEqual(isProductAllowed('valorant-tweaks,valorant-alert', 'valorant-alert'), true);
  assert.strictEqual(isProductAllowed('valorant-tweaks', 'valorant-alert'), false);
});

test('licensing: applyKey with logged in user claims, applies, and activates with JWT', async () => {
  let claimCalled = false;
  let applyCalled = false;
  let authActivateCalled = false;

  const fakeKld = {
    claimLicense: async (jwt, key) => { claimCalled = true; },
    applyLicense: async (jwt, key) => { applyCalled = true; },
    getChallenge: async (jwt) => ({ nonce: 'jwt-nonce-5678' }),
    activateLicense: async (jwt, args) => {
      authActivateCalled = true;
      assert.strictEqual(args.nonce, 'jwt-nonce-5678');
      return { ok: true, valid: true, status: 'active', plan: 'dynamic-tier' };
    },
    verifyPublic: async () => ({
      valid: true,
      status: 'active',
      plan: 'dynamic-tier'
    })
  };

  const testFolderName = 'ValAlertAuth_' + Date.now();
  const licensing = new Licensing({
    rawConfig: { keylicense: { productId: 'valorant-alert', appDataFolderName: testFolderName } },
    rootDir
  });

  try {
    licensing.kld = fakeKld;
    licensing.gate.kld = fakeKld;
    licensing.store.setSession('test-jwt-token', { id: 'u1', email: 'user@test.com' });

    const result = await licensing.applyKey('VA-AUTH-KEY-999');
    assert.strictEqual(claimCalled, true);
    assert.strictEqual(applyCalled, true);
    assert.strictEqual(authActivateCalled, true);
    assert.strictEqual(result.state, STATE.LICENSED);
    assert.strictEqual(result.entitled, true);
  } finally {
    try {
      fs.rmSync(licensing.cfg.appDataDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

test('gate: verify-public with device_not_activated performs auto-activation instead of clearing key', async () => {
  let activated = false;
  const fakeStore = {
    key: 'VA-VALID-UNACTIVATED',
    getLicenseKey() { return this.key; },
    setLicenseKey(k) { this.key = k; },
    isLoggedIn() { return false; },
    recordEntitlement(ent) { this.ent = ent; },
    publicSnapshot() { return { user: null, license: { key: this.key, plan: 'custom' }, trial: null, lastVerifiedAt: null }; },
    offlineDaysElapsed() { return 0; }
  };

  const fakeKld = {
    verifyPublic: async () => {
      if (!activated) {
        return { ok: true, valid: false, status: 'inactive', reason: 'device_not_activated', plan: 'custom' };
      }
      return { ok: true, valid: true, status: 'active', plan: 'custom' };
    },
    getChallengePublic: async () => ({ nonce: 'nonce-auto-act' }),
    activatePublic: async () => {
      activated = true;
      return { ok: true, status: 'active', plan: 'custom' };
    }
  };

  const gate = new LicenseGate({
    cfg: resolveLicenseConfig({}, rootDir),
    kld: fakeKld,
    store: fakeStore,
    deviceId: 'test-device-id',
    deviceName: 'PC-TEST'
  });

  const snap = await gate.check();
  assert.strictEqual(activated, true);
  assert.strictEqual(fakeStore.key, 'VA-VALID-UNACTIVATED');
  assert.strictEqual(snap.state, STATE.LICENSED);
  assert.strictEqual(snap.entitled, true);
});

test('policy: canonical services and default plan grants match KLD migrations 0042 & 0047', () => {
  const { CANONICAL_SERVICES, DEFAULT_PLAN_GRANTS, normalizePlanKey, getServicesForPlan, isServiceEntitledForPlan } = require('../server/licensing/policy');

  assert.deepStrictEqual(CANONICAL_SERVICES, [
    'score_hud',
    'cloud_relay',
    'sound_engine',
    'match_analytics',
    'riot_poller',
    'desktop_dashboard'
  ]);

  assert.deepStrictEqual(DEFAULT_PLAN_GRANTS.trial, ['score_hud', 'riot_poller']);
  assert.deepStrictEqual(DEFAULT_PLAN_GRANTS.plus, ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard']);
  assert.deepStrictEqual(DEFAULT_PLAN_GRANTS.pro, ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard', 'match_analytics']);
  assert.deepStrictEqual(DEFAULT_PLAN_GRANTS.ultra, ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard', 'match_analytics', 'cloud_relay']);

  assert.strictEqual(normalizePlanKey('plan-valorant-alert-trial'), 'trial');
  assert.strictEqual(normalizePlanKey('valorant-alert:ultra'), 'ultra');
  assert.strictEqual(normalizePlanKey('pro'), 'pro');
  assert.strictEqual(normalizePlanKey('*'), 'ultra');

  assert.strictEqual(isServiceEntitledForPlan('cloud_relay', 'trial'), false);
  assert.strictEqual(isServiceEntitledForPlan('cloud_relay', 'plus'), false);
  assert.strictEqual(isServiceEntitledForPlan('cloud_relay', 'pro'), false);
  assert.strictEqual(isServiceEntitledForPlan('cloud_relay', 'ultra'), true);
  assert.strictEqual(isServiceEntitledForPlan('sound_engine', 'trial'), false);
  assert.strictEqual(isServiceEntitledForPlan('sound_engine', 'plus'), true);
  assert.strictEqual(isServiceEntitledForPlan('score_hud', 'trial'), true);
});

test('gate: getEntitledServices and isServiceEntitled reflect active plan', async () => {
  const fakeStore = {
    plan: 'plus',
    getLicenseKey() { return 'VA-KEY-PLUS'; },
    isLoggedIn() { return false; },
    recordEntitlement(ent) { this.ent = ent; },
    publicSnapshot() { return { user: null, license: { key: 'VA-KEY-PLUS', plan: this.plan }, trial: null, lastVerifiedAt: null }; },
    offlineDaysElapsed() { return 0; }
  };

  const fakeKld = {
    verifyPublic: async () => ({
      ok: true,
      valid: true,
      status: 'active',
      plan: fakeStore.plan
    })
  };

  const gate = new LicenseGate({
    cfg: resolveLicenseConfig({}, rootDir),
    kld: fakeKld,
    store: fakeStore,
    deviceId: 'test-device-id',
    deviceName: 'PC-TEST'
  });

  const snap = await gate.check();
  assert.strictEqual(snap.entitled, true);
  assert.strictEqual(snap.plan, 'plus');
  assert.deepStrictEqual(snap.services, ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard']);
  assert.strictEqual(gate.isServiceEntitled('score_hud'), true);
  assert.strictEqual(gate.isServiceEntitled('sound_engine'), true);
  assert.strictEqual(gate.isServiceEntitled('cloud_relay'), false);

  // Switch to ultra
  fakeStore.plan = 'ultra';
  await gate.check();
  assert.strictEqual(gate.isServiceEntitled('cloud_relay'), true);

  // When blocked / unentitled, all services false
  gate.set(STATE.BLOCKED);
  assert.strictEqual(gate.isServiceEntitled('score_hud'), false);
  assert.strictEqual(gate.isServiceEntitled('cloud_relay'), false);
  assert.deepStrictEqual(gate.getEntitledServices(), []);
});

