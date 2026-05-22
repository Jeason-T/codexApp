const fs = require('node:fs/promises');
const path = require('node:path');

const appDataRoot = path.join(process.env.APPDATA || path.resolve(__dirname, '..', '..'), 'fanqie-uploader');
const writableRoot = __dirname.includes('app.asar') ? appDataRoot : path.resolve(__dirname, '..', '..');
const logsDir = path.join(writableRoot, 'logs');
const uploadLogPath = path.join(logsDir, 'upload.log');
const errorLogPath = path.join(logsDir, 'error.log');

function formatLine(level, message, meta = {}) {
  const metaText = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${metaText}\n`;
}

async function appendToFile(filePath, line) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line, 'utf8');
}

async function log(level, message, meta = {}) {
  const line = formatLine(level, message, meta);
  await appendToFile(uploadLogPath, line);

  if (level === 'error') {
    await appendToFile(errorLogPath, line);
  }
}

async function info(message, meta = {}) {
  await log('info', message, meta);
}

async function warn(message, meta = {}) {
  await log('warn', message, meta);
}

async function error(message, meta = {}) {
  await log('error', message, meta);
}

async function debug(message, meta = {}) {
  await log('debug', message, meta);
}

function createLogEntry(level, message) {
  return {
    time: new Date().toISOString(),
    level,
    message
  };
}

module.exports = {
  logsDir,
  uploadLogPath,
  errorLogPath,
  createLogEntry,
  log,
  info,
  warn,
  error,
  debug
};
