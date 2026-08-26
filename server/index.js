const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const QRCode = require('qrcode');

const logger = require('./utils/logger');
const { readLockfile } = require('./riot/lockfile-reader');
const { getAuthData } = require('./riot/riot-auth');
const { getRegionInfo } = require('./riot/riot-region');
const ScorePoller = require('./core/score-poller');
const ScoreWSServer = require('./transport/ws-server');

// Resolve path for pkg environment
const isPkg = !!process.pkg;
const rootDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const publicDir = isPkg ? path.join(__dirname, 'public') : path.join(__dirname, '..', 'public');

// Set Background Process Priority to BELOW_NORMAL (Guarantees Valorant gets 100% CPU priority)
try {
  if (os.setPriority && os.constants && os.constants.priority) {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  }
} catch (e) {}

// Load Config file dynamically
let config = {
  port: 3000,
  pollingIntervalMs: 2500,
  idlePollingIntervalMs: 5000,
  tokenAutoRefreshMins: 45,
  alertEnemyScoreThreshold: 12
};

const configPath = path.join(rootDir, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = { ...config, ...JSON.parse(raw) };
    logger.info(`Loaded config.json from: ${configPath}`);
  } catch (e) {
    logger.error('Failed to parse config.json, using defaults:', e.message);
  }
} else {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    logger.info(`Created default config.json at: ${configPath}`);
  } catch (e) {}
}

const PORT = process.env.PORT || config.port || 3000;

// Helper: Get local LAN IPv4 address
function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const lanIp = getLocalLanIp();

// Create HTTP Server for PWA & PC Dashboard
const server = http.createServer(async (req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';

  // API Endpoint: Serve QR Code as Direct PNG Image
  if (reqPath === '/api/qr') {
    const token = wsServer.getToken();
    const appUrl = `http://${lanIp}:${PORT}?token=${token}`;
    try {
      const pngBuffer = await QRCode.toBuffer(appUrl, { type: 'png', margin: 1, width: 280 });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Length': pngBuffer.length
      });
      res.end(pngBuffer);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('QR generation error: ' + err.message);
    }
    return;
  }

  // API Endpoint: Serve System Info JSON
  if (reqPath === '/api/info') {
    const token = wsServer.getToken();
    const lockfile = readLockfile();
    const regionInfo = getRegionInfo();

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({
      port: PORT,
      lanIp,
      token,
      lanUrl: `http://${lanIp}:${PORT}?token=${token}`,
      lanMobileUrl: `http://${lanIp}:${PORT}?token=${token}`,
      lanDashboardUrl: `http://${lanIp}:${PORT}/dashboard.html?token=${token}`,
      localUrl: `http://localhost:${PORT}?token=${token}`,
      dashboardUrl: `http://localhost:${PORT}/dashboard.html?token=${token}`,
      riotConnected: !!lockfile,
      region: regionInfo.region,
      shard: regionInfo.shard,
      clientVersion: regionInfo.clientVersion
    }));
    return;
  }

  // API Endpoint: Create Desktop Shortcut
  if (reqPath === '/api/create-shortcut' && req.method === 'POST') {
    const vbsPath = path.join(rootDir, 'Create-Desktop-Shortcut.vbs');
    exec(`cscript //nologo "${vbsPath}"`, { cwd: rootDir }, (err) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (err) {
        res.end(JSON.stringify({ success: false, message: 'Lỗi tạo shortcut: ' + err.message }));
      } else {
        res.end(JSON.stringify({ success: true, message: 'Đã tạo Shortcut Valorant Alert ngoài Desktop!' }));
      }
    });
    return;
  }

  const filePath = path.join(publicDir, reqPath);

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      }
      return;
    }
    // Prevent aggressive browser caching of HTML/JS
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, must-revalidate'
    });
    res.end(data);
  });
});

// Attach WebSocket Server
const wsServer = new ScoreWSServer(server);
const authToken = wsServer.getToken();
const fullAppUrl = `http://${lanIp}:${PORT}?token=${authToken}`;
const dashboardUrl = `http://localhost:${PORT}/dashboard.html?token=${authToken}`;

// Initialize Core Score Poller
const poller = new ScorePoller(config, (scoreData) => {
  wsServer.broadcastScore(scoreData);
});

// Start Server
server.listen(PORT, '0.0.0.0', async () => {
  logger.info('===========================================================');
  logger.info('🚀 VALORANT REALTIME SCORE ALERT SERVER STARTED');
  logger.info('===========================================================');
  logger.info(`🔑 AUTH TOKEN:    ${authToken}`);
  logger.info(`🖥️ PC DASHBOARD: ${dashboardUrl}`);
  logger.info(`📱 LAN IPHONE:   ${fullAppUrl}`);
  logger.info(`📝 LOG FILE:      ${logger.getLogFilePath()}`);
  logger.info('===========================================================');
  logger.info('📱 SCAN THE QR CODE BELOW WITH YOUR MOBILE CAMERA:\n');

  try {
    const qrString = await QRCode.toString(fullAppUrl, { type: 'terminal', small: true });
    console.log(qrString);
  } catch (err) {
    logger.info(`(Open URL directly on Mobile Browser: ${fullAppUrl})`);
  }

  logger.info('===========================================================');

  // Verify Riot Client connection on startup
  const lockfile = readLockfile();
  if (lockfile) {
    logger.info(`✅ Riot Client detected! Port: ${lockfile.port}`);
    const auth = await getAuthData(false, config.tokenAutoRefreshMins);
    if (auth) {
      logger.info(`✅ Authenticated with Riot Local API. PUUID: ${auth.puuid}`);
      const region = getRegionInfo();
      logger.info(`✅ Region: ${region.region} (${region.shard})`);
    }
  } else {
    logger.warn('⚠️ Riot Client lockfile not found. Please launch Valorant on PC.');
  }

  // Auto-launch PC Dashboard in Desktop Standalone App Mode (Edge/Chrome)
  try {
    exec(`start msedge --app="${dashboardUrl}"`, (err) => {
      if (err) {
        exec(`start "" "${dashboardUrl}"`);
      }
    });
  } catch (e) {}

  // Start polling
  poller.start();
});
