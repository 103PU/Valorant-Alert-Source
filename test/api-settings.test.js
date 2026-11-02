const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadSettings, saveSettings, handleApiSettings } = require('../server/routes/api-settings');

test('settings storage: loads defaults and saves custom values', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'val-settings-test-'));
  try {
    const initial = loadSettings(tmpDir);
    assert.equal(initial.masterVolume, 0.8);
    assert.equal(initial.soundPreset, 'melodicChime');
    assert.equal(initial.evtMatchPoint, true);

    const updated = saveSettings(tmpDir, {
      masterVolume: 0.5,
      soundPreset: 'radarPulse',
      evtMatchPoint: false
    });
    assert.equal(updated.masterVolume, 0.5);
    assert.equal(updated.soundPreset, 'radarPulse');
    assert.equal(updated.evtMatchPoint, false);

    const reloaded = loadSettings(tmpDir);
    assert.equal(reloaded.masterVolume, 0.5);
    assert.equal(reloaded.soundPreset, 'radarPulse');
    assert.equal(reloaded.evtMatchPoint, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
