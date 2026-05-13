/**
 * Persiste solo sucursal de filas marcadas como CRUDAS/CRUDA en el snapshot de planillaje.
 * Archivo: data/crudas-sucursal.json — se reescribe desde el estado actual del turno (polling).
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

async function ensureDir() {
  const dir = path.dirname(storePath);
  await fs.mkdir(dir, { recursive: true });
}

export async function leerSucursalesCrudas() {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const data = JSON.parse(raw || '{}');
    const ids = data?.ids && typeof data.ids === 'object' ? data.ids : {};
    return { ids, meta: data?.meta || {} };
  } catch {
    return { ids: {}, meta: {} };
  }
}

/**
 * @param {string} turnoFecha YYYY-MM-DD (turno operativo Bogotá)
 * @param {Map<string, object>} snapshotMap salida de snapshotPlanillajeDesdeRows
 */
export async function persistirSucursalesCrudasDesdeSnapshot(turnoFecha, snapshotMap) {
  if (!(snapshotMap instanceof Map)) return;
  const tf = String(turnoFecha || '').trim();
  const ids = {};
  for (const [id, row] of snapshotMap) {
    const idKey = String(id || '').trim();
    if (!idKey) continue;
    if (!esObservacionCruda(row?.observacion)) continue;
    ids[idKey] = {
      id_producto: idKey,
      sucursal: String(row?.sucursal || '').trim(),
      fecha_turno: tf,
      usuario_planillaje: row?.username_bd ? String(row.username_bd).trim() : null,
      actualizado_en: new Date().toISOString(),
    };
  }
  const payload = {
    meta: {
      version: 1,
      ultimo_turno: tf,
      actualizado_en: new Date().toISOString(),
      total: Object.keys(ids).length,
    },
    ids,
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
