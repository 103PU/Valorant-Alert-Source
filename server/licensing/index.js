const logger = require('../utils/logger');
const { resolveLicenseConfig } = require('./config');
const { KldClient, KldError, KldNetworkError } = require('./kld-client');
const { LicenseStore } = require('./store');
const { getDeviceId, getDeviceName } = require('./device-id');
const { LicenseGate, STATE, isEntitled } = require('./gate');
const { loginWithGoogle } = require('./auth');
const { checkForUpdate } = require('./app-version');

// Re-verify periodically so a revoked or expired license stops working within a
// bounded window rather than only at next launch. 6h is a compromise: frequent
// enough to matter commercially, rare enough not to hammer KLD.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// The update check's GitHub fallback is unauthenticated, and GitHub allows 60
// requests per hour per IP. The dashboard can be reopened and refreshed freely,
// so cache the answer instead of spending a request per page load — a version
// that changed five minutes ago is not worth a 403 for the next hour.
const UPDATE_CHECK_TTL_MS = 30 * 60 * 1000;

class Licensing {
  constructor({ rawConfig, rootDir }) {
    this.cfg = resolveLicenseConfig(rawConfig, rootDir);
    this.kld = new KldClient(this.cfg);
    this.store = new LicenseStore(this.cfg.appDataDir);
    this.deviceId = getDeviceId(this.cfg.appDataDir);
    this.deviceName = getDeviceName();
    this.gate = new LicenseGate({
      cfg: this.cfg,
      kld: this.kld,
      store: this.store,
      deviceId: this.deviceId,
      deviceName: this.deviceName
    });
    this.loginInFlight = null;
    this.timer = null;
    this.updateCache = null;
  }

  get state() {
    return this.gate.state;
  }

  get entitled() {
    return isEntitled(this.gate.state);
  }

  onChange(fn) {
    this.gate.onChange(fn);
  }

  /** Initial check at boot, then the periodic re-verify. */
  async start() {
    const snap = await this.gate.check();
    this.timer = setInterval(() => {
      this.gate.check().catch((e) => logger.warn('[license] periodic recheck failed:', e.message));
    }, RECHECK_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    return snap;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One login at a time. A second click while the browser tab is already open
   * joins the in-flight attempt instead of trying to bind the loopback port twice
   * (which would fail with EADDRINUSE and look like a real error to the user).
   */
  async login() {
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = (async () => {
      try {
        const data = await loginWithGoogle({ cfg: this.cfg, kld: this.kld });
        this.store.setSession(data.jwt, data.user);
        logger.info(`[license] logged in as ${data.user && data.user.email}`);
        return await this.gate.check();
      } finally {
        this.loginInFlight = null;
      }
    })();

    return this.loginInFlight;
  }

  logout() {
    this.store.clearSession();
    this.gate.set(STATE.NOT_LOGGED_IN);
    logger.info('[license] logged out');
    return this.gate.snapshot();
  }

  /**
   * Update availability, cached. Never throws: checkForUpdate reports refused
   * sources in `warnings` and returns source:'none' when nothing could answer,
   * because an update check that cannot run must not look like a blocked app.
   * Entitlement is decided by this.gate and nothing here touches it.
   */
  async checkAppVersion() {
    const now = Date.now();
    if (this.updateCache && now - this.updateCache.at < UPDATE_CHECK_TTL_MS) {
      return this.updateCache.result;
    }
    const result = await checkForUpdate(this.cfg, this.kld);
    this.updateCache = { at: now, result };
    return result;
  }

  /**
   * Apply a key the user pasted. Claim first so a key that is not yet on the
   * account becomes theirs; an already-claimed key is not an error here, so that
   * reason is swallowed and the flow continues to apply.
   */
  async applyKey(licenseKey) {
    const jwt = this.store.getJwt();
    if (!jwt) throw new KldError(401, 'not_logged_in', 'Cần đăng nhập trước khi nhập key.');

    try {
      await this.kld.claimLicense(jwt, licenseKey);
      logger.info('[license] key claimed');
    } catch (e) {
      if (e instanceof KldNetworkError) throw e;
      // Already owned / already claimed by this user: keep going.
      const benign = ['already_claimed', 'already_owned', 'license_already_claimed'];
      if (!benign.includes(e.code)) {
        logger.warn(`[license] claim returned ${e.code}, continuing to apply`);
      }
    }

    await this.kld.applyLicense(jwt, licenseKey);
    logger.info('[license] key applied, re-checking entitlement');
    return this.gate.check();
  }
}

/**
 * Always returns a Licensing instance.
 *
 * It used to return null when config.json had no `keylicense` block, and
 * server/index.js answered that null by starting the poller unconditionally —
 * so deleting three lines from the plaintext config.json that ships beside the
 * .exe turned the paid app into a free one. config.json is a file the end user
 * can write, which makes it untrusted input; it must not be able to decide
 * whether the gate exists.
 *
 * Nothing has to be invented to remove that branch: DEFAULTS in ./config
 * already carries a working baseUrl, productId and platform, and auth.js reads
 * the Google client id from KLD before falling back to config. A missing or
 * malformed block therefore yields a fully functional gate, and removing the
 * block is now a no-op rather than a bypass.
 */
function createLicensing({ rawConfig, rootDir }) {
  if (!rawConfig || !rawConfig.keylicense) {
    logger.warn('[license] no keylicense block in config.json — using built-in defaults');
  }
  return new Licensing({ rawConfig, rootDir });
}

module.exports = { createLicensing, Licensing, STATE, isEntitled };
