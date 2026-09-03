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

// Plans this product is sold under. A signed entitlement naming any other plan
// is a genuine KLD record that simply does not cover Valorant Alert.
const ALLOWED_PLANS = Object.freeze(['plus', 'pro', 'ultra']);

// Ceiling on the offline grace window, independent of config.json's
// maxOfflineDays. The config value stays a tunable so an operator can shorten
// the window, but it cannot lengthen it past this: `"maxOfflineDays": 999999`
// in a text file the user owns would otherwise be permanent offline use.
const MAX_OFFLINE_DAYS_HARD_CAP = 7;

/**
 * True when `plan` is covered by this build.
 *
 * An absent plan is *not* treated as a violation. KLD does not guarantee a plan
 * on every license shape, and a signed entitlement with plan:null is a data
 * question rather than a bypass — the signature already proves the record is
 * KLD's. Blocking on null would brick real customers to close nothing.
 */
function isPlanAllowed(plan) {
  if (plan === null || plan === undefined || String(plan).trim() === '') return true;
  return ALLOWED_PLANS.includes(String(plan).trim().toLowerCase());
}

/** Clamp a configured grace window to the hard cap. */
function clampOfflineDays(configured) {
  const n = Number(configured);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), MAX_OFFLINE_DAYS_HARD_CAP);
}

module.exports = { ALLOWED_PLANS, MAX_OFFLINE_DAYS_HARD_CAP, isPlanAllowed, clampOfflineDays };
