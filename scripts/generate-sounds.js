const fs = require('fs');
const path = require('path');

function createWavBuffer(sampleRate, durationSec, generateSample) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);  // PCM
  buffer.writeUInt16LE(1, 22);  // 1 channel
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);  // BlockAlign
  buffer.writeUInt16LE(16, 34); // 16 bits

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const s = Math.max(-1, Math.min(1, generateSample(t, durationSec)));
    const intSample = Math.floor(s < 0 ? s * 32768 : s * 32767);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

// 1. Melodic Chime (659.25, 830.61, 987.77, 1318.51)
function melodicChime() {
  const notes = [
    { f: 659.25, st: 0.0, d: 0.4 },
    { f: 830.61, st: 0.15, d: 0.4 },
    { f: 987.77, st: 0.30, d: 0.5 },
    { f: 1318.51, st: 0.45, d: 0.8 }
  ];
  return createWavBuffer(44100, 1.3, (t) => {
    let sum = 0;
    for (const n of notes) {
      if (t >= n.st && t <= n.st + n.d) {
        const dt = t - n.st;
        const env = Math.exp(-dt * 6) * Math.min(1, dt * 50);
        sum += Math.sin(2 * Math.PI * n.f * dt) * env * 0.45;
      }
    }
    return sum;
  });
}

// 2. Radar Pulse
function radarPulse() {
  return createWavBuffer(44100, 0.5, (t) => {
    let sum = 0;
    for (const st of [0.0, 0.2]) {
      if (t >= st && t <= st + 0.15) {
        const dt = t - st;
        const f = 880 + dt * 5000;
        const env = Math.exp(-dt * 15);
        sum += Math.sin(2 * Math.PI * f * dt) * env * 0.5;
      }
    }
    return sum;
  });
}

// 3. Crystal Bell
function crystalBell() {
  const notes = [
    { f: 880, st: 0.0, d: 0.6 },
    { f: 1318.51, st: 0.18, d: 0.8 }
  ];
  return createWavBuffer(44100, 1.1, (t) => {
    let sum = 0;
    for (const n of notes) {
      if (t >= n.st && t <= n.st + n.d) {
        const dt = t - n.st;
        const env = Math.exp(-dt * 5) * Math.min(1, dt * 60);
        sum += Math.sin(2 * Math.PI * n.f * dt) * env * 0.45;
      }
    }
    return sum;
  });
}

// 4. Arcade Retro
function arcadeRetro() {
  const freqs = [523.25, 659.25, 783.99, 1046.50];
  return createWavBuffer(44100, 0.4, (t) => {
    const idx = Math.floor(t / 0.08);
    if (idx >= 0 && idx < freqs.length) {
      const dt = t - idx * 0.08;
      const f = freqs[idx];
      const sign = Math.sin(2 * Math.PI * f * dt) >= 0 ? 1 : -1; // square wave
      return sign * 0.3 * Math.exp(-dt * 8);
    }
    return 0;
  });
}

// 5. Tactical Duty
function tacticalDuty() {
  const notes = [
    { f: 220, st: 0.0, d: 0.3 },
    { f: 440, st: 0.15, d: 0.4 }
  ];
  return createWavBuffer(44100, 0.6, (t) => {
    let sum = 0;
    for (const n of notes) {
      if (t >= n.st && t <= n.st + n.d) {
        const dt = t - n.st;
        // Triangle wave
        const p = (dt * n.f) % 1;
        const tri = 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;
        sum += tri * 0.4 * Math.exp(-dt * 6);
      }
    }
    return sum;
  });
}

// 6. Match Point Alarm (Urgent dual tone)
function matchPointAlarm() {
  return createWavBuffer(44100, 1.0, (t) => {
    const p = Math.floor(t / 0.15);
    const f = (p % 2 === 0) ? 1400 : 1050;
    const dt = t - p * 0.15;
    return Math.sin(2 * Math.PI * f * dt) * 0.5 * Math.exp(-dt * 4);
  });
}

// 7. Victory Chime
function victoryChime() {
  const notes = [
    { f: 523.25, st: 0.0, d: 0.2 },
    { f: 659.25, st: 0.15, d: 0.2 },
    { f: 783.99, st: 0.30, d: 0.3 },
    { f: 1046.50, st: 0.45, d: 0.8 }
  ];
  return createWavBuffer(44100, 1.3, (t) => {
    let sum = 0;
    for (const n of notes) {
      if (t >= n.st && t <= n.st + n.d) {
        const dt = t - n.st;
        const env = Math.exp(-dt * 4) * Math.min(1, dt * 50);
        sum += Math.sin(2 * Math.PI * n.f * dt) * env * 0.45;
      }
    }
    return sum;
  });
}

function generateAll() {
  const root = path.join(__dirname, '..');
  const targetDirs = [
    path.join(root, 'assets', 'sounds'),
    path.join(root, 'public', 'sounds')
  ];

  for (const dir of targetDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'melodicChime.wav'), melodicChime());
    fs.writeFileSync(path.join(dir, 'radarPulse.wav'), radarPulse());
    fs.writeFileSync(path.join(dir, 'crystalBell.wav'), crystalBell());
    fs.writeFileSync(path.join(dir, 'arcadeRetro.wav'), arcadeRetro());
    fs.writeFileSync(path.join(dir, 'tacticalDuty.wav'), tacticalDuty());
    fs.writeFileSync(path.join(dir, 'matchPoint.wav'), matchPointAlarm());
    fs.writeFileSync(path.join(dir, 'victory.wav'), victoryChime());
    fs.writeFileSync(path.join(dir, 'roundChange.wav'), melodicChime());
  }

  // Clean up any stray scripts/assets
  const stray = path.join(__dirname, 'assets');
  if (fs.existsSync(stray)) {
    fs.rmSync(stray, { recursive: true, force: true });
  }

  console.log('Successfully generated all WAV sound presets.');
}

generateAll();
