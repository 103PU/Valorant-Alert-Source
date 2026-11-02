const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DEFAULT_SETTINGS = {
  masterVolume: 0.8,
  soundPreset: 'melodicChime',
  customRound: 10,
  isPcAudioEnabled: true,
  evtMatchPoint: true,
  evtRoundChange: true,
  evtCustomRound: true,
  evtMatchEnded: true,
  evtSpikePlanted: true,
  evtOvertime: true,
  evtDangerVignette: true,
  evtDiscordMatchPoint: true,
  evtDiscordMatchEnd: true,
  evtDesktopNotify: false,
  discordWebhook: '',
  activeSyncMode: 'cloud',
  lang: 'vi'
};

function getSettingsFilePath(appDataDir) {
  const dir = appDataDir || (process.env.APPDATA ? path.join(process.env.APPDATA, 'ValorantAlert') : path.join(__dirname, '..', '..'));
  return path.join(dir, 'settings.json');
}

function loadSettings(appDataDir) {
  try {
    const filePath = getSettingsFilePath(appDataDir);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) {
    logger.warn('[Settings] Failed to read settings.json, using defaults:', e.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(appDataDir, updates) {
  try {
    const dir = appDataDir || (process.env.APPDATA ? path.join(process.env.APPDATA, 'ValorantAlert') : path.join(__dirname, '..', '..'));
    fs.mkdirSync(dir, { recursive: true });
    const current = loadSettings(dir);
    const merged = { ...current, ...updates };
    const filePath = path.join(dir, 'settings.json');
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (e) {
    logger.error('[Settings] Failed to save settings.json:', e.message);
    throw e;
  }
}

function readJsonBody(req, limitBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(req) {
  const addr = req.socket && req.socket.remoteAddress;
  return !!addr && LOOPBACK.has(addr);
}

async function handleApiSettings(req, res, { licensing, wsServer }) {
  const parsed = new URL(req.url, 'http://localhost');
  const token = parsed.searchParams.get('token');
  const appDataDir = licensing && licensing.cfg && licensing.cfg.appDataDir;

  const isLocal = isLoopback(req);
  if (!isLocal && (!token || token !== wsServer.getToken())) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'invalid_token' }));
    return;
  }

  if (req.method === 'GET') {
    const settings = loadSettings(appDataDir);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({ ok: true, settings }));
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const updated = saveSettings(appDataDir, body);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(JSON.stringify({ ok: true, settings: updated }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
}

module.exports = { handleApiSettings, loadSettings, saveSettings, DEFAULT_SETTINGS };
