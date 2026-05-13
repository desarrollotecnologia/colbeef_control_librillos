import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(__dirname, '..', 'data', 'historico-cambios.json');
const tmpPath = `${storePath}.tmp`;

let writeQueue = Promise.resolve();
let storageMode = null; // 'db' | 'file'
let ensuredDb = false;

function esErrorSoloLectura(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('read-only') || msg.includes('readonly');
}

function forzarSoloArchivo() {
  const v = String(process.env.AUDITORIA_USE_FILE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

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

async function ensureAuditoriaDb() {
  if (forzarSoloArchivo()) {
    storageMode = 'file';
    return 'file';
  }
  if (storageMode) return storageMode;
  if (ensuredDb) {
    storageMode = 'db';
    return 'db';
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_auditoria_cambios (
        id TEXT PRIMARY KEY,
        event_time TIMESTAMPTZ NOT NULL,
        modulo TEXT NOT NULL DEFAULT 'general',
        accion TEXT NOT NULL DEFAULT 'actualizar',
        entidad TEXT,
        id_entidad TEXT,
        usuario TEXT,
        antes JSONB,
        despues JSONB,
        meta JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_app_auditoria_event_time
        ON app_auditoria_cambios (event_time DESC);
      CREATE INDEX IF NOT EXISTS idx_app_auditoria_modulo_time
        ON app_auditoria_cambios (modulo, event_time DESC);
    `);
    ensuredDb = true;
    storageMode = 'db';
    return 'db';
  } catch (err) {
    if (!esErrorSoloLectura(err)) throw err;
    console.warn('⚠️ Auditoría: BD en solo lectura o sin DDL; se usará historico-cambios.json.');
    await ensureStore();
    storageMode = 'file';
    return 'file';
  }
}

function mapDbRowToItem(r) {
  const t = r.event_time;
  const fechaIso =
    t instanceof Date && !Number.isNaN(t.getTime())
      ? t.toISOString()
      : t
        ? new Date(t).toISOString()
        : new Date().toISOString();
  return {
    id: r.id,
    fecha: fechaIso,
    modulo: r.modulo,
    accion: r.accion,
    entidad: r.entidad,
    idEntidad: r.id_entidad,
    usuario: r.usuario,
    antes: r.antes,
    despues: r.despues,
    meta: r.meta,
  };
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

  const mode = await ensureAuditoriaDb();
  if (mode === 'db') {
    await pool.query(
      `INSERT INTO app_auditoria_cambios
        (id, event_time, modulo, accion, entidad, id_entidad, usuario, antes, despues, meta)
       VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
      [
        row.id,
        row.fecha,
        row.modulo,
        row.accion,
        row.entidad,
        row.idEntidad,
        row.usuario,
        row.antes ? JSON.stringify(row.antes) : null,
        row.despues ? JSON.stringify(row.despues) : null,
        row.meta ? JSON.stringify(row.meta) : null,
      ]
    );
    return row;
  }

  writeQueue = writeQueue.then(async () => {
    const rows = await readRows();
    rows.push(row);
    if (rows.length > 50000) rows.splice(0, rows.length - 50000);
    await writeRows(rows);
  });
  await writeQueue;
  return row;
}

function filtrarArchivo(rows, { desde, hasta, modulo, accion, entidad, usuario }) {
  const fromTs = desde ? Date.parse(`${desde}T00:00:00.000Z`) : null;
  const toTs = hasta ? Date.parse(`${hasta}T23:59:59.999Z`) : null;
  return rows.filter((r) => {
    const ts = Date.parse(r.fecha || 0);
    if (!Number.isFinite(ts)) return false;
    if (fromTs !== null && ts < fromTs) return false;
    if (toTs !== null && ts > toTs) return false;
    if (modulo && String(r.modulo || '') !== String(modulo)) return false;
    if (accion && String(r.accion || '') !== String(accion)) return false;
    if (entidad && String(r.entidad || '') !== String(entidad)) return false;
    if (usuario && String(r.usuario || '') !== String(usuario)) return false;
    return true;
  });
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
  const lim = Math.max(1, Math.min(1000, Number(limit) || 120));
  const mode = await ensureAuditoriaDb();

  if (mode === 'file') {
    const rows = await readRows();
    const filtered = filtrarArchivo(rows, { desde, hasta, modulo, accion, entidad, usuario });
    const sorted = filtered.sort((a, b) => Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0));
    const items = sorted.slice(0, lim);
    return {
      total: filtered.length,
      totalCoincidentes: filtered.length,
      items,
    };
  }

  const parts = ['1=1'];
  const params = [];
  if (desde) {
    params.push(`${desde}T00:00:00.000Z`);
    parts.push(`event_time >= $${params.length}::timestamptz`);
  }
  if (hasta) {
    params.push(`${hasta}T23:59:59.999Z`);
    parts.push(`event_time <= $${params.length}::timestamptz`);
  }
  if (modulo) {
    params.push(String(modulo));
    parts.push(`modulo = $${params.length}`);
  }
  if (accion) {
    params.push(String(accion));
    parts.push(`accion = $${params.length}`);
  }
  if (entidad) {
    params.push(String(entidad));
    parts.push(`entidad = $${params.length}`);
  }
  if (usuario) {
    params.push(String(usuario));
    parts.push(`usuario = $${params.length}`);
  }
  const whereSql = `WHERE ${parts.join(' AND ')}`;

  const selParams = [...params, lim];
  const limPlaceholder = selParams.length;
  // Una sola ida a la BD: total coincidente en subconsulta escalar (mismos $1..$n que el WHERE exterior).
  const dataRes = await pool.query(
    `
    SELECT id, event_time, modulo, accion, entidad, id_entidad, usuario, antes, despues, meta,
           (SELECT COUNT(*)::int FROM app_auditoria_cambios ${whereSql}) AS __total_coincidentes
    FROM app_auditoria_cambios
    ${whereSql}
    ORDER BY event_time DESC
    LIMIT $${limPlaceholder}
    `,
    selParams
  );
  const rawRows = dataRes.rows || [];
  const totalCoincidentes =
    rawRows.length > 0 ? Number(rawRows[0].__total_coincidentes || 0) : 0;
  const items = rawRows.map((row) => {
    const { __total_coincidentes: _t, ...rest } = row;
    return mapDbRowToItem(rest);
  });
  return {
    total: totalCoincidentes,
    totalCoincidentes,
    items,
  };
}
