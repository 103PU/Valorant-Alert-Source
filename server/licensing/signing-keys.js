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
  // 'va-2026-09': '<32-byte raw public key, base64>'
  //
  // Deliberately empty: KLD has not generated or deployed the signing keypair
  // yet (rollout step 1 of docs/kld-entitlement-signing.md §7). Adding the kid
  // here is what unblocks step 4. The map form — rather than a single constant —
  // is what lets KLD rotate later: the new kid ships in an app release first,
  // KLD switches to it afterwards, and installs that predate the rotation keep
  // working because they still hold the old kid.
});

// Rollout step 2: verify a signature when one arrives, but do not yet demand
// one. Flipping this to true before KLD deploys signing would fail every
// activation for every user — the inversion §7 warns about.
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
