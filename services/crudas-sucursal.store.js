/**
 * Persiste la sucursal original de crudas por fecha/ID y mantiene la sucursal actual.
 * La original no se sobreescribe: sirve para comparar el día de despacho/revisión
 * y detectar si hay que reimprimir etiqueta por cambio de sucursal.
 *
 * Almacenamiento primario: MySQL local (colbeef_librillos.crudas_sucursal_snapshot)
 * Fallback: data/crudas-sucursal.json
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMySQLPool, isMySQLReady } from '../config/mysql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(__dirname, '..', 'data', 'crudas-sucursal.json');
const tmpPath = `${storePath}.tmp`;

let writeQueue = Promise.resolve();
let ultimoJson = null;

function usarMySQL() { return isMySQLReady(); }

function esObservacionCruda(obs) {
  return /\bCRUDAS?\b/i.test(String(obs || ''));
}

function limpiarSucursal(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

// ── Helpers JSON (fallback) ──────────────────────────────────────────────────
async function ensureDir() {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
}

function normalizarStore(data) {
  const fechas = {};
  const idsCompat = {};
  const addRow = (fechaRaw, idRaw, row = {}) => {
    const fecha = String(fechaRaw || row.fecha_turno || '').trim();
    const id = String(idRaw || row.id_producto || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !id) return;
    const sucOriginal = limpiarSucursal(row?.original?.sucursal ?? row.sucursal_original ?? row.sucursal);
    const sucActual = limpiarSucursal(row?.actual?.sucursal ?? row.sucursal_actual ?? row.sucursal);
    if (!sucOriginal && !sucActual) return;
    if (!fechas[fecha]) fechas[fecha] = { ids: {} };
    fechas[fecha].ids[id] = {
      id_producto: id,
      fecha_turno: fecha,
      original: {
        sucursal: sucOriginal || sucActual,
        usuario_planillaje: row?.original?.usuario_planillaje ?? row.usuario_planillaje ?? null,
        guardado_en: row?.original?.guardado_en ?? row.guardado_en ?? row.actualizado_en ?? null,
      },
      actual: {
        sucursal: sucActual || sucOriginal,
        usuario_planillaje: row?.actual?.usuario_planillaje ?? row.usuario_planillaje ?? null,
        actualizado_en: row?.actual?.actualizado_en ?? row.actualizado_en ?? row.guardado_en ?? null,
      },
    };
  };
  const porFecha = data?.fechas && typeof data.fechas === 'object' ? data.fechas : {};
  for (const [fecha, bloque] of Object.entries(porFecha)) {
    const ids = bloque?.ids && typeof bloque.ids === 'object' ? bloque.ids : {};
    for (const [id, row] of Object.entries(ids)) addRow(fecha, id, row);
  }
  const idsPlanos = data?.ids && typeof data.ids === 'object' ? data.ids : {};
  for (const [id, row] of Object.entries(idsPlanos)) addRow(row?.fecha_turno, id, row);
  for (const [, bloque] of Object.entries(fechas)) {
    for (const [id, row] of Object.entries(bloque.ids || {})) {
      idsCompat[id] = {
        id_producto: id,
        sucursal: row.actual.sucursal,
        sucursal_original: row.original.sucursal,
        fecha_turno: String(bloque.fecha_turno || row.fecha_turno || ''),
        usuario_planillaje: row.actual.usuario_planillaje,
        actualizado_en: row.actual.actualizado_en,
      };
    }
  }
  return {
    meta: {
      ...(data?.meta && typeof data.meta === 'object' ? data.meta : {}),
      version: 2,
      total_fechas: Object.keys(fechas).length,
      total: Object.values(fechas).reduce((acc, b) => acc + Object.keys(b?.ids || {}).length, 0),
    },
    fechas,
    ids: idsCompat,
  };
}

async function leerStoreNormalizadoFile() {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    return normalizarStore(JSON.parse(raw || '{}'));
  } catch {
    return normalizarStore({});
  }
}

// ── MySQL helpers ────────────────────────────────────────────────────────────
function rowsToStore(rows) {
  const fechas = {};
  const ids = {};
  for (const r of rows) {
    const fecha = r.fecha_turno instanceof Date
      ? r.fecha_turno.toISOString().slice(0, 10)
      : String(r.fecha_turno || '').slice(0, 10);
    const id = String(r.id_producto || '').trim();
    if (!fecha || !id) continue;
    if (!fechas[fecha]) fechas[fecha] = { ids: {} };
    fechas[fecha].ids[id] = {
      id_producto: id,
      fecha_turno: fecha,
      original: {
        sucursal: String(r.sucursal_original || ''),
        usuario_planillaje: r.usuario_planillaje || null,
        guardado_en: r.guardado_en instanceof Date ? r.guardado_en.toISOString() : (r.guardado_en || null),
      },
      actual: {
        sucursal: String(r.sucursal_actual || ''),
        usuario_planillaje: r.usuario_planillaje || null,
        actualizado_en: r.actualizado_en instanceof Date ? r.actualizado_en.toISOString() : (r.actualizado_en || null),
      },
    };
    ids[id] = {
      id_producto: id,
      sucursal: String(r.sucursal_actual || ''),
      sucursal_original: String(r.sucursal_original || ''),
      fecha_turno: fecha,
      usuario_planillaje: r.usuario_planillaje || null,
      actualizado_en: r.actualizado_en instanceof Date ? r.actualizado_en.toISOString() : (r.actualizado_en || null),
    };
  }
  const total_fechas = Object.keys(fechas).length;
  const total = Object.values(fechas).reduce((acc, b) => acc + Object.keys(b.ids).length, 0);
  return { meta: { version: 2, total_fechas, total }, fechas, ids };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Devuelve el store completo (todas las fechas).
 * En MySQL carga solo las últimas 60 días para no traer todo.
 */
export async function leerSucursalesCrudas() {
  if (usarMySQL()) {
    try {
      const db = getMySQLPool();
      const [rows] = await db.query(
        `SELECT id_producto, fecha_turno, sucursal_original, sucursal_actual,
                usuario_planillaje, guardado_en, actualizado_en
         FROM crudas_sucursal_snapshot
         WHERE fecha_turno >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
         ORDER BY fecha_turno DESC`
      );
      return rowsToStore(rows || []);
    } catch (e) {
      console.warn('⚠️ crudas-sucursal MySQL read:', e.message, '→ archivo');
    }
  }
  return leerStoreNormalizadoFile();
}

/**
 * Persiste snapshot de sucursales de crudas desde el polling del turno.
 * @param {string} turnoFecha YYYY-MM-DD
 * @param {Map<string, object>} snapshotMap salida de snapshotPlanillajeDesdeRows
 */
export async function persistirSucursalesCrudasDesdeSnapshot(turnoFecha, snapshotMap) {
  if (!(snapshotMap instanceof Map)) return;
  const tf = String(turnoFecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tf)) return;

  const ahora = new Date();

  if (usarMySQL()) {
    try {
      const db = getMySQLPool();
      // Leer las originales ya guardadas para no sobreescribirlas
      const [existing] = await db.query(
        'SELECT id_producto, sucursal_original, guardado_en FROM crudas_sucursal_snapshot WHERE fecha_turno = ?',
        [tf]
      );
      const origMap = new Map(existing.map((r) => [String(r.id_producto), r]));

      const vals = [];
      for (const [id, row] of snapshotMap) {
        const idKey = String(id || '').trim();
        if (!idKey || !esObservacionCruda(row?.observacion)) continue;
        const sucursal = limpiarSucursal(row?.sucursal);
        if (!sucursal) continue;
        const usuario = row?.username_bd ? String(row.username_bd).trim() : null;
        const prev = origMap.get(idKey);
        const sucOrig = prev?.sucursal_original ? String(prev.sucursal_original) : sucursal;
        const guard = prev?.guardado_en ? new Date(prev.guardado_en) : ahora;
        vals.push([idKey, tf, sucOrig, sucursal, usuario, guard, ahora]);
      }
      if (vals.length) {
        await db.query(
          `INSERT INTO crudas_sucursal_snapshot
             (id_producto, fecha_turno, sucursal_original, sucursal_actual, usuario_planillaje, guardado_en, actualizado_en)
           VALUES ?
           ON DUPLICATE KEY UPDATE
             sucursal_actual    = VALUES(sucursal_actual),
             usuario_planillaje = VALUES(usuario_planillaje),
             actualizado_en     = VALUES(actualizado_en)`,
          [vals]
        );
      }
      return;
    } catch (e) {
      console.warn('⚠️ crudas-sucursal MySQL write:', e.message, '→ archivo');
    }
  }

  // Fallback: archivo JSON
  const store = await leerStoreNormalizadoFile();
  if (!store.fechas[tf]) store.fechas[tf] = { ids: {} };
  const bloque = store.fechas[tf].ids;

  for (const [id, row] of snapshotMap) {
    const idKey = String(id || '').trim();
    if (!idKey || !esObservacionCruda(row?.observacion)) continue;
    const sucursal = limpiarSucursal(row?.sucursal);
    if (!sucursal) continue;
    const usuario = row?.username_bd ? String(row.username_bd).trim() : null;
    const prev = bloque[idKey];
    bloque[idKey] = {
      id_producto: idKey,
      fecha_turno: tf,
      original: prev?.original?.sucursal
        ? prev.original
        : { sucursal, usuario_planillaje: usuario, guardado_en: ahora.toISOString() },
      actual: { sucursal, usuario_planillaje: usuario, actualizado_en: ahora.toISOString() },
    };
  }
  const normalizado = normalizarStore(store);
  const payload = {
    meta: { ...normalizado.meta, version: 2, ultimo_turno: tf, actualizado_en: ahora.toISOString() },
    fechas: normalizado.fechas,
    ids: normalizado.ids,
  };
  const json = JSON.stringify(payload);
  if (json === ultimoJson) return;
  writeQueue = writeQueue.then(async () => {
    if (json === ultimoJson) return;
    await ensureDir();
    await fs.writeFile(tmpPath, json, 'utf8');
    await fs.rename(tmpPath, storePath);
    ultimoJson = json;
  });
  await writeQueue;
}

/**
 * Compara sucursal original (fechaPlan) contra la actual en fechaRevision.
 * @param {string} fechaPlan YYYY-MM-DD
 * @param {string} fechaRevision YYYY-MM-DD
 * @param {Map<string, string>} sucursalActualPorId
 * @param {Set<string>} idsPermitidos
 */
export async function obtenerCambiosSucursalCrudasGuardadas(
  fechaPlan,
  fechaRevision,
  sucursalActualPorId,
  idsPermitidos = null
) {
  const fp = String(fechaPlan || '').trim();
  const fr = String(fechaRevision || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fp) || !/^\d{4}-\d{2}-\d{2}$/.test(fr)) return [];

  let rows = [];

  if (usarMySQL()) {
    try {
      const db = getMySQLPool();
      const [dbRows] = await db.query(
        `SELECT id_producto, sucursal_original, sucursal_actual, usuario_planillaje, guardado_en, actualizado_en
         FROM crudas_sucursal_snapshot WHERE fecha_turno = ?`,
        [fp]
      );
      rows = (dbRows || []).map((r) => ({
        id: String(r.id_producto || '').trim(),
        sucursal_original: limpiarSucursal(r.sucursal_original),
        sucursal_actual:   limpiarSucursal(r.sucursal_actual),
        guardado_en:    r.guardado_en    instanceof Date ? r.guardado_en.toISOString()    : (r.guardado_en    || null),
        actualizado_en: r.actualizado_en instanceof Date ? r.actualizado_en.toISOString() : (r.actualizado_en || null),
        usuario:        r.usuario_planillaje || null,
      }));
    } catch (e) {
      console.warn('⚠️ crudas-sucursal MySQL cambios:', e.message, '→ archivo');
      rows = [];
    }
  }

  if (!rows.length) {
    // Fallback archivo
    const store = await leerStoreNormalizadoFile();
    const bloque = store.fechas?.[fp]?.ids || {};
    rows = Object.entries(bloque).map(([id, row]) => ({
      id, sucursal_original: limpiarSucursal(row?.original?.sucursal),
      sucursal_actual: limpiarSucursal(sucursalActualPorId?.get(id) ?? row?.actual?.sucursal),
      guardado_en: row?.original?.guardado_en || null,
      actualizado_en: row?.actual?.actualizado_en || null,
      usuario: row?.actual?.usuario_planillaje || row?.original?.usuario_planillaje || null,
    }));
  }

  const out = [];
  for (const row of rows) {
    const idKey = String(row.id || '').trim();
    if (!idKey) continue;
    if (idsPermitidos && !idsPermitidos.has(idKey)) continue;
    const antes  = limpiarSucursal(row.sucursal_original);
    const despues = limpiarSucursal(sucursalActualPorId?.get(idKey) ?? row.sucursal_actual);
    if (!antes || !despues || antes === despues) continue;
    out.push({
      id: idKey, sucursal_antes: antes, sucursal_despues: despues,
      fecha_plan: fp, fecha_revision: fr,
      guardado_en: row.guardado_en || null, actualizado_en: row.actualizado_en || null,
      usuario: row.usuario || null,
    });
  }
  return out;
}
