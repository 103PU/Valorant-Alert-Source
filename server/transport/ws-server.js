const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ScoreWSServer {
  constructor(httpServer) {
    this.httpServer = httpServer;
    this.authToken = this.generateToken();
    this.wss = new WebSocketServer({ noServer: true });
    this.lastPayloadJson = null;

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
