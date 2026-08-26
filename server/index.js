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
