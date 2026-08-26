const path = require('path');
const { exec } = require('child_process');

function handleApiShortcut(req, res, { rootDir }) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const vbsPath = path.join(rootDir, 'Create-Desktop-Shortcut.vbs');
  exec(`cscript //nologo "${vbsPath}"`, { cwd: rootDir }, (err) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (err) {
      res.end(JSON.stringify({ success: false, message: 'Lỗi tạo shortcut: ' + err.message }));
    } else {
      res.end(JSON.stringify({ success: true, message: 'Đã tạo Shortcut Valorant Alert ngoài Desktop!' }));
    }
  });
}

module.exports = { handleApiShortcut };
