const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleApiLicense } = require('../server/routes/api-license');
const { createLicensing } = require('../server/licensing');

// The two update routes, at the layer where the guards live. Separate from
// update-download.test.js on purpose: that file proves the download and install
// engine is safe, this one proves nothing can reach it from the wrong place or with
// the wrong version. The engine is never actually run here — `updater.start` is
// replaced with a recorder, so no fetch and no process happen in this file at all.

const TOKEN = 'share-pin-not-a-real-one';
const rootDir = path.join(__dirname, '..');
const wsServer = { getToken: () => TOKEN };

function withTempAppData(fn) {
  const prev = process.env.APPDATA;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-upd-route-'));
  process.env.APPDATA = tmp;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const fakeReq = (url, { method = 'GET', remote = '127.0.0.1' } = {}) => ({
  url,
  method,
  socket: { remoteAddress: remote },
  on() {}
});

function fakeRes() {
  const out = { status: 0, body: null };
  out.writeHead = (status) => { out.status = status; };
  out.end = (payload) => { out.body = payload ? JSON.parse(payload) : null; };
  return out;
}

const call = async (licensing, url, opts) => {
  const res = fakeRes();
  await handleApiLicense(fakeReq(url, opts), res, { licensing, wsServer });
  return res;
};

const q = (action) => `/api/license/${action}?token=${encodeURIComponent(TOKEN)}`;

/**
 * A real Licensing facade with two things pinned:
 *  - the update-check cache is primed, so checkAppVersion() answers from memory and
 *    no request to KLD or GitHub is made;
 *  - updater.start is a recorder, so the guards can be tested without a download.
 * Priming the cache rather than stubbing checkAppVersion keeps the real method —
 * including its TTL branch — in the path being tested.
 */
function withLicensing(update, fn) {
  return withTempAppData(async () => {
    const licensing = createLicensing({ rawConfig: {}, rootDir });
    licensing.updateCache = { at: Date.now(), result: update };
    const started = [];
    licensing.updater.start = async (version) => {
      started.push(version);
      return { stage: 'downloading', version, percent: 0, busy: true, error: null };
    };
    try {
      return await fn(licensing, started);
    } finally {
      licensing.stop();
    }
  });
}

const AVAILABLE = Object.freeze({
  ok: true,
  appVersion: '1.0.0',
  source: 'github',
  latestVersion: '1.4.0',
  minimumVersion: '1.4.0',
  forceUpdate: false,
  forceUpdateRequired: false,
  softUpdateAvailable: true,
  releaseNotes: '',
  releasePageUrl: 'https://github.com/103PU/Valorant-Alert-Release/releases/latest',
  warnings: []
});

// What a check that could reach nobody returns. It fails open on purpose, so the
// shape "no update" and the shape "could not tell" are identical here by design.
const NOTHING = Object.freeze({
  ...AVAILABLE, source: 'none', latestVersion: '1.0.0', minimumVersion: '1.0.0', softUpdateAvailable: false
});

// --- update/start: the guards ------------------------------------------------

test('update/start is refused over GET — it starts work', async () => {
  await withLicensing(AVAILABLE, async (licensing, started) => {
    const res = await call(licensing, q('update/start'));
    assert.equal(res.status, 405);
    assert.equal(res.body.error, 'method_not_allowed');
    assert.deepEqual(started, [], 'a GET started an install');
  });
});

test('update/start is refused from the LAN even with the share pin', async () => {
  await withLicensing(AVAILABLE, async (licensing, started) => {
    // The pin is correct here. It is not enough: this route ends by executing a
    // program on the host, so holding the pin from another device must not be able
    // to trigger it.
    for (const remote of ['192.168.1.50', '::ffff:192.168.1.50', '10.0.0.7', '203.0.113.9']) {
      const res = await call(licensing, q('update/start'), { method: 'POST', remote });
      assert.equal(res.status, 403, remote);
      assert.equal(res.body.error, 'loopback_only', remote);
    }
    assert.deepEqual(started, [], 'a LAN caller started an install');
  });
});

test('every update route requires the share pin', async () => {
  await withLicensing(AVAILABLE, async (licensing, started) => {
    for (const url of ['/api/license/update/start', '/api/license/update/state',
      '/api/license/update/start?token=wrong']) {
      const res = await call(licensing, url, { method: 'POST' });
      assert.equal(res.status, 401, url);
      assert.equal(res.body.error, 'invalid_token', url);
    }
    assert.deepEqual(started, []);
  });
});

test('a loopback POST starts the version the server resolved', async () => {
  await withLicensing(AVAILABLE, async (licensing, started) => {
    for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const res = await call(licensing, q('update/start'), { method: 'POST', remote });
      assert.equal(res.status, 200, remote);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.stage, 'downloading');
      // startUpdate() adds this so the UI has a fallback link while the run is live.
      assert.equal(res.body.releasePageUrl, AVAILABLE.releasePageUrl);
    }
    assert.deepEqual(started, ['1.4.0', '1.4.0', '1.4.0']);
  });
});

test('a version in the request body is not read, let alone used', async () => {
  await withLicensing(AVAILABLE, async (licensing, started) => {
    // The whole reason this route is safe. If it ever grew a body parser, the
    // recorder below would receive 9.9.9 — a caller-chosen path segment on a URL
    // that ends in "run this program".
    const body = Buffer.from(JSON.stringify({ version: '9.9.9', url: 'http://evil/x.zip' }));
    const listened = [];
    const req = {
      url: q('update/start'),
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      on(event, handler) {
        listened.push(event);
        // Deliver it, so a route that does read the body gets a usable value and the
        // test fails on the assertion rather than hanging on an unresolved promise.
        if (event === 'data') process.nextTick(() => handler(body));
        if (event === 'end') process.nextTick(handler);
      }
    };
    const res = fakeRes();
    await handleApiLicense(req, res, { licensing, wsServer });

    assert.equal(res.status, 200);
    assert.deepEqual(started, ['1.4.0'], 'the body chose the version');
    assert.deepEqual(listened, [], `the body was read: subscribed to ${listened.join(', ')}`);
  });
});

// --- update/start: nothing to install ----------------------------------------

test('no available update is a 400 carrying the code, not a started run', async () => {
  await withLicensing(NOTHING, async (licensing, started) => {
    const res = await call(licensing, q('update/start'), { method: 'POST' });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'no_update_available');
    assert.deepEqual(started, [], 'installed a version that is already running');
  });
});

test('a check that reached nobody does not install the running version', async () => {
  // source:'none' is "could not tell", and checkForUpdate reports latestVersion ===
  // appVersion there because it fails open. Reinstalling 1.0.0 over 1.0.0 would kill
  // and restart the app for nothing, which is how a failing check turns into a loop.
  await withLicensing({ ...NOTHING, warnings: ['kld_not_product_scoped', 'github_http_404'] },
    async (licensing, started) => {
      const res = await call(licensing, q('update/start'), { method: 'POST' });
      assert.equal(res.body.error, 'no_update_available');
      assert.deepEqual(started, []);
    });
});

test('a forced update installs even though softUpdateAvailable is false', async () => {
  // decide() sets exactly one of the two flags, so startUpdate() has to accept
  // either. Testing this pins the contract: force is not a subset of soft.
  await withLicensing({
    ...AVAILABLE, forceUpdate: true, forceUpdateRequired: true, softUpdateAvailable: false
  }, async (licensing, started) => {
    const res = await call(licensing, q('update/start'), { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(started, ['1.4.0']);
  });
});

test('the 400 body carries a gate snapshot, which is what keeps the UI from throwing', async () => {
  await withLicensing(NOTHING, async (licensing) => {
    const res = await call(licensing, q('update/start'), { method: 'POST' });
    // licApi() in dashboard.html resolves on a !ok response that still has `state`
    // and lets the caller read data.ok — the install handler depends on that, so an
    // error body without a snapshot would surface as a thrown network-style error.
    assert.equal(typeof res.body.state, 'string');
    assert.equal(res.body.ok, false);
  });
});

// --- update/state -------------------------------------------------------------

test('update/state is a GET and answers before any run has started', async () => {
  await withLicensing(AVAILABLE, async (licensing) => {
    const res = await call(licensing, q('update/state'));
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.stage, 'idle');
    assert.equal(res.body.busy, false);
    assert.equal(res.body.error, null);
  });
});

test('update/state is readable from the LAN — deliberately, unlike update/start', async () => {
  await withLicensing(AVAILABLE, async (licensing) => {
    // The phone UI shows the same banner the dashboard does. This reads a stage name
    // and a byte count and changes nothing, so it is pin-only on purpose; the
    // asymmetry with update/start is the design, not an oversight.
    const res = await call(licensing, q('update/state'), { remote: '192.168.1.50' });
    assert.equal(res.status, 200);
    assert.equal(res.body.stage, 'idle');
  });
});

test('update/state passes a live run through unflattened, error object included', async () => {
  await withLicensing(AVAILABLE, async (licensing) => {
    // Mid-download, then failed. The dashboard renders "[stage/code]" from the nested
    // error and a byte count from the two number fields, so the route flattening or
    // dropping either would leave the banner with nothing to say.
    licensing.updater.state = {
      ...licensing.updater.state,
      stage: 'downloading', version: '1.4.0', percent: 42, bytesReceived: 4096, bytesTotal: 9728
    };
    let res = await call(licensing, q('update/state'));
    assert.equal(res.body.stage, 'downloading');
    assert.equal(res.body.busy, true, 'a run in flight reported as settled');
    assert.equal(res.body.percent, 42);
    assert.equal(res.body.bytesReceived, 4096);

    licensing.updater.state = {
      ...licensing.updater.state,
      stage: 'error',
      error: { stage: 'verify', code: 'checksum_mismatch', message: 'sha256 không khớp.', retryable: true }
    };
    res = await call(licensing, q('update/state'));
    assert.equal(res.body.busy, false, 'error is a settled stage — the UI must offer retry');
    assert.deepEqual(res.body.error,
      { stage: 'verify', code: 'checksum_mismatch', message: 'sha256 không khớp.', retryable: true });
  });
});

test('an unknown update action is a 404, not a fallthrough', async () => {
  await withLicensing(AVAILABLE, async (licensing, started) => {
    for (const action of ['update', 'update/', 'update/install', 'update/start/x']) {
      const res = await call(licensing, q(action), { method: 'POST' });
      assert.equal(res.status, 404, action);
      assert.equal(res.body.error, 'unknown_action', action);
    }
    assert.deepEqual(started, []);
  });
});
