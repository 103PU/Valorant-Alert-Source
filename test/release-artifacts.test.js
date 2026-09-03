const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  portableZipName,
  installerZipName,
  checksumFileName,
  normalizeVersion,
  checksumLine,
  resolver
} = require('../scripts/release-naming');

const rootDir = path.join(__dirname, '..');
const pkg = require('../package.json');

// KLD resolves the dashboard's download button by scanning GitHub release asset
// names (download-resolver.ts:88-101). The build used to emit a bare
// ValorantScoreAlert.exe, which matches none of its predicates — so the resolver
// returned null and the button dead-ended regardless of how the release was cut.
// These tests are the contract; revert the naming and they fail.
test('the portable archive name is what KLD selects as the portable asset', () => {
  const name = portableZipName(pkg.version);

  assert.ok(resolver.matchesPortable(name), `${name} must match the portable predicate`);
  assert.ok(!resolver.matchesInstaller(name), `${name} must not be taken for the installer`);
  assert.match(name, /^ValorantScoreAlert-v\d+\.\d+\.\d+-win-x64\.zip$/);
});

test('the installer archive name selects the installer, never the portable slot', () => {
  const name = installerZipName(pkg.version);

  assert.ok(resolver.matchesInstaller(name));
  assert.ok(!resolver.matchesPortable(name), 'the installer must not shadow the portable download');
});

test('the checksum file name is matched case-insensitively by the resolver', () => {
  assert.ok(resolver.isChecksums(checksumFileName()));
  assert.ok(resolver.isChecksums('sha256sums.txt'));
  assert.ok(!resolver.isChecksums('SHA256SUMS.txt.asc'), 'the match is exact, not a prefix');
});

// The regression itself, asserted directly so nobody re-introduces it.
test('a bare .exe matches no resolver predicate', () => {
  for (const name of ['ValorantScoreAlert.exe', 'ValorantScoreAlert-v1.0.0.zip', 'release-win32.zip']) {
    assert.ok(!resolver.matchesPortable(name), `${name} must not be mistaken for a valid asset`);
    assert.ok(!resolver.matchesInstaller(name));
  }
});

test('normalizeVersion tolerates a leading v and surrounding space', () => {
  assert.strictEqual(normalizeVersion('v1.2.3'), '1.2.3');
  assert.strictEqual(normalizeVersion(' 1.2.3 '), '1.2.3');
  assert.strictEqual(normalizeVersion(undefined), '0.0.0');
});

test('checksumLine is sha256sum format: 64 hex, two spaces, file name', () => {
  const line = checksumLine('a'.repeat(64), 'x.zip');
  assert.strictEqual(line, `${'a'.repeat(64)}  x.zip`);
  assert.match(line, /^[0-9a-f]{64} {2}\S+$/);
});

// A second copy of the name inside build.js would drift from the module the test
// checks, and the drift would only show up as a dead download button in prod.
test('build.js derives the artifact names from release-naming, not by hand', () => {
  const build = fs.readFileSync(path.join(rootDir, 'scripts', 'build.js'), 'utf8');

  assert.match(build, /require\('\.\/release-naming'\)/);
  assert.match(build, /portableZipName\(/);
  assert.match(build, /checksumFileName\(/);
  assert.ok(
    !/ValorantScoreAlert-v\$\{|['"]ValorantScoreAlert-v/.test(build),
    'build.js must not spell an artifact name out inline'
  );
});

// package.json is the ONLY place a version lives. config.json used to carry a
// `build.version` copy, but nothing ever read it — resolveAppVersion
// (server/licensing/config.js:41-48) reads package.json, no route serves a
// version, and no frontend displays one. A second copy of a number is a second
// thing to forget on a release, so the field is gone rather than synced. This
// test is what stops it coming back.
test('config.json carries no version field — package.json is the only source', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(rootDir, 'config.json'), 'utf8'));
  assert.strictEqual(cfg.build, undefined, 'config.json must not re-introduce a build block');
  assert.strictEqual(cfg.version, undefined, 'config.json must not carry a top-level version');
});

// allowedPlans moved into server/licensing/policy.js. Leaving a copy in the
// user-writable config would imply editing it still works — it does not.
test('config.json no longer carries the dead allowedPlans field', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(rootDir, 'config.json'), 'utf8'));
  assert.strictEqual(cfg.keylicense.allowedPlans, undefined);
});
