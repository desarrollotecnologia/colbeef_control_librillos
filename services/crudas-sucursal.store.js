/**
 * Persiste la sucursal original de crudas por fecha/ID y mantiene la sucursal actual.
 * La original no se sobreescribe: sirve para comparar el día de despacho/revisión
 * y detectar si hay que reimprimir etiqueta por cambio de sucursal.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(__dirname, '..', 'data', 'crudas-sucursal.json');
const tmpPath = `${storePath}.tmp`;

let writeQueue = Promise.resolve();
let ultimoJson = null;

function esObservacionCruda(obs) {
  return /\bCRUDAS?\b/i.test(String(obs || ''));
}

function limpiarSucursal(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

async function ensureDir() {
  const dir = path.dirname(storePath);
  await fs.mkdir(dir, { recursive: true });
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
        usuario_planillaje:
          row?.original?.usuario_planillaje ?? row.usuario_planillaje ?? null,
        guardado_en:
          row?.original?.guardado_en ?? row.guardado_en ?? row.actualizado_en ?? null,
      },
      actual: {
        sucursal: sucActual || sucOriginal,
        usuario_planillaje:
          row?.actual?.usuario_planillaje ?? row.usuario_planillaje ?? null,
        actualizado_en:
          row?.actual?.actualizado_en ?? row.actualizado_en ?? row.guardado_en ?? null,
      },
    };
  };

  const porFecha = data?.fechas && typeof data.fechas === 'object' ? data.fechas : {};
  for (const [fecha, bloque] of Object.entries(porFecha)) {
    const ids = bloque?.ids && typeof bloque.ids === 'object' ? bloque.ids : {};
    for (const [id, row] of Object.entries(ids)) addRow(fecha, id, row);
  }

  // Compatibilidad con el formato anterior: { ids: { id: { fecha_turno, sucursal } } }
  const idsPlanos = data?.ids && typeof data.ids === 'object' ? data.ids : {};
  for (const [id, row] of Object.entries(idsPlanos)) addRow(row?.fecha_turno, id, row);

  for (const [fecha, bloque] of Object.entries(fechas)) {
    for (const [id, row] of Object.entries(bloque.ids || {})) {
      idsCompat[id] = {
        id_producto: id,
        sucursal: row.actual.sucursal,
        sucursal_original: row.original.sucursal,
        fecha_turno: fecha,
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
      total: Object.values(fechas).reduce(
        (acc, bloque) => acc + Object.keys(bloque?.ids || {}).length,
        0
      ),
    },
    fechas,
    ids: idsCompat,
  };
}

async function leerStoreNormalizado() {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    return normalizarStore(JSON.parse(raw || '{}'));
  } catch {
    return normalizarStore({});
  }
}

export async function leerSucursalesCrudas() {
  return leerStoreNormalizado();
}

/**
 * @param {string} turnoFecha YYYY-MM-DD (turno operativo Bogotá)
 * @param {Map<string, object>} snapshotMap salida de snapshotPlanillajeDesdeRows
 */
export async function persistirSucursalesCrudasDesdeSnapshot(turnoFecha, snapshotMap) {
  if (!(snapshotMap instanceof Map)) return;
  const tf = String(turnoFecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tf)) return;
  const store = await leerStoreNormalizado();
  if (!store.fechas[tf]) store.fechas[tf] = { ids: {} };
  const bloque = store.fechas[tf].ids;
  const ahora = new Date().toISOString();
  for (const [id, row] of snapshotMap) {
    const idKey = String(id || '').trim();
    if (!idKey) continue;
    if (!esObservacionCruda(row?.observacion)) continue;
    const sucursal = limpiarSucursal(row?.sucursal);
    if (!sucursal) continue;
    const usuario = row?.username_bd ? String(row.username_bd).trim() : null;
    const prev = bloque[idKey];
    bloque[idKey] = {
      id_producto: idKey,
      fecha_turno: tf,
      original: prev?.original?.sucursal
        ? prev.original
        : {
            sucursal,
            usuario_planillaje: usuario,
            guardado_en: ahora,
          },
      actual: {
        sucursal,
        usuario_planillaje: usuario,
        actualizado_en: ahora,
      },
    };
  }
  const normalizado = normalizarStore(store);
  const payload = {
    meta: {
      ...normalizado.meta,
      version: 2,
      ultimo_turno: tf,
      actualizado_en: ahora,
    },
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
 * Compara la sucursal original guardada para fechaPlan contra la sucursal actual
 * consultada en el día de despacho/revisión.
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
  const store = await leerStoreNormalizado();
  const ids = store.fechas?.[fp]?.ids || {};
  const out = [];
  for (const [id, row] of Object.entries(ids)) {
    const idKey = String(id || '').trim();
    if (!idKey) continue;
    if (idsPermitidos && !idsPermitidos.has(idKey)) continue;
    const antes = limpiarSucursal(row?.original?.sucursal);
    const despues = limpiarSucursal(sucursalActualPorId?.get(idKey) ?? row?.actual?.sucursal);
    if (!antes || !despues || antes === despues) continue;
    out.push({
      id: idKey,
      sucursal_antes: antes,
      sucursal_despues: despues,
      fecha_plan: fp,
      fecha_revision: fr,
      guardado_en: row?.original?.guardado_en || null,
      actualizado_en: row?.actual?.actualizado_en || null,
      usuario: row?.actual?.usuario_planillaje || row?.original?.usuario_planillaje || null,
    });
  }
  return out;
}
