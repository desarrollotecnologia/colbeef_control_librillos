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

function itemsDesdeRegistroReimpresion(row) {
  const despues = row?.despues && typeof row.despues === 'object' ? row.despues : null;
  if (Array.isArray(despues?.items)) return despues.items;
  const meta = row?.meta && typeof row.meta === 'object' ? row.meta : null;
  if (Array.isArray(meta?.items)) return meta.items;
  return [];
}

/**
 * IDs ya reimpresos para un par plan → revisión (último registro gana por id).
 * @returns {Promise<Map<string, { fecha: string, usuario: string|null, sucursal_despues: string|null, plaza: string|null }>>}
 */
/**
 * Cambios de sucursal en crudas del plan, detectados en auditoría planillaje (antes ≠ despues).
 * @param {string} fechaPlanISO
 * @param {string} fechaRevisionISO
 * @param {Set<string>|string[]} idsPermitidos IDs del plan de faena
 */
export async function obtenerCambiosSucursalCrudasAuditoria(
  fechaPlanISO,
  fechaRevisionISO,
  idsPermitidos
) {
  const fechaPlan = String(fechaPlanISO || '').trim();
  const fechaRevision = String(fechaRevisionISO || '').trim();
  const ids =
    idsPermitidos instanceof Set
      ? idsPermitidos
      : new Set((idsPermitidos || []).map((x) => String(x || '').trim()).filter(Boolean));
  if (!ids.size || !/^\d{4}-\d{2}-\d{2}$/.test(fechaPlan) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaRevision)) {
    return [];
  }

  const { items } = await obtenerHistoricoCambios({
    desde: fechaPlan,
    hasta: fechaRevision,
    modulo: 'planillaje',
    accion: 'actualizar_en_turno',
    limit: 8000,
  });

  const puestoDesdeSnap = (snap) => {
    if (!snap || typeof snap !== 'object') return '';
    const cod = String(snap.agrupacion_codigo || '').trim().toLowerCase();
    const ag = String(snap.agrupacion || snap.cliente_destino || '').replace(/\s+/g, ' ').trim();
    if (ag && cod && cod !== 'asurcarnes') return ag;
    const suc = String(snap.sucursal || '').replace(/\s+/g, ' ').trim();
    if (suc && !/^cava\.?$/i.test(suc)) return suc;
    const obs = String(snap.observacion || '');
    const m = obs.match(/\b(DRA\s+CAVA|\d+\s*ZAP|\d+ZAP)\b/i);
    return m ? m[0].replace(/\s+/g, ' ').trim().toUpperCase() : '';
  };

  const diaBogotaIso = (iso) => {
    const t = Date.parse(String(iso || ''));
    if (!Number.isFinite(t)) return '';
    return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  };

  const ordenados = [...(items || [])].sort(
    (a, b) => Date.parse(a.fecha || 0) - Date.parse(b.fecha || 0)
  );

  const snapPlan = new Map();
  const snapRev = new Map();
  const snapUltimo = new Map();

  for (const ev of ordenados) {
    const id = String(
      ev.idEntidad || ev.despues?.id_producto || ev.antes?.id_producto || ''
    ).trim();
    if (!id || !ids.has(id)) continue;
    const despues = ev.despues && typeof ev.despues === 'object' ? ev.despues : null;
    if (!despues) continue;
    const obs = String(despues.observacion || '').trim();
    if (!/\bCRUDAS?\b/i.test(obs)) continue;
    const dia = diaBogotaIso(ev.fecha);
    snapUltimo.set(id, despues);
    if (dia === fechaPlan) snapPlan.set(id, despues);
    if (dia === fechaRevision) snapRev.set(id, despues);
  }

  const out = [];
  for (const id of ids) {
    const sPlan = snapPlan.get(id) || snapUltimo.get(id);
    const sRev = snapRev.get(id) || snapUltimo.get(id);
    if (!sPlan || !sRev) continue;
    const pAnt = puestoDesdeSnap(sPlan);
    const pNue = puestoDesdeSnap(sRev);
    if (pAnt === pNue) continue;
    out.push({
      id,
      sucursal_antes: pAnt,
      sucursal_despues: pNue,
      observacion_antes: String(sPlan.observacion || '').trim(),
      observacion_despues: String(sRev.observacion || '').trim(),
      fecha: null,
      usuario: null,
    });
  }
  return out;
}

export async function obtenerReimpresionesCrudasMap(fechaPlanISO, fechaRevisionISO) {
  const fechaPlan = String(fechaPlanISO || '').trim();
  const fechaRevision = String(fechaRevisionISO || '').trim();
  const out = new Map();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPlan) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaRevision)) {
    return out;
  }

  const { items } = await obtenerHistoricoCambios({
    desde: fechaPlan,
    modulo: 'reimpresion_crudas',
    accion: 'imprimir_etiquetas',
    limit: 1000,
  });

  const ordenados = [...(items || [])].sort(
    (a, b) => Date.parse(a.fecha || 0) - Date.parse(b.fecha || 0)
  );
  for (const row of ordenados) {
    const meta = row?.meta && typeof row.meta === 'object' ? row.meta : {};
    if (String(meta.fecha_plan || '') !== fechaPlan) continue;
    if (String(meta.fecha_revision || '') !== fechaRevision) continue;
    for (const it of itemsDesdeRegistroReimpresion(row)) {
      const id = String(it.id_producto ?? it.id ?? '').trim();
      if (!id) continue;
      out.set(id, {
        fecha: row.fecha,
        usuario: row.usuario || null,
        sucursal_despues: it.sucursal_despues != null ? String(it.sucursal_despues) : null,
        plaza: it.plaza != null ? String(it.plaza) : null,
      });
    }
  }
  return out;
}

/**
 * Registra un lote de reimpresión de etiquetas crudas (histórico).
 * @param {{ fecha_plan: string, fecha_revision: string, items: Array<object>, usuario?: string }} input
 */
export async function registrarReimpresionCrudas({
  fecha_plan,
  fecha_revision,
  items = [],
  usuario = null,
}) {
  const fechaPlan = String(fecha_plan || '').trim();
  const fechaRevision = String(fecha_revision || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPlan) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaRevision)) {
    throw new Error('fecha_plan y fecha_revision deben ser YYYY-MM-DD');
  }
  const normalizados = (items || [])
    .map((it) => ({
      id_producto: String(it.id_producto ?? it.id ?? '').trim(),
      sucursal_antes: it.sucursal_antes != null ? String(it.sucursal_antes) : null,
      sucursal_despues: it.sucursal_despues != null ? String(it.sucursal_despues) : null,
      plaza: it.plaza != null ? String(it.plaza) : null,
    }))
    .filter((it) => it.id_producto);
  if (!normalizados.length) {
    throw new Error('items requiere al menos un id_producto');
  }

  return registrarCambioHistorico({
    modulo: 'reimpresion_crudas',
    accion: 'imprimir_etiquetas',
    entidad: 'cruda',
    idEntidad: `${fechaPlan}|${fechaRevision}`,
    usuario: usuario ? String(usuario).slice(0, 120) : null,
    despues: { items: normalizados },
    meta: {
      fecha_plan: fechaPlan,
      fecha_revision: fechaRevision,
      total: normalizados.length,
      origen: 'historico',
    },
  });
}
