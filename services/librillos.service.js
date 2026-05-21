import { pool } from '../config/db.js';
import { ID_TIPO_PARTE_COLBEEF } from '../config/tipo-parte.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  columnasTextoPlanFaenaProducto,
  fusionarObservacionClasificacion,
  textoIndicaRetiroLibrillos,
} from '../config/plan-faena-obs.js';
import {
  agrupacionDesdeObservacionCompleta,
  agrupacionDesdeTextoPlanFaena,
  reglaOverrideGutierrezCarviscol,
} from './agrupaciones.service.js';
import { obtenerCambiosSucursalCrudasAuditoria, registrarCambioHistorico } from './auditoria.service.js';
import { persistirSucursalesCrudasDesdeSnapshot } from './crudas-sucursal.store.js';
import {
  SQL_EXPR_FECHA_PARTE_BOGOTA,
  SQL_WHERE_PARTE_DIA_BOGOTA_P1,
} from '../config/parte-dia-bogota-sql.js';
import {
  INCLUIR_SACRIFICIO_EMERGENCIA,
  SACRIFICIO_EMERGENCIA_PUESTO_ILIKE,
  SACRIFICIO_EMERGENCIA_PUESTO_TABLA,
  columnasNombrePuestoTrabajo,
} from '../config/sacrificio-emergencia.js';
import { parsearObservacion } from './librillos/observacion.parser.js';
import {
  hoyBogotaISO,
  fechaTurnoOperativoBogotaISO,
  diaAnteriorIsoBogota,
} from './librillos/fecha-bogota.js';
import {
  cachePorFecha,
  cachePorRango,
  cacheCambiosSucursalRevision,
  cacheMapaSucursalHastaFecha,
  CACHE_FECHA_MS,
  CACHE_RANGO_MS,
  CACHE_CRUCE_SUCURSAL_MS,
  leerCacheFecha,
  guardarCacheFecha,
  leerCacheRango,
  guardarCacheRango,
  invalidarCacheFecha,
  invalidarCacheCruceSucursalPorFecha,
  getCacheTurno,
  setCacheTurno,
  statsCache,
} from './librillos/cache-store.js';
import { calcularResumenMacro } from './librillos/resumen-macro.js';
import { clasificarMovimiento } from './clasificacion-movimiento.service.js';
import { markPollSuccess, markPollError } from '../lib/runtime-state.js';
import { log } from '../lib/logger.js';

export { parsearObservacion } from './librillos/observacion.parser.js';
export { fechaTurnoOperativoBogotaISO } from './librillos/fecha-bogota.js';

let cacheTurnoFecha = null;
let cacheTurnoSnapshot = new Map();
let columnaUsuarioPlanillaje = undefined; // undefined=no resuelto, null=no existe

const COLBEEF_DEBUG = process.env.COLBEEF_DEBUG === '1' || process.env.COLBEEF_DEBUG === 'true';
const USE_PLAN_FAENA_UNIVERSE =
  process.env.USE_PLAN_FAENA_UNIVERSE === '0' ? false : true;
/** Plan ∪ parte Colbeef del mismo día (recomendado): evita quedarse cortos vs. macro/DATOS. */
const USE_UNION_PARTE_PLAN_DIA =
  process.env.USE_UNION_PARTE_PLAN_DIA === '0' ? false : true;
/**
 * Si =1, el KPI puede mostrar además el subconjunto plan∩insens (solo informativo).
 * El listado y el resumen del día usan SIEMPRE todo el plan de faena del día.
 */
const REQUIERE_INSENSIBILIZACION_PLAN_FAENA =
  process.env.REQUIERE_INSENSIBILIZACION_PLAN_FAENA === '1';
const PLAN_FAENA_FALLBACK_ON_EMPTY =
  process.env.PLAN_FAENA_FALLBACK_ON_EMPTY === '0' ? false : true;
/** Activar solo si hay archivos en data/ y scripts Python (extract_*.py). Por defecto: solo BD. */
const USE_LOCAL_PLAN_FILES =
  process.env.USE_LOCAL_PLAN_FILES === '0'
    ? false
    : (process.env.USE_LOCAL_PLAN_FILES === '1' ||
       process.env.USE_LOCAL_PLAN_FILES === 'true' ||
       fs.existsSync(path.resolve(process.cwd(), 'data', 'PLAN FAENA CONSOLIDADO.xls')));
const USE_LOCAL_RETIRO_FILES =
  process.env.USE_LOCAL_RETIRO_FILES === '1' ||
  process.env.USE_LOCAL_RETIRO_FILES === 'true';
const localPlanObsCache = new Map();
const localRetiroObsCache = new Map();
const planSnapshotCache = new Map();
const PLAN_SNAPSHOT_DIR = path.resolve(process.cwd(), 'data', 'plan-faena-historico');
/**
 * Lotes para `metaRaizPorIds` y cava (solo tablas `trazabilidad_proceso.*` / `organizaciones.*`).
 * No se consulta `vw_pbi01` ni vistas analíticas Power BI.
 * Env: `META_RAIZ_BATCH_SIZE` (o alias heredado `VISTA_CHUNK_SIZE`).
 */
const META_RAIZ_BATCH = (() => {
  const raw = String(process.env.META_RAIZ_BATCH_SIZE || process.env.VISTA_CHUNK_SIZE || '').trim();
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 15 && n <= 300) return n;
  return 120;
})();
/** Concurrencia de lotes para metadatos raíz + cava. Env: `META_RAIZ_CONCURRENCY` o `VISTA_CHUNK_CONCURRENCY`. */
const META_RAIZ_CONCURRENCY = (() => {
  const raw = String(process.env.META_RAIZ_CONCURRENCY || process.env.VISTA_CHUNK_CONCURRENCY || '').trim();
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 8) return n;
  return 3;
})();
const RANGE_CONCURRENCY = (() => {
  const n = parseInt(String(process.env.RANGO_CONCURRENCY || ''), 10);
  if (Number.isFinite(n) && n >= 1 && n <= 8) return n;
  return 3;
})();
/** API completa: incluir todos los registros del día. */
function rowIncluidoColbeef(observacionesRaw, observacionParsed, cliente_destino) {
  return true;
}

// ── CHUNKS ────────────────────────────────────────────────────────────────────
function chunks(arr, n) {
  const result = [];
  for (let i = 0; i < arr.length; i += n) result.push(arr.slice(i, i + n));
  return result;
}

async function procesarGruposConLimite(grupos, worker, concurrency = 3) {
  const lim = Math.max(1, Number(concurrency) || 1);
  for (let i = 0; i < grupos.length; i += lim) {
    const tramo = grupos.slice(i, i + lim);
    await Promise.all(tramo.map((g) => worker(g)));
  }
}

const keyCodigo = (c) => String(c);

function esCrudaHistorialLibrillosRow(d) {
  return /\bCRUDAS?\b/i.test(
    String(d?.observaciones ?? d?.observacion ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function sucursalNormLibrilloRow(d) {
  return String(d?.sucursal ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Puesto logístico para etiquetas: sucursal BD, luego plaza de fila, luego plaza en observación. */
function puestoLogisticoNorm({ sucursal, plaza, observacion } = {}) {
  const suc = sucursalNormLibrilloRow({ sucursal });
  if (suc && !/^cava\.?$/i.test(suc)) return suc;
  const pl = sucursalNormLibrilloRow({ sucursal: plaza });
  if (pl && !/^cava\.?$/i.test(pl)) return pl;
  const { plaza: pObs } = parsearObservacion(String(observacion || ''));
  const po = sucursalNormLibrilloRow({ sucursal: pObs });
  if (po && !/^cava\.?$/i.test(po)) return po;
  return suc || pl || po || '';
}

/** Puesto operativo en etiqueta: agrupación del día (4ZAP, etc.) antes que sucursal «CAVA» fija en BD. */
function puestoOperativoDesdeFila(d, obsText) {
  if (!d && !obsText) return '';
  const cod = String(d?.agrupacion_codigo || '').trim().toLowerCase();
  const ag = String(d?.agrupacion || '').trim();
  if (ag && cod && cod !== 'asurcarnes') return ag;
  return puestoLogisticoNorm({
    sucursal: d?.sucursal,
    plaza: d?.plaza,
    observacion: obsText || d?.observaciones || d?.observacion,
  });
}

function puestoDesdeFilaConsulta(d) {
  if (!d) return '';
  return puestoOperativoDesdeFila(d, d.observaciones ?? d.observacion);
}

function detectarCambioPuestoCrudaPlanRevision(dPlan, dRev, obsAnt, obsNue) {
  const pAnt = puestoOperativoDesdeFila(dPlan, obsAnt);
  const pNue = puestoOperativoDesdeFila(dRev, obsNue);
  if (pAnt !== pNue) {
    return { sucursal_antes: pAnt, sucursal_despues: pNue };
  }
  const cAnt = String(dPlan?.agrupacion_codigo || '').trim().toLowerCase();
  const cNue = String(dRev?.agrupacion_codigo || '').trim().toLowerCase();
  if (
    cAnt &&
    cNue &&
    cAnt !== cNue &&
    cAnt !== 'asurcarnes' &&
    cNue !== 'asurcarnes'
  ) {
    return {
      sucursal_antes: String(dPlan?.agrupacion || cAnt).trim(),
      sucursal_despues: String(dRev?.agrupacion || cNue).trim(),
    };
  }
  return null;
}

function listarCambiosSucursalEntreFilas(
  arrReferencia,
  arrRevision,
  fechaReferencia,
  fechaRevision,
  { soloCrudas = true, idsPermitidos = null } = {}
) {
  const mapRef = new Map();
  for (const d of arrReferencia || []) {
    if (!d) continue;
    const id = String(d.id_producto ?? '').trim();
    if (!id) continue;
    if (idsPermitidos && !idsPermitidos.has(id)) continue;
    mapRef.set(id, d);
  }
  const generado = new Date().toISOString();
  const cambios = [];
  for (const n of arrRevision || []) {
    if (!n) continue;
    const id = String(n.id_producto ?? '').trim();
    if (!id) continue;
    if (idsPermitidos && !idsPermitidos.has(id)) continue;
    const p = mapRef.get(id);
    if (!p) continue;
    if (soloCrudas) {
      const cruda =
        esCrudaHistorialLibrillosRow(p) || esCrudaHistorialLibrillosRow(n);
      if (!cruda) continue;
    }
    const obsAnt = String(p.observaciones ?? p.observacion ?? '').trim();
    const obsNue = String(n.observaciones ?? n.observacion ?? '').trim();
    const diff = detectarCambioPuestoCrudaPlanRevision(p, n, obsAnt, obsNue);
    if (!diff) continue;
    const sAnt = diff.sucursal_antes;
    const sNue = diff.sucursal_despues;
    cambios.push({
      id,
      tipo: 'CRUDA_SUCURSAL',
      antes: sAnt || '—',
      despues: sNue || '—',
      sucursal_antes: sAnt,
      sucursal_despues: sNue,
      observacion_antes: obsAnt,
      observacion_despues: obsNue,
      observacion_texto: obsNue,
      propietario: String(n.propietario || p.propietario || '').trim(),
      cliente_destino: String(n.cliente_destino || p.cliente_destino || '').trim(),
      agrupacion: String(n.agrupacion || p.agrupacion || '').trim(),
      plaza: String(n.plaza || p.plaza || '').trim(),
      empresa_destino: String(n.empresa_destino || p.empresa_destino || '').trim(),
      destino: String(n.destino || p.destino || '').trim(),
      identificacion: String(n.identificacion || p.identificacion || '').trim(),
      detectado_en: generado,
      momento_bd: null,
      fuente: 'bd_servidor',
      fecha_referencia: fechaReferencia,
      fecha_revision: fechaRevision,
    });
  }
  return cambios;
}

function listarCambiosSucursalCrudasEntreFilas(arrReferencia, arrRevision, fechaReferencia, fechaRevision) {
  return listarCambiosSucursalEntreFilas(arrReferencia, arrRevision, fechaReferencia, fechaRevision, {
    soloCrudas: true,
  });
}

/**
 * Crudas con cambio de sucursal respecto al día anterior (mismo criterio que el modal logística).
 */
export async function obtenerCrudasCambioSucursalCruceDiaAnterior(fechaISO) {
  const fecha = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('fecha debe ser YYYY-MM-DD');
  }
  const ayer = diaAnteriorIsoBogota(fecha);
  if (!ayer) {
    return {
      fecha,
      fecha_referencia_anterior: '',
      cambios: [],
      generado_en: new Date().toISOString(),
    };
  }

  const idsHoy = await idsUniversoReporteDia(fecha);
  const idsAyer = await idsUniversoReporteDia(ayer);
  const ids = [...new Set([...idsHoy, ...idsAyer])];
  const [sucAyer, sucHoy, obsAyer, obsHoy] = await Promise.all([
    mapaSucursalPorIdsHastaFechaDia(ayer, ids),
    mapaSucursalPorIdsHastaFechaDia(fecha, ids),
    mapaObservacionPartePorIdsEnFecha(ayer, ids),
    mapaObservacionPartePorIdsEnFecha(fecha, ids),
  ]);
  const cambios = [];
  const generado = new Date().toISOString();
  for (const id of ids) {
    const sAnt = sucursalNormLibrilloRow({ sucursal: sucAyer.get(id) });
    const sNue = sucursalNormLibrilloRow({ sucursal: sucHoy.get(id) });
    if (sAnt === sNue) continue;
    const obsAnt = obsAyer.get(id) || '';
    const obsNue = obsHoy.get(id) || '';
    if (!esCrudaHistorialLibrillosRow({ observaciones: obsAnt }) && !esCrudaHistorialLibrillosRow({ observaciones: obsNue })) {
      continue;
    }
    cambios.push({
      id,
      tipo: 'CRUDA_SUCURSAL',
      antes: sAnt || '—',
      despues: sNue || '—',
      sucursal_antes: sAnt,
      sucursal_despues: sNue,
      observacion_antes: obsAnt,
      observacion_despues: obsNue,
      observacion_texto: obsNue,
      detectado_en: generado,
      momento_bd: null,
      fuente: 'bd_servidor',
      fecha_referencia: ayer,
      fecha_revision: fecha,
    });
  }

  return {
    fecha,
    fecha_referencia_anterior: ayer,
    cambios,
    generado_en: new Date().toISOString(),
  };
}

function huellaIdsConsulta(ids) {
  const s = [...ids].map(String).sort();
  if (s.length <= 4) return s.join('\x1f');
  return `${s.length}\x1f${s[0]}\x1f${s[s.length - 1]}`;
}

/** Sucursal (local Colbeef) vigente al cierre del día calendario Bogotá, por última parte tipo Colbeef ≤ esa fecha. */
async function mapaSucursalPorIdsHastaFechaDia(fechaISO, idsTexto) {
  const ids = [...new Set((idsTexto || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const fecha = String(fechaISO || '').trim();
  const cacheKey = `${fecha}|${huellaIdsConsulta(ids)}`;
  const hit = cacheMapaSucursalHastaFecha.get(cacheKey);
  if (hit && Date.now() - Number(hit.ts || 0) <= CACHE_FECHA_MS) {
    return hit.map;
  }
  const out = new Map();
  const grupos = chunks(ids, META_RAIZ_BATCH);
  for (const grupo of grupos) {
    const res = await pool.query(
      `
      WITH pp_asof AS (
        SELECT DISTINCT ON (pp.id_producto::text)
          pp.id_producto::text AS id_producto,
          pp.id AS id_parte_producto
        FROM trazabilidad_proceso.parte_producto pp
        WHERE pp.id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
          AND pp.id_producto::text = ANY($2::text[])
          AND (timezone('America/Bogota', pp.fecha_registro))::date <= $1::date
        ORDER BY pp.id_producto::text, pp.fecha_registro DESC NULLS LAST, pp.id DESC
      ),
      ppe_lnk AS (
        SELECT DISTINCT ON (ppe.id_producto::text)
          ppe.id_producto::text AS id_producto,
          ppe.id AS id_parte_producto_empresa
        FROM trazabilidad_proceso.parte_producto_empresa ppe
        INNER JOIN pp_asof pa
          ON pa.id_producto = ppe.id_producto::text
         AND pa.id_parte_producto = ppe.id_parte_producto
        ORDER BY ppe.id_producto::text, ppe.id DESC
      ),
      ppel_lnk AS (
        SELECT DISTINCT ON (ppel.id_parte_producto_empresa)
          ppel.id_parte_producto_empresa,
          ppel.id_local
        FROM trazabilidad_proceso.parte_producto_empresa_local ppel
        INNER JOIN ppe_lnk pl ON pl.id_parte_producto_empresa = ppel.id_parte_producto_empresa
        ORDER BY ppel.id_parte_producto_empresa, ppel.id DESC
      )
      SELECT
        pa.id_producto,
        s.nombre AS sucursal
      FROM pp_asof pa
      LEFT JOIN ppe_lnk pl ON pl.id_producto = pa.id_producto
      LEFT JOIN ppel_lnk pel ON pel.id_parte_producto_empresa = pl.id_parte_producto_empresa
      LEFT JOIN organizaciones.sucursal s ON s.id = pel.id_local
      `,
      [fechaISO, grupo]
    );
    (res.rows || []).forEach((r) => {
      out.set(String(r.id_producto), String(r.sucursal || '').trim());
    });
  }
  cacheMapaSucursalHastaFecha.set(cacheKey, { ts: Date.now(), map: out });
  return out;
}

/** Sucursal Colbeef registrada ese día calendario (última parte del día), no acumulada. */
async function mapaSucursalPorIdsEnFechaCalendario(fechaISO, idsTexto) {
  const ids = [...new Set((idsTexto || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const fecha = String(fechaISO || '').trim();
  const cacheKey = `dia|${fecha}|${huellaIdsConsulta(ids)}`;
  const hit = cacheMapaSucursalHastaFecha.get(cacheKey);
  if (hit && Date.now() - Number(hit.ts || 0) <= CACHE_FECHA_MS) {
    return hit.map;
  }
  const out = new Map();
  const grupos = chunks(ids, META_RAIZ_BATCH);
  for (const grupo of grupos) {
    const res = await pool.query(
      `
      WITH pp_dia AS (
        SELECT DISTINCT ON (pp.id_producto::text)
          pp.id_producto::text AS id_producto,
          pp.id AS id_parte_producto
        FROM trazabilidad_proceso.parte_producto pp
        WHERE pp.id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
          AND pp.id_producto::text = ANY($2::text[])
          AND (timezone('America/Bogota', pp.fecha_registro))::date = $1::date
        ORDER BY pp.id_producto::text, pp.fecha_registro DESC NULLS LAST, pp.id DESC
      ),
      ppe_lnk AS (
        SELECT DISTINCT ON (ppe.id_producto::text)
          ppe.id_producto::text AS id_producto,
          ppe.id AS id_parte_producto_empresa
        FROM trazabilidad_proceso.parte_producto_empresa ppe
        INNER JOIN pp_dia pa
          ON pa.id_producto = ppe.id_producto::text
         AND pa.id_parte_producto = ppe.id_parte_producto
        ORDER BY ppe.id_producto::text, ppe.id DESC
      ),
      ppel_lnk AS (
        SELECT DISTINCT ON (ppel.id_parte_producto_empresa)
          ppel.id_parte_producto_empresa,
          ppel.id_local
        FROM trazabilidad_proceso.parte_producto_empresa_local ppel
        INNER JOIN ppe_lnk pl ON pl.id_parte_producto_empresa = ppel.id_parte_producto_empresa
        ORDER BY ppel.id_parte_producto_empresa, ppel.id DESC
      )
      SELECT
        pa.id_producto,
        s.nombre AS sucursal
      FROM pp_dia pa
      LEFT JOIN ppe_lnk pl ON pl.id_producto = pa.id_producto
      LEFT JOIN ppel_lnk pel ON pel.id_parte_producto_empresa = pl.id_parte_producto_empresa
      LEFT JOIN organizaciones.sucursal s ON s.id = pel.id_local
      `,
      [fechaISO, grupo]
    );
    (res.rows || []).forEach((r) => {
      out.set(String(r.id_producto), String(r.sucursal || '').trim());
    });
  }
  cacheMapaSucursalHastaFecha.set(cacheKey, { ts: Date.now(), map: out });
  return out;
}

/** Observación de parte_producto ese día (última del calendario); respaldo última conocida si no hubo registro. */
async function mapaObservacionPartePorIdsEnFecha(fechaISO, idsTexto) {
  const ids = [...new Set((idsTexto || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const { map: delDia } = await filasParteProductoPorIdsYFecha(fechaISO, ids);
  const faltantes = ids.filter((id) => !delDia.has(String(id)));
  const ult = faltantes.length ? await observacionesUltimasPorIds(faltantes) : new Map();
  for (const id of ids) {
    const row = delDia.get(String(id)) || ult.get(String(id));
    out.set(
      String(id),
      String(row?.observaciones || '')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }
  return out;
}

/** Último registro cava por id: pendiente = sin fecha_salida (aún no sale de cava / no despachado). */
async function mapaPendienteSalidaCavaPorIds(idsTexto) {
  const ids = [...new Set((idsTexto || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  for (const id of ids) out.set(id, { pendiente: true, fecha_salida_cava: null });
  const grupos = chunks(ids, META_RAIZ_BATCH);
  for (const grupo of grupos) {
    const res = await pool.query(
      `
      SELECT DISTINCT ON (pp.id_producto::text)
        pp.id_producto::text AS id_producto,
        pcr.fecha_salida AS fecha_salida_cava
      FROM trazabilidad_proceso.parte_producto pp
      LEFT JOIN LATERAL (
        SELECT x.fecha_salida
        FROM trazabilidad_proceso.parte_producto_cava_riel x
        WHERE x.id_producto::text = pp.id_producto::text
          AND x.id_parte_producto = pp.id
        ORDER BY x.id DESC
        LIMIT 1
      ) pcr ON TRUE
      WHERE pp.id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
        AND pp.id_producto::text = ANY($1::text[])
      ORDER BY pp.id_producto::text, pp.fecha_registro DESC NULLS LAST, pp.id DESC
      `,
      [grupo]
    );
    (res.rows || []).forEach((r) => {
      const id = String(r.id_producto || '').trim();
      if (!id) return;
      const fs = r.fecha_salida_cava || null;
      out.set(id, { pendiente: !fs, fecha_salida_cava: fs });
    });
  }
  return out;
}

/**
 * Revisión logística: plan de faena (día N) vs sucursal al cierre de cada día (no el valor «actual» único).
 */
export async function obtenerCambiosSucursalRevisionPlanFaena(fechaPlanISO, fechaRevisionISO) {
  const fechaPlan = String(fechaPlanISO || '').trim();
  const fechaRevision = String(fechaRevisionISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPlan) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaRevision)) {
    throw new Error('fecha_plan y fecha_revision deben ser YYYY-MM-DD');
  }
  const cacheKey = `v3-agrupacion|${fechaPlan}|${fechaRevision}`;
  const hitCruce = cacheCambiosSucursalRevision.get(cacheKey);
  if (hitCruce && Date.now() - Number(hitCruce.ts || 0) <= CACHE_CRUCE_SUCURSAL_MS) {
    return hitCruce.data;
  }
  const planSet = await idsPlanFaenaPorFecha(fechaPlan);
  const generado = new Date().toISOString();

  let filasPlan = [];
  let filasRev = [];
  try {
    [filasPlan, filasRev] = await Promise.all([
      obtenerLibrillosConsultaBdDirecta(fechaPlan),
      obtenerLibrillosConsultaBdDirecta(fechaRevision),
    ]);
  } catch (e) {
    log.warn('Cruce sucursal: consulta librillos plan/revisión', { error: e.message });
  }

  const sucursalEnFilaPlan = new Map();
  const sucursalEnFilaRev = new Map();
  for (const d of filasPlan || []) {
    const id = String(d?.id_producto ?? '').trim();
    if (!id) continue;
    sucursalEnFilaPlan.set(id, sucursalNormLibrilloRow(d));
  }
  for (const d of filasRev || []) {
    const id = String(d?.id_producto ?? '').trim();
    if (!id) continue;
    sucursalEnFilaRev.set(id, sucursalNormLibrilloRow(d));
  }

  const filaPlanPorId = new Map((filasPlan || []).map((d) => [String(d?.id_producto ?? '').trim(), d]));
  const filaRevPorId = new Map((filasRev || []).map((d) => [String(d?.id_producto ?? '').trim(), d]));
  const idsPlan = [...planSet];

  if (!idsPlan.length) {
    return {
      fecha_plan: fechaPlan,
      fecha_revision: fechaRevision,
      total_plan_faena: planSet.size,
      total_crudas_plan: 0,
      cambios: [],
      cambios_todos_sucursal: [],
      total_cambios_sucursal: 0,
      total_elegibles_reimpresion: 0,
      generado_en: generado,
    };
  }

  const [obsPlan, obsRev, mapaCava] = await Promise.all([
    mapaObservacionPartePorIdsEnFecha(fechaPlan, idsPlan),
    mapaObservacionPartePorIdsEnFecha(fechaRevision, idsPlan),
    mapaPendienteSalidaCavaPorIds(idsPlan),
  ]);

  const idsCrudasPlan = idsPlan.filter((id) => {
    const dPlan = filaPlanPorId.get(id);
    const dRev = filaRevPorId.get(id);
    const o1 = String(
      obsPlan.get(id) || dPlan?.observaciones || dPlan?.observacion || ''
    ).trim();
    const o2 = String(
      obsRev.get(id) || dRev?.observaciones || dRev?.observacion || ''
    ).trim();
    return (
      esCrudaHistorialLibrillosRow({ observaciones: o1 }) ||
      esCrudaHistorialLibrillosRow({ observaciones: o2 })
    );
  });

  if (!idsCrudasPlan.length) {
    return {
      fecha_plan: fechaPlan,
      fecha_revision: fechaRevision,
      total_plan_faena: planSet.size,
      total_crudas_plan: 0,
      cambios: [],
      cambios_todos_sucursal: [],
      total_cambios_sucursal: 0,
      total_elegibles_reimpresion: 0,
      generado_en: generado,
    };
  }

  const cambiosFilaDirecto = listarCambiosSucursalEntreFilas(filasPlan, filasRev, fechaPlan, fechaRevision, {
    soloCrudas: true,
    idsPermitidos: new Set(idsCrudasPlan),
  });

  const cambios = [];
  const cambios_todos_sucursal = [];
  const pushCambio = (id, diff, obsAnt, obsNue, fuente, momentoBd = null) => {
    const cava = mapaCava.get(id);
    const elegible_reimpresion = cava?.pendiente !== false;
    const row = {
      id,
      tipo: 'CRUDA_SUCURSAL',
      antes: diff.sucursal_antes || '—',
      despues: diff.sucursal_despues || '—',
      sucursal_antes: diff.sucursal_antes,
      sucursal_despues: diff.sucursal_despues,
      observacion_antes: obsAnt,
      observacion_despues: obsNue,
      observacion_texto: obsNue,
      detectado_en: generado,
      momento_bd: momentoBd,
      fuente,
      fecha_referencia: fechaPlan,
      fecha_revision: fechaRevision,
      elegible_reimpresion,
      fecha_salida_cava: cava?.fecha_salida_cava || null,
    };
    cambios_todos_sucursal.push(row);
    if (elegible_reimpresion) cambios.push(row);
  };

  for (const c of cambiosFilaDirecto) {
    const id = String(c?.id || '').trim();
    if (!id) continue;
    pushCambio(
      id,
      { sucursal_antes: c.sucursal_antes, sucursal_despues: c.sucursal_despues },
      c.observacion_antes,
      c.observacion_despues,
      'consulta_plan_revision'
    );
  }

  for (const id of idsCrudasPlan) {
    if (cambios_todos_sucursal.some((x) => x.id === id)) continue;
    const dPlan = filaPlanPorId.get(id);
    const dRev = filaRevPorId.get(id);
    if (!dPlan || !dRev) continue;
    const obsAnt =
      obsPlan.get(id) ||
      String(dPlan?.observaciones ?? dPlan?.observacion ?? '').trim();
    const obsNue =
      obsRev.get(id) ||
      String(dRev?.observaciones ?? dRev?.observacion ?? '').trim();
    if (
      !esCrudaHistorialLibrillosRow({ observaciones: obsAnt }) &&
      !esCrudaHistorialLibrillosRow({ observaciones: obsNue })
    ) {
      continue;
    }
    const diff = detectarCambioPuestoCrudaPlanRevision(dPlan, dRev, obsAnt, obsNue);
    if (!diff) continue;
    pushCambio(id, diff, obsAnt, obsNue, 'bd_servidor');
  }

  const idsCrudasSet = new Set(idsCrudasPlan);
  let cambiosAud = [];
  try {
    cambiosAud = await obtenerCambiosSucursalCrudasAuditoria(
      fechaPlan,
      fechaRevision,
      idsCrudasSet
    );
  } catch (e) {
    log.warn('Cruce sucursal: auditoría planillaje', { error: e.message });
  }

  for (const c of cambiosAud) {
    const id = String(c?.id || '').trim();
    if (!id || cambios_todos_sucursal.some((x) => x.id === id)) continue;
    const cava = mapaCava.get(id);
    const elegible_reimpresion = cava?.pendiente !== false;
    const row = {
      id,
      tipo: 'CRUDA_SUCURSAL',
      antes: c.sucursal_antes || '—',
      despues: c.sucursal_despues || '—',
      sucursal_antes: c.sucursal_antes,
      sucursal_despues: c.sucursal_despues,
      observacion_antes: c.observacion_antes || '',
      observacion_despues: c.observacion_despues || '',
      observacion_texto: c.observacion_despues || '',
      detectado_en: generado,
      momento_bd: c.fecha || null,
      fuente: 'auditoria_planillaje',
      fecha_referencia: fechaPlan,
      fecha_revision: fechaRevision,
      elegible_reimpresion,
      fecha_salida_cava: cava?.fecha_salida_cava || null,
    };
    cambios_todos_sucursal.push(row);
    if (elegible_reimpresion) cambios.push(row);
  }

  const payload = {
    fecha_plan: fechaPlan,
    fecha_revision: fechaRevision,
    total_plan_faena: planSet.size,
    total_crudas_plan: idsCrudasPlan.length,
    cambios,
    cambios_todos_sucursal,
    total_cambios_sucursal: cambios_todos_sucursal.length,
    total_cambios_auditoria: cambiosAud.length,
    total_elegibles_reimpresion: cambios.length,
    generado_en: generado,
  };
  cacheCambiosSucursalRevision.set(cacheKey, { ts: Date.now(), data: payload });
  return payload;
}

async function obtenerColumnaUsuarioPlanillaje() {
  if (columnaUsuarioPlanillaje !== undefined) return columnaUsuarioPlanillaje;
  try {
    const res = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'trazabilidad_proceso'
        AND table_name = 'parte_producto'
      `
    );
    const cols = new Set((res.rows || []).map((r) => String(r.column_name || '').toLowerCase()));
    const candidatos = [
      'username',
      'usuario',
      'usuario_registro',
      'usuario_registra',
      'usuario_creacion',
      'creado_por',
      'registrado_por',
      'user_name',
      'usr_registro',
    ];
    const hit = candidatos.find((c) => cols.has(c));
    columnaUsuarioPlanillaje = hit || null;
  } catch {
    columnaUsuarioPlanillaje = null;
  }
  return columnaUsuarioPlanillaje;
}

function snapshotPlanillajeDesdeRows(rows) {
  const m = new Map();
  (rows || []).forEach((r) => {
    const obsCompleta = String(r?.observaciones || r?.observacion || '').toUpperCase();
    const tieneRetiroLibrillos =
      /\bRETIRAR?\s+LIBRIL+OS?\b/.test(obsCompleta) ||
      /\bRETIRAR?\s+LIBRIL+O\b/.test(obsCompleta) ||
      /\bRETIRAR?\s+LIBRIL\b/.test(obsCompleta);
    const tienePlanFaena = String(r?.observacion_plan || '').trim().length > 0;
    const tieneObsActual = String(r?.observacion || '').trim().length > 0;
    const relevantePlanillaje = tieneRetiroLibrillos || tienePlanFaena || tieneObsActual;
    if (!relevantePlanillaje) return;

    const id = String(r?.id_producto || '').trim();
    if (!id) return;
    const identificacion = String(r?.identificacion || '').trim();
    const propietario = String(r?.propietario || '').trim();
    const clienteDestino = String(r?.cliente_destino || '').trim();
    const observacion = String(r?.observacion || r?.observaciones || '').trim();
    const empresaDestino = String(r?.empresa_destino || '').trim();
    const usernameBd = String(r?.usuario_planillaje || '').trim();
    const sucursal = String(r?.sucursal || '').trim() || null;
    const agrupacion = String(r?.agrupacion || '').trim() || null;
    const agrupacion_codigo = String(r?.agrupacion_codigo || '').trim() || null;
    m.set(id, {
      id_producto: id,
      id_animal: identificacion || null,
      propietario: propietario || null,
      cliente_destino: clienteDestino || null,
      observacion: observacion || null,
      empresa_destino: empresaDestino || null,
      sucursal,
      agrupacion,
      agrupacion_codigo,
      username_bd: usernameBd || null,
      fecha_turno: String(r?.fecha || '').trim() || null,
    });
  });
  return m;
}

async function registrarCambiosPlanillajeTurno(turnoFecha, prevMap, nextMap) {
  if (!(prevMap instanceof Map) || !(nextMap instanceof Map)) return;
  const ids = new Set([...prevMap.keys(), ...nextMap.keys()]);
  const tasks = [];
  ids.forEach((id) => {
    const prev = prevMap.get(id) || null;
    const next = nextMap.get(id) || null;
    if (!prev && next) {
      tasks.push(
        registrarCambioHistorico({
          modulo: 'planillaje',
          accion: 'crear_en_turno',
          entidad: 'librillos_turno',
          idEntidad: id,
          usuario: next?.username_bd || '(sin username_bd)',
          antes: null,
          despues: next,
          meta: { fecha_turno: turnoFecha, fuente: 'polling_db' },
        })
      );
      return;
    }
    if (prev && !next) {
      tasks.push(
        registrarCambioHistorico({
          modulo: 'planillaje',
          accion: 'remover_en_turno',
          entidad: 'librillos_turno',
          idEntidad: id,
          usuario: prev?.username_bd || '(sin username_bd)',
          antes: prev,
          despues: null,
          meta: { fecha_turno: turnoFecha, fuente: 'polling_db' },
        })
      );
      return;
    }
    if (!prev || !next) return;
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    tasks.push(
      registrarCambioHistorico({
        modulo: 'planillaje',
        accion: 'actualizar_en_turno',
        entidad: 'librillos_turno',
        idEntidad: id,
        usuario: next?.username_bd || prev?.username_bd || '(sin username_bd)',
        antes: prev,
        despues: next,
        meta: { fecha_turno: turnoFecha, fuente: 'polling_db' },
      })
    );
  });
  if (tasks.length) await Promise.all(tasks);
}

function leerSnapshotPlanFaena(fechaISO) {
  const key = String(fechaISO || '').trim();
  if (!key) return null;
  if (planSnapshotCache.has(key)) return planSnapshotCache.get(key);
  try {
    const file = path.join(PLAN_SNAPSHOT_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = raw?.items && typeof raw.items === 'object' ? raw.items : {};
    const map = new Map(
      Object.entries(items)
        .map(([id, txt]) => [String(id).trim(), String(txt || '').trim()])
        .filter(([id, txt]) => id && txt)
    );
    planSnapshotCache.set(key, map);
    return map;
  } catch {
    return null;
  }
}

function guardarSnapshotPlanFaenaSiNoExiste(fechaISO, map) {
  const key = String(fechaISO || '').trim();
  if (!key || !(map instanceof Map) || !map.size) return;
  try {
    fs.mkdirSync(PLAN_SNAPSHOT_DIR, { recursive: true });
    const file = path.join(PLAN_SNAPSHOT_DIR, `${key}.json`);
    if (fs.existsSync(file)) return;
    const items = {};
    map.forEach((v, k) => {
      const id = String(k || '').trim();
      const txt = String(v || '').trim();
      if (id && txt) items[id] = txt;
    });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          fecha: key,
          guardado_en: new Date().toISOString(),
          items,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    console.warn(`⚠️ No se pudo guardar snapshot plan faena ${key}: ${err.message}`);
  }
}

/**
 * Texto concatenado desde columnas configurables de a_plan_faena_producto
 * (misma semántica que «Visceras Blancas / Rojas» del Excel cuando existan en BD).
 */
async function mapaTextoPlanFaenaPorFecha(fechaISO) {
  const snapshot = leerSnapshotPlanFaena(fechaISO);
  if (snapshot && snapshot.size) return snapshot;
  const cols = columnasTextoPlanFaenaProducto();
  if (!cols.length) return new Map();

  const nullParts = cols
    .map((c) => `NULLIF(TRIM(COALESCE(pfp.${c}::text, '')), '')`)
    .join(',\n          ');
  const sql = `
    SELECT DISTINCT ON (pfp.id_producto)
      pfp.id_producto::text AS id_producto,
      TRIM(REGEXP_REPLACE(
        CONCAT_WS(' ',
          ${nullParts}
        ),
        '[ \\t\\r\\n]+', ' ', 'g'
      )) AS texto_plan
    FROM a_trazabilidad_proceso.a_plan_faena pf
    JOIN a_trazabilidad_proceso.a_plan_faena_producto pfp
      ON pfp.id_plan_faena = pf.id
    WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = $1::date
    ORDER BY pfp.id_producto ASC, pf.fecha_plan DESC NULLS LAST, pf.id DESC NULLS LAST
  `;

  try {
    const res = await pool.query(sql, [fechaISO]);
    const map = new Map();
    (res.rows || []).forEach((r) => {
      const id = String(r.id_producto);
      const t = String(r.texto_plan || '').trim();
      if (t) map.set(id, t);
    });
    guardarSnapshotPlanFaenaSiNoExiste(fechaISO, map);
    return map;
  } catch (err) {
    console.warn(
      `⚠️ mapaTextoPlanFaenaPorFecha (${fechaISO}): ${err.message} — sin texto de plan (revisar PLAN_FAENA_PFP_TEXT_COLUMNS).`
    );
    return new Map();
  }
}

function mapaTextoPlanFaenaLocalPorFecha(fechaISO) {
  const snapshot = leerSnapshotPlanFaena(fechaISO);
  if (snapshot && snapshot.size) return snapshot;
  if (!USE_LOCAL_PLAN_FILES) return new Map();
  const k = String(fechaISO || '');
  if (localPlanObsCache.has(k)) return localPlanObsCache.get(k);
  try {
    const py = spawnSync(
      'python',
      ['scripts/extract_planfaena_obs.py', k],
      { encoding: 'utf8', windowsHide: true }
    );
    if (py.status !== 0 || !py.stdout) {
      const vacio = new Map();
      localPlanObsCache.set(k, vacio);
      return vacio;
    }
    const parsed = JSON.parse(String(py.stdout || '{}'));
    const items = parsed?.items && typeof parsed.items === 'object' ? parsed.items : {};
    const m = new Map(
      Object.entries(items)
        .map(([id, txt]) => [String(id).trim(), String(txt || '').trim()])
        .filter(([id, txt]) => id && txt)
    );
    guardarSnapshotPlanFaenaSiNoExiste(fechaISO, m);
    localPlanObsCache.set(k, m);
    return m;
  } catch {
    const vacio = new Map();
    localPlanObsCache.set(k, vacio);
    return vacio;
  }
}

function mapaTextoRetiroLocalPorFecha(fechaISO) {
  if (!USE_LOCAL_RETIRO_FILES) return new Map();
  const k = String(fechaISO || '');
  if (localRetiroObsCache.has(k)) return localRetiroObsCache.get(k);
  try {
    const py = spawnSync(
      'python',
      ['scripts/extract_retiro_obs.py', k],
      { encoding: 'utf8', windowsHide: true }
    );
    if (py.status !== 0 || !py.stdout) {
      const vacio = new Map();
      localRetiroObsCache.set(k, vacio);
      return vacio;
    }
    const parsed = JSON.parse(String(py.stdout || '{}'));
    const items = parsed?.items && typeof parsed.items === 'object' ? parsed.items : {};
    const m = new Map(
      Object.entries(items)
        .map(([id, txt]) => [String(id).trim(), String(txt || '').trim()])
        .filter(([id, txt]) => id && txt)
    );
    localRetiroObsCache.set(k, m);
    return m;
  } catch {
    const vacio = new Map();
    localRetiroObsCache.set(k, vacio);
    return vacio;
  }
}

async function idsPlanFaenaPorFecha(fechaISO) {
  const res = await pool.query(
    `
    SELECT DISTINCT pfp.id_producto::text AS id_producto
    FROM a_trazabilidad_proceso.a_plan_faena pf
    JOIN a_trazabilidad_proceso.a_plan_faena_producto pfp
      ON pfp.id_plan_faena = pf.id
    WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = $1::date
    `,
    [fechaISO]
  );
  return new Set((res.rows || []).map((r) => String(r.id_producto).trim()).filter(Boolean));
}

/** Animales insensibilizados (sacrificados) según fecha calendario en trazabilidad_proceso.insensibilizacion. */
async function idsInsensibilizacionPorFecha(fechaISO) {
  try {
    const res = await pool.query(
      `
      SELECT DISTINCT id_producto::text AS id_producto
      FROM trazabilidad_proceso.insensibilizacion
      WHERE fecha_registro = $1::date
      `,
      [fechaISO]
    );
    return new Set((res.rows || []).map((r) => String(r.id_producto).trim()).filter(Boolean));
  } catch (err) {
    console.warn(`⚠️ insensibilizacion (${fechaISO}): ${err.message}`);
    return new Set();
  }
}

function interseccionIdsSets(plan, insens) {
  const out = [];
  for (const id of plan) {
    if (insens.has(id)) out.push(id);
  }
  return out.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

function unionPlanInsensMasEmergencia(plan, insens, emerg) {
  const merged = new Set(interseccionIdsSets(plan, insens));
  if (emerg && emerg.size) {
    for (const id of emerg) {
      if (insens.has(id)) merged.add(String(id).trim());
    }
  }
  return [...merged].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
}

let sqlSacrificioEmergenciaCache = null;
let sacrificioEmergenciaTablaOk = undefined;

function parseTablaPgCalificada(cualificada) {
  const s = String(cualificada || '').trim();
  const m = s.match(/^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/i);
  if (!m) return null;
  return { schema: m[1].toLowerCase(), table: m[2].toLowerCase() };
}

function buildSqlSacrificioEmergencia() {
  if (sqlSacrificioEmergenciaCache) return sqlSacrificioEmergenciaCache;
  const tbl = parseTablaPgCalificada(SACRIFICIO_EMERGENCIA_PUESTO_TABLA);
  if (!tbl) {
    sqlSacrificioEmergenciaCache = null;
    return null;
  }
  const cols = columnasNombrePuestoTrabajo();
  if (!cols.length) {
    sqlSacrificioEmergenciaCache = null;
    return null;
  }
  const condPuesto = cols
    .map((c) => `COALESCE(pt.${c}, '') ILIKE $2`)
    .join(' OR ');
  sqlSacrificioEmergenciaCache = `
    SELECT DISTINCT i.id_producto::text AS id_producto
    FROM trazabilidad_proceso.insensibilizacion i
    INNER JOIN ${tbl.schema}.${tbl.table} pt ON pt.id = i.id_puesto_trabajo
    WHERE i.fecha_registro = $1::date
      AND (${condPuesto})
  `;
  return sqlSacrificioEmergenciaCache;
}

/**
 * Insensibilizados ese día en puesto «sacrificio de emergencia» (plan puede ser otro día).
 * Usa trazabilidad_proceso.insensibilizacion.id_puesto_trabajo + catálogo de puestos.
 */
async function idsSacrificioEmergenciaPorFecha(fechaISO) {
  if (!INCLUIR_SACRIFICIO_EMERGENCIA) return new Set();
  const sql = buildSqlSacrificioEmergencia();
  if (!sql) {
    console.warn('⚠️ Sacrificio emergencia: tabla/columnas de puesto no configuradas.');
    return new Set();
  }
  try {
    const res = await pool.query(sql, [fechaISO, SACRIFICIO_EMERGENCIA_PUESTO_ILIKE]);
    return new Set((res.rows || []).map((r) => String(r.id_producto).trim()).filter(Boolean));
  } catch (err) {
    if (sacrificioEmergenciaTablaOk !== false) {
      sacrificioEmergenciaTablaOk = false;
      console.warn(
        `⚠️ Sacrificio emergencia (${fechaISO}): ${err.message} — revise SACRIFICIO_EMERGENCIA_PUESTO_TABLA en .env`
      );
    }
    return new Set();
  }
}

/** IDs con movimiento tipo Colbeef ese día (calendario fecha_registro). */
async function idsParteProductoColbeefDia(fechaISO) {
  const res = await pool.query(
    `
    SELECT DISTINCT id_producto::text AS id_producto
    FROM trazabilidad_proceso.parte_producto
    WHERE id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
      AND ${SQL_WHERE_PARTE_DIA_BOGOTA_P1}
    `,
    [fechaISO]
  );
  return new Set((res.rows || []).map((r) => String(r.id_producto)));
}

/**
 * Universo operativo del día: todo el plan de faena (+ parte del día opcional + emergencia fuera de plan).
 * No se limita a insensibilizados: el resumen por agrupación debe reflejar el plan planteado.
 */
async function idsUniversoReporteDia(fechaISO) {
  const merged = new Set();
  const plan = await idsPlanFaenaPorFecha(fechaISO);
  plan.forEach((id) => merged.add(id));
  if (USE_UNION_PARTE_PLAN_DIA) {
    const parte = await idsParteProductoColbeefDia(fechaISO);
    parte.forEach((id) => merged.add(id));
  }
  if (INCLUIR_SACRIFICIO_EMERGENCIA) {
    const emerg = await idsSacrificioEmergenciaPorFecha(fechaISO);
    for (const id of emerg) {
      if (!plan.has(id)) merged.add(String(id).trim());
    }
  }
  return [...merged].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
}

/** Subconjunto informativo plan ∩ insens (+ emergencia), solo para KPI / diagnóstico. */
async function idsUniversoPlanInsensListado(fechaISO) {
  const [plan, insens, emerg] = await Promise.all([
    idsPlanFaenaPorFecha(fechaISO),
    idsInsensibilizacionPorFecha(fechaISO),
    idsSacrificioEmergenciaPorFecha(fechaISO),
  ]);
  return unionPlanInsensMasEmergencia(plan, insens, emerg);
}

/** Metadatos plan vs insensibilización (KPI / diagnóstico). */
export async function obtenerMetaUniversoPorFecha(fechaISO) {
  const fecha = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('fecha debe ser YYYY-MM-DD');
  }
  const [plan, insens, emerg, idsListado, idsPlanInsens] = await Promise.all([
    idsPlanFaenaPorFecha(fecha),
    idsInsensibilizacionPorFecha(fecha),
    idsSacrificioEmergenciaPorFecha(fecha),
    idsUniversoReporteDia(fecha),
    idsUniversoPlanInsensListado(fecha),
  ]);
  let planSinInsens = 0;
  let planConInsens = 0;
  plan.forEach((id) => {
    if (insens.has(id)) planConInsens += 1;
    else planSinInsens += 1;
  });
  let insensSinPlan = 0;
  let emergenciaFueraPlan = 0;
  insens.forEach((id) => {
    if (!plan.has(id)) {
      insensSinPlan += 1;
      if (emerg.has(id)) emergenciaFueraPlan += 1;
    }
  });
  let insensSinPlanSinEmergencia = 0;
  insens.forEach((id) => {
    if (!plan.has(id) && !emerg.has(id)) insensSinPlanSinEmergencia += 1;
  });
  return {
    fecha,
    filtro_insensibilizacion_activo: false,
    universo_plan_completo: true,
    incluir_sacrificio_emergencia: INCLUIR_SACRIFICIO_EMERGENCIA,
    total_plan_faena: plan.size,
    total_insensibilizados: insens.size,
    total_sacrificio_emergencia: emerg.size,
    total_en_listado: idsListado.length,
    total_plan_interseccion_insens: idsPlanInsens.length,
    plan_con_insensibilizacion: planConInsens,
    plan_sin_insensibilizar: planSinInsens,
    insens_sin_plan: insensSinPlan,
    emergencia_fuera_plan: emergenciaFueraPlan,
    insens_sin_plan_sin_emergencia: insensSinPlanSinEmergencia,
  };
}

/** Última fila del día (tipo Colbeef) por id; solo esos IDs. */
async function filasParteProductoPorIdsYFecha(fechaISO, idsTexto) {
  if (!idsTexto.length) return { rows: [], map: new Map() };
  const colUsuario = await obtenerColumnaUsuarioPlanillaje();
  const exprUsuario =
    colUsuario && /^[a-z_][a-z0-9_]*$/i.test(colUsuario)
      ? `COALESCE(${colUsuario}::text, '') AS usuario_planillaje`
      : `NULL::text AS usuario_planillaje`;
  const res = await pool.query(
    `
    SELECT DISTINCT ON (id_producto)
      id_producto, identificacion, observaciones, NULL::text AS accion,
      id_tipo_parte_producto,
      ${SQL_EXPR_FECHA_PARTE_BOGOTA}::text AS fecha,
      ${exprUsuario}
    FROM trazabilidad_proceso.parte_producto
    WHERE id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
      AND ${SQL_WHERE_PARTE_DIA_BOGOTA_P1}
      AND id_producto::text = ANY($2::text[])
    ORDER BY id_producto ASC, fecha_registro DESC NULLS LAST
    `,
    [fechaISO, idsTexto]
  );
  const map = new Map();
  (res.rows || []).forEach((r) => map.set(String(r.id_producto), r));
  return { rows: res.rows || [], map };
}

/** Última observación disponible por ID (sin filtrar por día), usada como respaldo del plan. */
async function observacionesUltimasPorIds(idsTexto) {
  if (!idsTexto.length) return new Map();
  const colUsuario = await obtenerColumnaUsuarioPlanillaje();
  const exprUsuario =
    colUsuario && /^[a-z_][a-z0-9_]*$/i.test(colUsuario)
      ? `COALESCE(${colUsuario}::text, '') AS usuario_planillaje`
      : `NULL::text AS usuario_planillaje`;
  const res = await pool.query(
    `
    SELECT DISTINCT ON (id_producto)
      id_producto, identificacion, observaciones,
      ${SQL_EXPR_FECHA_PARTE_BOGOTA}::text AS fecha,
      ${exprUsuario}
    FROM trazabilidad_proceso.parte_producto
    WHERE id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
      AND id_producto::text = ANY($1::text[])
    ORDER BY id_producto ASC, fecha_registro DESC NULLS LAST
    `,
    [idsTexto]
  );
  const map = new Map();
  (res.rows || []).forEach((r) => map.set(String(r.id_producto), r));
  return map;
}

/** Todas las filas del día tipo Colbeef (sin filtro plan). */
async function filasParteProductoDia(fechaISO) {
  const colUsuario = await obtenerColumnaUsuarioPlanillaje();
  const exprUsuario =
    colUsuario && /^[a-z_][a-z0-9_]*$/i.test(colUsuario)
      ? `COALESCE(${colUsuario}::text, '') AS usuario_planillaje`
      : `NULL::text AS usuario_planillaje`;
  const res = await pool.query(
    `
    SELECT DISTINCT ON (id_producto)
      id_producto, identificacion, observaciones, NULL::text AS accion,
      id_tipo_parte_producto,
      ${SQL_EXPR_FECHA_PARTE_BOGOTA}::text AS fecha,
      ${exprUsuario}
    FROM trazabilidad_proceso.parte_producto
    WHERE id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
      AND ${SQL_WHERE_PARTE_DIA_BOGOTA_P1}
    ORDER BY id_producto ASC, fecha_registro DESC NULLS LAST
    `,
    [fechaISO]
  );
  return res.rows || [];
}

/**
 * Unifica datos descriptivos raíz con el último movimiento real de cava
 * de la parte tipo Colbeef (librillos), evitando mezclar fechas de otras partes.
 */
function mergeMetaRaizYCava(idProducto, metaRaizPorCodigo, cavaParte13Map) {
  const k = keyCodigo(idProducto);
  const ult = metaRaizPorCodigo[k];
  const u = ult || {};
  const c13 = cavaParte13Map[k] || {};
  const nombre = String(u.nombre_propietario || '').trim() || null;
  const propietario_origen = nombre ? 'raiz_ultimo' : null;

  return {
    nombre_propietario: nombre,
    destino: u.destino || null,
    sucursal: u.sucursal || null,
    empresa_destino: u.empresa_destino || null,
    fecha_ingreso_cava: c13.fecha_ingreso_cava || null,
    fecha_salida_cava: c13.fecha_salida_cava || null,
    propietario_origen,
    enriquecido: !!(nombre || u.destino || u.sucursal || u.empresa_destino),
  };
}

async function metaRaizPorIds(idsTexto) {
  const ids = [...new Set((idsTexto || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return {};
  const sql = `
    WITH ids AS (
      SELECT unnest($1::text[]) AS id_producto
    ),
    pp_vb_ult AS (
      SELECT DISTINCT ON (pp.id_producto::text)
        pp.id_producto::text AS id_producto,
        pp.id AS id_parte_producto
      FROM trazabilidad_proceso.parte_producto pp
      WHERE pp.id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
        AND pp.id_producto::text = ANY($1::text[])
      ORDER BY pp.id_producto::text, pp.fecha_registro DESC, pp.id DESC
    ),
    ppe_ult AS (
      SELECT DISTINCT ON (ppe.id_producto::text)
        ppe.id_producto::text AS id_producto,
        ppe.id AS id_parte_producto_empresa
      FROM trazabilidad_proceso.parte_producto_empresa ppe
      JOIN pp_vb_ult ppv
        ON ppv.id_producto = ppe.id_producto::text
       AND ppv.id_parte_producto = ppe.id_parte_producto
      ORDER BY ppe.id_producto::text, ppe.id DESC
    ),
    ppel_ult AS (
      SELECT DISTINCT ON (ppel.id_parte_producto_empresa)
        ppel.id_parte_producto_empresa,
        ppel.id_local
      FROM trazabilidad_proceso.parte_producto_empresa_local ppel
      ORDER BY ppel.id_parte_producto_empresa, ppel.id DESC
    ),
    prop_ult AS (
      SELECT DISTINCT ON (pe.id_producto::text)
        pe.id_producto::text AS id_producto,
        e.nombre AS nombre_propietario
      FROM trazabilidad_proceso.producto_empresa pe
      JOIN organizaciones.empresa e ON e.id = pe.id_empresa
      WHERE pe.id_producto::text = ANY($1::text[])
        AND pe.activo = true
      ORDER BY pe.id_producto::text, pe.id DESC
    )
    SELECT
      i.id_producto,
      p.nombre_propietario,
      s.nombre AS sucursal,
      de.nombre AS destino,
      e1.nombre AS empresa_destino
    FROM ids i
    LEFT JOIN prop_ult p
      ON p.id_producto = i.id_producto
    LEFT JOIN ppe_ult ppe
      ON ppe.id_producto = i.id_producto
    LEFT JOIN ppel_ult ppel
      ON ppel.id_parte_producto_empresa = ppe.id_parte_producto_empresa
    LEFT JOIN organizaciones.sucursal s
      ON s.id = ppel.id_local
    LEFT JOIN trazabilidad_proceso.destino de
      ON de.id = s.id_destino
    LEFT JOIN trazabilidad_proceso.parte_producto_empresa ppe_full
      ON ppe_full.id = ppe.id_parte_producto_empresa
    LEFT JOIN organizaciones.empresa e1
      ON e1.id = ppe_full.id_empresa
  `;
  const res = await pool.query(sql, [ids]);
  const out = {};
  (res.rows || []).forEach((r) => {
    out[keyCodigo(r.id_producto)] = {
      nombre_propietario: r.nombre_propietario || null,
      sucursal: r.sucursal || null,
      destino: r.destino || null,
      empresa_destino: r.empresa_destino || null,
    };
  });
  return out;
}

function textoNoVacio(...vals) {
  const esPlaceholderVacio = (txt) => {
    const t = String(txt || '').trim().toUpperCase();
    if (!t) return true;
    if (['-', '--', '—', 'N/A', 'NA', 'NULL', 'SIN DESTINO', 'SIN CLIENTE', 'SIN PLAZA'].includes(t)) return true;
    return false;
  };
  for (const v of vals) {
    const t = String(v || '').trim();
    if (!esPlaceholderVacio(t)) return t;
  }
  return null;
}

// ── CONSULTA PRINCIPAL ────────────────────────────────────────────────────────
const consultarLibrillos = async (fecha = null) => {
  try {
    // Día calendario completo (Bogotá).
    // Si no llega ?fecha, usamos la fecha actual de Bogotá (no la del servidor).
    const fechaISO = fecha || hoyBogotaISO();
    const emergIdsDia =
      USE_PLAN_FAENA_UNIVERSE && INCLUIR_SACRIFICIO_EMERGENCIA
        ? await idsSacrificioEmergenciaPorFecha(fechaISO)
        : new Set();

    // PASO 1: Universo de filas — con plan activo = ids del plan ∪ (opcional) parte Colbeef del día;
    //          se une la fila parte del mismo día cuando existe (si no, respaldo última obs. o pendiente).
    let librillos = [];
    /** Solo en modo plan+merge: ids que ya tienen registro en a_parte_producto ese día */
    let idsConParte = null;

    if (USE_PLAN_FAENA_UNIVERSE) {
      try {
        const idsOrdenados = await idsUniversoReporteDia(fechaISO);
        if (idsOrdenados.length > 0) {
          const { map: parteMap } = await filasParteProductoPorIdsYFecha(
            fechaISO,
            idsOrdenados
          );
          // Si falta observación del día para algún ID del plan, usar la última observación conocida.
          const idsFaltantes = idsOrdenados.filter((id) => !parteMap.has(String(id)));
          const ultObsMap = await observacionesUltimasPorIds(idsFaltantes);
          idsConParte = new Set(parteMap.keys());
          librillos = idsOrdenados.map((id) => {
            const row = parteMap.get(id);
            if (row) return row;
            const back = ultObsMap.get(String(id));
            if (back) {
              return {
                id_producto: id,
                identificacion: back.identificacion || null,
                observaciones: back.observaciones || null,
                usuario_planillaje: back.usuario_planillaje || null,
                accion: null,
                id_tipo_parte_producto: ID_TIPO_PARTE_COLBEEF,
                // Mantener fecha operativa solicitada, aunque la observación sea respaldo histórico.
                fecha: fechaISO,
                observacion_origen: 'respaldo_ultima_observacion',
              };
            }
            return {
              id_producto: id,
              identificacion: null,
              observaciones: null,
              accion: null,
              id_tipo_parte_producto: ID_TIPO_PARTE_COLBEEF,
              fecha: fechaISO,
              observacion_origen: 'sin_observacion',
            };
          });
          if (COLBEEF_DEBUG) {
            const modoUniverso = `plan completo${USE_UNION_PARTE_PLAN_DIA ? '+parte día' : ''}${INCLUIR_SACRIFICIO_EMERGENCIA ? '+emerg fuera plan' : ''}`;
            console.log(
              `🧭 Universo ${fechaISO}: ${idsOrdenados.length} IDs (${modoUniverso}) · con parte tipo ${ID_TIPO_PARTE_COLBEEF} mismo día: ${idsConParte.size}`
            );
          }
        } else if (!PLAN_FAENA_FALLBACK_ON_EMPTY) {
          librillos = [];
          console.warn(
            `⚠️ Sin IDs en universo (plan${USE_UNION_PARTE_PLAN_DIA ? '+parte día' : ''}) para ${fechaISO}; modo estricto (sin fallback).`
          );
        } else {
          console.warn(
            `⚠️ Sin IDs en universo (plan${USE_UNION_PARTE_PLAN_DIA ? '+parte día' : ''}) para ${fechaISO}; fallback a parte_producto del día.`
          );
          librillos = await filasParteProductoDia(fechaISO);
        }
      } catch (err) {
        if (!PLAN_FAENA_FALLBACK_ON_EMPTY) throw err;
        console.warn(`⚠️ Error consultando plan faena (${fechaISO}); fallback activo: ${err.message}`);
        librillos = await filasParteProductoDia(fechaISO);
      }
    } else {
      librillos = await filasParteProductoDia(fechaISO);
    }

    if (librillos.length === 0) {
      if (COLBEEF_DEBUG) console.log(`✅ Sin producción para ${fecha || 'hoy'}.`);
      return [];
    }

    // PASO 2: Metadatos raíz, cava y texto de plan faena (independientes entre sí → en paralelo).
    const idProductos = [...new Set(librillos.map(l => l.id_producto))];
    if (COLBEEF_DEBUG) {
      console.log(`📦 ${idProductos.length} IDs únicos — metadatos raíz + cava + plan (paralelo, lotes ${META_RAIZ_BATCH})…`);
    }

    const grupos = chunks(idProductos, META_RAIZ_BATCH);
    const metaRaizPorCodigo = {};
    const cavaParte13Map = {};

    const cargarMetaRaiz = procesarGruposConLimite(
      grupos,
      async (grupo) => {
        try {
          const m = await metaRaizPorIds(grupo.map(String));
          Object.assign(metaRaizPorCodigo, m);
        } catch (err) {
          console.warn(`⚠️ Error en metadatos raíz por IDs: ${err.message}`);
        }
      },
      META_RAIZ_CONCURRENCY
    );

    const cargarCava = procesarGruposConLimite(
      grupos,
      async (grupo) => {
        try {
          const resCava13 = await pool.query(`
          SELECT DISTINCT ON (pp.id_producto)
            pp.id_producto::text AS codigo,
            pcr.fecha_ingreso AS fecha_ingreso_cava,
            pcr.fecha_salida AS fecha_salida_cava
          FROM trazabilidad_proceso.parte_producto pp
          LEFT JOIN LATERAL (
            SELECT x.fecha_ingreso, x.fecha_salida
            FROM trazabilidad_proceso.parte_producto_cava_riel x
            WHERE x.id_producto::text = pp.id_producto::text
              AND x.id_parte_producto = pp.id
            ORDER BY x.id DESC
            LIMIT 1
          ) pcr ON TRUE
          WHERE pp.id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
            AND pp.id_producto::text = ANY($1)
          ORDER BY pp.id_producto
          `, [grupo.map(String)]);
          resCava13.rows.forEach((r) => {
            cavaParte13Map[keyCodigo(r.codigo)] = {
              fecha_ingreso_cava: r.fecha_ingreso_cava || null,
              fecha_salida_cava: r.fecha_salida_cava || null,
            };
          });
        } catch (err) {
          console.warn(`⚠️ Error en chunk cava parte 13: ${err.message}`);
        }
      },
      META_RAIZ_CONCURRENCY
    );

    const [, , planObsMapRaw] = await Promise.all([
      cargarMetaRaiz,
      cargarCava,
      mapaTextoPlanFaenaPorFecha(fechaISO),
    ]);
    let planObsMap = planObsMapRaw instanceof Map ? planObsMapRaw : new Map();

    if (COLBEEF_DEBUG) {
      console.log(`✅ Metadatos raíz: ${Object.keys(metaRaizPorCodigo).length} · cava parte 13: ${Object.keys(cavaParte13Map).length}`);
    }

    const retiroObsMap = mapaTextoRetiroLocalPorFecha(fechaISO);
    if (!planObsMap.size) {
      // Fallback local: usa archivos PlanFaena*.xls en data/ para replicar macro.
      planObsMap = mapaTextoPlanFaenaLocalPorFecha(fechaISO);
    }

    // PASO 3: Unir (metadatos desde tablas + movimiento real de parte 13)
    const resultado = librillos
      .map((l) => {
        const v = mergeMetaRaizYCava(l.id_producto, metaRaizPorCodigo, cavaParte13Map);
        const obsParte = String(l.observaciones || '');
        const textoRetiro = retiroObsMap.get(String(l.id_producto)) || '';
        const textoPlan = planObsMap.get(String(l.id_producto)) || '';
        const { obsFuente, observacion_fuente } = fusionarObservacionClasificacion(
          textoPlan,
          obsParte,
          textoRetiro
        );
        const { observacion, cliente_destino, plaza } = parsearObservacion(obsFuente);
        const ovGutCarv = reglaOverrideGutierrezCarviscol(v.nombre_propietario, obsFuente);
        let clienteClasificacion;
        let ag;
        if (ovGutCarv) {
          clienteClasificacion = ovGutCarv.cliente_destino;
          ag = { codigo: ovGutCarv.codigo, etiqueta: ovGutCarv.etiqueta };
        } else {
          clienteClasificacion = textoNoVacio(cliente_destino, v.nombre_propietario);
          const planTxt = textoPlan.trim();
          const parteConRetiro = textoIndicaRetiroLibrillos(obsFuente);
          if (planTxt && !parteConRetiro) {
            ag = agrupacionDesdeTextoPlanFaena(planTxt, clienteClasificacion);
          } else {
            ag = agrupacionDesdeObservacionCompleta(
              obsFuente || planTxt,
              clienteClasificacion
            );
          }
        }
        const destinoFinal = textoNoVacio(v.destino, v.empresa_destino, clienteClasificacion);
        /** Plaza operativa: primero la plaza parseada desde observación (p.ej. "01014 CAVA"), luego sucursal BD. */
        const plazaFinal = textoNoVacio(plaza, v.sucursal);
        const clienteDestinoFinal = textoNoVacio(clienteClasificacion, v.empresa_destino);
        const obsParteTrim = obsParte.replace(/\s+/g, ' ').trim();
        const textoRetiroTrim = String(textoRetiro || '').replace(/\s+/g, ' ').trim();
        return {
          id_producto: l.id_producto,
          identificacion: l.identificacion,
          usuario_planillaje: l.usuario_planillaje || null,
          fecha: l.fecha,
          observaciones: obsFuente,
          observaciones_parte: obsParteTrim || null,
          texto_retiro_obs: textoRetiroTrim || null,
          observacion_origen: l.observacion_origen || null,
          observacion_plan: textoPlan.trim() ? textoPlan : null,
          observacion,
          observacion_fuente,
          plaza: plazaFinal,
          pendiente_registro_parte:
            idsConParte != null && !idsConParte.has(String(l.id_producto)),
          cliente_destino: clienteDestinoFinal,
          agrupacion_codigo: ag.codigo,
          agrupacion: ag.etiqueta,
          propietario: v.nombre_propietario || 'Sin asignar',
          propietario_origen: v.propietario_origen,
          destino: destinoFinal,
          sucursal: v.sucursal || null,
          empresa_destino: v.empresa_destino || null,
          fecha_ingreso_cava: v.fecha_ingreso_cava || null,
          fecha_salida_cava: v.fecha_salida_cava || null,
          enriquecido: v.enriquecido,
          sacrificio_emergencia: emergIdsDia.has(String(l.id_producto).trim()),
        };
      })
      .map((row) => ({
        ...row,
        clasificacion_movimiento: clasificarMovimiento(row),
      }))
      .filter((row) =>
        rowIncluidoColbeef(row.observaciones, row.observacion, row.cliente_destino)
      );

    if (COLBEEF_DEBUG) {
      console.log(`✅ [${fecha || 'hoy'}] ${resultado.length} registros (día completo)`);
    }
    return resultado;

  } catch (error) {
    console.error('❌ Error:', error.message);
    return [];
  }
};

async function consultarLibrillosConCache(fechaISO) {
  const f = String(fechaISO || '').trim() || hoyBogotaISO();
  const hit = leerCacheFecha(f);
  if (hit) return hit;
  const data = await consultarLibrillos(f);
  guardarCacheFecha(f, data);
  return data;
}

/** Lectura BD sin caché por fecha (conciliaciones, consultas puntuales). */
export async function obtenerLibrillosConsultaBdDirecta(fechaISO) {
  return consultarLibrillos(String(fechaISO || '').trim());
}

export function invalidarCacheLibrillosFecha(fechaISO) {
  const f = String(fechaISO || '').trim();
  invalidarCacheFecha(f);
  invalidarCacheCruceSucursalPorFecha(f);
  const turno = getCacheTurno();
  if (f && turno.fecha === f) {
    setCacheTurno({
      datos: [],
      ultimaActualizacion: null,
      fecha: f,
      snapshot: new Map(),
    });
  }
}

/** Tras escrituras (salidas, etc.): vacía caché del turno operativo actual. */
export function invalidarCacheTurnoActual() {
  invalidarCacheLibrillosFecha(fechaTurnoOperativoBogotaISO());
}

// ── CACHE ─────────────────────────────────────────────────────────────────────
const actualizarCache = async () => {
  const t0 = Date.now();
  try {
    if (COLBEEF_DEBUG) log.debug('Consultando base de datos (cache servidor)');
    const turnoFecha = fechaTurnoOperativoBogotaISO();
    const datos = await consultarLibrillos(turnoFecha);
    const nextSnap = snapshotPlanillajeDesdeRows(datos);
    if (cacheTurnoFecha === turnoFecha) {
      await registrarCambiosPlanillajeTurno(turnoFecha, cacheTurnoSnapshot, nextSnap);
    } else {
      cacheTurnoFecha = turnoFecha;
    }
    cacheTurnoSnapshot = nextSnap;
    const ahora = new Date();
    setCacheTurno({
      datos,
      ultimaActualizacion: ahora,
      fecha: turnoFecha,
      snapshot: nextSnap,
    });
    guardarCacheFecha(turnoFecha, datos);
    try {
      await persistirSucursalesCrudasDesdeSnapshot(turnoFecha, nextSnap);
    } catch (e) {
      log.warn('No se pudo guardar crudas-sucursal.json', { error: e.message });
    }
    markPollSuccess({
      fecha: turnoFecha,
      rows: datos.length,
      ms: Date.now() - t0,
      intervalMs: CACHE_POLL_MS,
    });
    if (COLBEEF_DEBUG) log.debug('Cache actualizado', { rows: datos.length, fecha: turnoFecha });
  } catch (error) {
    markPollError(error);
    log.error('Error cache polling', { error: error.message });
  }
};

const CACHE_POLL_MS = (() => {
  const n = parseInt(String(process.env.CACHE_POLL_INTERVAL_MS || ''), 10);
  if (Number.isFinite(n) && n >= 30000 && n <= 600000) return n;
  return 60000;
})();

export const iniciarPolling = async () => {
  console.log(`Iniciando polling cache (cada ${CACHE_POLL_MS / 1000}s)…`);
  await actualizarCache();
  setInterval(actualizarCache, CACHE_POLL_MS);
};

export const obtenerLibrillos = () => {
  const c = getCacheTurno();
  return {
    datos: c.datos,
    ultimaActualizacion: c.ultimaActualizacion,
    total: c.datos.length,
  };
};

export { statsCache };

export const obtenerLibrillosPorFecha = async (fecha) => await consultarLibrillosConCache(fecha);

export async function obtenerResumenMacroPorFecha(fecha) {
  let meta_universo = null;
  try {
    meta_universo = await obtenerMetaUniversoPorFecha(fecha);
  } catch {
    meta_universo = null;
  }
  const datos = await consultarLibrillosConCache(fecha);
  const rowsAll = Array.isArray(datos) ? datos : [];
  // Resumen / categorías solo cuentan lo que sigue vigente en plan de faena
  // y fue insensibilizado (estrictamente plan ∩ insens, sin sumar emergencia
  // fuera de plan). Si retiran un ID del plan, deja de contar; mientras avanza
  // el plan/insens del día el conteo crece en tiempo real.
  let rowsResumen = rowsAll;
  try {
    const [planSet, insensSet] = await Promise.all([
      idsPlanFaenaPorFecha(fecha),
      idsInsensibilizacionPorFecha(fecha),
    ]);
    const setFiltro = new Set();
    for (const id of planSet) {
      if (insensSet.has(id)) setFiltro.add(String(id).trim());
    }
    rowsResumen = setFiltro.size
      ? rowsAll.filter((d) => setFiltro.has(String(d?.id_producto ?? '').trim()))
      : [];
  } catch (err) {
    console.warn(
      `⚠️ obtenerResumenMacroPorFecha(${fecha}): no se pudo filtrar a plan∩insens, uso universo completo: ${err.message}`
    );
  }
  return calcularResumenMacro(fecha, rowsResumen, meta_universo, {
    requiere_insensibilizacion_plan_faena: REQUIERE_INSENSIBILIZACION_PLAN_FAENA,
    incluir_sacrificio_emergencia: INCLUIR_SACRIFICIO_EMERGENCIA,
  });
}

/** Días calendario Bogotá entre dos fechas ISO (inclusive). */
function listaFechasDesdeHasta(desde, hasta) {
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
 * Un solo resultado para un rango: evita N peticiones HTTP desde el cliente.
 * Días en serie (sin Promise.all) para no disparar muchas consultas pesadas a la vez en la réplica.
 */
export async function obtenerLibrillosPorRangoFechas(desde, hasta) {
  const hit = leerCacheRango(desde, hasta);
  if (hit) return hit;
  const fechas = listaFechasDesdeHasta(desde, hasta);
  /** Reporte de librillos y cierres anuales requieren hasta ~366 días. */
  const MAX_DIAS = 400;
  if (fechas.length > MAX_DIAS) {
    throw new Error(`Rango máximo ${MAX_DIAS} días`);
  }
  if (!fechas.length) return [];

  const merged = [];
  for (let i = 0; i < fechas.length; i += RANGE_CONCURRENCY) {
    const tramo = fechas.slice(i, i + RANGE_CONCURRENCY);
    const partes = await Promise.all(tramo.map((f) => consultarLibrillosConCache(f)));
    partes.forEach((p) => merged.push(...p));
  }
  const m = new Map();
  merged.forEach((row) => {
    const k = `${String(row.id_producto)}|${String(row.fecha || '')}`;
    if (!m.has(k)) m.set(k, row);
  });
  const out = [...m.values()];
  guardarCacheRango(desde, hasta, out);
  return out;
}

export const obtenerObservacionesPorFecha = async (fecha) => {
  const planObsMap = await mapaTextoPlanFaenaPorFecha(fecha);

  const mapFilaObs = (r) => {
    const ts = r.momento_registro_bd;
    const momento_registro_bd =
      ts instanceof Date && !Number.isNaN(ts.getTime()) ? ts.toISOString() : null;
    const obsParte = String(r.observacion_actual || '');
    const textoPlan = planObsMap.get(String(r.id_producto)) || '';
    const { obsFuente } = fusionarObservacionClasificacion(textoPlan, obsParte);
    return {
      id_producto: r.id_producto,
      observacion_actual: obsFuente,
      momento_registro_bd,
    };
  };

  if (USE_PLAN_FAENA_UNIVERSE) {
    try {
      const idsOrdenados = await idsUniversoReporteDia(fecha);
      if (idsOrdenados.length > 0) {
        const res = await pool.query(
          `
          SELECT DISTINCT ON (id_producto)
            id_producto,
            COALESCE(NULLIF(TRIM(REGEXP_REPLACE(observaciones, '\\s+', ' ', 'g')), ''), '') AS observacion_actual,
            fecha_registro AS momento_registro_bd
          FROM trazabilidad_proceso.parte_producto
          WHERE id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
            AND ${SQL_WHERE_PARTE_DIA_BOGOTA_P1}
            AND id_producto::text = ANY($2::text[])
          ORDER BY id_producto ASC, fecha_registro DESC NULLS LAST
          `,
          [fecha, idsOrdenados]
        );
        const porId = new Map(
          (res.rows || []).map((row) => [String(row.id_producto), row])
        );
        return idsOrdenados.map((id) => {
          const r = porId.get(id);
          if (r) return mapFilaObs(r);
          const textoPlan = planObsMap.get(String(id)) || '';
          const { obsFuente } = fusionarObservacionClasificacion(textoPlan, '');
          return {
            id_producto: id,
            observacion_actual: obsFuente,
            momento_registro_bd: null,
          };
        });
      }
    } catch (err) {
      if (!PLAN_FAENA_FALLBACK_ON_EMPTY) throw err;
      console.warn(`⚠️ observaciones+plan (${fecha}): ${err.message}`);
    }
  }

  const res = await pool.query(`
    SELECT DISTINCT ON (id_producto)
      id_producto,
      COALESCE(NULLIF(TRIM(REGEXP_REPLACE(observaciones, '\\s+', ' ', 'g')), ''), '') AS observacion_actual,
      fecha_registro AS momento_registro_bd
    FROM trazabilidad_proceso.parte_producto
    WHERE id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
      AND ${SQL_WHERE_PARTE_DIA_BOGOTA_P1}
    ORDER BY id_producto ASC, fecha_registro DESC NULLS LAST
  `, [fecha]);
  return res.rows.map(mapFilaObs);
};

export const obtenerStatsUltimos7Dias = async () => {
  try {
    const res = await pool.query(`
      SELECT ${SQL_EXPR_FECHA_PARTE_BOGOTA}::text AS dia,
             COUNT(DISTINCT id_producto) AS total
      FROM trazabilidad_proceso.parte_producto
      WHERE id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
        AND fecha_registro >= ((now() AT TIME ZONE 'America/Bogota')::date - INTERVAL '6 days') AT TIME ZONE 'America/Bogota'
        AND fecha_registro < ((now() AT TIME ZONE 'America/Bogota')::date + INTERVAL '1 day') AT TIME ZONE 'America/Bogota'
      GROUP BY ${SQL_EXPR_FECHA_PARTE_BOGOTA}
      ORDER BY dia ASC
    `);
    const resultado = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const found = res.rows.find(r => r.dia === iso);
      resultado.push({ fecha: iso, total: found ? parseInt(found.total) : 0 });
    }
    return resultado;
  } catch (error) {
    console.error('❌ Error stats:', error.message);
    return [];
  }
};