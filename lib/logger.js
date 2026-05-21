/** Logger JSON ligero (sin dependencias). */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function nivelActual() {
  const v = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();
  return LEVELS[v] ?? LEVELS.info;
}

function emit(level, msg, meta = {}) {
  if (LEVELS[level] < nivelActual()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: String(msg),
    ...meta,
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(line));
}

export const log = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};
