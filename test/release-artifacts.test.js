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
  assert.match(build, /installerZipName\(/);
  assert.match(build, /checksumFileName\(/);
  assert.ok(
    !/ValorantScoreAlert-v\$\{|['"]ValorantScoreAlert-v/.test(build),
    'build.js must not spell an artifact name out inline'
  );
});

// The contract between the two halves of the installer: build.js stages the payload
// at <zip root>/app, and Install-ValorantAlert.ps1 resolves it as $PSScriptRoot\app.
// Nothing at runtime would catch a disagreement except a user whose install refuses
// to start with "không tìm thấy thư mục 'app'".
test('build.js stages the installer payload where the installer looks for it', () => {
  const build = fs.readFileSync(path.join(rootDir, 'scripts', 'build.js'), 'utf8');
  const ps1 = fs.readFileSync(
    path.join(rootDir, 'tools', 'installer', 'Install-ValorantAlert.ps1'),
    'utf8'
  );

  assert.match(build, /installerStageDir, 'app'/, "build.js must stage the payload as app/");
  assert.match(ps1, /Join-Path \$PSScriptRoot 'app'/, "the installer must read the payload from app/");
});

// The installer zip is assembled from four named files, so a missing one is a
// broken download rather than a build error: Compress-Archive would happily zip
// three of them. build.js throws on a missing asset; this proves all four exist
// in the tree, and that the .cmd/.ps1 pair the user actually double-clicks agree
// on the file name.
test('tools/installer holds the four files the installer zip is built from', () => {
  const installerDir = path.join(rootDir, 'tools', 'installer');

  for (const asset of [
    'Install-ValorantAlert.ps1',
    'Install-ValorantAlert.cmd',
    'Uninstall-ValorantAlert.ps1',
    'README-FIRST.txt'
  ]) {
    assert.ok(fs.existsSync(path.join(installerDir, asset)), `tools/installer/${asset} must exist`);
  }

  const cmd = fs.readFileSync(path.join(installerDir, 'Install-ValorantAlert.cmd'), 'utf8');
  assert.match(cmd, /Install-ValorantAlert\.ps1/, 'the .cmd must invoke the .ps1 beside it');
});

// The shortcut target is the one thing in the installer that fails silently and
// invisibly: pointing it at ValorantScoreAlert.exe produces a running server with
// no tray icon, so the app looks dead while it is actually working. launcher.vbs is
// what frees port 3000, refreshes the shortcut and starts scripts/tray.ps1.
test('the installer creates a shortcut to launcher.vbs, not to the exe', () => {
  const ps1 = fs.readFileSync(
    path.join(rootDir, 'tools', 'installer', 'Install-ValorantAlert.ps1'),
    'utf8'
  );

  assert.match(ps1, /wscript\.exe/, 'the shortcut target must be wscript.exe');
  assert.match(ps1, /scripts\\launcher\.vbs/, 'the shortcut argument must be scripts\\launcher.vbs');
  assert.ok(
    !/TargetPath\s*=\s*.*ValorantScoreAlert\.exe/.test(ps1),
    'a shortcut aimed at the exe would start the server with no tray icon'
  );
});

// %APPDATA%\ValorantAlert holds the KLD session, the entitlement and the device id.
// An uninstall that removes it turns every reinstall into "log in again, activate
// again, burn another device slot", so the purge has to be opt-in.
test('the uninstaller keeps user data unless -PurgeUserData is passed', () => {
  const ps1 = fs.readFileSync(
    path.join(rootDir, 'tools', 'installer', 'Uninstall-ValorantAlert.ps1'),
    'utf8'
  );

  assert.match(ps1, /\[switch\]\s*\$PurgeUserData/, 'the purge must be a switch, not the default');
  assert.match(ps1, /if\s*\(\$PurgeUserData\)/, 'the user-data delete must sit behind that switch');
  assert.match(ps1, /install-info\.txt/, 'it must refuse a directory it did not install');
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

// Windows PowerShell 5.1 — the `powershell` that Install-ValorantAlert.cmd and
// launcher.vbs invoke — assumes the ANSI code page for any .ps1 without a BOM. Every
// Vietnamese string in these files then decodes to mojibake, and the installer's
// mojibake happened to contain a quote character, so the script did not merely print
// garbage: it failed to parse. `Install-ValorantAlert.ps1:103 Unexpected token 'i'`,
// which is a 100% failure rate for anyone double-clicking the .cmd. The BOM is the fix
// and this test is what keeps an editor from silently dropping it again.
function shippedPowerShellScripts() {
  const dirs = [path.join(rootDir, 'scripts'), path.join(rootDir, 'tools', 'installer')];

  return dirs.flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((name) => /\.ps1$/i.test(name))
      .map((name) => path.join(dir, name))
  );
}

test('every shipped .ps1 holding non-ASCII text starts with a UTF-8 BOM', () => {
  const scripts = shippedPowerShellScripts();
  assert.ok(scripts.length >= 3, 'the scan found no PowerShell scripts — wrong directories?');

  for (const file of scripts) {
    const bytes = fs.readFileSync(file);
    if (!bytes.some((b) => b > 0x7f)) continue; // pure ASCII parses either way

    assert.deepStrictEqual(
      [...bytes.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      `${path.relative(rootDir, file)} has non-ASCII text but no UTF-8 BOM — PowerShell 5.1 will misread it`
    );
  }
});

// Parsing as UTF-8 is only half of it. A console left on code page 437/850 prints the
// same correctly-parsed Vietnamese as '?', so the install reads as broken even when it
// worked. The assignment is wrapped in try/catch in both scripts: a host that refuses it
// must not take the install down over a cosmetic setting.
test('the installer scripts force UTF-8 console output', () => {
  for (const name of ['Install-ValorantAlert.ps1', 'Uninstall-ValorantAlert.ps1']) {
    const src = fs.readFileSync(path.join(rootDir, 'tools', 'installer', name), 'utf8');

    assert.match(
      src,
      /try \{ \[Console\]::OutputEncoding = \[System\.Text\.Encoding\]::UTF8 \} catch \{ \}/,
      `${name} must set the console to UTF-8, and must not throw if the host refuses`
    );
  }
});

// README-FIRST.txt is the one shipped file a user opens by hand, and it is entirely
// Vietnamese. Notepad on current Windows 10 detects BOM-less UTF-8, but nothing
// guarantees the viewer: read as ANSI, the whole file is mojibake and the install
// instructions become unusable. Three bytes remove the guess.
test('README-FIRST.txt starts with a UTF-8 BOM', () => {
  const bytes = fs.readFileSync(path.join(rootDir, 'tools', 'installer', 'README-FIRST.txt'));

  assert.deepStrictEqual(
    [...bytes.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    'the Vietnamese readme must declare its encoding'
  );
});

// The .cmd is the opposite case and the reason the fix is not "add a BOM everywhere":
// cmd.exe reads a batch file in the OEM code page and cannot be told otherwise, and a
// BOM there is executed as part of the first line. So this file stays pure ASCII — the
// Vietnamese in its messages is deliberately unaccented.
test('Install-ValorantAlert.cmd is pure ASCII with no BOM', () => {
  const bytes = fs.readFileSync(path.join(rootDir, 'tools', 'installer', 'Install-ValorantAlert.cmd'));

  assert.ok(!bytes.some((b) => b > 0x7f), 'a non-ASCII byte in the .cmd prints as garbage in cmd.exe');
  assert.notDeepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'cmd.exe would execute the BOM');
});

// `Copy-Item -LiteralPath "$src\*"` copies NOTHING and raises NOTHING: -LiteralPath
// makes the '*' a literal file name, which matches no file. The installer shipped that
// line, so a real run produced an empty install folder, a Start Menu shortcut, and a
// green "Cài đặt xong" — after deleting the user's previous working install. Swapping to
// -Path is not the fix either: a browser-created folder like 'Valorant-Alert [1]\app'
// makes '[1]' a character class, and that copies nothing too. Both were reproduced
// before the fix (enumerate children literally) was written.
test('the installer never pairs -LiteralPath with a wildcard', () => {
  const ps1 = fs
    .readFileSync(path.join(rootDir, 'tools', 'installer', 'Install-ValorantAlert.ps1'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line)); // the explanation above quotes the bad form

  const offenders = ps1.filter((line) => line.includes('-LiteralPath') && line.includes('*'));
  assert.deepStrictEqual(offenders, [], 'a wildcard under -LiteralPath matches nothing and reports success');
});

// Order matters more than the copy itself: the delete below is what makes a silent copy
// failure destructive rather than merely useless. Verifying the staged tree first turns
// the worst case into "install refused, old version still works".
test('the installer verifies the staged copy before deleting the old install', () => {
  const ps1 = fs.readFileSync(path.join(rootDir, 'tools', 'installer', 'Install-ValorantAlert.ps1'), 'utf8');

  const stagedCheck = ps1.indexOf('Bản sao tạm thiếu');
  const oldDelete = ps1.indexOf('Remove-Item -LiteralPath $installDirFullPath');

  assert.ok(stagedCheck !== -1, 'the staged tree must be re-checked after the copy');
  assert.ok(oldDelete !== -1, 'the old install is still expected to be removed');
  assert.ok(stagedCheck < oldDelete, 'the check has to run BEFORE the irreversible delete');
});


