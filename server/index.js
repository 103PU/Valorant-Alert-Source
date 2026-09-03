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
const { createLicensing } = require('./licensing');

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

// Keylicense Dashboard gate (login + license). Always constructed: a missing or
// malformed keylicense block falls back to the built-in defaults rather than
// disabling the gate, because config.json is user-writable.
const licensing = createLicensing({ rawConfig: config, rootDir });

// Create HTTP Server & WebSocket Server
const server = http.createServer();
const wsServer = new ScoreWSServer(server, {
  isEntitled: () => licensing.entitled
});
const authToken = wsServer.getToken();
const fullAppUrl = `http://${lanIp}:${PORT}?token=${authToken}`;
const dashboardUrl = `http://localhost:${PORT}/dashboard.html?token=${authToken}`;

// Attach Modular HTTP Request Handler
const appHandler = createApp({
  wsServer,
  lanIp,
  port: PORT,
  rootDir,
  publicDir,
  licensing
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

function launchBrowserDashboard(url, onFinished) {
  if (process.platform !== 'win32') {
    exec(`explorer.exe "${url}"`, () => { if (onFinished) onFinished(); });
    return;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const browserCandidates = [
    // 1. Google Chrome
    path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // 2. Microsoft Edge
    path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    // 3. Brave Browser
    path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
  ];

  const foundBrowser = browserCandidates.find(p => p && fs.existsSync(p));

  if (foundBrowser) {
    // Launch Chromium browser in standalone app mode (frameless app window)
    exec(`"${foundBrowser}" --app="${url}"`, (err) => {
      if (err) {
        exec(`explorer.exe "${url}"`, () => { if (onFinished) onFinished(); });
      } else {
        if (onFinished) onFinished();
      }
    });
  } else {
    // Open in Windows system default browser (Firefox, Opera, Cốc Cốc, etc.)
    exec(`explorer.exe "${url}"`, () => {
      if (onFinished) onFinished();
    });
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Check if an existing Valorant Score Alert instance is already running healthy on this port
    const req = http.get(`http://localhost:${PORT}/api/info`, (res) => {
      if (res.statusCode === 200) {
        logger.info(`✅ Valorant Score Alert đã đang chạy ngầm trên cổng ${PORT}.`);
        process.exit(0);
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

  // Auto-launch PC Dashboard in Desktop Standalone App Mode (Edge, Chrome, Brave, or System Default)
  try {
    launchBrowserDashboard(dashboardUrl);
  } catch (e) {}

  // Licensing gate: the score feed is the paid feature, so polling follows
  // entitlement for the whole session, not just at boot. start()/stop() are both
  // idempotent (score-poller.js:95, :119), so re-firing on a state change is safe.
  // There is deliberately no "licensing absent" branch — the poller starts only
  // from an entitled gate state, never from the shape of config.json.
  try {
    const snap = await licensing.start();
    logger.info('===========================================================');
    if (snap.entitled) {
      const label = snap.license && snap.license.plan ? `plan ${snap.license.plan}` : snap.state;
      logger.info(`✅ License hợp lệ (${label}). Bắt đầu theo dõi tỉ số.`);
    } else if (snap.state === 'NOT_LOGGED_IN') {
      logger.warn('🔑 Chưa đăng nhập. Mở Dashboard và bấm "Đăng nhập Google" để kích hoạt.');
    } else {
      logger.warn(`⚠️ Chưa có license khả dụng (${snap.state}${snap.reason ? `: ${snap.reason}` : ''}).`);
    }
    logger.info('===========================================================');
  } catch (e) {
    // A failed check leaves the gate on its last state, which is never entitled
    // on a first run — so this logs and falls through without starting polling.
    logger.error('Không kiểm tra được license:', e.message);
  }

  licensing.onChange((snap) => {
    if (snap.entitled) {
      poller.start();
    } else {
      poller.stop();
    }
  });

  if (licensing.entitled) poller.start();
});
