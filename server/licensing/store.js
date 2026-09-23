const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');

// Persisted session + last-known entitlement, under %APPDATA%\ValorantAlert.
// Holds the KLD JWT, so it is never logged and never sent anywhere except KLD.
// %APPDATA% is already per-user on Windows; no extra ACL work is done here.
const STATE_FILE = 'session.json';
const CREDENTIALS_FILE = 'credentials.json';

const EMPTY = {
  jwt: null,
  user: null,           // { id, email, name, picture }
  license: null,        // last successful LicenseInfo from KLD
  lastVerifiedAt: null, // ISO string — unsigned fallback for the offline window
  trial: null,
  // The signed entitlement envelope { entitlement, sig, kid } exactly as KLD
  // transmitted it. Stored verbatim so it can be re-verified byte-for-byte at
  // every boot; re-serialising a parsed payload would break the signature.
  entitlement: null
};

class LicenseStore {
  constructor(appDataDir) {
    this.appDataDir = appDataDir;
    this.filePath = path.join(appDataDir, STATE_FILE);
    this.credentialsPath = path.join(appDataDir, CREDENTIALS_FILE);
    this.state = { ...EMPTY };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.state = { ...EMPTY, ...JSON.parse(raw) };
      } else if (fs.existsSync(this.credentialsPath)) {
        const raw = fs.readFileSync(this.credentialsPath, 'utf8');
        const creds = JSON.parse(raw);
        if (creds && creds.jwt) {
          this.state = { ...EMPTY, jwt: creds.jwt, user: creds.user || null };
        }
      }
    } catch (e) {
      logger.warn('Could not read license session, starting clean:', e.message);
      this.state = { ...EMPTY };
    }
    return this.state;
  }

  save() {
    try {
      fs.mkdirSync(this.appDataDir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
      if (this.state.jwt) {
        fs.writeFileSync(this.credentialsPath, JSON.stringify({
          ok: true,
          jwt: this.state.jwt,
          user: this.state.user,
          savedAt: new Date().toISOString()
        }, null, 2), 'utf8');
      }
    } catch (e) {
      logger.warn('Could not persist license session:', e.message);
    }
  }

  setSession(jwt, user) {
    this.state.jwt = jwt;
    this.state.user = user || null;
    this.save();
  }

  clearSession() {
    this.state = { ...EMPTY };
    this.save();
    try {
      if (fs.existsSync(this.credentialsPath)) {
        fs.unlinkSync(this.credentialsPath);
      }
    } catch (e) {}
  }

  recordEntitlement(license, trial, envelope) {
    this.state.license = license || null;
    this.state.trial = trial || null;
    this.state.entitlement = envelope || null;
    this.state.lastVerifiedAt = new Date().toISOString();
    this.save();
  }

  /** The stored envelope, verbatim. Never trusted until re-verified. */
  getEnvelope() {
    const e = this.state.entitlement;
    if (!e || typeof e !== 'object') return null;
    return e;
  }

  getJwt() {
    return this.state.jwt;
  }

  isLoggedIn() {
    return !!this.state.jwt;
  }

  // Whole days since the last successful online verification, or null if there
  // has never been one (in which case grace cannot apply).
  //
  // This reads lastVerifiedAt, which lives in a file the user can edit — so it
  // is only the fallback for the rollout window where KLD has not signed
  // anything yet. Once an envelope is present, the gate computes the window from
  // the signed issuedAt instead (docs/kld-entitlement-signing.md §4, bypass #3).
  offlineDaysElapsed() {
    if (!this.state.lastVerifiedAt) return null;
    const then = Date.parse(this.state.lastVerifiedAt);
    if (Number.isNaN(then)) return null;
    return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  }

  // Safe to expose to the UI: no JWT, no raw token.
  publicSnapshot() {
    const lic = this.state.license;
    return {
      user: this.state.user
        ? { id: this.state.user.id, email: this.state.user.email, name: this.state.user.name, picture: this.state.user.picture }
        : null,
      license: lic
        ? {
            key: lic.key,
            plan: lic.plan,
            keyType: lic.keyType,
            status: lic.status,
            expiresAt: lic.expiresAt,
            maxDevices: lic.maxDevices
          }
        : null,
      lastVerifiedAt: this.state.lastVerifiedAt,
      trial: this.state.trial
    };
  }
}

module.exports = { LicenseStore };
