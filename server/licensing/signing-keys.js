// Trust anchors for KLD entitlement signatures.
//
// WHY THIS IS A .js FILE AND NOT A BLOCK IN config.json
// -----------------------------------------------------
// config.json and %APPDATA%\ValorantAlert\session.json both ship as plaintext
// next to the .exe and are writable by the end user. Anything that decides
// *whether* an entitlement is genuine must therefore live in code, which caxa
// compresses into the single-file binary — otherwise swapping in your own public
// key, or setting REQUIRE_SIGNATURE to false, is a one-line bypass of the whole
// scheme. See docs/kld-entitlement-signing.md §5 and §7.
//
// Raw 32-byte Ed25519 public keys, base64. KLD produces the value with:
//   publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64')

const PUBLIC_KEYS = Object.freeze({
  // Rollout step 1 done on 2026-09-04: KLD generated the Ed25519 keypair and
  // deployed the private half as the Worker secret LICENSE_SIGNING_KEY. The
  // private key was never written to disk and no copy exists outside
  // Cloudflare's secret store.
  //
  // Verified BEFORE installation, because installing a kid is the point of no
  // return: signature_invalid and every assertBinding mismatch throw regardless
  // of REQUIRE_SIGNATURE, so a mismatched key would BLOCK activations rather
  // than fall back. The check ran this module's own verifyEnvelope against a
  // live production-signed envelope with requireSignature true — positive
  // verify with full bindings, and the negative cases each threw the right code
  // (signature_product_mismatch, signature_device_mismatch,
  // signature_kind_mismatch, signature_unknown_kid, signature_invalid on a
  // one-byte tamper).
  //
  // The map form — rather than a single constant — is what lets KLD rotate
  // later: the new kid ships in an app release first, KLD switches to it
  // afterwards, and installs that predate the rotation keep working because they
  // still hold the old kid.
  'va-2026-09': 'UWw+PjDsGRSKUaJL+tJ2bKZoC3TTCVEcMLmOpNIqUAs=',
});

// Rollout step 2: verify a signature when one arrives, but do not yet demand
// one. Flipping this to true before KLD deploys signing would fail every
// activation for every user — the inversion §7 warns about.
//
// KLD has been emitting signed envelopes since 2026-09-04, so signatures do
// arrive now and are checked. Demanding them is still a separate, deliberate
// release decision: every install in the field that predates this build sends
// no kid, and older KLD deploys could stop signing. Flip it only when a build
// carrying this key has actually shipped.
//
// A bad signature under a *known* kid is rejected regardless of this flag: that
// is active tampering, not a version skew. This flag only governs the two
// rollout gaps (no signature at all, or a kid this build has never heard of).
const REQUIRE_SIGNATURE = false;

// Guard rail, asserted by test/license-signature.test.js: REQUIRE_SIGNATURE
// cannot be true while PUBLIC_KEYS is empty, because that combination rejects
// every possible response and bricks the app offline as well as online.
function canRequireSignature() {
  return Object.keys(PUBLIC_KEYS).length > 0;
}

module.exports = { PUBLIC_KEYS, REQUIRE_SIGNATURE, canRequireSignature };
