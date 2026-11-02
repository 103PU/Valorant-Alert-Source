const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const NativeSoundPlayer = require('../server/core/sound-player');

test('NativeSoundPlayer resolves sound files and handles score updates', () => {
  const root = path.resolve(__dirname, '..');
  const player = new NativeSoundPlayer(root);

  // Check resolve
  const chime = player.resolveSoundFile('melodicChime');
  assert.ok(chime, 'should find melodicChime.wav');
  assert.ok(fs.existsSync(chime), 'file must exist on disk');

  let playedFile = null;
  player.playFile = (filePath) => {
    playedFile = filePath;
  };

  // When PC audio disabled, should NOT play
  player.handleScoreUpdate({ inGame: true, alliedScore: 1, enemyScore: 0 }, { isPcAudioEnabled: false });
  assert.equal(playedFile, null, 'must not play when audio is disabled');

  // When PC audio enabled, round change SHOULD play native sound
  player.handleScoreUpdate({ inGame: true, alliedScore: 2, enemyScore: 0 }, { isPcAudioEnabled: true, evtRoundChange: true });
  assert.ok(playedFile, 'must play native sound on round change');
  assert.match(playedFile, /melodicChime\.wav/);

  // Match point alarm
  playedFile = null;
  player.handleScoreUpdate({ inGame: true, alliedScore: 2, enemyScore: 12, status: 'MATCH_POINT_RISK' }, { isPcAudioEnabled: true, evtMatchPoint: true });
  assert.ok(playedFile, 'must play match point alarm');
  assert.match(playedFile, /(matchPoint|Alarm01)\.wav/);

  // Match end victory
  playedFile = null;
  player.handleScoreUpdate({ inGame: true, alliedScore: 13, enemyScore: 2 }, { isPcAudioEnabled: true, evtMatchEnded: true });
  assert.ok(playedFile, 'must play match end victory');
  assert.match(playedFile, /(victory|tada)\.wav/);

  player.destroy();
});
