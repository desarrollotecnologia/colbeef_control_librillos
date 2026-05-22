/**
 * Reporte mensual de librillos (tabla por día × canal + facturación).
 * Misma lógica de agrupación que el frontend (codigoAgrupacionMacro).
 */
import { hoyBogotaISO } from './fecha-bogota.js';

export const REP_LIB_CANALES = [
  { key: 'derivados_carnicos', label: 'DERIVADOS CARNICOS' },
  { key: 'asurcarnes', label: 'ASURCARNES' },
  { key: 'asurcarnescol', label: 'ASURCARNES COL' },
  { key: 'cat', label: 'CAT' },
  { key: 'global_hides', label: 'GLOBAL HIDES' },
  { key: 'asurcarnes_glo', label: 'ASURCARNES GLO' },
];

const REP_LIB_CANAL_KEYS = new Set(REP_LIB_CANALES.map((c) => c.key));

export const REP_LIB_FACTURABLE = new Set([
  'derivados_carnicos',
  'global_hides',
  'asurcarnes',
  'asurcarnescol',
  'asurcarnes_glo',
]);

export const REP_LIB_MESES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function codigoAgrupacionReporte(d) {
  const codRaw = String(d?.agrupacion_codigo || 'asurcarnes').trim() || 'asurcarnes';
  const obsTxt = String(d?.observaciones ?? d?.observacion ?? '').trim();
  return codRaw === 'asurcarnes' && !obsTxt ? 'cocidos' : codRaw;
}

function fechaIsoRow(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function filaBase(fecha) {
  const base = { fecha };
  REP_LIB_CANALES.forEach((c) => {
    base[c.key] = 0;
  });
  return base;
}

/** Días ISO Bogotá desde `desde` hasta `hasta` inclusive. */
export function listaDiasIso(desde, hasta) {
  const out = [];
  let d = new Date(`${desde}T00:00:00-05:00`);
  const h = new Date(`${hasta}T00:00:00-05:00`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(h.getTime()) || d > h) return out;
  while (d <= h) {
    out.push(d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Rango operativo del mes: hasta hoy si es el mes en curso; si no, fin de mes.
 * Incluye día de corte anterior (último del mes previo) para facturación.
 */
export function rangoMesReporteLibrillos(anio, mes) {
  const y = Number(anio);
  const m = Number(mes);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    throw new Error('anio y mes inválidos');
  }
  const hoy = hoyBogotaISO();
  const desde = `${y}-${pad2(m)}-01`;
  const finCalendario = new Date(y, m, 0).toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota',
  });
  let hasta = finCalendario;
  if (hoy >= desde && hoy <= finCalendario) hasta = hoy;
  const corteAnterior = new Date(y, m - 1, 0).toLocaleDateString('en-CA', {
    timeZone: 'America/Bogota',
  });
  const mesEnCurso = hasta < finCalendario;
  return {
    desde,
    hasta,
    fin_calendario: finCalendario,
    corte_anterior: corteAnterior,
    mes_en_curso: mesEnCurso,
    consulta_desde: corteAnterior,
    consulta_hasta: hasta,
  };
}

function calcularFacturacion(lista, anio, mes, rango) {
  const out = {
    periodo_texto: 'Selecciona un mes para calcular facturación.',
    detalle: [],
    total_mes: 0,
    total_corte_anterior: 0,
    total_facturar: 0,
    corte_anterior: rango.corte_anterior,
    fin_mes: rango.fin_calendario,
  };
  const y = Number(anio);
  const m = Number(mes);
  const detalle = new Map();
  let totalMes = 0;
  let totalCorteAnterior = 0;
  const fmt = (iso) => {
    const d = new Date(`${iso}T00:00:00-05:00`);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
  };
  for (const r of lista || []) {
    const f = fechaIsoRow(r?.fecha);
    if (!f) continue;
    const cod = codigoAgrupacionReporte(r);
    if (!REP_LIB_FACTURABLE.has(cod)) continue;
    const yy = Number(f.slice(0, 4));
    const mm = Number(f.slice(5, 7));
    if (yy === y && mm === m) {
      detalle.set(cod, (detalle.get(cod) || 0) + 1);
      totalMes += 1;
    }
    if (f === rango.corte_anterior) totalCorteAnterior += 1;
  }
  out.periodo_texto = `Se realiza factura de comisión de librillos del ${fmt(rango.corte_anterior)} al ${fmt(rango.fin_calendario)}.`;
  const asurCombo =
    Number(detalle.get('asurcarnes') || 0) +
    Number(detalle.get('asurcarnescol') || 0) +
    Number(detalle.get('asurcarnes_glo') || 0);
  out.detalle = [
    { codigo: 'derivados_carnicos', total: Number(detalle.get('derivados_carnicos') || 0) },
    { codigo: 'global_hides', total: Number(detalle.get('global_hides') || 0) },
    { codigo: 'asur_combo', total: asurCombo },
  ].filter((x) => Number(x.total || 0) > 0);
  out.total_mes = totalMes;
  out.total_corte_anterior = totalCorteAnterior;
  out.total_facturar = totalMes + totalCorteAnterior;
  return out;
}

/**
 * @param {object[]} registros — filas de consultarLibrillos (mismo día + agrupación)
 * @param {number|string} anio
 * @param {number|string} mes 1-12
 */
export function armarReporteLibrillosMensual(registros, anio, mes) {
  const m = Number(mes);
  const rango = rangoMesReporteLibrillos(anio, m);
  const porDia = new Map();

  for (const r of registros || []) {
    const f = fechaIsoRow(r?.fecha);
    if (!f || f < rango.desde || f > rango.hasta) continue;
    const cod = codigoAgrupacionReporte(r);
    if (!REP_LIB_CANAL_KEYS.has(cod)) continue;
    if (!porDia.has(f)) porDia.set(f, filaBase(f));
    porDia.get(f)[cod] += 1;
  }

  const filas = listaDiasIso(rango.desde, rango.hasta).map((fecha) => {
    const row = porDia.get(fecha) || filaBase(fecha);
    return { ...row };
  });

  const totales = filaBase('tot');
  let diasConDatos = 0;
  filas.forEach((f) => {
    let sumDia = 0;
    REP_LIB_CANALES.forEach((c) => {
      totales[c.key] += Number(f[c.key] || 0);
      sumDia += Number(f[c.key] || 0);
    });
    if (sumDia > 0) diasConDatos += 1;
  });

  const totalLibros = REP_LIB_CANALES.reduce(
    (s, c) => s + Number(totales[c.key] || 0),
    0
  );
  const facturacion = calcularFacturacion(registros, anio, m, rango);

  return {
    anio: Number(anio),
    mes: m,
    mes_nombre: REP_LIB_MESES[m - 1] || '',
    ...rango,
    dias_con_datos: diasConDatos,
    dias_en_tabla: filas.length,
    total_registros: (registros || []).length,
    filas,
    totales,
    total_libros: totalLibros,
    facturacion,
    canales: REP_LIB_CANALES,
  };
}
