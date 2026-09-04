const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { resolveLicenseConfig } = require('../server/licensing/config');
const {
  readEchoedProductId,
  compareVersions,
  normalizeVersion,
  decide,
  checkForUpdate
} = require('../server/licensing/app-version');

const rootDir = path.join(__dirname, '..');

function cfgWith(appVersion = '1.0.0') {
  const cfg = resolveLicenseConfig({}, rootDir);
  cfg.appVersion = appVersion;
  return cfg;
}

// A KldClient double. The real one performs a network fetch in its constructor's
// request path; these tests must never leave the process.
function fakeClient(handler) {
  return { request: async (endpointPath) => handler(endpointPath) };
}

function refusingClient(code = 'boom') {
  return fakeClient(async () => {
    throw Object.assign(new Error(code), { code });
  });
}

// Swaps global fetch for the duration of one call. Restores even on throw, so a
// failing assertion cannot leak a stub into the next test.
async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function githubOk(body) {
  return async () => ({ ok: true, status: 200, json: async () => body });
}

function githubDown() {
  return async () => ({ ok: false, status: 404, json: async () => ({}) });
}

// --- version comparison ------------------------------------------------------

test('compareVersions matches ValorantTweaks ordering', () => {
  assert.strictEqual(compareVersions('1.0.0', '1.0.1'), -1);
  assert.strictEqual(compareVersions('1.0.1', '1.0.0'), 1);
  assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
  // Leading v is stripped, so a git tag compares equal to a bare version.
  assert.strictEqual(compareVersions('v1.2.3', '1.2.3'), 0);
  // Missing trailing parts are zero, not "smaller by absence".
  assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
  // '-' is a separator like '.', which is how 3.4.4-beta.1 sorts above 3.4.4.
  assert.strictEqual(compareVersions('3.4.4', '3.4.4-1'), -1);
  // Non-numeric parts read as 0 rather than throwing.
  assert.strictEqual(compareVersions('1.0.junk', '1.0.0'), 0);
  assert.strictEqual(normalizeVersion(''), '0.0.0');
  assert.strictEqual(normalizeVersion(null), '0.0.0');
});

test('decide never reports force and soft at the same time', () => {
  const d = decide('1.0.0', { forceUpdate: true, minimumVersion: '2.0.0', latestVersion: '2.0.0' });
  assert.strictEqual(d.forceUpdateRequired, true);
  assert.strictEqual(d.softUpdateAvailable, false);
});

test('decide ignores forceUpdate when the install already meets the floor', () => {
  // force_update is a flag on the row, not a verdict: it only bites below minimum.
  const d = decide('2.0.0', { forceUpdate: true, minimumVersion: '2.0.0', latestVersion: '2.1.0' });
  assert.strictEqual(d.forceUpdateRequired, false);
  assert.strictEqual(d.softUpdateAvailable, true);
});

// --- the product-scope trust gate -------------------------------------------

test('readEchoedProductId accepts every spelling KLD might use', () => {
  assert.strictEqual(readEchoedProductId({ productId: 'Valorant-Alert' }), 'valorant-alert');
  assert.strictEqual(readEchoedProductId({ product_id: 'valorant-alert' }), 'valorant-alert');
  assert.strictEqual(readEchoedProductId({ product: 'valorant-alert' }), 'valorant-alert');
  assert.strictEqual(readEchoedProductId({ currentVersion: '1.0.0' }), null);
  assert.strictEqual(readEchoedProductId(null), null);
});

// The regression test for the actual production hazard. This payload is the live
// 2026-09-04 response from GET /api/app/version?productId=valorant-alert, which
// is Valorant Tweaks' row because app_version_config has one global row
// (CHECK (id = 1)). With force_update flipped on, an unguarded client would
// compute 1.0.0 < 3.4.4 and lock every Valorant Alert install out of the app.
test('an unscoped KLD row cannot force-update this product', async () => {
  const cfg = cfgWith('1.0.0');
  const client = fakeClient(async () => ({
    ok: true,
    version: {
      current_version: '3.4.4',
      currentVersion: '3.4.4',
      minimum_version: '3.4.4',
      minimumVersion: '3.4.4',
      force_update: true,
      forceUpdate: true,
      release_notes: 'Release highlights'
    }
  }));

  const result = await withFetch(githubDown(), () => checkForUpdate(cfg, client));

  assert.strictEqual(result.forceUpdateRequired, false);
  assert.strictEqual(result.softUpdateAvailable, false);
  assert.strictEqual(result.latestVersion, '1.0.0');
  assert.strictEqual(result.source, 'none');
  assert.ok(result.warnings.includes('kld_not_product_scoped'));
});

test('a KLD row scoped to another product is refused, not merged', async () => {
  const cfg = cfgWith('1.0.0');
  const client = fakeClient(async () => ({
    ok: true,
    version: { productId: 'valorant-tweaks', currentVersion: '3.4.4', forceUpdate: true }
  }));

  const result = await withFetch(githubDown(), () => checkForUpdate(cfg, client));

  assert.strictEqual(result.forceUpdateRequired, false);
  assert.ok(result.warnings.includes('kld_product_mismatch'));
});

test('a product-scoped KLD row is trusted, force included', async () => {
  const cfg = cfgWith('1.0.0');
  const client = fakeClient(async (endpointPath) => {
    // The scope must actually be on the wire, not just honoured in the response.
    assert.ok(endpointPath.includes('productId=valorant-alert'), endpointPath);
    return {
      ok: true,
      version: {
        productId: 'valorant-alert',
        currentVersion: '1.2.0',
        minimumVersion: '1.1.0',
        forceUpdate: true,
        releaseNotes: 'ban dau'
      }
    };
  });

  const result = await checkForUpdate(cfg, client);

  assert.strictEqual(result.source, 'kld');
  assert.strictEqual(result.latestVersion, '1.2.0');
  assert.strictEqual(result.forceUpdateRequired, true);
  assert.strictEqual(result.softUpdateAvailable, false);
  assert.deepStrictEqual(result.warnings, []);
});

test('an empty minimum_version does not become a 0.0.0 floor', async () => {
  const cfg = cfgWith('1.0.0');
  const client = fakeClient(async () => ({
    ok: true,
    version: {
      productId: 'valorant-alert',
      currentVersion: '1.0.0',
      minimum_version: '   ',
      force_update: true
    }
  }));

  const result = await checkForUpdate(cfg, client);

  assert.strictEqual(result.minimumVersion, '1.0.0');
  assert.strictEqual(result.forceUpdateRequired, false);
});

// --- GitHub fallback ---------------------------------------------------------

test('GitHub fallback can nag but never lock', async () => {
  const cfg = cfgWith('1.0.0');
  const result = await withFetch(
    githubOk({ tag_name: 'v9.9.9', body: 'notes', html_url: 'https://example.invalid/r' }),
    () => checkForUpdate(cfg, refusingClient('kld_down'))
  );

  assert.strictEqual(result.source, 'github');
  assert.strictEqual(result.latestVersion, '9.9.9');
  assert.strictEqual(result.softUpdateAvailable, true);
  // Even nine major versions behind, GitHub alone must not hard-lock the app.
  assert.strictEqual(result.forceUpdate, false);
  assert.strictEqual(result.forceUpdateRequired, false);
  assert.ok(result.warnings.includes('kld_down'));
});

test('the check reads the -release repo, not the source repo', async () => {
  const cfg = cfgWith('1.0.0');
  let seen = null;
  await withFetch(
    async (target) => {
      seen = target;
      return { ok: true, status: 200, json: async () => ({ tag_name: 'v1.0.0' }) };
    },
    () => checkForUpdate(cfg, refusingClient())
  );

  assert.strictEqual(
    seen,
    'https://api.github.com/repos/103PU/Valorant-Alert-Release/releases/latest'
  );
});

test('config.json cannot repoint the update source', () => {
  // releaseRepo is a code constant. caxa compresses it into the .exe, so a user
  // editing config.json cannot redirect where updates are looked up.
  const cfg = resolveLicenseConfig(
    { keylicense: { releaseRepo: '103PU/attacker-controlled' } },
    rootDir
  );
  assert.strictEqual(cfg.releaseRepo, '103PU/Valorant-Alert-Release');
});

// --- fail-open ---------------------------------------------------------------

test('both sources failing yields no update, not a forced one', async () => {
  const cfg = cfgWith('1.0.0');
  const result = await withFetch(githubDown(), () => checkForUpdate(cfg, refusingClient('kld_down')));

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.source, 'none');
  assert.strictEqual(result.forceUpdateRequired, false);
  assert.strictEqual(result.softUpdateAvailable, false);
  assert.deepStrictEqual(result.warnings, ['kld_down', 'github_http_404']);
});

// --- the dashboard is the only consumer -------------------------------------

// An update check nothing renders is the same as no update check. This module
// shipped before the banner did, so the endpoint sat with zero callers; these
// pin the wiring rather than the pixels.
const dashboardHtml = require('fs').readFileSync(
  path.join(rootDir, 'public', 'dashboard.html'),
  'utf8'
);

test('the dashboard calls the app-version endpoint, and spells it the way the route does', () => {
  assert.match(dashboardHtml, /licApi\('app-version'\)/, 'nothing renders the update state');

  const route = require('fs').readFileSync(
    path.join(rootDir, 'server', 'routes', 'api-license.js'),
    'utf8'
  );
  // A typo here is silent: the switch falls through to `default` and the banner
  // simply never appears.
  assert.match(route, /case 'app-version':/, 'the route case must match the action the UI requests');
});

test('the dashboard renders the server decision instead of comparing versions itself', () => {
  assert.match(dashboardHtml, /info\.forceUpdateRequired/);
  assert.match(dashboardHtml, /info\.softUpdateAvailable/);
  assert.ok(
    !/compareVersions|parseParts/.test(dashboardHtml),
    'version ordering lives in server/licensing/app-version.js — a second copy would drift'
  );
});

test('a forced update cannot be dismissed', () => {
  // The soft banner offers "để sau"; the forced one must not, or the banner is
  // decoration. Asserted on the source because the branch is unreachable at
  // runtime today — KLD's version row is not product-scoped yet.
  const forced = dashboardHtml.slice(dashboardHtml.indexOf('if (info.forceUpdateRequired)'));
  const softAt = forced.indexOf('} else {');
  assert.ok(softAt > 0, 'the force/soft branches must both exist');

  assert.match(forced.slice(0, softAt), /btnUpdLater\.classList\.add\('lic-hidden'\)/);
  assert.match(forced.slice(softAt), /btnUpdLater\.classList\.remove\('lic-hidden'\)/);
});
