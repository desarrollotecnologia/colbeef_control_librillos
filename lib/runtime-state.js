/** Estado en memoria para /api/health y diagnóstico operativo. */

export const runtimeState = {
  startedAt: new Date().toISOString(),
  lastPollOkAt: null,
  lastPollErrorAt: null,
  lastPollError: null,
  lastPollRows: 0,
  lastPollMs: null,
  pollIntervalMs: null,
  cacheTurnoFecha: null,
  cacheTurnoRows: 0,
  cacheTurnoAgeSec: null,
};

export function markPollSuccess({ fecha, rows, ms, intervalMs }) {
  runtimeState.lastPollOkAt = new Date().toISOString();
  runtimeState.lastPollError = null;
  runtimeState.lastPollRows = Number(rows) || 0;
  runtimeState.lastPollMs = ms ?? null;
  runtimeState.pollIntervalMs = intervalMs ?? runtimeState.pollIntervalMs;
  runtimeState.cacheTurnoFecha = fecha ?? null;
  runtimeState.cacheTurnoRows = Number(rows) || 0;
  runtimeState.cacheTurnoAgeSec = 0;
}

export function markPollError(err) {
  runtimeState.lastPollErrorAt = new Date().toISOString();
  runtimeState.lastPollError = String(err?.message || err);
}

export function snapshotHealthExtra() {
  return { ...runtimeState };
}
