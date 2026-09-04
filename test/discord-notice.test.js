const test = require('node:test');
const assert = require('node:assert');

const { buildReleaseNotice } = require('../scripts/discord-release-notice');
const { portableZipName, installerZipName } = require('../scripts/release-naming');

const REPO = '103PU/Valorant-Alert-Source';
const FIXED = new Date('2026-09-04T00:00:00.000Z');

const notice = (over = {}) => buildReleaseNotice({ tag: 'v1.2.3', repo: REPO, now: FIXED, ...over });
const buttons = (n) => n.components[0].components;

// The buttons are the only part of this message a user interacts with, and a wrong URL
// is a 404 that nobody sees until someone clicks it. The names therefore come from
// release-naming.js — the same module build.js names the artifacts with — rather than
// being spelled out here or in the workflow.
test('the download buttons point at the assets build.js actually produces', () => {
  const [installer, portable] = buttons(notice());

  assert.strictEqual(
    installer.url,
    `https://github.com/${REPO}/releases/download/v1.2.3/${installerZipName('1.2.3')}`
  );
  assert.strictEqual(
    portable.url,
    `https://github.com/${REPO}/releases/download/v1.2.3/${portableZipName('1.2.3')}`
  );
});

// The installer is first and labelled as the recommended one because KLD serves
// `recommended = installer ?? portable`: the dashboard's Download button and this message
// must not steer users to two different files.
test('the installer is the first, recommended button', () => {
  const [first] = buttons(notice());

  assert.match(first.label, /bộ cài/);
  assert.ok(first.url.includes('-installer.zip'), 'the first button must be the installer');
});

// style 5 (link) is what makes these buttons work with nothing running behind them. A
// non-link button carries a custom_id and needs an interaction handler; converted by
// accident, the row renders and then does nothing when clicked.
test('every button is a link button, so no interaction handler is needed', () => {
  const row = notice().components[0];

  assert.strictEqual(row.type, 1, 'components[0] must be an action row');
  for (const button of row.components) {
    assert.strictEqual(button.type, 2);
    assert.strictEqual(button.style, 5);
    assert.match(button.url, /^https:\/\/github\.com\//);
    assert.strictEqual(button.custom_id, undefined, 'a link button must not carry a custom_id');
  }
});

// The manual workflow takes the tag as free text, so '1.2.3' and 'v1.2.3' both arrive.
// Without normalisation one of them produces .../releases/tag/vv1.2.3.
test('the tag is normalised, so v-prefixed and bare tags agree', () => {
  assert.deepStrictEqual(notice({ tag: '1.2.3' }), notice({ tag: 'v1.2.3' }));
  assert.ok(!notice({ tag: 'v1.2.3' }).embeds[0].url.includes('vv'));
});

// A bad dispatch input must stop the step rather than announce a release with dead links.
test('a malformed tag or repo throws instead of building broken links', () => {
  assert.throws(() => notice({ tag: 'latest' }), /tag must be vX\.Y\.Z/);
  assert.throws(() => notice({ tag: 'v1.2' }), /tag must be vX\.Y\.Z/);
  assert.throws(() => notice({ repo: 'not-a-repo' }), /repo must be owner\/name/);
  assert.throws(() => notice({ repo: 'owner/name; rm -rf /' }), /repo must be owner\/name/);
});

// This module builds a body; the workflow holds the relay URL and its auth token. If a
// credential ever reaches the payload it is one `echo` in a public CI log away from
// being published — ValorantTweaks' notify-discord-manual.yml is exactly that mistake,
// with a live webhook URL committed in plaintext.
test('the payload carries no credential and no webhook endpoint', () => {
  const json = JSON.stringify(notice());

  assert.ok(!/discord\.com\/api\/webhooks/i.test(json), 'a webhook URL must never be in the body');
  assert.ok(!/x-auth-token|authorization|bot\s+[A-Za-z0-9]/i.test(json));
  assert.ok(!/token|secret/i.test(json), 'nothing token-shaped belongs in an announcement');
});

// The install instructions describe THIS app's installer, not ValorantTweaks'. The step
// that gets skipped most is extracting the zip first — the installer refuses to run from
// inside it, and that refusal is the single most likely support question.
test('the instructions name the installer entry point and the extract-first rule', () => {
  const [embed] = notice().embeds;
  const guide = embed.fields.find((f) => f.name.includes('HƯỚNG DẪN CÀI ĐẶT'));

  assert.ok(guide, 'the message must carry install instructions');
  assert.match(guide.value, /Install-ValorantAlert\.cmd/);
  assert.match(guide.value, /Giải nén \*\*TOÀN BỘ\*\*/);
  assert.match(guide.value, /khay hệ thống/, 'the tray icon is where the app actually lives');
});

// Uninstall keeping %APPDATA%\ValorantAlert is the reason a reinstall does not cost a
// device slot. Stating it in the announcement is cheaper than answering it per user.
test('the notes cover SmartScreen, the per-user install and the preserved user data', () => {
  const notes = notice().embeds[0].fields.find((f) => f.name.includes('LƯU Ý')).value;

  assert.match(notes, /SmartScreen/);
  assert.match(notes, /không cần quyền admin/i);
  assert.match(notes, /%APPDATA%\\ValorantAlert/);
});

test('the embed is a single embed carrying the version and the release link', () => {
  const { embeds } = notice();

  assert.strictEqual(embeds.length, 1);
  assert.match(embeds[0].description, /v1\.2\.3/);
  assert.strictEqual(embeds[0].url, `https://github.com/${REPO}/releases/tag/v1.2.3`);
  assert.strictEqual(embeds[0].timestamp, FIXED.toISOString());
});
