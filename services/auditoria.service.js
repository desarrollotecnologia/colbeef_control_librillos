import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(__dirname, '..', 'data', 'historico-cambios.json');
const tmpPath = `${storePath}.tmp`;

let writeQueue = Promise.resolve();

async function ensureStore() {
  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, '[]', 'utf8');
  }
}

async function readRows() {
  await ensureStore();
  const raw = await fs.readFile(storePath, 'utf8');
  try {
    const data = JSON.parse(raw || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeRows(rows) {
  await fs.writeFile(tmpPath, JSON.stringify(rows), 'utf8');
  await fs.rename(tmpPath, storePath);
}

export async function registrarCambioHistorico({
  modulo = 'general',
  accion = 'actualizar',
  entidad = null,
  idEntidad = null,
  usuario = null,
  antes = null,
  despues = null,
  meta = null,
}) {
  const row = {
    id: `chg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fecha: new Date().toISOString(),
    modulo: String(modulo || 'general').slice(0, 60),
    accion: String(accion || 'actualizar').slice(0, 60),
    entidad: entidad ? String(entidad).slice(0, 80) : null,
    idEntidad: idEntidad ? String(idEntidad).slice(0, 140) : null,
    usuario: usuario ? String(usuario).slice(0, 120) : null,
    antes: antes && typeof antes === 'object' ? antes : null,
    despues: despues && typeof despues === 'object' ? despues : null,
    meta: meta && typeof meta === 'object' ? meta : null,
  };

  writeQueue = writeQueue.then(async () => {
    const rows = await readRows();
    rows.push(row);
    if (rows.length > 50000) rows.splice(0, rows.length - 50000);
    await writeRows(rows);
  });
  await writeQueue;
  return row;
}

export async function obtenerHistoricoCambios({
  desde = null,
  hasta = null,
  modulo = null,
  accion = null,
  entidad = null,
  usuario = null,
  limit = 120,
} = {}) {
  const rows = await readRows();
  const fromTs = desde ? Date.parse(`${desde}T00:00:00.000Z`) : null;
  const toTs = hasta ? Date.parse(`${hasta}T23:59:59.999Z`) : null;
  const lim = Math.max(1, Math.min(1000, Number(limit) || 120));

  const out = rows
    .filter((r) => {
      const ts = Date.parse(r.fecha || 0);
      if (!Number.isFinite(ts)) return false;
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      if (modulo && String(r.modulo || '') !== String(modulo)) return false;
      if (accion && String(r.accion || '') !== String(accion)) return false;
      if (entidad && String(r.entidad || '') !== String(entidad)) return false;
      if (usuario && String(r.usuario || '') !== String(usuario)) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0))
    .slice(0, lim);

  return {
    total: out.length,
    items: out,
  };
}
