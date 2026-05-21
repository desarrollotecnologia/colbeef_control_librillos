/** Fechas operativas en zona America/Bogota (corte de turno). */

const HORA_CORTE_TURNO_BOGOTA = (() => {
  const n = parseInt(String(process.env.HORA_CORTE_TURNO_SALIDA_BOGOTA || ''), 10);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 6;
})();

export function hoyBogotaISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

export function fechaTurnoOperativoBogotaISO() {
  const now = new Date();
  const fechaCal = now.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  if (!(h < HORA_CORTE_TURNO_BOGOTA)) return fechaCal;
  const d = new Date(`${fechaCal}T00:00:00-05:00`);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

export function diaAnteriorIsoBogota(fechaISO) {
  const s = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00-05:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

export { HORA_CORTE_TURNO_BOGOTA };
