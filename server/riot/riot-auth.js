const { readLockfile } = require('./lockfile-reader');
const logger = require('../utils/logger');

// Ignore self-signed certificates for local HTTPS requests to Riot Client
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let cachedAuth = null;
let refreshTimer = null;

/**
 * Fetches or refreshes entitlement token and access token from Riot Client.
 */
async function refreshAuthData(autoRefreshMins = 45) {
  const lockfile = readLockfile();
  if (!lockfile) {
    logger.warn('[RiotAuth] Lockfile not available. Riot Client may not be running.');
    cachedAuth = null;
    return null;
  }

  try {
    const res = await fetch(`${lockfile.baseUrl}/entitlements/v1/token`, {
      headers: {
        'Authorization': lockfile.authHeader
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();

    const accessToken = data.accessToken;
    const entitlement = typeof data.entitlements === 'string'
      ? data.entitlements
      : (data.token || (Array.isArray(data.entitlements) ? data.entitlements[0] : ''));

    let puuid = data.subject || data.sub;
    if (!puuid && accessToken) {
      try {
        const payloadBase64 = accessToken.split('.')[1];
        const decodedPayload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        puuid = decodedPayload.sub;
      } catch (e) {}
    }

    cachedAuth = {
      accessToken,
      entitlement,
      puuid,
      lockfile,
      fetchedAt: Date.now()
    };

    logger.info(`[RiotAuth] Tokens refreshed successfully for PUUID: ${puuid}`);

    // Schedule auto-refresh
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      logger.info('[RiotAuth] Scheduled token auto-refresh running...');
      refreshAuthData(autoRefreshMins).catch(e => logger.error('[RiotAuth] Auto-refresh error:', e.message));
    }, autoRefreshMins * 60 * 1000);

    return cachedAuth;
  } catch (err) {
    logger.error('[RiotAuth] Error fetching entitlements token:', err.message);
    cachedAuth = null;
    return null;
  }
}

async function getAuthData(forceRefresh = false, autoRefreshMins = 45) {
  if (forceRefresh || !cachedAuth) {
    return await refreshAuthData(autoRefreshMins);
  }
  return cachedAuth;
}

module.exports = { getAuthData, refreshAuthData };
