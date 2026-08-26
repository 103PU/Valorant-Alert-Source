const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('===========================================================');
console.log('📦 BUILDING VALORANT SCORE ALERT STANDALONE RELEASE PACKAGE');
console.log('===========================================================');

const rootDir = path.join(__dirname, '..');
const releaseDir = path.join(rootDir, 'dist', 'ValorantScoreAlert-Release');

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
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
console.log('[1/5] Copying public PWA frontend assets...');
copyDirSync(path.join(rootDir, 'public'), path.join(releaseDir, 'public'));

// 2. Copy branding assets
console.log('[2/5] Copying branding assets (icons)...');
copyDirSync(path.join(rootDir, 'assets'), path.join(releaseDir, 'assets'));

// 3. Copy launcher scripts
console.log('[3/5] Copying launcher & tray scripts...');
copyDirSync(path.join(rootDir, 'scripts'), path.join(releaseDir, 'scripts'));

// 4. Copy configuration and batch files
console.log('[4/5] Copying launcher batch files & configuration...');
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
console.log('[5/5] Compiling standalone ValorantScoreAlert.exe binary...');
const exeOutputPath = path.join(releaseDir, 'ValorantScoreAlert.exe');

try {
  execSync(
    `npx caxa --input . --output "${exeOutputPath}" --exclude "dist" ".git" ".github" "test" "logs" -- "{{caxa}}/node_modules/.bin/node" "{{caxa}}/server/index.js"`,
    { cwd: rootDir, stdio: 'inherit' }
  );
  console.log(`✅ Standalone binary created: ${exeOutputPath}`);
} catch (err) {
  console.error('⚠️ Standalone compilation error:', err.message);
  process.exit(1);
}

console.log('\n===========================================================');
console.log('🎉 PORTABLE RELEASE PACKAGE CREATED SUCCESSFULLY!');
console.log(`📁 RELEASE FOLDER: ${releaseDir}`);
console.log('===========================================================');
