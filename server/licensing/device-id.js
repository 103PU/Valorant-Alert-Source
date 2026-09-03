const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const logger = require('../utils/logger');

// A device id must survive reboots and app updates so KLD's max_devices count
// stays stable. A random id persisted under %APPDATA% is used rather than a
// hardware fingerprint: clearing app data yields a new device, which is the same
// behaviour ValorantTweaks has, and it needs no native module or registry read.
function getDeviceId(appDataDir) {
  const idFile = path.join(appDataDir, 'device-id');

  try {
    if (fs.existsSync(idFile)) {
      const existing = fs.readFileSync(idFile, 'utf8').trim();
      if (existing) return existing;
    }
  } catch (e) {
    logger.warn('Could not read device id, generating a new one:', e.message);
  }

  const fresh = crypto.randomUUID();
  try {
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(idFile, fresh, 'utf8');
  } catch (e) {
    // Non-fatal: an in-memory id still lets this session activate, it just
    // registers as a new device next launch.
    logger.warn('Could not persist device id:', e.message);
  }
  return fresh;
}

function getDeviceName() {
  try {
    return `${os.hostname()} (${os.platform()})`;
  } catch (e) {
    return 'Unknown device';
  }
}

module.exports = { getDeviceId, getDeviceName };
