const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class MobileEvents {
  constructor(appDataDir) {
    this.file = path.join(appDataDir, 'mobile-events.json');
    try { this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.state = {}; }
    this.state.hostId ||= crypto.randomUUID();
    // ponytail: after an unverified restart, suppress alerts until a new idle-to-match transition.
    this.waitForNewMatch = Boolean(this.state.inGame);
  }

  update(score) {
    const inGame = score.inGame === true;
    const previous = this.state;
    let matchInstanceId = previous.matchInstanceId;
    let events = [];
    if (!inGame) {
      matchInstanceId = null;
      this.waitForNewMatch = false;
    } else if (!previous.inGame || !matchInstanceId) {
      matchInstanceId = crypto.randomUUID();
    } else if (!this.waitForNewMatch) {
      const ally = Number(score.alliedScore);
      const enemy = Number(score.enemyScore);
      const oldAlly = Number(previous.alliedScore);
      const oldEnemy = Number(previous.enemyScore);
      const delta = ally + enemy - oldAlly - oldEnemy;
      const standard = ['COMPETITIVE', 'UNRATED', 'CUSTOM GAME'].includes(String(score.gameMode || '').toUpperCase());
      if (delta === 1 && ally >= oldAlly && enemy >= oldEnemy) {
        const finishedRound = ally + enemy;
        events.push(this.event(matchInstanceId, 'round_end', finishedRound));
        const finished = standard && (ally >= 13 || enemy >= 13) && Math.abs(ally - enemy) >= 2;
        if (!finished) events.push(this.event(matchInstanceId, 'round_started', finishedRound + 1));
        if (standard && enemy >= 12 && enemy > ally && !finished) events.push(this.event(matchInstanceId, 'match_point_risk', finishedRound + 1));
        if (standard && ally === 12 && enemy === 12) events.push(this.event(matchInstanceId, 'overtime', 25));
        if (finished) {
          events.push(this.event(matchInstanceId, 'match_finished', finishedRound));
        }
      }
    }
    const sequence = (previous.sequence || 0) + 1;
    this.state = {
      hostId: previous.hostId,
      matchInstanceId,
      sequence,
      inGame,
      alliedScore: Number(score.alliedScore) || 0,
      enemyScore: Number(score.enemyScore) || 0
    };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state));
    } catch { /* Score delivery continues; alerts after a restart fail closed. */ }
    return {
      ...score,
      schemaVersion: 2,
      hostId: this.state.hostId,
      matchInstanceId,
      sequence,
      events
    };
  }

  event(matchInstanceId, type, roundNumber) {
    const id = crypto.createHash('sha256').update(`${this.state.hostId}|${matchInstanceId}|${type}|${roundNumber}`).digest('hex');
    return { id, type, roundNumber, occurredAt: new Date().toISOString() };
  }
}

module.exports = { MobileEvents };
