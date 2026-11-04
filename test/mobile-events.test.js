const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MobileEvents } = require('../server/core/mobile-events');

test('mobile events use stable ids and do not replay after restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'valorant-mobile-events-'));
  try {
    const events = new MobileEvents(dir);
    const score = (ally, enemy, inGame = true) => ({ inGame, alliedScore: ally, enemyScore: enemy, gameMode: 'COMPETITIVE' });
    assert.deepEqual(events.update(score(11, 11)).events, []);
    const first = events.update(score(11, 12));
    assert.deepEqual(first.events.map(x => x.type), ['round_end', 'round_started', 'match_point_risk']);
    assert.equal(first.events[0].id, events.event(first.matchInstanceId, 'round_end', 23).id);
    assert.deepEqual(events.update(score(11, 12)).events, []);
    assert.deepEqual(new MobileEvents(dir).update(score(11, 12)).events, []);
    events.update(score(0, 0, false));
    const next = events.update(score(0, 0));
    assert.notEqual(next.matchInstanceId, first.matchInstanceId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
