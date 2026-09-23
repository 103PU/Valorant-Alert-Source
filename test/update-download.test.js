const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const { UpdateInstaller, findChecksum } = require('../server/updater');
const { installerZipName, checksumFileName, checksumLine } = require('../scripts/release-naming');

// The updater is the one module in this app that downloads a file and then executes
// a program, so the tests hold two lines that matter more than the happy path:
// nothing is executed unless sha256 matched, and no caller can influence the URL.
//
// Every side effect is injected, so this suite never reaches the network and never
// starts a real installer. The extract stub does create files — the same temp tree it
// removes in test.after — because "did the .cmd actually appear" is what the real
// Expand-Archive check is guarding, and a stub that skipped it would pass vacuously.

const VERSION = '1.2.3';
const REPO = '103PU/Valorant-Alert-Release';
const ASSET = installerZipName(VERSION);
const BASE = `https://github.com/${REPO}/releases/download/v${VERSION}`;

const ZIP = Buffer.concat([Buffer.from('PK'), crypto.randomBytes(4096)]);
const ZIP_SHA = crypto.createHash('sha256').update(ZIP).digest('hex');

const tempRoots = [];
test.after(() => {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true });
});

// --- doubles -----------------------------------------------------------------

const okStream = (buf, { withLength = true, chunks = 2 } = {}) => ({
  ok: true,
  status: 200,
  headers: {
    get: (k) => (k.toLowerCase() === 'content-length' && withLength ? String(buf.length) : null)
  },
  // Split so percent has something to move through; a Node Readable is accepted
  // alongside a web stream precisely so a test can do this without undici.
  body: Readable.from(
    chunks === 1 ? [buf] : [buf.subarray(0, 1024), buf.subarray(1024)]
  )
});

const okText = (text) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => text });
const httpErr = (status) => ({ ok: false, status, headers: { get: () => null } });

/** Routes by substring so a test states the URL it expects, not a whole map. */
function stubFetch(routes) {
  const impl = async (url) => {
    impl.calls.push(String(url));
    for (const [needle, make] of routes) {
      if (String(url).includes(needle)) return make();
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  impl.calls = [];
  return impl;
}

const goodRoutes = () => [
  [ASSET, () => okStream(ZIP)],
  [checksumFileName(), () => okText(`${checksumLine(ZIP_SHA, ASSET)}\n`)]
];

function stubSpawn({ extractExit = 0, createCmd = true } = {}) {
  const impl = (file, args, opts) => {
    impl.calls.push({ file, args, opts });
    const child = new EventEmitter();
    child.unref = () => { child.unrefed = true; };
    if (file === 'powershell.exe') {
      // Stands in for Expand-Archive, and reads the destination from the same
      // environment variable the real command reads — so this also proves the paths
      // travel as env vars rather than being interpolated into -Command.
      const out = opts && opts.env && opts.env.VA_UPDATE_OUT;
      if (extractExit === 0 && out) {
        fs.mkdirSync(out, { recursive: true });
        if (createCmd) fs.writeFileSync(path.join(out, 'Install-ValorantAlert.cmd'), '@echo off\r\n');
      }
      setImmediate(() => child.emit('exit', extractExit));
    }
    // The launch child deliberately never exits: launch() must not wait for it.
    return child;
  };
  impl.calls = [];
  return impl;
}

function makeInstaller(fetchImpl, spawnImpl) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'va-upd-'));
  tempRoots.push(root);
  const workDir = path.join(root, 'update');
  const inst = new UpdateInstaller({
    cfg: { releaseRepo: REPO, appDataDir: root },
    fetchImpl,
    spawnImpl,
    workDir
  });
  return { inst, workDir };
}

/** Runs to a settled stage. Polling beats a callback: state is what the UI reads. */
async function settle(inst) {
  for (let i = 0; i < 600; i += 1) {
    if (!inst.snapshot().busy) return inst.snapshot();
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`never settled, stuck at ${inst.snapshot().stage}`);
}

// --- SHA256SUMS.txt parsing ---------------------------------------------------

test('findChecksum matches the release line, whatever shape sha256sum wrote it in', () => {
  const hex = 'a'.repeat(64);
  assert.equal(findChecksum(`${hex}  ${ASSET}`, ASSET), hex);
  assert.equal(findChecksum(`${hex} *${ASSET}`, ASSET), hex, 'binary-mode star');
  assert.equal(findChecksum(`${hex}  ./dist/${ASSET}`, ASSET), hex, 'path-prefixed');
  assert.equal(findChecksum(`${hex.toUpperCase()}  ${ASSET}`, ASSET), hex, 'lowercased');
});

test('findChecksum returns null rather than the wrong file’s digest', () => {
  const lines = [
    `${'b'.repeat(64)}  ValorantScoreAlert-v1.2.3-win-x64.zip`,
    `${'c'.repeat(64)}  SomethingElse.zip`
  ].join('\n');
  // The portable zip is in the same file and its name is a prefix-free near-miss;
  // matching it would install the wrong artifact with a "verified" label on it.
  assert.equal(findChecksum(lines, ASSET), null);
});

// --- the version is not caller-controlled ------------------------------------

test('a version that is not strictly x.y.z is refused before any request', async () => {
  const fetchImpl = stubFetch([]);
  const { inst } = makeInstaller(fetchImpl, stubSpawn());
  // '' is in this list because normalizeVersion() defaults it to '0.0.0'. Naming a
  // file 0.0.0 is harmless; fetching and running v0.0.0 is not, so the check has to
  // happen before that default applies.
  for (const bad of ['../../evil', '1.2', '1.2.3-beta', 'latest', '1.2.3/../..', '', null, undefined]) {
    await assert.rejects(() => inst.start(bad), (e) => {
      assert.equal(e.code, 'bad_version');
      assert.equal(e.stage, 'release_lookup');
      return true;
    }, `accepted ${JSON.stringify(bad)}`);
  }
  // A tag-shaped value is accepted, since that is what GitHub reports.
  assert.equal(inst.snapshot().stage, 'idle');
  assert.equal(fetchImpl.calls.length, 0);
});

// --- the happy path -----------------------------------------------------------

test('a verified download ends by spawning the installer with -Launch', async () => {
  const fetchImpl = stubFetch(goodRoutes());
  const spawnImpl = stubSpawn();
  const { inst, workDir } = makeInstaller(fetchImpl, spawnImpl);

  const started = await inst.start(VERSION);
  assert.equal(started.stage, 'downloading');
  assert.equal(started.busy, true);

  const final = await settle(inst);
  assert.equal(final.stage, 'launched', JSON.stringify(final.error));
  assert.equal(final.percent, 100);
  assert.equal(final.bytesReceived, ZIP.length);

  // Both URLs are derived from releaseRepo + release-naming.js. Nothing in the
  // request path came from a caller.
  assert.deepEqual(fetchImpl.calls, [`${BASE}/${ASSET}`, `${BASE}/${checksumFileName()}`]);

  const [extract, launch] = spawnImpl.calls;
  assert.equal(extract.file, 'powershell.exe');
  assert.ok(extract.args.includes('-NoProfile') && extract.args.includes('-NonInteractive'));
  const command = extract.args[extract.args.length - 1];
  assert.match(command, /Expand-Archive -LiteralPath \$env:VA_UPDATE_ZIP/);
  // The paths must not appear in the command string at all — that is the whole
  // point of routing them through the environment.
  assert.ok(!command.includes(workDir), 'a path was interpolated into -Command');

  assert.equal(launch.file, 'cmd.exe');
  assert.deepEqual(launch.args, ['/c', path.join(workDir, 'payload', 'Install-ValorantAlert.cmd'), '-Launch']);
  assert.equal(launch.opts.detached, true, 'the installer is about to kill this process');
  assert.equal(launch.opts.stdio, 'ignore');
  assert.equal(launch.opts.windowsHide, false, 'the installer window is the progress UI');
});

test('progress reports real bytes, and percent stays under 100 until the install is done', async () => {
  const seen = [];
  // Paced body: a 4 KB in-memory stream would otherwise finish before the first
  // poll and the test would be asserting on an empty sample.
  const paced = () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(ZIP.length) : null) },
    body: Readable.from((async function* stream() {
      for (let at = 0; at < ZIP.length; at += 1024) {
        await new Promise((r) => setTimeout(r, 8));
        yield ZIP.subarray(at, at + 1024);
      }
    })())
  });
  const fetchImpl = stubFetch([
    [ASSET, paced],
    [checksumFileName(), () => okText(`${checksumLine(ZIP_SHA, ASSET)}\n`)]
  ]);
  const { inst } = makeInstaller(fetchImpl, stubSpawn());
  await inst.start(VERSION);
  while (inst.snapshot().busy) {
    seen.push({ ...inst.snapshot() });
    await new Promise((r) => setTimeout(r, 2));
  }
  const downloads = seen.filter((s) => s.stage === 'downloading');
  assert.ok(downloads.length > 0, 'never observed the downloading stage');
  assert.ok(downloads.every((s) => s.percent <= 99), 'percent hit 100 mid-download');
  assert.ok(downloads.some((s) => s.bytesReceived > 0 && s.bytesReceived < ZIP.length));
  assert.equal(inst.snapshot().stage, 'launched');
});

// --- nothing runs unless sha256 matched --------------------------------------

test('a checksum mismatch executes nothing and deletes the zip', async () => {
  const fetchImpl = stubFetch([
    [ASSET, () => okStream(ZIP)],
    [checksumFileName(), () => okText(`${checksumLine('d'.repeat(64), ASSET)}\n`)]
  ]);
  const spawnImpl = stubSpawn();
  const { inst, workDir } = makeInstaller(fetchImpl, spawnImpl);

  await inst.start(VERSION);
  const final = await settle(inst);

  assert.equal(final.stage, 'error');
  assert.equal(final.error.stage, 'verify');
  assert.equal(final.error.code, 'checksum_mismatch');
  assert.equal(final.error.retryable, true);
  assert.equal(spawnImpl.calls.length, 0, 'a process was started on an unverified file');
  assert.equal(fs.existsSync(path.join(workDir, ASSET)), false, 'the bad zip was kept on disk');
});

test('an asset missing from SHA256SUMS.txt is a failure, not an unverified install', async () => {
  const fetchImpl = stubFetch([
    [ASSET, () => okStream(ZIP)],
    [checksumFileName(), () => okText(`${'e'.repeat(64)}  some-other-file.zip\n`)]
  ]);
  const spawnImpl = stubSpawn();
  const { inst, workDir } = makeInstaller(fetchImpl, spawnImpl);
  await inst.start(VERSION);
  const final = await settle(inst);
  assert.equal(final.error.code, 'checksum_missing');
  assert.equal(spawnImpl.calls.length, 0);
  assert.equal(fs.existsSync(path.join(workDir, ASSET)), false);
});

test('SHA256SUMS.txt being unreachable fails the run — verification is not optional', async () => {
  const fetchImpl = stubFetch([
    [ASSET, () => okStream(ZIP)],
    [checksumFileName(), () => httpErr(404)]
  ]);
  const spawnImpl = stubSpawn();
  const { inst } = makeInstaller(fetchImpl, spawnImpl);
  await inst.start(VERSION);
  const final = await settle(inst);
  assert.equal(final.error.stage, 'verify');
  assert.equal(final.error.code, 'github_http_404');
  assert.equal(spawnImpl.calls.length, 0);
});

// --- the other failures -------------------------------------------------------

test('a missing release asset is a retryable download failure naming the status', async () => {
  const fetchImpl = stubFetch([[ASSET, () => httpErr(404)]]);
  const { inst } = makeInstaller(fetchImpl, stubSpawn());
  await inst.start(VERSION);
  const final = await settle(inst);
  assert.equal(final.error.stage, 'download');
  assert.equal(final.error.code, 'github_http_404');
  assert.equal(final.error.retryable, true);
  assert.equal(fetchImpl.calls.length, 1, 'asked for checksums after the asset 404ed');
});

test('an extraction that produces no installer is a non-retryable extract failure', async () => {
  const fetchImpl = stubFetch(goodRoutes());
  const spawnImpl = stubSpawn({ createCmd: false });
  const { inst } = makeInstaller(fetchImpl, spawnImpl);
  await inst.start(VERSION);
  const final = await settle(inst);
  assert.equal(final.error.stage, 'extract');
  assert.equal(final.error.code, 'installer_missing');
  // Retrying a structurally wrong zip just downloads it again; the UI sends the
  // user to the release page instead.
  assert.equal(final.error.retryable, false);
  assert.equal(spawnImpl.calls.length, 1, 'launched something after a failed extract');
});

test('a non-zero Expand-Archive exit is reported with its exit code', async () => {
  const fetchImpl = stubFetch(goodRoutes());
  const spawnImpl = stubSpawn({ extractExit: 1 });
  const { inst } = makeInstaller(fetchImpl, spawnImpl);
  await inst.start(VERSION);
  const final = await settle(inst);
  assert.equal(final.error.code, 'extract_exit_1');
  assert.equal(spawnImpl.calls.length, 1);
});

test('a second start during a run is refused, not queued', async () => {
  const fetchImpl = stubFetch([
    [ASSET, () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(ZIP.length) },
      body: Readable.from((async function* slow() {
        yield ZIP.subarray(0, 512);
        await new Promise((r) => setTimeout(r, 120));
        yield ZIP.subarray(512);
      })())
    })],
    [checksumFileName(), () => okText(`${checksumLine(ZIP_SHA, ASSET)}\n`)]
  ]);
  const { inst } = makeInstaller(fetchImpl, stubSpawn());
  await inst.start(VERSION);
  await assert.rejects(() => inst.start(VERSION), (e) => {
    assert.equal(e.code, 'update_already_running');
    return true;
  });
  await settle(inst);
});

test('a settled run can be started again, so a failure is recoverable', async () => {
  const fetchImpl = stubFetch([[ASSET, () => httpErr(500)]]);
  const { inst } = makeInstaller(fetchImpl, stubSpawn());
  await inst.start(VERSION);
  assert.equal((await settle(inst)).stage, 'error');
  // Restart clears the previous error rather than reporting it forever.
  const again = await inst.start(VERSION);
  assert.equal(again.stage, 'downloading');
  assert.equal(again.error, null);
  await settle(inst);
});

test('a work dir that is not the update sandbox is refused before any delete', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'va-upd-guard-'));
  tempRoots.push(root);
  const keep = path.join(root, 'keep.txt');
  fs.writeFileSync(keep, 'do not delete me');
  const inst = new UpdateInstaller({
    cfg: { releaseRepo: REPO, appDataDir: root },
    fetchImpl: stubFetch(goodRoutes()),
    spawnImpl: stubSpawn(),
    workDir: root // not named "update" — prepareWorkDir must refuse it
  });
  await inst.start(VERSION);
  const final = await settle(inst);
  assert.equal(final.error.code, 'bad_work_dir');
  assert.equal(fs.existsSync(keep), true, 'the guard did not stop the recursive delete');
});

test('a non-Windows host is refused up front — the installer is a .cmd', async () => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  try {
    const fetchImpl = stubFetch([]);
    const { inst } = makeInstaller(fetchImpl, stubSpawn());
    await assert.rejects(() => inst.start(VERSION), (e) => {
      assert.equal(e.code, 'platform_unsupported');
      return true;
    });
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
});

test('a v-prefixed tag is accepted and normalized — GitHub reports tag_name', async () => {
  const fetchImpl = stubFetch(goodRoutes());
  const { inst } = makeInstaller(fetchImpl, stubSpawn());
  await inst.start(`v${VERSION}`);
  const final = await settle(inst);
  assert.equal(final.stage, 'launched', JSON.stringify(final.error));
  assert.equal(final.version, VERSION, 'the leading v leaked into the version');
  assert.equal(fetchImpl.calls[0], `${BASE}/${ASSET}`);
});
