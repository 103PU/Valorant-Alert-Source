const logger = require('../utils/logger');
const { loadSettings } = require('./api-settings');

function readJsonBody(req, limitBytes = 16 * 1024) {
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

async function handleApiSimulator(req, res, { wsServer, cloudRelay, nativeSound, licensing }) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }

  const parsed = new URL(req.url, 'http://localhost');
  const token = parsed.searchParams.get('token');
  const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const isLocal = req.socket && loopback.has(req.socket.remoteAddress);

  if (!isLocal && (!token || token !== wsServer.getToken())) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'invalid_token' }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const scoreData = {
      inGame: body.inGame !== false,
      matchId: body.matchId || body.mapName || 'ASCENT',
      mapName: body.mapName || 'ASCENT',
      gameMode: body.gameMode || 'COMPETITIVE',
      alliedScore: Number(body.alliedScore) || 0,
      enemyScore: Number(body.enemyScore) || 0,
      status: body.status || 'IN_MATCH',
      timestamp: Date.now()
    };

    if (wsServer) wsServer.broadcastScore(scoreData);
    if (cloudRelay) cloudRelay.broadcastScore(scoreData);

    if (nativeSound) {
      const appDataDir = licensing && licensing.cfg && licensing.cfg.appDataDir;
      const settings = loadSettings(appDataDir);
      const hasActiveClients = wsServer ? wsServer.getClientCount() > 0 : false;
      nativeSound.handleScoreUpdate(scoreData, settings, hasActiveClients);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, scoreData }));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

module.exports = { handleApiSimulator };
