const logger = require('../utils/logger');

// Licensing endpoints for both UIs.
//
// Security: this server binds 0.0.0.0 so a phone on the LAN can reach it, which
// means these routes are LAN-reachable too. Two guards, deliberately different:
//   - every route requires the share pin, the same secret that gates the WS upgrade
//   - state-changing routes additionally require a loopback caller
// Login spawns a browser on the host machine and logout destroys the session, so
// neither should ever be triggerable from another device on the network.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(req) {
  const addr = req.socket && req.socket.remoteAddress;
  return !!addr && LOOPBACK.has(addr);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limitBytes = 8 * 1024) {
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

async function handleApiLicense(req, res, { licensing, wsServer }) {
  // Unreachable from server/index.js, which always constructs a gate. Kept as a
  // fail-closed guard so a future caller that forgets the argument gets a clear
  // 503 instead of a TypeError halfway through a handler.
  if (!licensing) {
    return sendJson(res, 503, { ok: false, error: 'licensing_unavailable' });
  }

  const parsed = new URL(req.url, 'http://localhost');
  const action = parsed.pathname.replace(/^\/api\/license\/?/, '').replace(/\/+$/, '');
  const token = parsed.searchParams.get('token');

  if (!token || token !== wsServer.getToken()) {
    return sendJson(res, 401, { ok: false, error: 'invalid_token' });
  }

  const requireLocal = () => {
    if (isLoopback(req)) return true;
    sendJson(res, 403, { ok: false, error: 'loopback_only' });
    return false;
  };

  const requirePost = () => {
    if (req.method === 'POST') return true;
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return false;
  };

  try {
    switch (action) {
      case 'status':
        return sendJson(res, 200, { ok: true, ...licensing.gate.snapshot() });

      case 'recheck': {
        if (!requirePost()) return;
        const snap = await licensing.gate.check();
        return sendJson(res, 200, { ok: true, ...snap });
      }

      // Update availability. GET because it is a read and the dashboard polls it,
      // and deliberately separate from `status`: an update check that fails must
      // not be able to make the entitlement snapshot look degraded.
      case 'app-version':
        return sendJson(res, 200, await licensing.checkAppVersion());

      case 'login': {
        if (!requirePost() || !requireLocal()) return;
        const snap = await licensing.login();
        return sendJson(res, 200, { ok: true, ...snap });
      }

      case 'logout': {
        if (!requirePost() || !requireLocal()) return;
        const snap = licensing.logout();
        return sendJson(res, 200, { ok: true, ...snap });
      }

      // Applies a key the user pasted, then rechecks. Mirrors the ValorantTweaks
      // flow: claim (if not owned yet) → apply → activate.
      case 'apply-key': {
        if (!requirePost() || !requireLocal()) return;
        const body = await readJsonBody(req);
        const key = typeof body.licenseKey === 'string' ? body.licenseKey.trim() : '';
        if (!key) return sendJson(res, 400, { ok: false, error: 'licenseKey_required' });
        const snap = await licensing.applyKey(key);
        return sendJson(res, 200, { ok: true, ...snap });
      }

      default:
        return sendJson(res, 404, { ok: false, error: 'unknown_action' });
    }
  } catch (e) {
    logger.error(`[license] ${action} failed:`, e.message);
    return sendJson(res, 400, {
      ok: false,
      error: e.code || 'request_failed',
      message: e.message,
      ...licensing.gate.snapshot()
    });
  }
}

module.exports = { handleApiLicense };
