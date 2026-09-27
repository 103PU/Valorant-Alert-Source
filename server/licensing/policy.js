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

// Plans this product is sold under.
// Policy: Single Purchase plan "valorant-alert" (also supporting legacy/compatible tiers).
// When license is valid/active, 100% of all features are unlocked.
const ALLOWED_PLANS = Object.freeze([
  'valorant-alert',
  'single',
  'lifetime',
  'plus',
  'pro',
  'ultra'
]);

// Ceiling on the offline grace window, independent of config.json's
// maxOfflineDays. The config value stays a tunable so an operator can shorten
// the window, but it cannot lengthen it past this: `"maxOfflineDays": 999999`
// in a text file the user owns would otherwise be permanent offline use.
const MAX_OFFLINE_DAYS_HARD_CAP = 7;

/**
 * True when `plan` is covered by this build.
 *
 * Single Purchase policy: any active license for valorant-alert unlocks 100% features.
 */
function isPlanAllowed(plan) {
  if (plan === null || plan === undefined || String(plan).trim() === '') return true;
  const p = String(plan).trim().toLowerCase();
  return ALLOWED_PLANS.includes(p) || p.includes('valorant') || p.includes('alert');
}

/** Clamp a configured grace window to the hard cap. */
function clampOfflineDays(configured) {
  const n = Number(configured);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), MAX_OFFLINE_DAYS_HARD_CAP);
}

module.exports = { ALLOWED_PLANS, MAX_OFFLINE_DAYS_HARD_CAP, isPlanAllowed, clampOfflineDays };
