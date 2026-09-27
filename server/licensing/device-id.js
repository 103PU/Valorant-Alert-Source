const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const logger = require('../utils/logger');

function getPrimaryMac() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac.toLowerCase();
        }
      }
    }
  } catch (e) {}
  return '';
}

/**
 * Generates hardware fingerprint: Motherboard Serial / UUID + CPU ID + Primary MAC Address.
 * SHA-256 hashed into a 64-character lowercase hexadecimal string.
 */
function generateHardwareFingerprint() {
  let mb = '';
  let cpu = '';

  if (process.platform === 'win32') {
    try {
      mb = execSync(
        'powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"',
        { timeout: 3500, encoding: 'utf8' }
      ).trim();
    } catch (e) {
      try {
        mb = execSync('wmic csproduct get uuid', { timeout: 3500, encoding: 'utf8' })
          .replace(/UUID/i, '')
          .trim();
      } catch (e2) {}
    }

    try {
      cpu = execSync(
        'powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Processor).ProcessorId"',
        { timeout: 3500, encoding: 'utf8' }
      ).trim();
    } catch (e) {
      try {
        cpu = execSync('wmic cpu get processorid', { timeout: 3500, encoding: 'utf8' })
          .replace(/ProcessorId/i, '')
          .trim();
      } catch (e2) {}
    }
  }

  const mac = getPrimaryMac();
  const hostname = os.hostname() || 'localhost';
  const cpus = os.cpus();
  const cpuModel = (cpus && cpus[0] && cpus[0].model) || '';

  // Combine hardware items into a single deterministic string
  const rawHardware = [mb, cpu, mac, hostname, cpuModel].filter(Boolean).join(':').toLowerCase();
  return crypto.createHash('sha256').update(rawHardware).digest('hex').toLowerCase();
}

/**
 * Returns a stable 64-character lowercase SHA-256 hardware deviceId.
 * Persisted in %APPDATA%\ValorantAlert\device-id to guarantee zero changes across reboots.
 */
function getDeviceId(appDataDir) {
  const idFile = path.join(appDataDir, 'device-id');

  try {
    if (fs.existsSync(idFile)) {
      const existing = fs.readFileSync(idFile, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(existing)) {
        return existing.toLowerCase();
      }
    }
  } catch (e) {
    logger.warn('Could not read existing device id:', e.message);
  }

  const fresh = generateHardwareFingerprint();
  try {
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(idFile, fresh, 'utf8');
  } catch (e) {
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

module.exports = {
  getDeviceId,
  getDeviceName,
  generateHardwareFingerprint,
  getPrimaryMac
};
