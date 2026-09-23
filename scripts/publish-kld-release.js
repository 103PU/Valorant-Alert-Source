const fs = require('fs');
const { normalizeVersion } = require('./release-naming');

/**
 * Builds standard payload for KLD publish-release webhook.
 */
function buildKldPayload({ version, releaseNotes = '', minimumVersion, forceUpdate = false }) {
  const normVer = normalizeVersion(version);
  return {
    version: normVer,
    minimumVersion: minimumVersion ? normalizeVersion(minimumVersion) : normVer,
    forceUpdate: Boolean(forceUpdate),
    releaseNotes: String(releaseNotes || '')
  };
}

/**
 * Posts the release metadata to KLD Central Server.
 */
async function publishKldRelease({
  serverUrl = 'https://keylicensedashboard.dungbd2005.workers.dev',
  adminToken,
  payload,
  fetchFn = globalThis.fetch
}) {
  if (!adminToken) {
    throw new Error('adminToken is required to publish release to KLD');
  }

  const endpoint = `${serverUrl.replace(/\/+$/, '')}/api/admin/app-version/publish-release`;
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Admin-Token': adminToken
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {}

  if (!res.ok) {
    throw new Error(`KLD publish failed (HTTP ${res.status}): ${text || res.statusText}`);
  }

  return json || { ok: true, raw: text };
}

// CLI Execution Handler
async function main() {
  const args = process.argv.slice(2);
  let tag = '';
  let url = 'https://keylicensedashboard.dungbd2005.workers.dev';
  let token = '';
  let notesFile = '';
  let notes = '';
  let force = false;
  let minVer = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tag' && args[i + 1]) { tag = args[++i]; }
    else if (args[i] === '--url' && args[i + 1]) { url = args[++i]; }
    else if (args[i] === '--token' && args[i + 1]) { token = args[++i]; }
    else if (args[i] === '--notes-file' && args[i + 1]) { notesFile = args[++i]; }
    else if (args[i] === '--notes' && args[i + 1]) { notes = args[++i]; }
    else if (args[i] === '--min-version' && args[i + 1]) { minVer = args[++i]; }
    else if (args[i] === '--force-update') { force = true; }
  }

  if (notesFile && fs.existsSync(notesFile)) {
    try {
      notes = fs.readFileSync(notesFile, 'utf8');
    } catch (e) {
      console.warn(`Could not read notes file: ${e.message}`);
    }
  }

  if (!tag) {
    try {
      tag = require('../package.json').version;
    } catch (e) {}
  }

  if (!token) {
    token = process.env.KLD_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  }

  if (!token) {
    console.log('::notice::KLD_ADMIN_TOKEN is not set — skipping the KLD version webhook.');
    return;
  }

  const payload = buildKldPayload({
    version: tag,
    releaseNotes: notes,
    minimumVersion: minVer,
    forceUpdate: force
  });

  console.log(`📡 Sending release webhook for v${payload.version} to ${url}...`);
  try {
    const result = await publishKldRelease({
      serverUrl: url,
      adminToken: token,
      payload
    });
    console.log(`✅ Successfully published release v${payload.version} to KLD!`);
    if (result && result.version) {
      console.log(`KLD current version is now: ${result.version.currentVersion || result.version.current_version}`);
    }
  } catch (err) {
    console.warn(`⚠️ KLD release webhook call failed (non-blocking): ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildKldPayload,
  publishKldRelease
};
