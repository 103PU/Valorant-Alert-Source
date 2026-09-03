const fs = require('fs');
const os = require('os');
const path = require('path');

const { clampOfflineDays } = require('./policy');

// KLD endpoint paths. These mirror ValorantTweaks' LicenseConfig.cs: the dashboard
// is the single source of truth for licenses, so the paths are constants here
// rather than tunables in config.json — only the base URL and product id move.
const ENDPOINTS = {
  googleClientId: '/api/auth/google/client-id',
  googleExchange: '/auth/google/exchange',
  appliedLicense: '/api/me/applied-license',
  myLicenses: '/api/me/licenses',
  claimLicense: '/api/me/licenses/claim',
  applyLicense: (key) => `/api/me/licenses/${encodeURIComponent(key)}/apply`,
  activateLicense: (key) => `/api/me/licenses/${encodeURIComponent(key)}/activate`,
  verifyLicense: '/api/licenses/verify',
  // Activation is nonce-protected: KLD stores the nonce per user with a 5-minute
  // TTL and deletes it on use, so a challenge must be fetched immediately before
  // each activate call. Reusing one yields reason "nonce_invalid".
  challenge: '/api/licenses/challenge',
  startTrial: '/api/trials/start',
  verifyTrial: '/api/trials/verify'
};

const DEFAULTS = {
  baseUrl: 'https://keylicensedashboard.dungbd2005.workers.dev',
  productId: 'valorant-alert',
  platform: 'windows',
  loopbackPort: 8750,
  redirectUri: 'http://127.0.0.1:8750/oauth/callback/',
  httpTimeoutMs: 5000,
  oauthLoginTimeoutMins: 5,
  allowOfflineGrace: true,
  maxOfflineDays: 3,
  allowTrial: true,
  appDataFolderName: 'ValorantAlert'
};

function resolveAppVersion(rootDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

// %APPDATA%\ValorantAlert on Windows, ~/.config/ValorantAlert elsewhere.
function resolveAppDataDir(folderName) {
  const base = process.env.APPDATA
    || (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  return path.join(base, folderName);
}

function resolveLicenseConfig(rawConfig, rootDir) {
  const merged = { ...DEFAULTS, ...(rawConfig && rawConfig.keylicense) };

  // Google matches redirect_uri byte-exactly. Probed against the live client id:
  // http://127.0.0.1:8750/oauth/callback/ is registered and works, while the same
  // URI without the trailing slash, and http://localhost:8750/oauth/callback/,
  // both fail with redirect_uri_mismatch. The URI is fully determined by the
  // port, so derive it rather than trusting the file — an includes(':port/')
  // test let both of those broken spellings through untouched. The config field
  // stays because it is what the operator has to paste into the Google console.
  merged.redirectUri = `http://127.0.0.1:${merged.loopbackPort}/oauth/callback/`;

  merged.baseUrl = String(merged.baseUrl).replace(/\/+$/, '');

  // config.json can shorten the offline window but never lengthen it. Without
  // this clamp, `"maxOfflineDays": 999999` in a plaintext file the end user owns
  // is permanent offline use — the config half of bypass #3. The ceiling is a
  // code constant in ./policy, which caxa compresses into the .exe.
  merged.maxOfflineDays = clampOfflineDays(merged.maxOfflineDays);

  merged.appVersion = resolveAppVersion(rootDir);
  merged.appDataDir = resolveAppDataDir(merged.appDataFolderName);
  merged.endpoints = ENDPOINTS;

  return merged;
}

function url(cfg, endpointPath) {
  return `${cfg.baseUrl}${endpointPath}`;
}

module.exports = { ENDPOINTS, DEFAULTS, resolveLicenseConfig, resolveAppDataDir, url };
