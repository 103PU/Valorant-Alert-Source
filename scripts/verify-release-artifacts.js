// Pre-upload gate for the release job.
//
// build.js already refuses to emit a name the resolver would reject, but a release
// can still go out wrong in ways build.js cannot see from inside its own run:
// a stale dist/ from an earlier version, or a SHA256SUMS.txt describing a zip that
// was rebuilt afterwards. Both produce a release that downloads and then fails
// verification — the worst failure shape, because it looks like corruption.
//
// So this re-derives the expected names from package.json, proves both files are
// present, and recomputes the digest from the bytes actually on disk.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  portableZipName,
  checksumFileName,
  checksumLine,
  normalizeVersion,
  resolver
} = require('./release-naming');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const version = normalizeVersion(require(path.join(rootDir, 'package.json')).version);

const zipName = portableZipName(version);
const sumName = checksumFileName();
const zipPath = path.join(distDir, zipName);
const sumPath = path.join(distDir, sumName);

const failures = [];

function check(ok, message) {
  if (ok) {
    console.log(`✅ ${message}`);
  } else {
    console.error(`❌ ${message}`);
    failures.push(message);
  }
}

check(resolver.matchesPortable(zipName), `${zipName} satisfies the KLD portable-asset contract`);
check(!resolver.matchesInstaller(zipName), `${zipName} does not occupy the installer slot`);
check(resolver.isChecksums(sumName), `${sumName} is the checksums name the resolver looks for`);
check(fs.existsSync(zipPath), `dist/${zipName} exists`);
check(fs.existsSync(sumPath), `dist/${sumName} exists`);

// Only meaningful once both files are there; skip rather than throw ENOENT.
if (fs.existsSync(zipPath) && fs.existsSync(sumPath)) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  const expected = checksumLine(digest, zipName);
  const lines = fs.readFileSync(sumPath, 'utf8').split(/\r?\n/).filter(Boolean);

  check(lines.length === 1, `${sumName} holds exactly one line (found ${lines.length})`);
  check(
    lines.includes(expected),
    `${sumName} matches the bytes of ${zipName} (${digest.slice(0, 16)}…)`
  );

  const bytes = fs.statSync(zipPath).size;
  // caxa output is tens of MB; anything tiny means Compress-Archive archived an
  // empty or partial release folder and the guard above would still have passed.
  check(bytes > 5 * 1024 * 1024, `${zipName} is ${(bytes / 1048576).toFixed(1)} MB, above the 5 MB floor`);
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `portable=${zipPath}\nchecksums=${sumPath}\nversion=${version}\n`
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} release artifact check(s) failed. Not publishing.`);
  process.exit(1);
}

console.log(`\n🎯 Release artifacts verified for v${version}.`);
