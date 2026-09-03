const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

const { resolveLicenseConfig } = require('../server/licensing/config');
const { LicenseGate, STATE } = require('../server/licensing/gate');
const { KldNetworkError } = require('../server/licensing/kld-client');
const { verifyEnvelope, SignatureError, keyFromRaw } = require('../server/licensing/signature');
const { PUBLIC_KEYS, REQUIRE_SIGNATURE, canRequireSignature } = require('../server/licensing/signing-keys');
const { isPlanAllowed, MAX_OFFLINE_DAYS_HARD_CAP } = require('../server/licensing/policy');

const rootDir = path.join(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;
const KID = 'test-kid';
const DEVICE = 'device-test';
const PRODUCT = 'valorant-alert';

// A throwaway keypair per run. The real private key lives only in a Cloudflare
// Worker secret, so no key material of any kind belongs in this repo — and
// generating one here proves the verify path against a genuine Ed25519
// signature rather than a recorded fixture that could rot.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const RAW_PUBLIC = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const KEYS = { [KID]: RAW_PUBLIC };

function payloadFor(over = {}) {
  return {
    v: 1,
    nonce: 'nonce-1',
    productId: PRODUCT,
    licenseKey: 'VA-TEST-0001',
    deviceId: DEVICE,
    plan: 'pro',
    keyType: 'subscription',
    status: 'active',
    maxDevices: 3,
    expiresAt: null,
    issuedAt: new Date().toISOString(),
    kind: 'license',
    ...over
  };
}

/** Sign a payload the way KLD will: detached, over the transmitted bytes. */
function envelopeFor(over = {}, { kid = KID } = {}) {
  const entitlement = Buffer.from(JSON.stringify(payloadFor(over)), 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(entitlement, 'utf8'), privateKey).toString('base64url');
  return { entitlement, sig, kid };
}

function cfgWith(keylicense) {
  return resolveLicenseConfig({ keylicense }, rootDir);
}

// A store double. The real LicenseStore writes %APPDATA%\ValorantAlert\session.json
// on every recordEntitlement, which a test must not touch.
function fakeStore({ jwt = 'jwt', lastVerifiedAt = null, envelope = null } = {}) {
  return {
    recorded: [],
    envelope,
    isLoggedIn: () => !!jwt,
    getJwt: () => jwt,
    clearSession() {},
    recordEntitlement(license, trial, env) { this.recorded.push({ license, trial, envelope: env }); },
    getEnvelope() { return this.envelope; },
    offlineDaysElapsed: () => (lastVerifiedAt === null ? null : lastVerifiedAt),
    publicSnapshot: () => ({ user: null, license: null, trial: null, lastVerifiedAt })
  };
}

function gateWith(kld, { storeOpts = {}, keylicense = {}, requireSignature = true, keys = KEYS } = {}) {
  return new LicenseGate({
    cfg: cfgWith(keylicense),
    kld,
    store: fakeStore(storeOpts),
    deviceId: DEVICE,
    deviceName: 'test-host',
    trust: { keys, requireSignature }
  });
}

/** A KLD double whose activate response carries the given envelope fields. */
function kldReturning(extra, { nonce = 'nonce-1' } = {}) {
  return {
    getAppliedLicense: async () => ({ ok: true, appliedLicenseKey: 'VA-TEST-0001' }),
    getChallenge: async () => ({ nonce }),
    activateLicense: async () => ({
      ok: true,
      license: { license_key: 'VA-TEST-0001', plan: 'pro', status: 'active' },
      ...extra
    }),
    verifyTrial: async () => ({ ok: true, valid: false, reason: 'trial_unavailable' })
  };
}

// --- verifyEnvelope, unit ---------------------------------------------------

test('a genuine envelope verifies and yields the signed payload', () => {
  const verdict = verifyEnvelope(
    envelopeFor(),
    { nonce: 'nonce-1', deviceId: DEVICE, productId: PRODUCT, kind: 'license' },
    { keys: KEYS, requireSignature: true }
  );

  assert.strictEqual(verdict.verified, true);
  assert.strictEqual(verdict.warning, null);
  assert.strictEqual(verdict.payload.plan, 'pro');
  assert.strictEqual(verdict.payload.licenseKey, 'VA-TEST-0001');
});

// The reason for signing at all: the transmitted plan/expiry/status must not be
// editable. Flip one character of the payload and the signature no longer covers
// it, so the envelope has to be refused even though the sig itself is authentic.
test('a one-byte tamper of the payload is refused', () => {
  const env = envelopeFor();
  const tampered = Buffer.from(
    JSON.stringify(payloadFor({ plan: 'ultra' })),
    'utf8'
  ).toString('base64url');

  assert.throws(
    () => verifyEnvelope({ ...env, entitlement: tampered }, {}, { keys: KEYS, requireSignature: true }),
    (e) => e instanceof SignatureError && e.code === 'signature_invalid'
  );
});

test('a forged signature is refused', () => {
  const env = envelopeFor();
  const forged = crypto.randomBytes(64).toString('base64url');

  assert.throws(
    () => verifyEnvelope({ ...env, sig: forged }, {}, { keys: KEYS, requireSignature: true }),
    (e) => e instanceof SignatureError && e.code === 'signature_invalid'
  );
});

// Copying session.json to a second machine is the cheapest bypass of all. The
// signature is authentic there — it is the same file — so only the deviceId
// binding inside the signed payload catches it.
test('an envelope signed for another device is refused', () => {
  assert.throws(
    () => verifyEnvelope(
      envelopeFor({ deviceId: 'someone-elses-machine' }),
      { deviceId: DEVICE },
      { keys: KEYS, requireSignature: false }
    ),
    (e) => e instanceof SignatureError && e.code === 'signature_device_mismatch'
  );
});

test('an envelope for another product is refused', () => {
  assert.throws(
    () => verifyEnvelope(
      envelopeFor({ productId: 'valorant-tweaks' }),
      { productId: PRODUCT },
      { keys: KEYS, requireSignature: false }
    ),
    (e) => e instanceof SignatureError && e.code === 'signature_product_mismatch'
  );
});

// KLD deletes each nonce on use, so a replayed activation response is already
// half-blocked server-side; binding the nonce into the signature closes the
// other half, where the response itself is replayed at the client.
test('a replayed envelope with a stale nonce is refused', () => {
  assert.throws(
    () => verifyEnvelope(
      envelopeFor({ nonce: 'nonce-from-last-week' }),
      { nonce: 'nonce-1' },
      { keys: KEYS, requireSignature: false }
    ),
    (e) => e instanceof SignatureError && e.code === 'signature_nonce_mismatch'
  );
});

// A trial envelope must not stand in for a license one. Without the kind check a
// trial signature — cheaper to obtain, and issued without a nonce — would be
// accepted on the license path.
test('a trial envelope is refused on the license path', () => {
  assert.throws(
    () => verifyEnvelope(
      envelopeFor({ kind: 'trial' }),
      { kind: 'license' },
      { keys: KEYS, requireSignature: false }
    ),
    (e) => e instanceof SignatureError && e.code === 'signature_kind_mismatch'
  );
});

// --- the two rollout gaps ---------------------------------------------------
// docs/kld-entitlement-signing.md §7: an unsigned response and an unrecognised
// kid are tolerated while REQUIRE_SIGNATURE is false and refused once it is
// true. Getting this asymmetry wrong in either direction is a real failure: too
// strict bricks every install before KLD deploys, too loose is no gate at all.

test('a missing signature is tolerated while REQUIRE_SIGNATURE is false', () => {
  const verdict = verifyEnvelope({ ok: true }, {}, { keys: KEYS, requireSignature: false });
  assert.strictEqual(verdict.verified, false);
  assert.strictEqual(verdict.warning, 'signature_missing');
  assert.strictEqual(verdict.payload, null);
});

test('a missing signature is refused once REQUIRE_SIGNATURE is true', () => {
  assert.throws(
    () => verifyEnvelope({ ok: true }, {}, { keys: KEYS, requireSignature: true }),
    (e) => e instanceof SignatureError && e.code === 'signature_missing'
  );
});

test('an unknown kid is tolerated while REQUIRE_SIGNATURE is false', () => {
  const verdict = verifyEnvelope(
    envelopeFor({}, { kid: 'va-2099-01' }),
    {},
    { keys: KEYS, requireSignature: false }
  );
  assert.strictEqual(verdict.verified, false);
  assert.strictEqual(verdict.warning, 'signature_unknown_kid');
});

test('an unknown kid is refused once REQUIRE_SIGNATURE is true', () => {
  assert.throws(
    () => verifyEnvelope(envelopeFor({}, { kid: 'va-2099-01' }), {}, { keys: KEYS, requireSignature: true }),
    (e) => e instanceof SignatureError && e.code === 'signature_unknown_kid'
  );
});

// A bad signature under a *known* kid is not a rollout gap — this build holds
// the trust anchor, so the only explanation is tampering. Refused in both modes.
test('a bad signature under a known kid is refused even with REQUIRE_SIGNATURE false', () => {
  assert.throws(
    () => verifyEnvelope(
      { ...envelopeFor(), sig: crypto.randomBytes(64).toString('base64url') },
      {},
      { keys: KEYS, requireSignature: false }
    ),
    (e) => e instanceof SignatureError && e.code === 'signature_invalid'
  );
});

// --- shipping invariants ----------------------------------------------------

// REQUIRE_SIGNATURE=true with no keys embedded rejects every possible response,
// online and offline alike. This is the guard that stops rollout step 4 from
// being flipped before step 1 has happened.
test('REQUIRE_SIGNATURE cannot be true while no public key is embedded', () => {
  if (!canRequireSignature()) {
    assert.strictEqual(
      REQUIRE_SIGNATURE,
      false,
      'PUBLIC_KEYS is empty, so REQUIRE_SIGNATURE must stay false or every activation fails'
    );
  }
  assert.ok(Object.isFrozen(PUBLIC_KEYS), 'the key map must not be mutable at runtime');
});

// The public key is a trust anchor. In config.json — a plaintext file beside the
// .exe — substituting your own key is the entire bypass, so the map has to be a
// code constant. Every embedded key must also be a well-formed 32-byte Ed25519
// key, or the failure surfaces as "signature_invalid" for every user instead.
test('every embedded public key is a usable 32-byte Ed25519 key', () => {
  for (const [kid, raw] of Object.entries(PUBLIC_KEYS)) {
    assert.strictEqual(
      Buffer.from(raw, 'base64').length,
      32,
      `${kid} is not a raw 32-byte key`
    );
    assert.strictEqual(keyFromRaw(raw).asymmetricKeyType, 'ed25519', `${kid} did not import`);
  }
});

test('keyFromRaw rejects a key of the wrong length', () => {
  assert.throws(
    () => keyFromRaw(crypto.randomBytes(31).toString('base64')),
    (e) => e instanceof SignatureError && e.code === 'signature_key_malformed'
  );
});

// --- gate integration -------------------------------------------------------

test('a signed activation reaches LICENSED and persists the envelope verbatim', async () => {
  const env = envelopeFor();
  const gate = gateWith(kldReturning(env));

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.LICENSED);
  assert.strictEqual(snap.signature.verified, true);
  assert.strictEqual(snap.signature.kid, KID);
  assert.deepStrictEqual(gate.store.recorded[0].envelope, env, 'stored bytes must be re-verifiable');
});

// The category matters as much as the refusal. A tampered response routed through
// KldNetworkError would land on OFFLINE_GRACE — the app would keep running on
// the very response it just rejected.
test('a bad signature lands on BLOCKED, never on OFFLINE_GRACE', async () => {
  const gate = gateWith(kldReturning({
    ...envelopeFor(),
    sig: crypto.randomBytes(64).toString('base64url')
  }));

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'signature_invalid');
  assert.strictEqual(snap.entitled, false);
  assert.strictEqual(gate.store.recorded.length, 0, 'nothing untrusted may be persisted');
});

test('an unsigned activation still works while REQUIRE_SIGNATURE is false', async () => {
  const gate = gateWith(kldReturning({}), { requireSignature: false });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.LICENSED, 'rollout step 2 must not break existing users');
  assert.strictEqual(snap.signature.verified, false);
  assert.strictEqual(snap.signature.warning, 'signature_missing');
});

test('an unsigned activation is refused once REQUIRE_SIGNATURE is true', async () => {
  const gate = gateWith(kldReturning({}), { requireSignature: true });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'signature_missing');
});

// --- offline grace measured from the signed issuedAt ------------------------

function kldOffline() {
  return {
    getAppliedLicense: async () => { throw new KldNetworkError('KLD unreachable: test'); },
    getChallenge: async () => { throw new KldNetworkError('KLD unreachable: test'); },
    activateLicense: async () => { throw new KldNetworkError('KLD unreachable: test'); },
    verifyTrial: async () => { throw new KldNetworkError('KLD unreachable: test'); }
  };
}

function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

// Bypass #3. lastVerifiedAt lives in session.json, which the user owns, so
// rewriting it to today used to reset the grace window for free. The signed
// issuedAt is the same field KLD stamped, and it wins.
test('grace is measured from the signed issuedAt, not from an edited lastVerifiedAt', async () => {
  const gate = gateWith(kldOffline(), {
    keylicense: { maxOfflineDays: 3 },
    storeOpts: {
      lastVerifiedAt: 0,                              // "verified today", user-supplied
      envelope: envelopeFor({ issuedAt: daysAgo(10) }) // what KLD actually signed
    }
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'offline_grace_expired');
  assert.strictEqual(snap.offline.daysElapsed, 10, 'the reported day count is the signed one');
});

test('a fresh signed envelope grants grace even with no lastVerifiedAt at all', async () => {
  const gate = gateWith(kldOffline(), {
    keylicense: { maxOfflineDays: 3 },
    storeOpts: { lastVerifiedAt: null, envelope: envelopeFor({ issuedAt: daysAgo(1) }) }
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.OFFLINE_GRACE);
  assert.strictEqual(snap.entitled, true);
  assert.strictEqual(snap.offline.daysElapsed, 1);
});

// The cached envelope is re-verified at every boot, so copying session.json to a
// second machine does not carry the grace window with it.
test('a cached envelope from another device is refused instead of granting grace', async () => {
  const gate = gateWith(kldOffline(), {
    keylicense: { maxOfflineDays: 3 },
    storeOpts: {
      lastVerifiedAt: 0,
      envelope: envelopeFor({ deviceId: 'someone-elses-machine', issuedAt: daysAgo(1) })
    }
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'signature_device_mismatch');
});

test('a tampered cached envelope is refused instead of granting grace', async () => {
  const gate = gateWith(kldOffline(), {
    keylicense: { maxOfflineDays: 3 },
    storeOpts: {
      lastVerifiedAt: 0,
      envelope: { ...envelopeFor({ issuedAt: daysAgo(1) }), sig: crypto.randomBytes(64).toString('base64url') }
    }
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'signature_invalid');
});

// With no envelope at all — every install before KLD deploys signing — the old
// unsigned path has to keep working, or rollout step 2 breaks offline users.
test('with no cached envelope, grace still falls back to lastVerifiedAt', async () => {
  const gate = gateWith(kldOffline(), {
    keylicense: { maxOfflineDays: 3 },
    storeOpts: { lastVerifiedAt: 2, envelope: null },
    requireSignature: false
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.OFFLINE_GRACE);
  assert.strictEqual(snap.offline.daysElapsed, 2);
});

// --- the config half of the same bypass -------------------------------------

test('maxOfflineDays is clamped by a code constant, not trusted from config.json', () => {
  assert.strictEqual(cfgWith({ maxOfflineDays: 999999 }).maxOfflineDays, MAX_OFFLINE_DAYS_HARD_CAP);
  assert.strictEqual(cfgWith({ maxOfflineDays: 3 }).maxOfflineDays, 3, 'shortening is still allowed');
  assert.strictEqual(cfgWith({ maxOfflineDays: -5 }).maxOfflineDays, 0);
  assert.strictEqual(cfgWith({ maxOfflineDays: 'forever' }).maxOfflineDays, 0);
});

test('an absurd maxOfflineDays cannot extend a stale signed entitlement', async () => {
  const gate = gateWith(kldOffline(), {
    keylicense: { maxOfflineDays: 999999 },
    storeOpts: { lastVerifiedAt: 0, envelope: envelopeFor({ issuedAt: daysAgo(30) }) }
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'offline_grace_expired');
});

// --- plan policy (bypass #4) ------------------------------------------------

test('allowedPlans is enforced from code, and an uncovered plan is BLOCKED', async () => {
  const gate = gateWith(kldReturning(envelopeFor({ plan: 'free' })));

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'plan_not_allowed');
});

// The signature proves which plan KLD issued; the response body beside it does
// not. Reading the plan from the unsigned body would leave the check decorative.
test('the plan check reads the signed payload, not the unsigned response body', async () => {
  const kld = kldReturning(envelopeFor({ plan: 'free' }));
  kld.activateLicense = async () => ({
    ok: true,
    license: { license_key: 'VA-TEST-0001', plan: 'pro', status: 'active' }, // claims pro
    ...envelopeFor({ plan: 'free' })                                          // signed says free
  });

  const snap = await gateWith(kld).check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'plan_not_allowed');
});

test('isPlanAllowed covers the sold plans, is case-insensitive, and tolerates absence', () => {
  for (const plan of ['plus', 'pro', 'ultra', 'PRO', ' Ultra ']) {
    assert.strictEqual(isPlanAllowed(plan), true, `${plan} should be allowed`);
  }
  for (const plan of ['free', 'basic', 'trial', 'enterprise']) {
    assert.strictEqual(isPlanAllowed(plan), false, `${plan} should not be allowed`);
  }
  // Absence is a KLD data question, not a bypass — the signature already proves
  // the record is theirs. Blocking on null would brick real customers.
  for (const plan of [null, undefined, '']) {
    assert.strictEqual(isPlanAllowed(plan), true, 'an absent plan must not block');
  }
});

// --- trial path uses the same envelope --------------------------------------

test('a signed trial reaches TRIAL and stores its envelope', async () => {
  const trialEnv = envelopeFor({ kind: 'trial', plan: null, licenseKey: null });
  const gate = gateWith({
    getAppliedLicense: async () => ({ ok: true, license: null, reason: 'no_applied_license' }),
    getChallenge: async () => ({ nonce: 'nonce-1' }),
    activateLicense: async () => ({ ok: false, reason: 'no_license' }),
    verifyTrial: async () => ({ ok: true, valid: true, trial: { status: 'active' }, ...trialEnv })
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.TRIAL);
  assert.strictEqual(snap.signature.verified, true);
  assert.deepStrictEqual(gate.store.recorded[0].envelope, trialEnv);
});

// Otherwise the trial endpoints become the next bypass: a mock server answering
// {ok:true, valid:true} is enough to be entitled.
test('a forged trial signature is refused, not silently accepted', async () => {
  const bad = { ...envelopeFor({ kind: 'trial' }), sig: crypto.randomBytes(64).toString('base64url') };
  const gate = gateWith({
    getAppliedLicense: async () => ({ ok: true, license: null, reason: 'no_applied_license' }),
    getChallenge: async () => ({ nonce: 'nonce-1' }),
    activateLicense: async () => ({ ok: false, reason: 'no_license' }),
    verifyTrial: async () => ({ ok: true, valid: true, trial: { status: 'active' }, ...bad })
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'signature_invalid');
});

test('a license envelope is refused on the trial path', async () => {
  const gate = gateWith({
    getAppliedLicense: async () => ({ ok: true, license: null, reason: 'no_applied_license' }),
    getChallenge: async () => ({ nonce: 'nonce-1' }),
    activateLicense: async () => ({ ok: false, reason: 'no_license' }),
    verifyTrial: async () => ({ ok: true, valid: true, trial: { status: 'active' }, ...envelopeFor() })
  });

  const snap = await gate.check();

  assert.strictEqual(snap.state, STATE.BLOCKED);
  assert.strictEqual(snap.reason, 'signature_kind_mismatch');
});










