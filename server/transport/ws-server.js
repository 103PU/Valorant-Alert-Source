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
  constructor(httpServer, { isEntitled } = {}) {
    this.httpServer = httpServer;
    this.authToken = this.generateToken();
    this.wss = new WebSocketServer({ noServer: true });
    this.lastPayloadJson = null;
    this.isEntitled = typeof isEntitled === 'function' ? isEntitled : () => false;

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

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      logger.info(`[WSServer] Client authenticated and connected from: ${clientIp}`);

      // Send latest score state immediately on connect if available
      if (this.lastPayloadJson) {
        ws.send(this.lastPayloadJson);
      }

      // Respond to ping heartbeats from mobile clients
      ws.on('message', (msg) => {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch (e) {}
      });

      ws.on('close', () => {
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

  getToken() {
    return this.authToken;
  }
}

module.exports = ScoreWSServer;
