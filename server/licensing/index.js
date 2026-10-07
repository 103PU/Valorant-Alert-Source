const logger = require('../utils/logger');
const { resolveLicenseConfig } = require('./config');
const { KldClient, KldError, KldNetworkError } = require('./kld-client');
const { LicenseStore } = require('./store');
const { getDeviceId, getDeviceName } = require('./device-id');
const { LicenseGate, STATE, isEntitled } = require('./gate');
const { loginWithGoogle } = require('./auth');
const { checkForUpdate } = require('./app-version');
const { UpdateInstaller } = require('../updater');

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
    // Installing an update is not a licensing concern, but cfg — releaseRepo,
    // appVersion, appDataDir — is owned here, and this facade is the only object the
    // route layer is handed. Constructed eagerly and cheaply: the constructor only
    // computes paths, and every side effect waits for start().
    this.updater = new UpdateInstaller({ cfg: this.cfg });
  }

  get state() {
    return this.gate.state;
  }

  get entitled() {
    return isEntitled(this.gate.state);
  }

  isServiceEntitled(serviceCode) {
    return this.gate ? this.gate.isServiceEntitled(serviceCode) : false;
  }

  getEntitledServices() {
    return this.gate ? this.gate.getEntitledServices() : [];
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
   * Starts the download-and-install run and returns at once; the dashboard polls
   * `update/state` for progress.
   *
   * The version comes from this server's own update check, never from the caller.
   * A client-supplied version — let alone a client-supplied URL — would turn a
   * LAN-reachable route into an arbitrary download-and-execute primitive.
   *
   * Refuses when the check found nothing to install. `source:'none'` is what a check
   * that could reach nobody returns (it fails open on purpose), and "could not tell"
   * must never start an install of the version already running.
   */
  async startUpdate() {
    const info = await this.checkAppVersion();
    if (!info.softUpdateAvailable && !info.forceUpdateRequired) {
      const err = new Error('Chưa có bản cập nhật nào để tải.');
      err.code = 'no_update_available';
      throw err;
    }
    const downloadUrl = (info.recommended && info.recommended.url) || null;
    const checksumUrl = info.checksumUrl || null;
    const started = await this.updater.start(info.latestVersion, { downloadUrl, checksumUrl });
    return { ...started, releasePageUrl: info.releasePageUrl };
  }

  updateState() {
    return this.updater.snapshot();
  }

  cancelUpdate() {
    return this.updater.cancel();
  }

  /**
   * Apply a key the user entered.
   * Follows Spec Section 1.3: Challenge-Response activation against Server KLD,
   * stores key locally, and optionally links to Google account if logged in.
   */
  async applyKey(licenseKey) {
    if (!licenseKey || typeof licenseKey !== 'string' || !licenseKey.trim()) {
      throw new KldError(400, 'license_key_required', 'Vui lòng nhập License Key.');
    }
    const cleanKey = licenseKey.trim();

    const jwt = this.store.getJwt();
    let activated = false;

    // 1. Account linking & authenticated activation if logged into Google OAuth
    if (jwt) {
      try {
        await this.kld.claimLicense(jwt, cleanKey);
      } catch (e) {
        if (e instanceof KldNetworkError) throw e;
        const benign = ['already_claimed', 'already_owned', 'license_already_claimed'];
        if (!benign.includes(e.code)) {
          logger.warn(`[license] claim returned ${e.code}, continuing to apply`);
        }
      }

      try {
        await this.kld.applyLicense(jwt, cleanKey);
      } catch (e) {
        if (e instanceof KldNetworkError) throw e;
        logger.warn(`[license] applyLicense returned ${e.code || e.message}`);
      }

      try {
        const challenge = await this.kld.getChallenge(jwt);
        const nonce = challenge && challenge.nonce;
        if (nonce) {
          const actRes = await this.kld.activateLicense(jwt, {
            licenseKey: cleanKey,
            deviceId: this.deviceId,
            deviceName: this.deviceName,
            nonce
          });
          if (actRes && actRes.ok !== false && actRes.valid !== false) {
            activated = true;
          }
        }
      } catch (e) {
        if (e instanceof KldNetworkError) throw e;
        logger.warn(`[license] authenticated activate returned ${e.code || e.message}, trying public fallback`);
      }
    }

    // 2. Challenge-Response Activation against Server KLD (Spec Section 1.3 / fallback)
    if (!activated) {
      try {
        const challenge = await this.kld.getChallengePublic(this.cfg.productId);
        const nonce = challenge && challenge.nonce;
        if (nonce) {
          await this.kld.activatePublic({
            licenseKey: cleanKey,
            deviceId: this.deviceId,
            deviceName: this.deviceName,
            nonce,
            productId: this.cfg.productId
          });
          activated = true;
        }
      } catch (e) {
        if (e instanceof KldNetworkError) throw e;
        const benign = ['device_already_active', 'activation_reused', 'already_activated'];
        if (benign.includes(e.code) || e.status === 404) {
          activated = true;
        } else if (!jwt) {
          throw e;
        }
      }
    }

    // Persist license key
    this.store.setLicenseKey(cleanKey);

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
