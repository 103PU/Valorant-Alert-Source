const test = require('node:test');
const assert = require('node:assert');
const { UpdateInstaller } = require('../server/updater');

test('invalid injected Authenticode verification blocks launch', async () => {
  const inst = new UpdateInstaller({ verifyArtifact: async () => false });
  await assert.rejects(() => inst.verifyBeforeLaunch('C:\\fake-setup.exe'), (error) => {
    assert.equal(error.code, 'signature_invalid');
    return true;
  });
});
