const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const {
  portableZipName,
  installerZipName,
  checksumFileName,
  checksumLine,
  normalizeVersion,
  resolver
} = require('./release-naming');

console.log('===========================================================');
console.log('📦 BUILDING VALORANT SCORE ALERT STANDALONE RELEASE PACKAGE');
console.log('===========================================================');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

// If running in Cloudflare Pages / Workers CI or build environment without Windows binary requirements,
// skip the heavy standalone exe compilation and packaging.
const isCloudflareCI = Boolean(
  process.env.CF_PAGES ||
  process.env.CF_WORKERS ||
  process.env.CLOUDFLARE_CI ||
  (process.env.CI && process.cwd().includes('buildhome'))
);

if (isCloudflareCI) {
  console.log('⚡ Cloudflare CI environment detected: web assets are served directly from public/.');
  console.log('⚡ Skipping standalone Windows executable compilation.');
  process.exit(0);
}

const releaseDir = path.join(distDir, 'ValorantScoreAlert-Release');
const appVersion = normalizeVersion(require(path.join(rootDir, 'package.json')).version);

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

// PowerShell single-quoted literal: the only escape inside one is a doubled
// quote. Paths are interpolated into a command line, so they get quoted here
// rather than concatenated raw.
function psLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Directories that must never follow the repo root into a shipped tree. Passed as
// a parameter rather than hardcoded because the installer stage copies an
// already-clean release folder, where skipping anything would silently ship a
// payload that differs from the portable zip QA actually tested.
const REPO_ONLY_DIRS = ['logs', 'dist', '.git', 'test'];

function copyDirSync(src, dest, skipDirs = REPO_ONLY_DIRS) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) {
        copyDirSync(srcPath, destPath, skipDirs);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy public PWA frontend assets
console.log('[1/8] Copying public PWA frontend assets...');
copyDirSync(path.join(rootDir, 'public'), path.join(releaseDir, 'public'));

// 2. Copy branding assets
console.log('[2/8] Copying branding assets (icons)...');
copyDirSync(path.join(rootDir, 'assets'), path.join(releaseDir, 'assets'));

// 3. Copy launcher scripts
console.log('[3/8] Copying launcher & tray scripts...');
copyDirSync(path.join(rootDir, 'scripts'), path.join(releaseDir, 'scripts'));

// 4. Copy configuration and batch files
console.log('[4/8] Copying launcher batch files & configuration...');
fs.copyFileSync(path.join(rootDir, 'config.json'), path.join(releaseDir, 'config.json'));
fs.copyFileSync(path.join(rootDir, 'Start-ValorantAlert.bat'), path.join(releaseDir, 'Start-ValorantAlert.bat'));
fs.copyFileSync(path.join(rootDir, 'Create-Desktop-Shortcut.vbs'), path.join(releaseDir, 'Create-Desktop-Shortcut.vbs'));

const readmeContent = `===========================================================
🎯 VALORANT REALTIME SCORE ALERT (PWA) - PORTABLE RELEASE
===========================================================

📌 HƯỚNG DẪN SỬ DỤNG:
1. Mở Valorant trên máy tính PC của bạn.
2. Nhấp đôi chuột vào "Start-ValorantAlert.bat" để khởi động server và mở PC Dashboard.
3. Mở điện thoại di động (iPhone / Android cùng Wi-Fi LAN), quét mã QR trên màn hình PC.
4. Bấm "KÍCH HOẠT CẢNH BÁO NỀN" trên điện thoại để nhận thông báo âm thanh realtime khi đối thủ đạt Match Point.

📌 TÍNH NĂNG NỔI BẬT:
- Đóng gói Standalone Executable (Không cần cài đặt Node.js trên máy).
- Tự động nhận diện trận đấu Valorant (Competitive, Unrated, Custom Game, TDM).
- 5 âm chuông cảnh báo với cao độ thông minh (Melodic Triad, Radar Pulse, Crystal Bell, Arcade, Tactical).
- Tùy chỉnh kịch bản: Match Point 12 round, Custom Round chọn trước, Kết thúc trận đấu.
- An toàn 100% trong mạng LAN nội bộ, không làm giảm FPS game.

===========================================================
`;

fs.writeFileSync(path.join(releaseDir, 'README-Release.txt'), readmeContent, 'utf8');
fs.mkdirSync(path.join(releaseDir, 'logs'), { recursive: true });

// 5. Package Standalone Executable with caxa
console.log('[5/8] Compiling standalone ValorantScoreAlert.exe binary...');
const exeOutputPath = path.join(releaseDir, 'ValorantScoreAlert.exe');

try {
  // caxa tars up --input wholesale, so every exclude has to be named. Beyond the
  // obvious build outputs: "relay" is the Cloudflare Worker source and
  // ".worker-dist"/".wrangler" are its build artifacts — none of them belong in
  // a desktop binary, and they were verified as shipped before being listed here.
  // "docs" holds the licence-enforcement design notes, which are a roadmap of the
  // trust model and have no business inside the shipped binary; ".claude" is
  // machine-local editor state. "tools" is the installer package — it wraps the
  // exe, so shipping it inside the exe would nest a copy of the installer in
  // every install.
  execSync(
    `npx caxa --input . --output "${exeOutputPath}" --exclude "dist" ".git" ".github" "test" "logs" "relay" ".worker-dist" ".wrangler" ".data" "docs" ".claude" "tools" "wrangler.jsonc" -- "{{caxa}}/node_modules/.bin/node" "{{caxa}}/server/index.js"`,
    { cwd: rootDir, stdio: 'inherit' }
  );
  console.log(`✅ Standalone binary created: ${exeOutputPath}`);
} catch (err) {
  console.error('⚠️ Standalone compilation error:', err.message);
  process.exit(1);
}

// 6. Zip the portable folder under the name KLD's download resolver matches.
//    A bare .exe matches none of its predicates, which is why the dashboard's
//    download button used to dead-end. See scripts/release-naming.js.
const zipName = portableZipName(appVersion);
const zipPath = path.join(distDir, zipName);
console.log(`[6/8] Packaging portable archive ${zipName}...`);

if (!resolver.matchesPortable(zipName)) {
  console.error(`⚠️ ${zipName} does not satisfy the KLD portable-asset contract.`);
  process.exit(1);
}

function compressFolder(sourceDir, destinationZipPath) {
  fs.rmSync(destinationZipPath, { force: true });
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -NonInteractive -Command "Compress-Archive -Path ${psLiteral(path.join(sourceDir, '*'))} -DestinationPath ${psLiteral(destinationZipPath)} -CompressionLevel Optimal -Force"`,
      { cwd: rootDir, stdio: 'inherit' }
    );
  } else {
    // Linux / macOS build environments (Cloudflare Pages, CI, Docker)
    const absSource = path.resolve(sourceDir);
    const absZip = path.resolve(destinationZipPath);
    try {
      execSync(`(cd "${absSource}" && zip -r -q "${absZip}" .) || (cd "${absSource}" && zip -r "${absZip}" *)`, {
        cwd: absSource,
        stdio: 'inherit',
        shell: '/bin/sh'
      });
    } catch (e) {
      execSync(
        `python3 -c "import zipfile, os; z = zipfile.ZipFile('${absZip}', 'w', zipfile.ZIP_DEFLATED); [z.write(os.path.join(r, f), os.path.relpath(os.path.join(r, f), '${absSource}')) for r, d, fs in os.walk('${absSource}') for f in fs]; z.close()"`,
        { cwd: absSource, stdio: 'inherit', shell: '/bin/sh' }
      );
    }
  }
}

try {
  compressFolder(releaseDir, zipPath);
  if (!fs.existsSync(zipPath)) throw new Error('Zip archive produced no file');
  console.log(`✅ Portable archive created: ${zipPath}`);
} catch (err) {
  console.error('⚠️ Archive packaging error:', err.message);
  process.exit(1);
}

// 7. Installer archive. Same payload as the portable zip, wrapped in the four
//    scripts from tools/installer with the tree under app/ — the layout
//    Install-ValorantAlert.ps1 expects, and the same layout ValorantTweaks uses
//    (tools/Create-InstallerPackage.ps1 there). KLD selects this asset by the word
//    "installer" in its name and prefers it over the portable one
//    (recommended = installer ?? portable), so the name is load-bearing twice: it
//    must match the installer predicate and must NOT match the portable one, or it
//    would shadow the download it is supposed to sit beside.
const installerZip = installerZipName(appVersion);
const installerZipPath = path.join(distDir, installerZip);
const installerStageDir = path.join(distDir, 'installer-package');
console.log(`[7/8] Packaging installer archive ${installerZip}...`);

if (!resolver.matchesInstaller(installerZip) || resolver.matchesPortable(installerZip)) {
  console.error(`⚠️ ${installerZip} does not satisfy the KLD installer-asset contract.`);
  process.exit(1);
}

// Named individually rather than copied as a directory: a stray file left in
// tools/installer would otherwise ride along into every user's download.
const INSTALLER_ASSETS = [
  'Install-ValorantAlert.ps1',
  'Install-ValorantAlert.cmd',
  'Uninstall-ValorantAlert.ps1',
  'README-FIRST.txt'
];

try {
  fs.rmSync(installerStageDir, { recursive: true, force: true });
  fs.rmSync(installerZipPath, { force: true });
  fs.mkdirSync(installerStageDir, { recursive: true });

  // No skip list: app/ must be the same tree the portable zip ships, or the
  // installer would deliver something QA never tested.
  copyDirSync(releaseDir, path.join(installerStageDir, 'app'), []);

  for (const asset of INSTALLER_ASSETS) {
    const from = path.join(rootDir, 'tools', 'installer', asset);
    if (!fs.existsSync(from)) throw new Error(`tools/installer/${asset} is missing`);
    fs.copyFileSync(from, path.join(installerStageDir, asset));
  }

  compressFolder(installerStageDir, installerZipPath);
  if (!fs.existsSync(installerZipPath)) throw new Error('Zip archive produced no file');
  console.log(`✅ Installer archive created: ${installerZipPath}`);
} catch (err) {
  console.error('⚠️ Installer packaging error:', err.message);
  // Staging tree is left in place on failure — it is the only evidence of what
  // was about to be zipped. process.exit skips finally blocks, so cleanup lives
  // on the success path below rather than pretending to be unconditional.
  process.exit(1);
}

// A duplicate of a ~37 MB release folder; leaving it in dist/ would double the
// directory and make a later "stale dist" diagnosis harder.
fs.rmSync(installerStageDir, { recursive: true, force: true });

// 8. SHA256SUMS.txt — the resolver reads this name case-insensitively and hands
//    it to the client as checksumUrl, so a release without it downloads fine but
//    cannot be verified. One line per published archive, in sha256sum format, so
//    `sha256sum -c` works on the file as-is.
const checksumPath = path.join(distDir, checksumFileName());
console.log(`[8/8] Writing ${checksumFileName()}...`);

const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checksums = [
  [sha256Of(zipPath), zipName],
  [sha256Of(installerZipPath), installerZip]
];

fs.writeFileSync(
  checksumPath,
  `${checksums.map(([hex, name]) => checksumLine(hex, name)).join('\n')}\n`,
  'utf8'
);
for (const [hex, name] of checksums) {
  console.log(`✅ ${name}: ${hex}`);
}

// 9. Copy public PWA frontend assets into dist root so Cloudflare Pages can host the dashboard directly
console.log('[9/9] Copying public PWA web assets to dist root for Cloudflare Pages / Web Hosting...');
copyDirSync(path.join(rootDir, 'public'), distDir);

console.log('\n===========================================================');
console.log('🎉 PORTABLE RELEASE PACKAGE CREATED SUCCESSFULLY!');
console.log(`📁 RELEASE FOLDER: ${releaseDir}`);
console.log(`📦 UPLOAD TO THE GITHUB RELEASE: ${zipName} + ${installerZip} + ${checksumFileName()}`);
console.log('===========================================================');
