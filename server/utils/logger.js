const fs = require('fs');
const path = require('path');

const isPkg = !!process.pkg;
const rootDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..', '..');
const logsDir = path.join(rootDir, 'logs');
const logFile = path.join(logsDir, 'app.log');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (e) {}
}

function formatTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function writeToFile(level, message) {
  const line = `[${formatTimestamp()}] [${level.toUpperCase()}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (err) {
    // Ignore file write errors if disk is locked
  }
}

const logger = {
  info: (...args) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    console.log(`[INFO] ${msg}`);
    writeToFile('info', msg);
  },
  warn: (...args) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    console.warn(`[WARN] ${msg}`);
    writeToFile('warn', msg);
  },
  error: (...args) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    console.error(`[ERROR] ${msg}`);
    writeToFile('error', msg);
  },
  debug: (...args) => {
    if (process.env.DEBUG) {
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
      console.log(`[DEBUG] ${msg}`);
      writeToFile('debug', msg);
    }
  },
  getLogFilePath: () => logFile
};

module.exports = logger;
