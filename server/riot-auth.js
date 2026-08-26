const { readLockfile } = require('./lockfile-reader');

// Ignore self-signed certificates for local HTTPS requests to Riot Client
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let cachedAuth = null;
let refreshTimer = null;

/**
 * Fetches or refreshes entitlement token and access token from Riot Client.
 */
async function refreshAuthData() {
  const lockfile = readLockfile();
  if (!lockfile) {
    console.warn('[RiotAuth] Lockfile not available. Riot Client may not be running.');
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

    console.log(`[RiotAuth] Tokens refreshed successfully for PUUID: ${puuid}`);

    // Schedule auto-refresh in 45 minutes (2700000 ms)
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      console.log('[RiotAuth] Scheduled 45-min token auto-refresh running...');
      refreshAuthData().catch(e => console.error('[RiotAuth] Auto-refresh error:', e.message));
    }, 45 * 60 * 1000);

    return cachedAuth;
  } catch (err) {
    console.error('[RiotAuth] Error fetching entitlements token:', err.message);
    cachedAuth = null;
    return null;
  }
}

/**
 * Returns current cached auth data or triggers a refresh if missing.
 */
async function getAuthData(forceRefresh = false) {
  if (forceRefresh || !cachedAuth) {
    return await refreshAuthData();
  }
  return cachedAuth;
}

module.exports = { getAuthData, refreshAuthData };
