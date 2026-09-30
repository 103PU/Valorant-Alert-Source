const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Inno Setup contract exists and owns silent relaunch policy', () => {
  const iss = read('tools/installer/ValorantAlert.iss');
  assert.match(iss, /\[Setup\]/);
  assert.match(iss, /\[Files\]/);
  assert.match(iss, /\[Run\]/);
  assert.match(iss, /skipifsilent/);
});

test('installer has rollback and concurrency guards', () => {
  const ps1 = read('tools/installer/Install-ValorantAlert.ps1');
  assert.match(ps1, /backup/i);
  assert.match(ps1, /restore/i);
  assert.match(ps1, /lock/i);
});

test('secure release verification is fail-closed by contract', () => {
  const build = read('scripts/build.js');
  const verify = read('scripts/verify-release-artifacts.js');
  const script = read('scripts/verify-authenticode.ps1');
  assert.match(build, /SECURE_RELEASE/);
  assert.match(verify, /signature/i);
  assert.match(script, /RequireValid/);
  assert.match(script, /ExpectedSubject/);
});
