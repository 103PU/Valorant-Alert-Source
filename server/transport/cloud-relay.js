const logger = require('../utils/logger');

/**
 * CloudRelay handles streaming live match score updates to Central Cloudflare Worker
 * (Keylicensedashboard) so remote mobile clients on 4G/5G can receive scores anywhere.
 */
class CloudRelay {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || 'https://keylicensedashboard.dungbd2005.workers.dev').replace(/\/+$/, '');
    this.webBaseUrl = (options.webBaseUrl || 'https://valorant-alert.pages.dev').replace(/\/+$/, '');
    this.getSession = typeof options.getSession === 'function' ? options.getSession : () => null;
    this.isEntitled = typeof options.isEntitled === 'function' ? options.isEntitled : () => false;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.minIntervalMs = options.minIntervalMs || 1500;
    this.enabled = options.enabled !== false;

    this.lastSyncAt = null;
    this.lastError = null;
    this.connected = false;
    this.lastPayloadHash = null;
    this.lastPushTime = 0;
    this.inFlight = false;
  }

  isEnabled() {
    return this.enabled;
  }

  setEnabled(val) {
    this.enabled = !!val;
  }

  getStatus() {
    const session = this.getSession() || {};
    const user = session.user || null;
    const entitled = this.isEntitled();

    return {
      enabled: this.enabled,
      entitled,
      connected: this.connected,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      user: user ? { id: user.id, email: user.email, name: user.name } : null,
      relayWebUrl: this.getRelayWebUrl()
    };
  }

  getRelayWebUrl() {
    const session = this.getSession() || {};
    const user = session.user;
    if (!user || !user.id) return null;
    let url = `${this.webBaseUrl}?mode=relay&userId=${encodeURIComponent(user.id)}&name=${encodeURIComponent(user.name || user.email || '')}`;
    if (this.baseUrl && !this.baseUrl.includes('keylicensedashboard.dungbd2005.workers.dev')) {
      url += `&server=${encodeURIComponent(this.baseUrl)}`;
    }
    return url;
  }

  async broadcastScore(scoreData) {
    if (!this.enabled || !scoreData) return;

    if (!this.isEntitled()) {
      return;
    }

    const session = this.getSession();
    if (!session || !session.jwt || !session.user || !session.user.id) {
      return;
    }

    const now = Date.now();
    const payloadHash = `${scoreData.inGame}:${scoreData.alliedScore}:${scoreData.enemyScore}:${scoreData.status}:${scoreData.round}:${scoreData.mapName}`;
    const isStateChange = this.lastPayloadHash !== payloadHash;

    // Skip if throttled and state hasn't changed
    if (!isStateChange && (now - this.lastPushTime < this.minIntervalMs)) {
      return;
    }

    // Skip concurrent requests to avoid piling up
    if (this.inFlight) {
      return;
    }

    this.inFlight = true;
    this.lastPushTime = now;
    this.lastPayloadHash = payloadHash;

    try {
      const url = `${this.baseUrl}/api/relay/score`;
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.jwt}`
        },
        body: JSON.stringify(scoreData),
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.lastError = `HTTP ${res.status}: ${text || res.statusText}`;
        this.connected = false;
        logger.debug(`[CloudRelay] Push returned status ${res.status}`);
      } else {
        this.connected = true;
        this.lastSyncAt = Date.now();
        this.lastError = null;
        if (isStateChange && scoreData.inGame) {
          logger.info(`[CloudRelay] ☁️ Live score synced to Cloudflare Relay (${scoreData.alliedScore} - ${scoreData.enemyScore})`);
        }
      }
    } catch (err) {
      this.connected = false;
      this.lastError = err.message;
      logger.debug(`[CloudRelay] Push failed: ${err.message}`);
    } finally {
      this.inFlight = false;
    }
  }
}

module.exports = CloudRelay;
