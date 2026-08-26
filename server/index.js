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
const { createApp } = require('./app');

// Resolve paths robustly for Source and Standalone Binary environments
const cwd = process.cwd();
const dirParent = path.join(__dirname, '..');
const rootDir = (fs.existsSync(path.join(cwd, 'config.json')) || fs.existsSync(path.join(cwd, 'public'))) ? cwd : dirParent;
const publicDir = fs.existsSync(path.join(rootDir, 'public')) 
  ? path.join(rootDir, 'public') 
  : (fs.existsSync(path.join(__dirname, '..', 'public')) ? path.join(__dirname, '..', 'public') : path.join(__dirname, 'public'));

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

// Create HTTP Server & WebSocket Server
const server = http.createServer();
const wsServer = new ScoreWSServer(server);
const authToken = wsServer.getToken();
const fullAppUrl = `http://${lanIp}:${PORT}?token=${authToken}`;
const dashboardUrl = `http://localhost:${PORT}/dashboard.html?token=${authToken}`;

// Attach Modular HTTP Request Handler
const appHandler = createApp({
  wsServer,
  lanIp,
  port: PORT,
  rootDir,
  publicDir
});
server.on('request', appHandler);

// Initialize Core Score Poller
const poller = new ScorePoller(config, (scoreData) => {
  wsServer.broadcastScore(scoreData);
});

let reclaimAttempts = 0;

function killPortAndRetry() {
  reclaimAttempts++;
  if (reclaimAttempts > 3) {
    logger.error(`❌ Cổng ${PORT} đang bị chiếm dụng. Vui lòng đóng ứng dụng đang dùng cổng ${PORT} hoặc đổi port trong config.json.`);
    process.exit(1);
    return;
  }
  logger.warn(`⚠️ Cổng ${PORT} bị chiếm bởi tiến trình không phản hồi. Đang thu hồi (Lần ${reclaimAttempts}/3)...`);
  exec(`cmd /c for /f "tokens=5" %a in ('netstat -aon ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /f /pid %a`, () => {
    setTimeout(() => {
      try {
        server.listen(PORT, '0.0.0.0');
      } catch (e) {}
    }, 1500);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Check if an existing Valorant Score Alert instance is already running healthy on this port
    const req = http.get(`http://localhost:${PORT}/api/info`, (res) => {
      if (res.statusCode === 200) {
        logger.info(`✅ Valorant Score Alert đã đang chạy ngầm trên cổng ${PORT}.`);
        logger.info(`🖥️ Đang mở PC Dashboard: http://localhost:${PORT}/dashboard.html`);
        // Just launch the PC Dashboard for user and exit cleanly
        exec(`start msedge --app="http://localhost:${PORT}/dashboard.html"`, (e) => {
          if (e) exec(`start "" "http://localhost:${PORT}/dashboard.html"`);
          process.exit(0);
        });
      } else {
        killPortAndRetry();
      }
    });

    req.on('error', () => {
      killPortAndRetry();
    });

    req.setTimeout(1500, () => {
      req.destroy();
      killPortAndRetry();
    });
  } else {
    logger.error('Server error:', err.message);
  }
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

  // Ensure System Tray Icon is running in background (hidden window)
  try {
    const candidatePaths = [
      path.join(rootDir, 'scripts', 'tray.ps1'),
      path.join(__dirname, '..', 'scripts', 'tray.ps1'),
      path.join(process.cwd(), 'scripts', 'tray.ps1')
    ];
    const trayScript = candidatePaths.find(p => fs.existsSync(p));
    if (trayScript) {
      exec(`powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "${trayScript}"`, {
        cwd: rootDir
      });
    }
  } catch (e) {}

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
