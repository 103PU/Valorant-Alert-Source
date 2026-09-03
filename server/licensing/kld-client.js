const { url } = require('./config');

// Thin HTTP client for Keylicense Dashboard. Node 18+ global fetch, no new deps.
//
// Two failure classes matter to the gate and are deliberately distinguishable:
//   - KldNetworkError: KLD was unreachable or timed out. Offline grace may apply.
//   - KldError:        KLD answered and refused. Grace must NOT apply.
// Collapsing them would let a revoked license keep working by pulling the plug.
class KldError extends Error {
  constructor(status, code, message, data) {
    super(message || `KLD returned ${status}`);
    this.name = 'KldError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

class KldNetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KldNetworkError';
  }
}

// KLD reports failures as either {error: "auth_required"} or {error: {code}},
// and sometimes carries a `reason` alongside ok:true. Read all three.
function extractCode(data, status) {
  if (data && typeof data === 'object') {
    if (typeof data.reason === 'string' && data.reason.trim()) return data.reason.trim();
    const e = data.error;
    if (typeof e === 'string' && e.trim()) return e.trim();
    if (e && typeof e === 'object' && typeof e.code === 'string' && e.code.trim()) {
      return e.code.trim();
    }
  }
  return `upstream_${status}`;
}

class KldClient {
  constructor(cfg) {
    this.cfg = cfg;
  }

  async request(endpointPath, { method = 'GET', jwt = null, json = null } = {}) {
    const headers = { accept: 'application/json' };
    if (jwt) headers.authorization = `Bearer ${jwt}`;
    if (json !== null) headers['content-type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.httpTimeoutMs);

    let res;
    try {
      res = await fetch(url(this.cfg, endpointPath), {
        method,
        headers,
        body: json !== null ? JSON.stringify(json) : undefined,
        signal: controller.signal
      });
    } catch (e) {
      throw new KldNetworkError(
        e.name === 'AbortError'
          ? `KLD timed out after ${this.cfg.httpTimeoutMs}ms`
          : `KLD unreachable: ${e.message}`
      );
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (!res.ok) {
      throw new KldError(res.status, extractCode(data, res.status), `KLD ${endpointPath} failed`, data);
    }
    return data;
  }

  // --- auth -----------------------------------------------------------------

  getGoogleClientId() {
    return this.request(this.cfg.endpoints.googleClientId);
  }

  // Exchanges a loopback OAuth code for a KLD session JWT. The Google client
  // secret lives on KLD, never in this desktop app, which is why the code goes
  // here instead of straight to Google's token endpoint.
  exchangeGoogleCode({ code, redirectUri, codeVerifier }) {
    return this.request(this.cfg.endpoints.googleExchange, {
      method: 'POST',
      json: { code, redirectUri, codeVerifier }
    });
  }

  // --- licenses -------------------------------------------------------------

  // productId scopes the read to this app. Unscoped, KLD answers with whatever
  // license the account last applied — for an existing Valorant Tweaks customer
  // that is a tweaks key. That key then fails activation with
  // product_not_allowed_for_license (KLD worker/index.ts:9150) and the gate lands
  // on BLOCKED, whose message ("hết hạn, bị thu hồi, hoặc vượt số thiết bị") is
  // wrong for the actual cause. Scoped, KLD answers license:null with
  // reason:"applied_license_product_mismatch" and checkOnline falls through to
  // the trial path instead.
  getAppliedLicense(jwt) {
    const q = `productId=${encodeURIComponent(this.cfg.productId)}`;
    return this.request(`${this.cfg.endpoints.appliedLicense}?${q}`, { jwt });
  }

  listMyLicenses(jwt) {
    return this.request(this.cfg.endpoints.myLicenses, { jwt });
  }

  claimLicense(jwt, licenseKey) {
    return this.request(this.cfg.endpoints.claimLicense, {
      method: 'POST',
      jwt,
      json: { licenseKey, productId: this.cfg.productId }
    });
  }

  applyLicense(jwt, licenseKey) {
    return this.request(this.cfg.endpoints.applyLicense(licenseKey), { method: 'POST', jwt });
  }

  getChallenge(jwt) {
    return this.request(this.cfg.endpoints.challenge, { jwt });
  }

  activateLicense(jwt, { licenseKey, deviceId, deviceName, nonce }) {
    return this.request(this.cfg.endpoints.activateLicense(licenseKey), {
      method: 'POST',
      jwt,
      json: {
        licenseKey,
        productId: this.cfg.productId,
        deviceId,
        deviceName,
        platform: this.cfg.platform,
        appVersion: this.cfg.appVersion,
        nonce
      }
    });
  }

  // --- trials ---------------------------------------------------------------

  startTrial(jwt, { deviceId, deviceName }) {
    return this.request(this.cfg.endpoints.startTrial, {
      method: 'POST',
      jwt,
      json: {
        productId: this.cfg.productId,
        deviceId,
        deviceName,
        appVersion: this.cfg.appVersion
      }
    });
  }

  verifyTrial(jwt, { deviceId }) {
    return this.request(this.cfg.endpoints.verifyTrial, {
      method: 'POST',
      jwt,
      json: { productId: this.cfg.productId, deviceId }
    });
  }
}

module.exports = { KldClient, KldError, KldNetworkError, extractCode };
