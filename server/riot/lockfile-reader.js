const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Reads and parses the Riot Client lockfile.
 * Location: %LocalAppData%\Riot Games\Riot Client\Config\lockfile
 */
function readLockfile() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    logger.error('LOCALAPPDATA environment variable is not defined.');
    return null;
  }

  const lockfilePath = path.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'lockfile');

  if (!fs.existsSync(lockfilePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(lockfilePath, 'utf8');
    const parts = content.split(':');
    if (parts.length < 5) {
      return null;
    }

    const [name, pid, port, password, protocol] = parts;
    const authHeader = 'Basic ' + Buffer.from(`riot:${password}`).toString('base64');
    const baseUrl = `${protocol}://127.0.0.1:${port}`;

    return {
      name,
      pid: parseInt(pid, 10),
      port: parseInt(port, 10),
      password,
      protocol,
      authHeader,
      baseUrl
    };
  } catch (err) {
    logger.error('Error reading lockfile:', err.message);
    return null;
  }
}

module.exports = { readLockfile };
