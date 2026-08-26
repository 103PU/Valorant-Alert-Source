const fs = require('fs');
const path = require('path');

let cachedRegionData = null;

/**
 * Parses ShooterGame.log to extract region, shard, and client version.
 */
function getRegionInfo() {
  if (cachedRegionData) {
    return cachedRegionData;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return getDefaultRegionInfo();
  }

  const logPath = path.join(localAppData, 'VALORANT', 'Saved', 'Logs', 'ShooterGame.log');

  if (!fs.existsSync(logPath)) {
    console.warn('[RiotRegion] ShooterGame.log not found, using default region "ap".');
    return getDefaultRegionInfo();
  }

  try {
    const logContent = fs.readFileSync(logPath, 'utf8');

    let region = null;
    let shard = null;
    let clientVersion = null;

    // Pattern matching glz URLs: https://glz-{region}-1.{shard}.a.pvp.net
    const glzMatch = logContent.match(/https:\/\/glz-([a-zA-Z0-9-]+)-1\.([a-zA-Z0-9-]+)\.a\.pvp\.net/);
    if (glzMatch) {
      region = glzMatch[1];
      shard = glzMatch[2];
    } else {
      const fallbackMatch = logContent.match(/glz-(.+?)-1\.(.+?)\.a\.pvp\.net/);
      if (fallbackMatch) {
        region = fallbackMatch[1];
        shard = fallbackMatch[2];
      }
    }

    // Pattern matching CI server version or release branch
    const versionMatch = logContent.match(/CI server version:\0?\s*([^\r\n]+)/) || logContent.match(/Branch: release-([^\r\n]+)/);
    if (versionMatch) {
      clientVersion = versionMatch[1].trim();
    }

    if (!region) {
      region = 'ap';
      shard = 'ap';
    }

    cachedRegionData = {
      region,
      shard,
      clientVersion: clientVersion || 'release-13.04-shipping-20-5340415'
    };

    console.log(`[RiotRegion] Detected Region: ${region}, Shard: ${shard}, ClientVersion: ${cachedRegionData.clientVersion}`);
    return cachedRegionData;
  } catch (err) {
    console.error('[RiotRegion] Error reading ShooterGame.log:', err.message);
    return getDefaultRegionInfo();
  }
}

function getDefaultRegionInfo() {
  return {
    region: 'ap',
    shard: 'ap',
    clientVersion: 'release-13.04-shipping-20-5340415'
  };
}

function clearRegionCache() {
  cachedRegionData = null;
}

module.exports = { getRegionInfo, clearRegionCache };
