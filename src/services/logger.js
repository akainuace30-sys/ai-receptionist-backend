import { AsyncLocalStorage } from 'async_hooks';

const LEVELS = ['debug', 'info', 'warn', 'error'];

function normalizeLevel(level) {
  if (!level) return 'info';
  const lower = level.toLowerCase();
  return LEVELS.includes(lower) ? lower : 'info';
}

const currentLevel = normalizeLevel(process.env.LOG_LEVEL);
const currentIndex = LEVELS.indexOf(currentLevel);
const storage = new AsyncLocalStorage();

export function runWithContext(context, fn) {
  return storage.run(context, fn);
}

export function getContext() {
  return storage.getStore() || {};
}

function shouldLog(level) {
  return LEVELS.indexOf(level) >= currentIndex;
}

function writeLog(level, message, meta = {}) {
  if (!shouldLog(level)) return;
  const context = getContext();
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    request_id: context.request_id,
    tenant_id: context.tenant_id,
    session_id: context.session_id,
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
