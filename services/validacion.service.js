import { ID_TIPO_PARTE_COLBEEF } from '../config/tipo-parte.js';
import {
  agrupacionDesdeObservacionCompleta,
  clasificarAgrupacionConAuditoria,
  normalizarClienteDestino,
} from './agrupaciones.service.js';
import { obtenerLibrillosPorFecha } from './librillos.service.js';
import { obtenerSalidas } from './salidas.service.js';

const HORA_CORTE_TURNO_SALIDA_BOGOTA = (() => {
  const n = parseInt(String(process.env.HORA_CORTE_TURNO_SALIDA_BOGOTA || ''), 10);
  if (Number.isFinite(n) && n >= 0 && n <= 23) return n;
  return 6;
})();

function normalizarObs(obs) {
  return String(obs || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const CODIGOS_RETIRO_COMERCIAL = new Set([
  'asurcarnes',
  'asurcarnescol',
  'asurcarnes_glo',
  'global_hides',
  'cat',
  'derivados_carnicos',
]);

function clasificarMovimiento(d) {
  const obsRaw = String(d?.observaciones ?? d?.observacion ?? '').trim();
  const obs = normalizarObs(obsRaw);
  const vacia = obs === '';
  const clienteParsed = String(d?.cliente_destino || '').trim();
  const t = normalizarClienteDestino(obsRaw);
  // Misma detección «RETIRAR LIBRILLOS» que agrupaciones.service.js (typos típicos).
  const retLibr =
    /\bretirar\s+librillos\b/.test(t) ||
    /\bretirar\s+librilo\b/.test(t) ||
    /\bretirar\s+librill\b/.test(t);
  const ag = agrupacionDesdeObservacionCompleta(obsRaw, clienteParsed);

  const tieneRetiro =
    retLibr || !!clienteParsed || CODIGOS_RETIRO_COMERCIAL.has(ag.codigo);

  const tieneCrudas = /\bCRUDAS?\b/.test(obs);
  const tieneAcond = /\bACONDICIONAMIENTO\b/.test(obs);

  const casoSoloCrudas = tieneCrudas && !tieneRetiro;
  const casoSoloRetiro = tieneRetiro && !tieneCrudas;
  const casoCrudasMasRetiro = tieneCrudas && tieneRetiro;
  const casoAcond = tieneAcond && !tieneRetiro;

  const librillo = casoSoloRetiro || casoCrudasMasRetiro;
  const viscera =
    vacia || casoSoloCrudas || casoCrudasMasRetiro || casoAcond || (!tieneRetiro && !vacia);
  const visceraCruda = casoSoloCrudas || casoCrudasMasRetiro;

  return { librillo, viscera, visceraCruda, vacia, tieneRetiro, tieneCrudas, tieneAcond };
}

function esVistaHistorialLibrillos(d) {
  return clasificarMovimiento(d).tieneRetiro;
}

/**
 * Alineado con frontend/app.js: toda fila con CRUDAS/CRUDA en observación entra al historial crudas
 * (aunque también tenga retiro de librillos — doble conteo operativo como en pantalla).
 */
function esVistaHistorialCrudasSolo(d) {
  const obs = normalizarObs(String(d?.observaciones ?? d?.observacion ?? ''));
  return /\bCRUDAS?\b/.test(obs);
}

/** Misma regla que el front: fecha calendario Bogotá del timestamp */
function diaDesdeTimestamp(val) {
  if (!val) return null;
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function diaAnteriorISO(iso) {
  const d = new Date(`${iso}T00:00:00-05:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function horaEnBogota(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value;
  return h != null ? parseInt(h, 10) : null;
}

function diaOperativoSalidaISO(val) {
  const cal = diaDesdeTimestamp(val);
  if (!cal) return null;
  const h = horaEnBogota(val);
  if (h == null) return cal;
  return h < HORA_CORTE_TURNO_SALIDA_BOGOTA ? diaAnteriorISO(cal) : cal;
}

function salidaColbeefUltima(idProducto, salidas) {
  const rows = (salidas || [])
    .filter((s) => String(s.id_producto) === String(idProducto) && s.fecha_salida)
    .sort((a, b) => new Date(b.fecha_salida) - new Date(a.fecha_salida));
  return rows[0] || null;
}

function salidaEfectivaInfo(d, salidas) {
  const colb = salidaColbeefUltima(d.id_producto, salidas);
  const colbTs = colb?.fecha_salida ? String(colb.fecha_salida) : null;
  const cavaTs = d?.fecha_salida_cava ? String(d.fecha_salida_cava) : null;
  if (!colbTs && !cavaTs) return null;
  if (colbTs && !cavaTs) return { ts: colbTs, fuente: 'colbeef' };
  if (!colbTs && cavaTs) return { ts: cavaTs, fuente: 'trazabilidad' };
  return new Date(colbTs) >= new Date(cavaTs)
    ? { ts: colbTs, fuente: 'colbeef' }
    : { ts: cavaTs, fuente: 'trazabilidad' };
}

function salidaEnDia(salidas, idProducto, fechaISO, dRow = null) {
  const info = dRow ? salidaEfectivaInfo(dRow, salidas) : salidaColbeefUltima(idProducto, salidas);
  if (!info) return false;
  const ts = dRow ? info.ts : info?.fecha_salida;
  return diaOperativoSalidaISO(ts) === fechaISO;
}

/**
 * Cuadre de movimientos para un día operativo (fecha YYYY-MM-DD).
 */
export async function obtenerValidacionMovimientos(fechaISO) {
  const [datos, salidas] = await Promise.all([
    obtenerLibrillosPorFecha(fechaISO),
    obtenerSalidas(),
  ]);

  const total_registros = datos.length;
  const sin_datos_vista = datos.filter((d) => !d.enriquecido).length;

  const idsLibrillos = datos.filter(esVistaHistorialLibrillos);
  const pendientes_despacho_librillos = idsLibrillos.filter(
    (d) => !salidaEnDia(salidas, d.id_producto, fechaISO, d)
  ).length;

  /** Conteo por bucket comercial (misma columna Agrupación que el API). */
  const por_agrupacion = {};
  idsLibrillos.forEach((d) => {
    const c = String(d.agrupacion_codigo ?? '').trim() || 'sin_codigo';
    por_agrupacion[c] = (por_agrupacion[c] || 0) + 1;
  });

  const idsCrudas = datos.filter(esVistaHistorialCrudasSolo);
  const pendientes_despacho_crudas = idsCrudas.filter(
    (d) => !salidaEnDia(salidas, d.id_producto, fechaISO, d)
  ).length;

  const despachos_dia = salidas.filter((s) => diaOperativoSalidaISO(s.fecha_salida) === fechaISO).length;

  const retiros_sin_cliente_parseado = idsLibrillos.filter(
    (d) => !d.cliente_destino || !String(d.cliente_destino).trim()
  ).length;

  const alertas = [];
  if (sin_datos_vista > 0) {
    alertas.push({
      codigo: 'sin_vista',
      texto: `${sin_datos_vista} registro(s) sin datos enriquecidos de trazabilidad para el ID (parte_producto/empresa; revisar trazabilidad)`,
    });
  }
  if (retiros_sin_cliente_parseado > 0) {
    alertas.push({
      codigo: 'retiro_sin_cliente',
      texto: `${retiros_sin_cliente_parseado} retiro(s) con texto «RETIRAR LIBRILLOS» sin cliente destino parseado`,
    });
  }
  if (pendientes_despacho_librillos > 0) {
    alertas.push({
      codigo: 'pendientes_librillos',
      texto: `${pendientes_despacho_librillos} librillo(s) con retiro sin despacho registrado hoy`,
    });
  }

  const ok = sin_datos_vista === 0 && retiros_sin_cliente_parseado === 0;

  return {
    fecha: fechaISO,
    total_registros,
    sin_datos_vista,
    librillos_con_retiro: idsLibrillos.length,
    por_agrupacion,
    pendientes_despacho_librillos,
    crudas_historial: idsCrudas.length,
    pendientes_despacho_crudas,
    despachos_registrados_dia: despachos_dia,
    retiros_sin_cliente_parseado,
    ok,
    alertas,
  };
}

export async function obtenerDiagnosticoMovimientos(fechaISO) {
  const [datos, salidas] = await Promise.all([
    obtenerLibrillosPorFecha(fechaISO),
    obtenerSalidas(),
  ]);

  const librillos = (datos || []).filter(esVistaHistorialLibrillos);
  const crudas = (datos || []).filter(esVistaHistorialCrudasSolo);
  const por_agrupacion = {};
  librillos.forEach((d) => {
    const c = String(d.agrupacion_codigo ?? '').trim() || 'sin_codigo';
    por_agrupacion[c] = (por_agrupacion[c] || 0) + 1;
  });

  const contarEstados = (lista) => {
    const out = { despachado_dia: 0, pendiente: 0, salio_otro_dia: 0 };
    const muestras = { pendiente: [], salio_otro_dia: [] };
    lista.forEach((d) => {
      const info = salidaEfectivaInfo(d, salidas);
      if (!info?.ts) {
        out.pendiente += 1;
        if (muestras.pendiente.length < 25) muestras.pendiente.push(String(d.id_producto));
        return;
      }
      const dia = diaOperativoSalidaISO(info.ts);
      if (dia === fechaISO) out.despachado_dia += 1;
      else {
        out.salio_otro_dia += 1;
        if (muestras.salio_otro_dia.length < 25) muestras.salio_otro_dia.push(String(d.id_producto));
      }
    });
    return { ...out, muestras };
  };

  return {
    fecha: fechaISO,
    corte_turno_hora_bogota: HORA_CORTE_TURNO_SALIDA_BOGOTA,
    total_registros: datos.length,
    sin_datos_vista: datos.filter((d) => !d.enriquecido).length,
    por_agrupacion,
    librillos: { total: librillos.length, ...contarEstados(librillos) },
    crudas: { total: crudas.length, ...contarEstados(crudas) },
  };
}

export async function obtenerAuditoriaClasificacion(fechaISO) {
  const datos = await obtenerLibrillosPorFecha(fechaISO);
  const rows = (Array.isArray(datos) ? datos : []).map((d) => {
    const obsRaw = String(d?.observaciones ?? d?.observacion ?? '').trim();
    const clienteParsed = String(d?.cliente_destino || '').trim();
    const calc = clasificarAgrupacionConAuditoria(obsRaw, clienteParsed);
    const actualCod = String(d?.agrupacion_codigo || '').trim();
    const actualEtiqueta = String(d?.agrupacion || '').trim();
    return {
      id_producto: String(d?.id_producto || '').trim(),
      observacion_original: obsRaw || null,
      observacion_normalizada: calc?.observacion_normalizada || null,
      cliente_destino: clienteParsed || null,
      agrupacion_actual_codigo: actualCod || null,
      agrupacion_actual: actualEtiqueta || null,
      agrupacion_recalculada_codigo: String(calc?.codigo || '').trim() || null,
      agrupacion_recalculada: String(calc?.etiqueta || '').trim() || null,
      regla_aplicada: String(calc?.regla || '').trim() || null,
      coincide: (actualCod || '') === String(calc?.codigo || ''),
    };
  });

  const total = rows.length;
  const noCoinciden = rows.filter((r) => !r.coincide);
  const porRegla = {};
  rows.forEach((r) => {
    const k = String(r.regla_aplicada || 'sin_regla');
    porRegla[k] = (porRegla[k] || 0) + 1;
  });

  return {
    fecha: fechaISO,
    total,
    total_no_coinciden: noCoinciden.length,
    por_regla: Object.entries(porRegla)
      .map(([regla, cantidad]) => ({ regla, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.regla.localeCompare(b.regla)),
    muestras_no_coinciden: noCoinciden.slice(0, 200),
  };
}

export function obtenerConfigOperacion() {
  const cols = String(process.env.PLAN_FAENA_PFP_TEXT_COLUMNS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    hora_corte_turno_salida_bogota: HORA_CORTE_TURNO_SALIDA_BOGOTA,
    id_tipo_parte_colbeef: ID_TIPO_PARTE_COLBEEF,
    use_plan_faena_universe:
      process.env.USE_PLAN_FAENA_UNIVERSE === '0' ? false : true,
    plan_faena_fallback_on_empty:
      process.env.PLAN_FAENA_FALLBACK_ON_EMPTY === '0' ? false : true,
    union_parte_plan_dia:
      process.env.USE_UNION_PARTE_PLAN_DIA === '0' ? false : true,
    plan_faena_pfp_text_columns: cols,
    plan_faena_obs_prioridad: String(
      process.env.PLAN_FAENA_OBS_PRIORIDAD || 'plan_first'
    ).trim(),
  };
}
