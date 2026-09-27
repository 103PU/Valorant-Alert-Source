const { url } = require('./config');

// Update check, scoped to THIS product.
//
// Two sources, deliberately unequal in what they are allowed to say:
//
//   KLD    /api/app/version  — may report a soft update AND a force update.
//   GitHub releases/latest   — may report a soft update ONLY.
//
// The asymmetry is the whole point. `forceUpdate` locks a user out of the app
// until they upgrade, so it must come from an authenticated admin decision with
// a `minimum_version` attached. GitHub's `releases/latest` carries no such
// field: deriving force-update from a tag would mean every publish hard-locks
// every install in the field. So GitHub can nag, and only KLD can lock.
//
// The check is advisory and fails OPEN. A version check that cannot run must
// never block the app — that is the license gate's job (see ./gate.js). Every
// failure here degrades to source:'none' plus a warning.

// KLD's version row is global, not per-product. Verified 2026-09-04 at the
// schema level: `app_version_config` is `id INTEGER PRIMARY KEY CHECK (id = 1)`
// (Keylicensedashboard/migrations/0013_add_app_version_config.sql:2, re-asserted
// in worker/index.ts:2442), and the public read is cached under
// `publicCacheKey("app-version")` with no product dimension (worker/index.ts:3862).
// Live, `?productId=valorant-alert` returns Valorant Tweaks' 3.4.4 byte-identical
// to the unscoped call.
//
// So we require KLD to PROVE the answer is ours before trusting it: the payload
// must echo back a product id equal to ours. It cannot do that today, which is
// exactly the desired outcome — an unscoped 3.4.4 with force_update would
// otherwise hard-lock every Valorant Alert install. Same failure class as the
// unscoped applied-license read documented in ./kld-client.js:102-109.
function readEchoedProductId(version) {
  if (!version || typeof version !== 'object') return null;
  for (const key of ['productId', 'product_id', 'product']) {
    const value = version[key];
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return null;
}

// Mirrors ValorantTweaks' AppVersionService.NormalizeVersion / ParseParts /
// CompareVersions so both apps order the same strings the same way: strip a
// leading v, split on '.' and '-', compare numerically, missing parts are 0.
function normalizeVersion(value) {
  const s = String(value == null ? '' : value).trim().replace(/^[vV]/, '');
  return s || '0.0.0';
}

function parseParts(value) {
  return normalizeVersion(value)
    .split(/[.-]/)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
}

function compareVersions(a, b) {
  const left = parseParts(a);
  const right = parseParts(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

// GitHub rejects API calls with no User-Agent (403), and this runs unauthenticated
// at 60 req/hour/IP — fine for one check per launch, which is why there is no
// token here and no new dependency.
async function fetchJson(target, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'ValorantAlert-UpdateCheck'
      },
      signal: controller.signal
    });
    if (!res.ok) {
      const err = new Error(`github_http_${res.status}`);
      err.code = `github_http_${res.status}`;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function releasePageUrl(repo) {
  return `https://github.com/${repo}/releases`;
}

function tagged(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

// Throws — never returns a half-trusted answer — so the caller's catch is the
// single place a rejected source turns into a warning.
async function checkKld(cfg, client) {
  const q = `productId=${encodeURIComponent(cfg.productId)}`;
  const data = await client.request(`${cfg.endpoints.appVersion}?${q}`);
  const version = data && typeof data === 'object' ? data.version : null;
  if (!version || typeof version !== 'object') throw tagged('kld_no_version_payload');

  const echoed = readEchoedProductId(version);
  if (!echoed) throw tagged('kld_not_product_scoped');
  if (echoed !== String(cfg.productId).toLowerCase()) throw tagged('kld_product_mismatch');

  const latestVersion = normalizeVersion(version.currentVersion ?? version.current_version);
  // An empty minimum means "no floor", not "floor at 0.0.0 so force away": fall
  // back to latest, which is what KLD's own appVersionConfigResponse does
  // (worker/index.ts:3822-3824).
  const rawMinimum = version.minimumVersion ?? version.minimum_version;
  const minimumVersion = normalizeVersion(
    (typeof rawMinimum === 'string' && rawMinimum.trim()) ? rawMinimum : latestVersion
  );

  return {
    source: 'kld',
    latestVersion,
    minimumVersion,
    forceUpdate: !!(version.forceUpdate ?? version.force_update),
    releaseNotes: String(version.releaseNotes ?? version.release_notes ?? ''),
    releasePageUrl: releasePageUrl(cfg.releaseRepo)
  };
}

async function checkDownloadResolver(cfg, client) {
  if (!client) throw tagged('no_client');
  const path = cfg.endpoints && typeof cfg.endpoints.download === 'function'
    ? cfg.endpoints.download(cfg.productId)
    : `/api/applications/${encodeURIComponent(cfg.productId)}/download`;
  const data = typeof client.getDownloadInfo === 'function'
    ? await client.getDownloadInfo(cfg.productId)
    : await client.request(path);

  if (!data || typeof data !== 'object') throw tagged('download_resolver_no_payload');
  const rawVer = typeof data.version === 'string' ? data.version.trim() : null;
  if (!rawVer) throw tagged('download_resolver_no_version');

  const latestVersion = normalizeVersion(rawVer);
  const releasePage = data.releasePageUrl || releasePageUrl(cfg.releaseRepo);
  const recommended = data.recommended || null;
  const portable = data.portable || null;

  return {
    source: 'kld_download',
    latestVersion,
    minimumVersion: latestVersion,
    forceUpdate: false,
    releaseNotes: '',
    releasePageUrl: releasePage,
    recommended,
    portable
  };
}

async function checkGitHub(cfg) {
  const data = await fetchJson(
    `https://api.github.com/repos/${cfg.releaseRepo}/releases/latest`,
    cfg.httpTimeoutMs
  );
  const tag = data && typeof data.tag_name === 'string' ? data.tag_name.trim() : '';
  if (!tag) throw tagged('github_release_has_no_tag');

  const latestVersion = normalizeVersion(tag);
  let recommended = null;
  let portable = null;

  if (Array.isArray(data.assets)) {
    for (const a of data.assets) {
      const name = String(a.name || '').toLowerCase();
      if ((name.includes('setup') || name.includes('installer')) && (name.endsWith('.exe') || name.endsWith('.zip'))) {
        recommended = {
          kind: 'installer',
          fileName: a.name,
          url: a.browser_download_url,
          sizeBytes: a.size
        };
      } else if (name.includes('win-x64') && name.endsWith('.zip') && !name.includes('installer')) {
        portable = {
          kind: 'portable',
          fileName: a.name,
          url: a.browser_download_url,
          sizeBytes: a.size
        };
      }
    }
  }

  return {
    source: 'github',
    latestVersion,
    // No floor and no force: see the header note. minimumVersion is reported for
    // display symmetry only and can never trigger a lock, because forceUpdate is
    // hard-false on this path.
    minimumVersion: latestVersion,
    forceUpdate: false,
    releaseNotes: String(data.body || ''),
    releasePageUrl: (typeof data.html_url === 'string' && data.html_url)
      || releasePageUrl(cfg.releaseRepo),
    recommended,
    portable
  };
}

// Same decision shape as ValorantTweaks' AppVersionService.cs:
//   force = forceUpdate && installed < minimum
//   soft  = !force && installed < latest
// so a force-update never also renders as a dismissible soft banner.
function decide(appVersion, found) {
  const forceUpdateRequired =
    !!found.forceUpdate && compareVersions(appVersion, found.minimumVersion) < 0;
  const softUpdateAvailable =
    !forceUpdateRequired && compareVersions(appVersion, found.latestVersion) < 0;
  return { forceUpdateRequired, softUpdateAvailable };
}

// Fails open by construction: every source that refuses lands in `warnings` and
// the result still returns. `source:'none'` means "could not tell", which the UI
// must render as "no update", never as "update required".
async function checkForUpdate(cfg, client) {
  const appVersion = normalizeVersion(cfg.appVersion);
  const warnings = [];

  for (const attempt of [
    () => checkKld(cfg, client),
    () => checkGitHub(cfg)
  ]) {
    try {
      const found = await attempt();
      if (!found.recommended && !found.portable && typeof client?.request === 'function') {
        try {
          const dl = await checkDownloadResolver(cfg, client);
          if (dl && dl.recommended) found.recommended = dl.recommended;
          if (dl && dl.portable) found.portable = dl.portable;
        } catch (_) {}
      }
      return { ok: true, appVersion, ...found, ...decide(appVersion, found), warnings };
    } catch (e) {
      warnings.push(e && e.code ? e.code : `check_failed:${e && e.message}`);
    }
  }

  return {
    ok: true,
    appVersion,
    source: 'none',
    latestVersion: appVersion,
    minimumVersion: appVersion,
    forceUpdate: false,
    forceUpdateRequired: false,
    softUpdateAvailable: false,
    releaseNotes: '',
    releasePageUrl: releasePageUrl(cfg.releaseRepo),
    recommended: null,
    portable: null,
    warnings
  };
}

module.exports = {
  readEchoedProductId,
  normalizeVersion,
  parseParts,
  compareVersions,
  releasePageUrl,
  checkKld,
  checkDownloadResolver,
  checkGitHub,
  decide,
  checkForUpdate,
  url
};
