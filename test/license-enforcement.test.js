const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const ScoreWSServer = require('../server/transport/ws-server');
const { createLicensing } = require('../server/licensing');
const { DEFAULTS } = require('../server/licensing/config');

// --- WS upgrade gate -------------------------------------------------------
//
// The score feed is the paid feature. Two things guard the upgrade: the share
// pin, and entitlement. The entitlement half used to read
// `if (this.isEntitled && !this.isEntitled())`, so constructing the transport
// without a gate meant every pin-holder got the stream.

function startWs(opts) {
  const httpServer = http.createServer((req, res) => res.end('ok'));
  const ws = new ScoreWSServer(httpServer, opts);
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      resolve({
        token: ws.getToken(),
        port: httpServer.address().port,
        close: () => new Promise((r) => httpServer.close(r))
      });
    });
  });
}

// Resolves 'open' on a successful handshake, or the HTTP status of the refusal.
function tryUpgrade(port, token) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
    const timer = setTimeout(() => reject(new Error('upgrade timed out')), 4000);
    client.on('open', () => {
      clearTimeout(timer);
      client.close();
      resolve('open');
    });
    client.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      res.destroy();
      resolve(res.statusCode);
    });
    client.on('error', () => {});
  });
}

test('an omitted entitlement gate fails closed, not open', async () => {
  const s = await startWs({});
  try {
    assert.strictEqual(await tryUpgrade(s.port, s.token), 402);
  } finally {
    await s.close();
  }
});

// A destructuring default only fires on undefined. `{ isEntitled: null }` — a
// forgotten ternary at the call site, which is exactly what server/index.js used
// to pass — would slip past it and then throw TypeError inside the upgrade
// handler. An uncaught throw in an 'upgrade' listener kills the process, so the
// gate has to coerce rather than merely default. Fail closed AND stay up.
for (const [label, gate] of [
  ['null', null],
  ['false', false],
  ['a string', 'yes'],
  ['a number', 1],
  ['an object', {}]
]) {
  test(`an entitlement gate that is ${label} refuses instead of throwing`, async () => {
    const s = await startWs({ isEntitled: gate });
    try {
      assert.strictEqual(await tryUpgrade(s.port, s.token), 402);
    } finally {
      await s.close();
    }
  });
}

test('an unentitled gate refuses the upgrade even with a valid pin', async () => {
  const s = await startWs({ isEntitled: () => false });
  try {
    assert.strictEqual(await tryUpgrade(s.port, s.token), 402);
  } finally {
    await s.close();
  }
});

test('an entitled gate still lets a valid pin through', async () => {
  const s = await startWs({ isEntitled: () => true });
  try {
    assert.strictEqual(await tryUpgrade(s.port, s.token), 'open');
  } finally {
    await s.close();
  }
});

test('entitlement is re-read per upgrade, not captured at construction', async () => {
  let entitled = false;
  const s = await startWs({ isEntitled: () => entitled });
  try {
    assert.strictEqual(await tryUpgrade(s.port, s.token), 402, 'before');
    entitled = true;
    assert.strictEqual(await tryUpgrade(s.port, s.token), 'open', 'after');
  } finally {
    await s.close();
  }
});

test('a wrong pin is 401 regardless of entitlement', async () => {
  const s = await startWs({ isEntitled: () => true });
  try {
    assert.strictEqual(await tryUpgrade(s.port, 'WRONG1'), 401);
  } finally {
    await s.close();
  }
});

// --- createLicensing must not be switchable off from disk -------------------
//
// config.json ships in plaintext beside the .exe, so the end user can write it.
// createLicensing used to return null when the keylicense block was absent, and
// server/index.js answered null by calling poller.start() unconditionally: three
// deleted lines turned the paid app into a free one. Nothing needs to be
// invented to remove that path — DEFAULTS already carries a working baseUrl and
// productId, so a missing block yields a normal gate.
//
// There is no separate test for the deleted `else { poller.start() }` branch:
// with licensing never null, that branch is unreachable by construction. These
// tests are what makes it unreachable, which is why they are the regression.

const rootDir = path.join(__dirname, '..');

// Licensing's constructor builds a LicenseStore and a device id under %APPDATA%.
// Redirect it at a temp dir so a test run never reads or writes the real
// %APPDATA%\ValorantAlert\session.json of whoever is running the suite.
function withTempAppData(fn) {
  const prev = process.env.APPDATA;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-lic-'));
  process.env.APPDATA = tmp;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

for (const [label, rawConfig] of [
  ['block absent', { port: 3000 }],
  ['block null', { keylicense: null }],
  ['block false', { keylicense: false }],
  ['whole config absent', null],
  ['block is a string', { keylicense: 'off' }]
]) {
  test(`createLicensing still gates when the keylicense ${label}`, () => {
    withTempAppData(() => {
      const licensing = createLicensing({ rawConfig, rootDir });

      assert.ok(licensing, 'a gate must exist however config.json is written');
      assert.strictEqual(licensing.entitled, false, 'and it must start unentitled');
      assert.strictEqual(licensing.cfg.baseUrl, DEFAULTS.baseUrl);
      assert.strictEqual(licensing.cfg.productId, DEFAULTS.productId);
      assert.strictEqual(typeof licensing.gate.check, 'function');
      licensing.stop();
    });
  });
}

test('a keylicense block that IS present is still honoured', () => {
  withTempAppData(() => {
    const licensing = createLicensing({
      rawConfig: { keylicense: { productId: 'valorant-alert', loopbackPort: 9123 } },
      rootDir
    });

    assert.strictEqual(licensing.cfg.productId, 'valorant-alert');
    assert.strictEqual(licensing.cfg.redirectUri, 'http://127.0.0.1:9123/oauth/callback/');
    licensing.stop();
  });
});
