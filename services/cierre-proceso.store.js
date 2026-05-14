/**
 * Cierres de proceso por fecha: snapshot de sucursal (crudas) al confirmar cierre.
 * Archivo: data/cierre-proceso.json
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(__dirname, '..', 'data', 'cierre-proceso.json');
const tmpPath = `${storePath}.tmp`;

let writeQueue = Promise.resolve();

async function ensureDir() {
  const dir = path.dirname(storePath);
  await fs.mkdir(dir, { recursive: true });
}

async function readAll() {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const j = JSON.parse(raw || '{}');
    const cierres = j?.cierres && typeof j.cierres === 'object' ? j.cierres : {};
    return { cierres, meta: j?.meta || {} };
  } catch {
    return { cierres: {}, meta: {} };
  }
}

async function writeAll(payload) {
  const json = JSON.stringify(payload, null, 2);
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    await fs.writeFile(tmpPath, json, 'utf8');
    await fs.rename(tmpPath, storePath);
  });
  await writeQueue;
}

export async function leerCierreProceso(fechaISO) {
  const f = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  const { cierres } = await readAll();
  const row = cierres[f];
  if (!row || typeof row !== 'object') return null;
  return { ...row, fecha_proceso: f };
}

export async function guardarCierreProceso(payload) {
  const f = String(payload?.fecha_proceso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('fecha_proceso inválida');
  const { cierres, meta } = await readAll();
  cierres[f] = {
    fecha_proceso: f,
    cerrado_en: payload.cerrado_en || new Date().toISOString(),
    usuario: payload.usuario ? String(payload.usuario).trim() : null,
    items: payload.items && typeof payload.items === 'object' ? payload.items : {},
    total_items: Number(payload.total_items) || 0,
  };
  await writeAll({
    meta: {
      ...meta,
      version: 1,
      ultimo_cierre_fecha: f,
      actualizado_en: new Date().toISOString(),
    },
    cierres,
  });
  return cierres[f];
}
