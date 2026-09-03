const logger = require('../utils/logger');
const { KldError, KldNetworkError } = require('./kld-client');
const { SignatureError, verifyEnvelope, extractEnvelope, issuedAtMs } = require('./signature');
const { isPlanAllowed } = require('./policy');

const DAY_MS = 24 * 60 * 60 * 1000;

// Entitlement states surfaced to the UI and to the server's own start/stop logic.
const STATE = {
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',   // no KLD session yet
  NEEDS_LICENSE: 'NEEDS_LICENSE',   // logged in, but nothing applied — "cần active keylicense"
  LICENSED: 'LICENSED',
  TRIAL: 'TRIAL',
  OFFLINE_GRACE: 'OFFLINE_GRACE',   // KLD unreachable, inside the grace window
  BLOCKED: 'BLOCKED'                // expired / revoked / device limit / grace expired
};

const ENTITLED = new Set([STATE.LICENSED, STATE.TRIAL, STATE.OFFLINE_GRACE]);

// Mirrors ValorantTweaks' ShouldBlockTrialFallback: only "there is no license at
// all" may fall through to a trial. Any other refusal (expired, revoked, device
// limit) is a real denial and must not be softened into a trial.
const TRIAL_FALLBACK_REASONS = new Set([
  'no_license',
  'no_applied_license',
  'applied_license_unavailable',
  // The account does have a license applied, but scoped to another product — a
  // Valorant Tweaks key, for the customers most likely to try this app first.
  // The scoped applied-license read reports the first; activate reports the
  // second if a key gets applied between that read and the activation call.
  // Neither means the user is blocked: it means there is no valorant-alert
  // license yet, which is exactly what the trial path is for.
  'applied_license_product_mismatch',
  'product_not_allowed_for_license'
]);

function isEntitled(state) {
  return ENTITLED.has(state);
}

// KLD returns license records in snake_case; ValorantTweaks' models are camelCase.
// Normalise to one shape so the info panel does not have to care which.
function normalizeLicense(raw) {
  if (!raw) return null;
  return {
    key: raw.license_key || raw.licenseKey || raw.key || null,
    productId: raw.product_id || raw.productId || null,
    plan: raw.plan || null,
    keyType: raw.key_type || raw.keyType || raw.display_type || null,
    status: raw.status || null,
    expiresAt: raw.expires_at || raw.expiresAt || null,
    maxDevices: raw.max_devices ?? raw.maxDevices ?? null,
    activatedDevices: raw.activated_devices ?? raw.activatedDevices ?? null
  };
}

function normalizeTrial(raw) {
  if (!raw) return null;
  return {
    status: raw.status || null,
    startedAt: raw.startedAt || raw.started_at || null,
    expiresAt: raw.expiresAt || raw.expires_at || null,
    remainingSeconds: raw.remainingSeconds ?? raw.remaining_seconds ?? null
  };
}

class LicenseGate {
  constructor({ cfg, kld, store, deviceId, deviceName, trust = null }) {
    this.cfg = cfg;
    this.kld = kld;
    this.store = store;
    this.deviceId = deviceId;
    this.deviceName = deviceName;

    // Test-only seam for the trust anchors: { keys, requireSignature }. Nothing
    // in the app passes it, so production always reads ./signing-keys. It is a
    // code-level parameter on purpose — reachable from config.json it would be
    // the fifth bypass, and archive patching is already conceded as out of scope
    // (docs/kld-entitlement-signing.md §9 item 3).
    this.trust = trust || {};

    this.state = store.isLoggedIn() ? STATE.NEEDS_LICENSE : STATE.NOT_LOGGED_IN;
    this.reason = null;
    this.message = null;
    this.checking = false;
    this.lastCheckedAt = null;
    this.listeners = [];

    // Last signature verdict, for the rollout-step-3 question "is every activate
    // arriving signed yet?". Informational only — never consulted as a decision.
    this.signature = { verified: false, kid: null, warning: null };
    // Days computed from a *signed* issuedAt, when there was one. Kept so the
    // snapshot reports the same number the grace decision actually used.
    this.offlineDaysSigned = null;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  set(state, { reason = null, message = null } = {}) {
    const changed = this.state !== state || this.reason !== reason;
    this.state = state;
    this.reason = reason;
    this.message = message;
    if (changed) {
      logger.info(`[license] state=${state}${reason ? ` reason=${reason}` : ''}`);
      for (const fn of this.listeners) {
        try {
          fn(this.snapshot());
        } catch (e) {}
      }
    }
  }

  snapshot() {
    const s = this.store.publicSnapshot();
    return {
      state: this.state,
      entitled: isEntitled(this.state),
      reason: this.reason,
      message: this.message,
      checking: this.checking,
      lastCheckedAt: this.lastCheckedAt,
      user: s.user,
      license: s.license,
      trial: s.trial,
      lastVerifiedAt: s.lastVerifiedAt,
      device: { id: this.deviceId, name: this.deviceName },
      signature: { ...this.signature },
      offline: {
        allowed: this.cfg.allowOfflineGrace,
        maxDays: this.cfg.maxOfflineDays,
        daysElapsed:
          this.offlineDaysSigned !== null ? this.offlineDaysSigned : this.store.offlineDaysElapsed()
      }
    };
  }

  /**
   * Verify an entitlement envelope and remember the verdict.
   *
   * Throws SignatureError on anything that can only be tampering. That error is
   * deliberately not a KldNetworkError: routing it into the offline grace window
   * would hand a mock server exactly the bypass signing exists to close.
   */
  verifyEntitlement(envelope, expect) {
    const kid = envelope && typeof envelope.kid === 'string' ? envelope.kid : null;
    try {
      const verdict = verifyEnvelope(envelope, expect, this.trust);
      this.signature = { verified: verdict.verified, kid, warning: verdict.warning };
      if (verdict.warning) {
        // Rollout steps 2-3: KLD has not signed this response yet, or has
        // rotated to a kid this build predates. Logged, not enforced, until
        // REQUIRE_SIGNATURE flips (docs/kld-entitlement-signing.md §7).
        logger.warn(`[license] entitlement unsigned/unverifiable: ${verdict.warning}`);
      }
      return verdict;
    } catch (e) {
      this.signature = { verified: false, kid, warning: e.code || 'signature_invalid' };
      throw e;
    }
  }

  /**
   * The full entitlement check. Order matches AccessService.cs:
   *   applied license → activate → (only if truly unlicensed) trial.
   * A network failure falls back to the offline grace window instead of denying.
   */
  async check() {
    if (!this.store.isLoggedIn()) {
      this.set(STATE.NOT_LOGGED_IN);
      return this.snapshot();
    }

    this.checking = true;
    try {
      const result = await this.checkOnline();
      this.lastCheckedAt = new Date().toISOString();
      return result;
    } catch (e) {
      if (e instanceof KldNetworkError) {
        return this.applyOfflineGrace(e);
      }
      if (e instanceof KldError && (e.status === 401 || e.status === 403)) {
        // The stored JWT is no longer good. Force a fresh login rather than
        // leaving the app in a half-authenticated state.
        if (e.status === 401) {
          this.store.clearSession();
          this.set(STATE.NOT_LOGGED_IN, {
            reason: e.code,
            message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'
          });
          return this.snapshot();
        }
        this.set(STATE.BLOCKED, { reason: e.code, message: 'Tài khoản hoặc license bị từ chối.' });
        return this.snapshot();
      }
      logger.error('[license] check failed:', e.message);
      this.set(STATE.BLOCKED, { reason: e.code || 'check_failed', message: e.message });
      return this.snapshot();
    } finally {
      this.checking = false;
    }
  }

  async checkOnline() {
    const jwt = this.store.getJwt();
    const applied = await this.kld.getAppliedLicense(jwt);
    const appliedKey = applied && (applied.appliedLicenseKey || (applied.license && applied.license.license_key));

    if (!appliedKey) {
      return this.tryTrial(applied && applied.reason ? applied.reason : 'no_applied_license');
    }

    // Activation is the real gate: it binds this device and enforces max_devices.
    const activation = await this.activate(appliedKey);

    if (activation.ok) {
      const license = normalizeLicense(activation.license || (applied && applied.license));

      // Verify BEFORE recording. Recording first would persist an entitlement
      // the app has just decided it cannot trust, and the cached copy is what
      // the next offline boot runs on.
      let verdict;
      try {
        verdict = this.verifyEntitlement(activation.envelope, {
          nonce: activation.nonce,
          deviceId: this.deviceId,
          productId: this.cfg.productId,
          kind: 'license'
        });
      } catch (e) {
        if (!(e instanceof SignatureError)) throw e;
        this.set(STATE.BLOCKED, { reason: e.code, message: e.message });
        return this.snapshot();
      }

      // Prefer the signed plan: the unsigned license body travelled in the same
      // response, so a mock server can put anything it likes there.
      const plan = verdict.verified && verdict.payload ? verdict.payload.plan : license && license.plan;
      if (!isPlanAllowed(plan)) {
        this.set(STATE.BLOCKED, {
          reason: 'plan_not_allowed',
          message: `Plan "${plan}" không nằm trong các plan được cấp phép cho sản phẩm này.`
        });
        return this.snapshot();
      }

      this.offlineDaysSigned = null;
      this.store.recordEntitlement(license, null, activation.envelope);
      this.set(STATE.LICENSED);
      return this.snapshot();
    }

    if (TRIAL_FALLBACK_REASONS.has(activation.reason)) {
      return this.tryTrial(activation.reason);
    }

    this.set(STATE.BLOCKED, { reason: activation.reason, message: activation.message });
    return this.snapshot();
  }

  /** Fetch a fresh nonce and activate. Never reuses a nonce — KLD deletes on use. */
  async activate(licenseKey) {
    const jwt = this.store.getJwt();

    let nonce;
    try {
      const challenge = await this.kld.getChallenge(jwt);
      nonce = challenge && challenge.nonce;
      if (!nonce) return { ok: false, reason: 'no_nonce', message: 'KLD không cấp nonce kích hoạt.' };
    } catch (e) {
      if (e instanceof KldNetworkError) throw e;
      return { ok: false, reason: e.code || 'challenge_failed', message: e.message };
    }

    try {
      const res = await this.kld.activateLicense(jwt, {
        licenseKey,
        deviceId: this.deviceId,
        deviceName: this.deviceName,
        nonce
      });

      // KLD signals refusal two ways on a 200: ok:false, or ok:true + valid:false.
      if (!res || res.ok === false) {
        return { ok: false, reason: (res && res.reason) || 'activation_failed', message: res && res.message };
      }
      if (res.valid === false) {
        return { ok: false, reason: res.reason || 'license_invalid', message: res.message };
      }
      // The envelope is carried out whole. Flattening to `license` here is what
      // used to lose `entitlement`/`sig` before the gate ever saw them; the nonce
      // travels with it because the signed payload is bound to this activation.
      return {
        ok: true,
        license: res.license || res.data || null,
        envelope: extractEnvelope(res),
        nonce
      };
    } catch (e) {
      if (e instanceof KldNetworkError) throw e;
      // 403 here means inactive/expired/device-limit — a hard denial.
      return { ok: false, reason: e.code || 'activation_failed', message: e.message };
    }
  }

  async tryTrial(priorReason) {
    if (!this.cfg.allowTrial) {
      this.set(STATE.NEEDS_LICENSE, { reason: priorReason });
      return this.snapshot();
    }

    const jwt = this.store.getJwt();

    let trial = null;
    try {
      trial = await this.kld.verifyTrial(jwt, { deviceId: this.deviceId });
    } catch (e) {
      if (e instanceof KldNetworkError) throw e;
      trial = { ok: false, valid: false, reason: e.code };
    }

    // Not started yet is the one case where starting one is appropriate.
    if (trial && trial.valid !== true && trial.reason === 'trial_not_started') {
      try {
        trial = await this.kld.startTrial(jwt, {
          deviceId: this.deviceId,
          deviceName: this.deviceName
        });
      } catch (e) {
        if (e instanceof KldNetworkError) throw e;
        trial = { ok: false, valid: false, reason: e.code };
      }
    }

    if (trial && trial.valid === true) {
      const t = normalizeTrial(trial.trial);

      // Same envelope, kind:"trial". Signing only the license path would make the
      // trial endpoints the next bypass — a mock server answering valid:true is
      // otherwise enough (docs/kld-entitlement-signing.md §6). No nonce here:
      // /api/trials/verify does not issue one, so the binding rests on deviceId
      // + productId + issuedAt. That is a deliberate, lower-value trade-off.
      try {
        this.verifyEntitlement(extractEnvelope(trial), {
          deviceId: this.deviceId,
          productId: this.cfg.productId,
          kind: 'trial'
        });
      } catch (e) {
        if (!(e instanceof SignatureError)) throw e;
        this.set(STATE.BLOCKED, { reason: e.code, message: e.message });
        return this.snapshot();
      }

      this.offlineDaysSigned = null;
      this.store.recordEntitlement(null, t, extractEnvelope(trial));
      this.set(STATE.TRIAL);
      return this.snapshot();
    }

    // No license and no usable trial: this is the "cần active keylicense" screen.
    this.set(STATE.NEEDS_LICENSE, {
      reason: (trial && trial.reason) || priorReason,
      message: 'Tài khoản chưa có license khả dụng cho sản phẩm này.'
    });
    return this.snapshot();
  }

  /**
   * KLD unreachable. Allow continued use only if there was a real successful
   * verification inside the grace window — never on a first run.
   *
   * The window is measured from the signed `issuedAt` whenever a cached envelope
   * is present, not from `lastVerifiedAt`. Both live in session.json, but only
   * one of them is covered by a signature: editing `lastVerifiedAt` to a future
   * date used to reset the window for free (bypass #3), and the ceiling on
   * `maxOfflineDays` is clamped in ./policy so the config half is closed too.
   */
  applyOfflineGrace(networkError) {
    const maxDays = this.cfg.maxOfflineDays;
    let signedDays = null;

    // Re-verified on every boot, not trusted from the file. "We verified this
    // once" is a property of the response, never of the cache holding it.
    const envelope = typeof this.store.getEnvelope === 'function' ? this.store.getEnvelope() : null;
    if (envelope) {
      let verdict;
      try {
        verdict = this.verifyEntitlement(envelope, {
          deviceId: this.deviceId,
          productId: this.cfg.productId
        });
      } catch (e) {
        if (!(e instanceof SignatureError)) throw e;
        // A cached envelope that no longer verifies — tampered, or copied from
        // another machine — is a denial, not a network problem.
        this.set(STATE.BLOCKED, { reason: e.code, message: e.message });
        return this.snapshot();
      }
      const issued = issuedAtMs(verdict.payload);
      if (verdict.verified && issued !== null) {
        signedDays = Math.max(0, Math.floor((Date.now() - issued) / DAY_MS));
      }
    }

    this.offlineDaysSigned = signedDays;
    const days = signedDays !== null ? signedDays : this.store.offlineDaysElapsed();

    if (!this.cfg.allowOfflineGrace || days === null) {
      this.set(STATE.BLOCKED, {
        reason: 'offline_no_cache',
        message: 'Không kết nối được Keylicense Dashboard và chưa có lần xác thực nào trước đó.'
      });
      return this.snapshot();
    }

    if (days > maxDays) {
      this.set(STATE.BLOCKED, {
        reason: 'offline_grace_expired',
        message: `Đã offline ${days} ngày, vượt giới hạn ${maxDays} ngày.`
      });
      return this.snapshot();
    }

    logger.warn(`[license] offline grace day ${days}/${maxDays}: ${networkError.message}`);
    this.set(STATE.OFFLINE_GRACE, {
      reason: 'kld_unreachable',
      message: `Đang dùng chế độ offline (ngày ${days}/${maxDays}).`
    });
    return this.snapshot();
  }
}

module.exports = { LicenseGate, STATE, isEntitled, normalizeLicense, normalizeTrial, TRIAL_FALLBACK_REASONS };
