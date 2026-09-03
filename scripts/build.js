const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const {
  portableZipName,
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

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'logs' && entry.name !== 'dist' && entry.name !== '.git' && entry.name !== 'test') {
        copyDirSync(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy public PWA frontend assets
console.log('[1/7] Copying public PWA frontend assets...');
copyDirSync(path.join(rootDir, 'public'), path.join(releaseDir, 'public'));

// 2. Copy branding assets
console.log('[2/7] Copying branding assets (icons)...');
copyDirSync(path.join(rootDir, 'assets'), path.join(releaseDir, 'assets'));

// 3. Copy launcher scripts
console.log('[3/7] Copying launcher & tray scripts...');
copyDirSync(path.join(rootDir, 'scripts'), path.join(releaseDir, 'scripts'));

// 4. Copy configuration and batch files
console.log('[4/7] Copying launcher batch files & configuration...');
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
console.log('[5/7] Compiling standalone ValorantScoreAlert.exe binary...');
const exeOutputPath = path.join(releaseDir, 'ValorantScoreAlert.exe');

try {
  // caxa tars up --input wholesale, so every exclude has to be named. Beyond the
  // obvious build outputs: "relay" is the Cloudflare Worker source and
  // ".worker-dist"/".wrangler" are its build artifacts — none of them belong in
  // a desktop binary, and they were verified as shipped before being listed here.
  // "docs" holds the licence-enforcement design notes, which are a roadmap of the
  // trust model and have no business inside the shipped binary; ".claude" is
  // machine-local editor state.
  execSync(
    `npx caxa --input . --output "${exeOutputPath}" --exclude "dist" ".git" ".github" "test" "logs" "relay" ".worker-dist" ".wrangler" ".data" "docs" ".claude" -- "{{caxa}}/node_modules/.bin/node" "{{caxa}}/server/index.js"`,
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
console.log(`[6/7] Packaging portable archive ${zipName}...`);

if (!resolver.matchesPortable(zipName)) {
  console.error(`⚠️ ${zipName} does not satisfy the KLD portable-asset contract.`);
  process.exit(1);
}

try {
  fs.rmSync(zipPath, { force: true });
  // Compress-Archive ships with Windows PowerShell 5.1, so this stays at zero new
  // dependencies. Archiving the folder *contents* keeps the extracted tree one
  // level deep — Explorer already extracts into a folder named after the zip.
  execSync(
    `powershell -NoProfile -NonInteractive -Command "Compress-Archive -Path ${psLiteral(path.join(releaseDir, '*'))} -DestinationPath ${psLiteral(zipPath)} -CompressionLevel Optimal -Force"`,
    { cwd: rootDir, stdio: 'inherit' }
  );
  if (!fs.existsSync(zipPath)) throw new Error('Compress-Archive produced no file');
  console.log(`✅ Portable archive created: ${zipPath}`);
} catch (err) {
  console.error('⚠️ Archive packaging error:', err.message);
  process.exit(1);
}

// 7. SHA256SUMS.txt — the resolver reads this name case-insensitively and hands
//    it to the client as checksumUrl, so a release without it downloads fine but
//    cannot be verified.
const checksumPath = path.join(distDir, checksumFileName());
console.log(`[7/7] Writing ${checksumFileName()}...`);

const digest = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
fs.writeFileSync(checksumPath, `${checksumLine(digest, zipName)}\n`, 'utf8');
console.log(`✅ ${checksumFileName()}: ${digest}`);

console.log('\n===========================================================');
console.log('🎉 PORTABLE RELEASE PACKAGE CREATED SUCCESSFULLY!');
console.log(`📁 RELEASE FOLDER: ${releaseDir}`);
console.log(`📦 UPLOAD TO THE GITHUB RELEASE: ${zipName} + ${checksumFileName()}`);
console.log('===========================================================');
