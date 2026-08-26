const test = require('node:test');
const assert = require('node:assert');
const ScorePoller = require('../server/core/score-poller');

test('formatMapName - Exact Unreal Engine asset paths', () => {
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Ascent/Ascent'), 'ASCENT');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Bonsai/Bonsai'), 'SPLIT');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Duality/Duality'), 'BIND');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Triad/Triad'), 'HAVEN');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Port/Port'), 'ICEBOX');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Foxtrot/Foxtrot'), 'BREEZE');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Canyon/Canyon'), 'FRACTURE');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Pitt/Pitt'), 'PEARL');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Jam/Jam'), 'LOTUS');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Jules/Jules'), 'SUNSET');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Infinity/Infinity'), 'ABYSS');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Plummet/Plummet'), 'ABYSS');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/Poveglia/Range'), 'THE RANGE');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/HURM/HURM_Yard'), 'DISTRICT');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/HURM/HURM_Alley'), 'PIAZZA');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/HURM/HURM_Helix'), 'KASBAH');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/HURM/HURM_Drift'), 'DRIFT');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/HURM/HURM_Glitch'), 'GLITCH');
});

test('formatMapName - Fuzzy substrings & fallback', () => {
  assert.strictEqual(ScorePoller.formatMapName('ascent_map'), 'ASCENT');
  assert.strictEqual(ScorePoller.formatMapName('custom_split'), 'SPLIT');
  assert.strictEqual(ScorePoller.formatMapName(''), 'ASCENT');
  assert.strictEqual(ScorePoller.formatMapName(null), 'ASCENT');
  assert.strictEqual(ScorePoller.formatMapName('/Game/Maps/NewMap/NewMap'), 'NEWMAP');
});

test('formatQueueName - Queue mode formatting', () => {
  assert.strictEqual(ScorePoller.formatQueueName('competitive'), 'COMPETITIVE');
  assert.strictEqual(ScorePoller.formatQueueName('unrated'), 'UNRATED');
  assert.strictEqual(ScorePoller.formatQueueName('swiftplay'), 'SWIFTPLAY');
  assert.strictEqual(ScorePoller.formatQueueName('spikerush'), 'SPIKE RUSH');
  assert.strictEqual(ScorePoller.formatQueueName('deathmatch'), 'DEATHMATCH');
  assert.strictEqual(ScorePoller.formatQueueName('hurm'), 'TDM');
  assert.strictEqual(ScorePoller.formatQueueName('', 'CustomGame'), 'CUSTOM');
  assert.strictEqual(ScorePoller.formatQueueName(null), 'CUSTOM');
});
