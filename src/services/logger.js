const LEVELS = ['debug', 'info', 'warn', 'error'];

function normalizeLevel(level) {
  if (!level) return 'info';
  const lower = level.toLowerCase();
  return LEVELS.includes(lower) ? lower : 'info';
}

const currentLevel = normalizeLevel(process.env.LOG_LEVEL);
const currentIndex = LEVELS.indexOf(currentLevel);

function shouldLog(level) {
  return LEVELS.indexOf(level) >= currentIndex;
}

function writeLog(level, message, meta = {}) {
  if (!shouldLog(level)) return;
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export const logger = {
  debug: (message, meta) => writeLog('debug', message, meta),
  info: (message, meta) => writeLog('info', message, meta),
  warn: (message, meta) => writeLog('warn', message, meta),
  error: (message, meta) => writeLog('error', message, meta)
};
