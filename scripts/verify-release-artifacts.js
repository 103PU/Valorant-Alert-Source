// Pre-upload gate for the release job.
//
// build.js already refuses to emit a name the resolver would reject, but a release
// can still go out wrong in ways build.js cannot see from inside its own run:
// a stale dist/ from an earlier version, or a SHA256SUMS.txt describing a zip that
// was rebuilt afterwards. Both produce a release that downloads and then fails
// verification — the worst failure shape, because it looks like corruption.
//
// So this re-derives the expected names from package.json, proves all three files
// are present (portable zip, installer zip, checksums), and recomputes each digest
// from the bytes actually on disk.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const {
  portableZipName,
  installerZipName,
  setupExeName,
  checksumFileName,
  checksumLine,
  normalizeVersion,
  resolver
} = require('./release-naming');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const releaseDir = path.join(distDir, 'ValorantScoreAlert-Release');
const version = normalizeVersion(require(path.join(rootDir, 'package.json')).version);

const zipName = portableZipName(version);
const installerName = installerZipName(version);
const setupName = setupExeName(version);
const sumName = checksumFileName();
const zipPath = path.join(distDir, zipName);
const installerPath = path.join(distDir, installerName);
const setupPath = path.join(distDir, setupName);
const sumPath = path.join(distDir, sumName);

const failures = [];
const signatureRequired = process.env.SECURE_RELEASE === '1' || process.env.VERIFY_SIGNATURES === '1';

function verifySignature(filePath) {
  if (!signatureRequired) return null;
  if (process.platform !== 'win32') return false;
  try {
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(rootDir, 'scripts', 'verify-authenticode.ps1'), '-Path', filePath, '-RequireValid'
    ];
    if (process.env.SIGNING_CERT_SUBJECT) args.push('-ExpectedSubject', process.env.SIGNING_CERT_SUBJECT);
    execFileSync('powershell.exe', args, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

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
check(resolver.matchesInstaller(installerName), `${installerName} satisfies the KLD installer-asset contract`);
// The resolver prefers the installer (recommended = installer ?? portable), so an
// installer that also matched the portable predicate would take both slots and the
// portable download would become unreachable.
check(!resolver.matchesPortable(installerName), `${installerName} does not shadow the portable download`);
check(resolver.isChecksums(sumName), `${sumName} is the checksums name the resolver looks for`);
check(fs.existsSync(zipPath), `dist/${zipName} exists`);
check(fs.existsSync(installerPath), `dist/${installerName} exists`);
check(fs.existsSync(setupPath), `dist/${setupName} exists`);
const mainExePath = path.join(releaseDir, 'ValorantScoreAlert.exe');
check(fs.existsSync(mainExePath), 'release tree contains ValorantScoreAlert.exe');
if (signatureRequired) {
  if (fs.existsSync(setupPath)) check(verifySignature(setupPath), `${setupName} has a valid Authenticode signature`);
  if (fs.existsSync(mainExePath)) check(verifySignature(mainExePath), 'ValorantScoreAlert.exe has a valid Authenticode signature');
} else {
  console.log('ℹ️ Authenticode verification skipped; set SECURE_RELEASE=1 for the signing gate.');
}
check(fs.existsSync(sumPath), `dist/${sumName} exists`);

// Only meaningful once the files are there; skip rather than throw ENOENT.
if (fs.existsSync(zipPath) && fs.existsSync(installerPath) && fs.existsSync(sumPath)) {
  const lines = fs.readFileSync(sumPath, 'utf8').split(/\r?\n/).filter(Boolean);
  check(lines.length === 3, `${sumName} holds exactly one line per archive (found ${lines.length})`);

  for (const [archivePath, archiveName] of [[zipPath, zipName], [installerPath, installerName], [setupPath, setupName]]) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    check(
      lines.includes(checksumLine(digest, archiveName)),
      `${sumName} matches the bytes of ${archiveName} (${digest.slice(0, 16)}…)`
    );

    const bytes = fs.statSync(archivePath).size;
    // caxa output is tens of MB; anything tiny means Compress-Archive archived an
    // empty or partial folder and the guard above would still have passed.
    check(bytes > 5 * 1024 * 1024, `${archiveName} is ${(bytes / 1048576).toFixed(1)} MB, above the 5 MB floor`);
  }
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `portable=${zipPath}\ninstaller=${installerPath}\nsetup=${setupPath}\nchecksums=${sumPath}\nversion=${version}\n`
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} release artifact check(s) failed. Not publishing.`);
  process.exit(1);
}

console.log(`\n🎯 Release artifacts verified for v${version}.`);
