// Local entitlement policy — the half of the decision KLD cannot make for us.
//
// A signature proves the *facts* in an entitlement are genuine (this plan, this
// expiry, this device). It says nothing about which of those facts this build is
// willing to accept. That second half is local policy, and it belongs in the
// same trust class as the public keys in ./signing-keys: baked into the binary,
// never read from config.json, because config.json is user-writable.
//
// docs/kld-entitlement-signing.md §9 item 1 records why: `allowedPlans` used to
// sit in config.json:11 and was never read by anything under server/, so it was
// simultaneously a dead field and an invitation to believe editing it worked.

// Disallowed tier plans (e.g. unentitled free placeholders)
const DISALLOWED_PLANS = new Set(['free', 'basic', 'enterprise']);

// Supported canonical plans on KLD (Migration 0047)
const CANONICAL_PLANS = Object.freeze([
  'trial',
  'plus',
  'pro',
  'ultra'
]);

// 6 Atomic services defined for Valorant Alert on KLD (Migration 0042)
const CANONICAL_SERVICES = Object.freeze([
  'score_hud',
  'cloud_relay',
  'sound_engine',
  'match_analytics',
  'riot_poller',
  'desktop_dashboard'
]);

// Default entitlement matrix per plan from KLD Migration 0047
const DEFAULT_PLAN_GRANTS = Object.freeze({
  trial: ['score_hud', 'riot_poller'],
  plus: ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard'],
  pro: ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard', 'match_analytics'],
  ultra: ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard', 'match_analytics', 'cloud_relay'],
  all: ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard', 'match_analytics', 'cloud_relay'],
  '*': ['score_hud', 'riot_poller', 'sound_engine', 'desktop_dashboard', 'match_analytics', 'cloud_relay']
});

// Ceiling on the offline grace window, independent of config.json's
// maxOfflineDays. The config value stays a tunable so an operator can shorten
// the window, but it cannot lengthen it past this: `"maxOfflineDays": 999999`
// in a text file the user owns would otherwise be permanent offline use.
const MAX_OFFLINE_DAYS_HARD_CAP = 7;

/**
 * Normalizes a raw plan string to canonical plan code.
 */
function normalizePlanKey(plan) {
  if (!plan) return 'trial';
  const p = String(plan).trim().toLowerCase();
  if (p === '*' || p === 'all' || p.includes('all-in-one') || p.includes('all-inone') || p.includes('lifetime')) {
    return 'ultra';
  }
  if (p.includes('ultra')) return 'ultra';
  if (p.includes('pro')) return 'pro';
  if (p.includes('plus')) return 'plus';
  if (p.includes('trial')) return 'trial';
  return p;
}

/**
 * Returns granted services for a given plan according to KLD matrix.
 */
function getServicesForPlan(plan, customGrants = null) {
  const norm = normalizePlanKey(plan);
  if (customGrants && customGrants[norm] && Array.isArray(customGrants[norm])) {
    return customGrants[norm];
  }
  return DEFAULT_PLAN_GRANTS[norm] || DEFAULT_PLAN_GRANTS.plus;
}

/**
 * Checks if a specific service is granted for the given plan.
 */
function isServiceEntitledForPlan(serviceCode, plan, customGrants = null) {
  const services = getServicesForPlan(plan, customGrants);
  return services.includes(serviceCode);
}

/**
 * True when `plan` is covered by this build.
 *
 * Keylicense Dashboard supports dynamic plan configurations per product.
 * Any valid paid plan or official trial issued by KLD for Valorant Alert is allowed.
 */
function isPlanAllowed(plan) {
  if (plan === null || plan === undefined || String(plan).trim() === '') return true;
  const p = String(plan).trim().toLowerCase();
  if (DISALLOWED_PLANS.has(p)) return false;
  return true;
}

/**
 * Check if a license product scope matches requested product.
 * Supports exact match, wildcard '*', 'all', and comma-separated scopes.
 */
function isProductAllowed(licenseProductId, requestedProductId = 'valorant-alert') {
  if (!licenseProductId) return true;
  const req = String(requestedProductId).trim().toLowerCase();
  const lic = String(licenseProductId).trim().toLowerCase();
  if (lic === '*' || lic === 'all' || lic.includes('all-in-one') || lic.includes('all-inone')) return true;
  const parts = lic.split(',').map((s) => s.trim().toLowerCase());
  return parts.includes(req) || parts.includes('*') || parts.includes('all');
}

/** Clamp a configured grace window to the hard cap. */
function clampOfflineDays(configured) {
  const n = Number(configured);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), MAX_OFFLINE_DAYS_HARD_CAP);
}

module.exports = {
  ALLOWED_PLANS: CANONICAL_PLANS,
  CANONICAL_PLANS,
  CANONICAL_SERVICES,
  DEFAULT_PLAN_GRANTS,
  DISALLOWED_PLANS,
  MAX_OFFLINE_DAYS_HARD_CAP,
  normalizePlanKey,
  getServicesForPlan,
  isServiceEntitledForPlan,
  isPlanAllowed,
  isProductAllowed,
  clampOfflineDays
};
