const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

class NativeSoundPlayer {
  constructor(rootDir) {
    this.rootDir = rootDir || path.resolve(__dirname, '..', '..');
    this.psProcess = null;
    this.isWindows = process.platform === 'win32';
    this.lastAllied = -1;
    this.lastEnemy = -1;
    this.lastMatchId = null;
    this.isMatchEndedTriggered = false;
    this.lastMatchPointSoundTime = 0;

    if (this.isWindows) {
      this.initProcess();
    }
  }

  initProcess() {
    try {
      this.psProcess = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', '-'
      ], {
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true
      });

      this.psProcess.on('error', (err) => {
        logger.warn('[NativeSound] PowerShell spawn error:', err.message);
        this.psProcess = null;
      });

      this.psProcess.on('exit', () => {
        this.psProcess = null;
      });

      // Initialize persistent SoundPlayer object
      if (this.psProcess.stdin && !this.psProcess.stdin.destroyed) {
        this.psProcess.stdin.write("$player = New-Object System.Media.SoundPlayer\n");
      }
    } catch (e) {
      logger.warn('[NativeSound] Could not start PowerShell player:', e.message);
      this.psProcess = null;
    }
  }

  resolveSoundFile(name) {
    const candidates = [
      path.join(this.rootDir, 'assets', 'sounds', `${name}.wav`),
      path.join(this.rootDir, 'public', 'sounds', `${name}.wav`),
      path.join(process.env.WINDIR || 'C:\\Windows', 'Media', `${name}.wav`)
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    // Fallbacks
    if (name === 'matchPoint') {
      const alarm = path.join(process.env.WINDIR || 'C:\\Windows', 'Media', 'Alarm01.wav');
      if (fs.existsSync(alarm)) return alarm;
    }
    const defNotify = path.join(process.env.WINDIR || 'C:\\Windows', 'Media', 'Windows Notify System Generic.wav');
    if (fs.existsSync(defNotify)) return defNotify;

    return null;
  }

  playFile(filePath) {
    if (!this.isWindows || !filePath) return;

    if (!this.psProcess || this.psProcess.exitCode !== null) {
      this.initProcess();
    }

    try {
      if (this.psProcess && this.psProcess.stdin && !this.psProcess.stdin.destroyed) {
        const cleanPath = filePath.replace(/'/g, "''");
        this.psProcess.stdin.write(`$player.SoundLocation = '${cleanPath}'; $player.Play()\n`);
      }
    } catch (e) {
      logger.warn('[NativeSound] Play failed:', e.message);
    }
  }

  playPreset(presetName = 'melodicChime') {
    const file = this.resolveSoundFile(presetName);
    if (file) {
      this.playFile(file);
    }
  }

  handleScoreUpdate(scoreData, settings = {}) {
    if (!scoreData || !scoreData.inGame) {
      this.lastAllied = -1;
      this.lastEnemy = -1;
      this.lastMatchId = null;
      this.isMatchEndedTriggered = false;
      return;
    }

    const allied = Number(scoreData.alliedScore) || 0;
    const enemy = Number(scoreData.enemyScore) || 0;

    // Reset when starting new match or when score decreases
    const matchId = scoreData.matchId || scoreData.mapName;
    if ((this.lastMatchId && this.lastMatchId !== matchId) ||
        (this.lastAllied !== -1 && (allied < this.lastAllied || enemy < this.lastEnemy))) {
      this.lastAllied = -1;
      this.lastEnemy = -1;
      this.isMatchEndedTriggered = false;
    }
    this.lastMatchId = matchId;

    const isAudioEnabled = settings.isPcAudioEnabled !== false;

    // Do not play if PC audio is disabled
    if (!isAudioEnabled) {
      this.lastAllied = allied;
      this.lastEnemy = enemy;
      return;
    }

    const preset = settings.soundPreset || 'melodicChime';
    const isFinished = (allied >= 13 || enemy >= 13) && Math.abs(allied - enemy) >= 2;

    // 1. Match Ended
    if (isFinished) {
      if (settings.evtMatchEnded !== false && !this.isMatchEndedTriggered) {
        this.isMatchEndedTriggered = true;
        logger.info(`[NativeSound] 🔔 Playing Match End sound (allied=${allied}, enemy=${enemy})`);
        const endSound = this.resolveSoundFile('victory') || this.resolveSoundFile('tada');
        this.playFile(endSound);
      }
      this.lastAllied = allied;
      this.lastEnemy = enemy;
      return;
    }

    // 2. Match Point Alert
    const threshold = Number(settings.alertEnemyScoreThreshold) || 12;
    const isMatchPoint = (enemy >= threshold) || (allied >= threshold) || scoreData.status === 'MATCH_POINT_RISK' || scoreData.status === 'MATCH_POINT';
    if (isMatchPoint && settings.evtMatchPoint !== false) {
      const now = Date.now();
      // Throttle match point sound to once every 20s or whenever score updates
      if (now - this.lastMatchPointSoundTime > 20000 || (this.lastEnemy !== enemy && enemy > this.lastEnemy)) {
        this.lastMatchPointSoundTime = now;
        logger.info(`[NativeSound] ⚠️ Playing Match Point Alarm (allied=${allied}, enemy=${enemy})`);
        const mpSound = this.resolveSoundFile('matchPoint') || this.resolveSoundFile('Alarm01');
        this.playFile(mpSound);
      }
      this.lastAllied = allied;
      this.lastEnemy = enemy;
      return;
    }

    // 3. Custom Round Alert
    const customRound = Number(settings.customRound) || 10;
    const isCustomHit = (allied + enemy === customRound) || (enemy === customRound) || (allied === customRound);
    if (isCustomHit && settings.evtCustomRound !== false && (this.lastAllied !== allied || this.lastEnemy !== enemy)) {
      if (this.lastAllied !== -1) {
        logger.info(`[NativeSound] 🎯 Playing Custom Round sound (round=${customRound})`);
        const crSound = this.resolveSoundFile('radarPulse') || this.resolveSoundFile(preset);
        this.playFile(crSound);
        this.lastAllied = allied;
        this.lastEnemy = enemy;
        return;
      }
    }

    // 4. Regular Round Change
    if (this.lastAllied !== -1 && this.lastEnemy !== -1) {
      if (allied > this.lastAllied || enemy > this.lastEnemy) {
        if (settings.evtRoundChange !== false) {
          logger.info(`[NativeSound] 🔔 Playing Round Change sound (${allied} - ${enemy})`);
          const rcSound = this.resolveSoundFile(preset) || this.resolveSoundFile('melodicChime');
          this.playFile(rcSound);
        }
      }
    }

    this.lastAllied = allied;
    this.lastEnemy = enemy;
  }

  destroy() {
    if (this.psProcess) {
      try {
        this.psProcess.kill();
      } catch {}
      this.psProcess = null;
    }
  }
}

module.exports = NativeSoundPlayer;
