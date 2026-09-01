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

export function esDomingoIso(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00-05:00`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 0;
}

/** Días con proceso para reporte de librillos: se excluyen domingos. */
export function listaDiasProcesoIso(desde, hasta) {
  return listaDiasIso(desde, hasta).filter((fecha) => !esDomingoIso(fecha));
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
    if (esDomingoIso(f)) continue;
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
  let totalRegistrosProceso = 0;

  for (const r of registros || []) {
    const f = fechaIsoRow(r?.fecha);
    if (!f || f < rango.desde || f > rango.hasta) continue;
    if (esDomingoIso(f)) continue;
    totalRegistrosProceso += 1;
    const cod = codigoAgrupacionReporte(r);
    if (!REP_LIB_CANAL_KEYS.has(cod)) continue;
    if (!porDia.has(f)) porDia.set(f, filaBase(f));
    porDia.get(f)[cod] += 1;
  }

  const filas = listaDiasProcesoIso(rango.desde, rango.hasta).map((fecha) => {
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
    total_registros: totalRegistrosProceso,
    filas,
    totales,
    total_libros: totalLibros,
    facturacion,
    canales: REP_LIB_CANALES,
  };
}

function diaMesDesdeIso(iso) {
  const n = Number(String(iso || '').slice(8, 10));
  return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
}

function parseDiaFiltro(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 31) return fallback;
  return Math.trunc(n);
}

function parseIncluirCorteFiltro(v, fallback = true) {
  if (v === null || v === undefined || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  if (['1', 'true', 'si', 'sí', 'on'].includes(s)) return true;
  return fallback;
}

function recalcularFacturacionDesdeFilas(filas, payload, incluirCorteAnterior) {
  const detalle = new Map();
  let totalMes = 0;
  for (const f of filas || []) {
    for (const c of REP_LIB_CANALES) {
      if (!REP_LIB_FACTURABLE.has(c.key)) continue;
      const n = Number(f[c.key] || 0);
      if (n <= 0) continue;
      detalle.set(c.key, (detalle.get(c.key) || 0) + n);
      totalMes += n;
    }
  }
  const asurCombo =
    Number(detalle.get('asurcarnes') || 0) +
    Number(detalle.get('asurcarnescol') || 0) +
    Number(detalle.get('asurcarnes_glo') || 0);
  const factBase = payload?.facturacion || {};
  const totalCorteAnterior = incluirCorteAnterior
    ? Number(factBase.total_corte_anterior || 0)
    : 0;
  return {
    ...factBase,
    detalle: [
      { codigo: 'derivados_carnicos', total: Number(detalle.get('derivados_carnicos') || 0) },
      { codigo: 'global_hides', total: Number(detalle.get('global_hides') || 0) },
      { codigo: 'asur_combo', total: asurCombo },
    ].filter((x) => Number(x.total || 0) > 0),
    total_mes: totalMes,
    total_corte_anterior: totalCorteAnterior,
    total_facturar: totalMes + totalCorteAnterior,
    incluye_corte_anterior: incluirCorteAnterior,
  };
}

/**
 * Aplica filtros operativos al reporte ya armado (tabla + facturación).
 * @param {object} payload — salida de armarReporteLibrillosMensual
 * @param {object} [opts]
 * @param {number|string} [opts.dia_desde] — día inicial del mes (1-31)
 * @param {number|string} [opts.dia_hasta] — día final del mes (1-31); vacío = hasta del payload
 * @param {boolean|string|number} [opts.incluir_corte_anterior] — sumar último día del mes previo
 */
export function filtrarReporteLibrillosMensual(payload, opts = {}) {
  if (!payload) return payload;
  const hastaAuto = diaMesDesdeIso(payload.hasta) || 31;
  const diaDesde = parseDiaFiltro(opts.dia_desde, 1);
  const diaHasta = parseDiaFiltro(opts.dia_hasta, hastaAuto);
  const desde = Math.min(diaDesde, diaHasta);
  const hasta = Math.max(diaDesde, diaHasta);
  const incluirCorte = parseIncluirCorteFiltro(opts.incluir_corte_anterior, true);

  const sinFiltroDias = desde <= 1 && hasta >= hastaAuto;
  const sinFiltroCorte = incluirCorte;
  if (sinFiltroDias && sinFiltroCorte) {
    return {
      ...payload,
      filtros: {
        dia_desde: 1,
        dia_hasta: hastaAuto,
        incluir_corte_anterior: true,
        activo: false,
      },
    };
  }

  const filas = (payload.filas || []).filter((f) => {
    const d = diaMesDesdeIso(f.fecha);
    return d != null && d >= desde && d <= hasta;
  });

  const totales = filaBase('tot');
  filas.forEach((f) => {
    REP_LIB_CANALES.forEach((c) => {
      totales[c.key] += Number(f[c.key] || 0);
    });
  });
  const totalLibros = REP_LIB_CANALES.reduce(
    (s, c) => s + Number(totales[c.key] || 0),
    0
  );
  const facturacion = recalcularFacturacionDesdeFilas(filas, payload, incluirCorte);

  const y = Number(payload.anio);
  const m = Number(payload.mes);
  const desdeIso = `${y}-${pad2(m)}-${pad2(desde)}`;
  const hastaIso = `${y}-${pad2(m)}-${pad2(hasta)}`;

  return {
    ...payload,
    desde: desdeIso,
    hasta: hastaIso,
    filas,
    totales,
    total_libros: totalLibros,
    dias_en_tabla: filas.length,
    facturacion,
    filtros: {
      dia_desde: desde,
      dia_hasta: hasta,
      incluir_corte_anterior: incluirCorte,
      activo: true,
    },
  };
}
