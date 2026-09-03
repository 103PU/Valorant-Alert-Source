const crypto = require('crypto');

const { PUBLIC_KEYS, REQUIRE_SIGNATURE } = require('./signing-keys');

// Ed25519 SPKI DER prefix. The app embeds only the raw 32-byte public key, but
// crypto.createPublicKey wants DER/SPKI — and for Ed25519 everything ahead of
// the key material is a fixed 12-byte header, so the DER can be reassembled by
// concatenation instead of pulling in an ASN.1 dependency. Verified end to end,
// not just Node-signs-Node-verifies: a signature produced by workerd's
// crypto.subtle reads correctly through this exact path
// (docs/kld-entitlement-signing.md §5.1 and §11.3).
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const RAW_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

// Payload scheme this build understands. A verified payload carrying a different
// `v` is refused rather than read with v1 assumptions: the signature proves the
// bytes came from KLD, not that this build knows what they mean. KLD must keep
// emitting v1 until an app release ships that handles the next version.
const SCHEME_VERSION = 1;

class SignatureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SignatureError';
    this.code = code;
  }
}

/** Raw 32-byte base64 public key -> a KeyObject usable by crypto.verify. */
function keyFromRaw(base64Raw) {
  const raw = Buffer.from(String(base64Raw), 'base64');
  if (raw.length !== RAW_PUBLIC_KEY_BYTES) {
    throw new SignatureError(
      'signature_key_malformed',
      `Public key phải đúng ${RAW_PUBLIC_KEY_BYTES} byte, nhận được ${raw.length}.`
    );
  }
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki'
  });
}

/**
 * Pull {entitlement, sig, kid} out of a KLD response without disturbing the
 * legacy fields beside them. Returns null when the response carries no envelope
 * at all — which is what every KLD deploy before rollout step 1 looks like.
 */
function extractEnvelope(res) {
  if (!res || typeof res !== 'object') return null;
  const { entitlement, sig, kid } = res;
  if (typeof entitlement !== 'string' && typeof sig !== 'string' && typeof kid !== 'string') {
    return null;
  }
  return { entitlement, sig, kid };
}

/** base64url(JSON) -> object. Throws rather than returning a half-parsed value. */
function decodePayload(entitlement) {
  let json;
  try {
    json = Buffer.from(entitlement, 'base64url').toString('utf8');
  } catch (e) {
    throw new SignatureError('signature_payload_invalid', 'Payload entitlement không phải base64url.');
  }

  let payload;
  try {
    payload = JSON.parse(json);
  } catch (e) {
    throw new SignatureError('signature_payload_invalid', 'Payload entitlement không phải JSON hợp lệ.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SignatureError('signature_payload_invalid', 'Payload entitlement không phải object.');
  }
  return payload;
}

function sameString(a, b) {
  const norm = (v) => (v === null || v === undefined ? '' : String(v));
  return norm(a) === norm(b);
}

/**
 * The bindings are what stop a genuinely-signed envelope from being replayed
 * somewhere it does not belong: another device (a copied session.json), another
 * product (a Valorant Tweaks entitlement), an earlier activation (a stale
 * nonce), or the trial path standing in for the license path.
 */
function assertBinding(payload, expect) {
  if (payload.v !== SCHEME_VERSION) {
    throw new SignatureError(
      'signature_version_unsupported',
      `Entitlement scheme v${payload.v} chưa được bản app này hỗ trợ.`
    );
  }
  if (expect.kind && !sameString(payload.kind, expect.kind)) {
    throw new SignatureError(
      'signature_kind_mismatch',
      `Entitlement kind "${payload.kind}" không phải "${expect.kind}".`
    );
  }
  if (expect.productId && !sameString(payload.productId, expect.productId)) {
    throw new SignatureError('signature_product_mismatch', 'Entitlement thuộc sản phẩm khác.');
  }
  if (expect.deviceId && !sameString(payload.deviceId, expect.deviceId)) {
    throw new SignatureError('signature_device_mismatch', 'Entitlement được cấp cho thiết bị khác.');
  }
  // Only checked on a live activation. A cached envelope re-verified at boot has
  // no live nonce to compare against — KLD deleted that nonce when it was used.
  if (expect.nonce && !sameString(payload.nonce, expect.nonce)) {
    throw new SignatureError(
      'signature_nonce_mismatch',
      'Entitlement không khớp nonce của lần kích hoạt này.'
    );
  }
  return payload;
}

/**
 * Verify a detached-payload entitlement envelope.
 *
 * Returns { verified, payload, warning }. `warning` is set — with verified
 * false — only for the two tolerated rollout gaps: no envelope at all, or a kid
 * this build has never heard of. Both become hard refusals once
 * REQUIRE_SIGNATURE is true. Everything else throws, including a bad signature
 * under a *known* kid, which is refused in both modes because it can only be
 * tampering, never version skew.
 *
 * SignatureError is deliberately NOT a KldNetworkError: a tampered response has
 * to land on BLOCKED, not slide into the offline grace window that exists for
 * KLD being unreachable (docs/kld-entitlement-signing.md §8).
 */
function verifyEnvelope(envelope, expect = {}, opts = {}) {
  const keys = opts.keys || PUBLIC_KEYS;
  const requireSignature =
    opts.requireSignature === undefined ? REQUIRE_SIGNATURE : !!opts.requireSignature;

  const env = extractEnvelope(envelope);
  const str = (v) => (typeof v === 'string' && v ? v : null);
  const entitlement = env && str(env.entitlement);
  const sig = env && str(env.sig);
  const kid = env && str(env.kid);

  if (!entitlement || !sig || !kid) {
    if (requireSignature) {
      throw new SignatureError('signature_missing', 'KLD không trả chữ ký entitlement.');
    }
    return { verified: false, payload: null, warning: 'signature_missing' };
  }

  const rawKey = Object.prototype.hasOwnProperty.call(keys, kid) ? keys[kid] : null;
  if (!rawKey) {
    if (requireSignature) {
      throw new SignatureError('signature_unknown_kid', `Bản app này chưa biết signing key "${kid}".`);
    }
    return { verified: false, payload: null, warning: 'signature_unknown_kid' };
  }

  const sigBytes = Buffer.from(sig, 'base64url');
  if (sigBytes.length !== ED25519_SIGNATURE_BYTES) {
    throw new SignatureError(
      'signature_invalid',
      `Chữ ký Ed25519 phải đúng ${ED25519_SIGNATURE_BYTES} byte, nhận được ${sigBytes.length}.`
    );
  }

  let ok = false;
  try {
    // Sign/verify over the exact bytes transmitted — no canonicalisation step to
    // disagree about, which is the whole reason for the detached payload (§3).
    ok = crypto.verify(null, Buffer.from(entitlement, 'utf8'), keyFromRaw(rawKey), sigBytes);
  } catch (e) {
    if (e instanceof SignatureError) throw e;
    throw new SignatureError('signature_invalid', `Không xác thực được chữ ký: ${e.message}`);
  }
  if (!ok) {
    throw new SignatureError('signature_invalid', 'Chữ ký entitlement không hợp lệ.');
  }

  return { verified: true, payload: assertBinding(decodePayload(entitlement), expect), warning: null };
}

/** ms since epoch of the signed issuedAt, or null when there is nothing usable. */
function issuedAtMs(payload) {
  if (!payload || !payload.issuedAt) return null;
  const t = Date.parse(payload.issuedAt);
  return Number.isNaN(t) ? null : t;
}

module.exports = {
  SignatureError,
  verifyEnvelope,
  extractEnvelope,
  decodePayload,
  keyFromRaw,
  issuedAtMs,
  ED25519_SPKI_PREFIX,
  SCHEME_VERSION
};



