const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ScoreWSServer {
  // isEntitled: () => boolean. Injected rather than importing the licensing
  // module here, so the transport stays testable on its own.
  //
  // Anything that is not a function becomes () => false. It used to default to
  // null with the call site written `if (this.isEntitled && !this.isEntitled())`,
  // so a missing gate read as "allowed" — a wiring mistake or a forgotten
  // argument silently unlocked the paid feed. A destructuring default alone is
  // not enough either: it only covers undefined, so an explicit null would then
  // throw inside the upgrade handler and take the process down. An entitlement
  // check must fail closed and stay up: no usable gate means no stream.
  constructor(httpServer, { isEntitled, token, getLastScore } = {}) {
    this.httpServer = httpServer;
    this.authToken = (typeof token === 'string' && token.trim()) ? token.trim().toUpperCase() : this.generateToken();
    this.wss = new WebSocketServer({ noServer: true });
    this.lastPayloadJson = null;
    this.isEntitled = typeof isEntitled === 'function' ? isEntitled : () => false;
    this.getLastScore = typeof getLastScore === 'function' ? getLastScore : null;
    this.connectedClients = new Map();

    this.init();
  }

  generateToken() {
    return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars, e.g. '3A8F1C'
  }

  init() {
    // Handle HTTP Upgrade to WebSocket using WHATWG URL API
    this.httpServer.on('upgrade', (request, socket, head) => {
      const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const clientToken = requestUrl.searchParams.get('token');

      if (!clientToken || clientToken !== this.authToken) {
        logger.warn(`[WSServer] Handshake rejected. Invalid token: "${clientToken}"`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // A valid pin is not enough: the score feed is the paid feature, so an
      // unentitled instance must not stream it to any client, local or LAN.
      if (!this.isEntitled()) {
        logger.warn('[WSServer] Handshake rejected: license not active.');
        socket.write('HTTP/1.1 402 Payment Required\r\n\r\n');
        socket.destroy();
        return;
      }

      if (socket && typeof socket.setNoDelay === 'function') {
        socket.setNoDelay(true);
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws, req) => {
      if (req && req.socket) {
        if (typeof req.socket.setNoDelay === 'function') req.socket.setNoDelay(true);
        if (typeof req.socket.setKeepAlive === 'function') req.socket.setKeepAlive(true, 15000);
      }
      const clientIp = req.socket ? req.socket.remoteAddress : 'unknown';
      const cleanIp = (clientIp || '').replace(/^.*:/, '') || clientIp;
      const ua = (req.headers && req.headers['user-agent']) || '';
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
      const isWindows = /Windows/i.test(ua);
      const isMac = /Macintosh|Mac OS/i.test(ua);
      const isLinux = /Linux/i.test(ua) && !isMobile;
      const os = isMobile ? (/iPhone|iPad|iPod/i.test(ua) ? 'iOS' : 'Android') : (isWindows ? 'Windows' : (isMac ? 'macOS' : (isLinux ? 'Linux' : 'Desktop')));
      const clientId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(6).toString('hex');
      const clientData = {
        id: clientId,
        ip: cleanIp,
        type: isMobile ? 'mobile' : 'desktop',
        os,
        name: isMobile ? `Mobile (${os})` : (cleanIp === '127.0.0.1' || cleanIp === 'localhost' ? 'Dashboard Host' : `Client (${os})`),
        connectedAt: Date.now(),
        lastActive: Date.now()
      };
      this.connectedClients.set(ws, clientData);
      logger.info(`[WSServer] Client authenticated and connected from: ${clientIp} (${clientData.name})`);

      // Send latest score state immediately on connect if available
      if (this.lastPayloadJson) {
        ws.send(this.lastPayloadJson);
      } else if (this.getLastScore) {
        const last = this.getLastScore();
        if (last) {
          try { ws.send(JSON.stringify(last)); } catch (e) {}
        }
      }

      // Respond to ping heartbeats and client hello
      ws.on('message', (msg) => {
        try {
          const parsed = JSON.parse(msg);
          const current = this.connectedClients.get(ws);
          if (current) current.lastActive = Date.now();
          if (parsed.type === 'client_hello') {
            if (current) {
              if (parsed.device) current.type = parsed.device;
              if (parsed.name) current.name = parsed.name;
              if (parsed.os) current.os = parsed.os;
            }
          } else if (parsed.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch (e) {}
      });

      ws.on('close', () => {
        this.connectedClients.delete(ws);
        logger.info(`[WSServer] Client disconnected: ${clientIp}`);
      });
    });
  }

  broadcastScore(scoreData) {
    const payloadJson = JSON.stringify(scoreData);

    // Skip duplicate payload if nothing changed
    if (this.lastPayloadJson === payloadJson) {
      return;
    }

    this.lastPayloadJson = payloadJson;

    for (const client of this.wss.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(payloadJson);
      }
    }
  }

  getClientCount() {
    let count = 0;
    for (const client of this.wss.clients) {
      if (client.readyState === 1) count++;
    }
    return count;
  }

  getConnectedDevices() {
    const list = [
      {
        id: 'host-pc',
        name: 'PC Host (App Master)',
        type: 'desktop',
        os: 'Windows',
        ip: '127.0.0.1',
        isHost: true,
        status: 'online',
        connectedAt: Date.now()
      }
    ];

    for (const [ws, data] of this.connectedClients.entries()) {
      if (ws.readyState === 1) {
        list.push({
          id: data.id,
          name: data.name,
          type: data.type,
          os: data.os,
          ip: data.ip,
          isHost: false,
          status: 'online',
          connectedAt: data.connectedAt,
          lastActive: data.lastActive
        });
      }
    }
    return list;
  }

  getToken() {
    return this.authToken;
  }
}

module.exports = ScoreWSServer;
