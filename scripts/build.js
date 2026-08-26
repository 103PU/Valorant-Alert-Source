const fs = require('fs');
const path = require('path');

console.log('===========================================================');
console.log('📦 BUILDING PORTABLE RELEASE PACKAGE');
console.log('===========================================================');

const rootDir = path.join(__dirname, '..');
const releaseDir = path.join(rootDir, 'dist', 'ValorantScoreAlert-Release');

if (fs.existsSync(releaseDir)) {
  fs.rmSync(releaseDir, { recursive: true, force: true });
}
fs.mkdirSync(releaseDir, { recursive: true });

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'logs' && entry.name !== 'dist' && entry.name !== '.git') {
        copyDirSync(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy server directory
console.log('[1/5] Copying server files...');
copyDirSync(path.join(rootDir, 'server'), path.join(releaseDir, 'server'));

// 2. Copy public directory
console.log('[2/5] Copying public PWA frontend assets...');
copyDirSync(path.join(rootDir, 'public'), path.join(releaseDir, 'public'));

// 3. Copy assets directory (icons)
console.log('[3/5] Copying branding assets...');
copyDirSync(path.join(rootDir, 'assets'), path.join(releaseDir, 'assets'));

// 4. Copy node_modules & root files
console.log('[4/5] Copying bundled node_modules dependencies...');
copyDirSync(path.join(rootDir, 'node_modules'), path.join(releaseDir, 'node_modules'));

fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(releaseDir, 'package.json'));
fs.copyFileSync(path.join(rootDir, 'config.json'), path.join(releaseDir, 'config.json'));
fs.copyFileSync(path.join(rootDir, 'Start-ValorantAlert.bat'), path.join(releaseDir, 'Start-ValorantAlert.bat'));
fs.copyFileSync(path.join(rootDir, 'Create-Desktop-Shortcut.vbs'), path.join(releaseDir, 'Create-Desktop-Shortcut.vbs'));

// 5. Create Release README
const readmeContent = `===========================================================
🎯 VALORANT REALTIME SCORE ALERT (PWA) - PORTABLE RELEASE
===========================================================

📌 HƯỚNG DẪN SỬ DỤNG CHO NGƯỜI DÙNG:

1. Mở Valorant trên máy tính PC của bạn.
2. Nhấp đôi chuột vào "Start-ValorantAlert.bat" để khởi động server và mở PC Dashboard.
3. Mở điện thoại di động (iPhone / Android cùng Wi-Fi LAN), quét mã QR trên màn hình PC.
4. Bấm "KÍCH HOẠT CẢNH BÁO NỀN" trên điện thoại để nhận thông báo âm thanh realtime khi đối thủ đạt Match Point.

📌 TÍNH NĂNG NỔI BẬT:
- Tự động nhận diện trận đấu Valorant (Competitive, Unrated, Custom Game).
- Kho 5 âm chuông cảnh báo độc quyền (Melodic Triad, Radar Pulse, Crystal Bell, Arcade, Tactical).
- Tùy chỉnh bật/tắt kịch bản thông báo (Match Point, Qua Round Mới, Overtime).
- Giao diện chuẩn phong cách Riot Games Valorant.
- Chi phí 0đ, an toàn 100% trong mạng LAN nội bộ.

===========================================================
`;

fs.writeFileSync(path.join(releaseDir, 'README-Release.txt'), readmeContent, 'utf8');

// Ensure empty logs folder exists in release
fs.mkdirSync(path.join(releaseDir, 'logs'), { recursive: true });

console.log('\n===========================================================');
console.log('🎉 PORTABLE RELEASE PACKAGE CREATED SUCCESSFULLY!');
console.log(`📁 RELEASE FOLDER: ${releaseDir}`);
console.log('===========================================================');
