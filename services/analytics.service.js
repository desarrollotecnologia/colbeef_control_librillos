import { pool } from '../config/db.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileStorePath = path.join(__dirname, '..', 'data', 'analytics-events.json');
const fileStoreTmpPath = `${fileStorePath}.tmp`;

let ensured = false;
let storageMode = null; // 'db' | 'file'
let fileWriteQueue = Promise.resolve();

function esErrorSoloLectura(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('read-only') || msg.includes('readonly');
}

async function ensureFileStore() {
  try {
    await fs.access(fileStorePath);
  } catch {
    await fs.writeFile(fileStorePath, '[]', 'utf8');
  }
}

function extraerArrayJsonPrefix(raw) {
  const s = String(raw || '').trimStart();
  if (!s.startsWith('[')) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return null;
}

async function writeFileEvents(rows) {
  await fs.writeFile(fileStoreTmpPath, JSON.stringify(rows), 'utf8');
  await fs.rename(fileStoreTmpPath, fileStorePath);
}

async function readFileEvents() {
  await ensureFileStore();
  const raw = await fs.readFile(fileStorePath, 'utf8');
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Recupera archivos con basura al final por escrituras concurrentes previas.
    const prefix = extraerArrayJsonPrefix(raw);
    if (!prefix) return [];
    try {
      const parsed = JSON.parse(prefix);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

async function appendFileEvent(event) {
  fileWriteQueue = fileWriteQueue.then(async () => {
    const rows = await readFileEvents();
    rows.push(event);
    if (rows.length > 120000) {
      rows.splice(0, rows.length - 120000);
    }
    await writeFileEvents(rows);
  });
  await fileWriteQueue;
}

function sanitizarEvento({
  sessionId,
  eventName,
  viewName = null,
  userName = null,
  durationMs = null,
  path: routePath = null,
  userAgent = null,
  ip = null,
  meta = null,
}) {
  return {
    sessionId: String(sessionId).slice(0, 120),
    eventName: String(eventName).slice(0, 80),
    viewName: viewName ? String(viewName).slice(0, 80) : null,
    userName: userName ? String(userName).slice(0, 120) : null,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : null,
    path: routePath ? String(routePath).slice(0, 300) : null,
    userAgent: userAgent ? String(userAgent).slice(0, 400) : null,
    ip: ip ? String(ip).slice(0, 80) : null,
    meta: meta && typeof meta === 'object' ? meta : null,
  };
}

function aplicarRangoJs(rows, desde, hasta) {
  const from = desde ? Date.parse(`${desde}T00:00:00.000Z`) : null;
  const to = hasta ? Date.parse(`${hasta}T23:59:59.999Z`) : null;
  return rows.filter((r) => {
    const ts = Date.parse(r.eventTime || 0);
    if (!Number.isFinite(ts)) return false;
    if (from !== null && ts < from) return false;
    if (to !== null && ts > to) return false;
    return true;
  });
}

function resumenDesdeEventosJs(rows, { desde, hasta }) {
  const filtrados = aplicarRangoJs(rows, desde, hasta);
  const totalEventos = filtrados.length;
  const sesiones = new Map();
  const vistas = new Map();
  const eventos = new Map();
  const usuarios = new Map();
  const eventosDia = new Map();
  const vistaTiempoMs = new Map();
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;
  const activos24h = new Set();

  for (const e of filtrados) {
    const sid = String(e.sessionId || '');
    const ts = Date.parse(e.eventTime || 0);
    if (!sid || !Number.isFinite(ts)) continue;
    if (!sesiones.has(sid)) sesiones.set(sid, { inicio: ts, fin: ts });
    const item = sesiones.get(sid);
    if (ts < item.inicio) item.inicio = ts;
    if (ts > item.fin) item.fin = ts;
    item.eventos = (item.eventos || 0) + 1;
    if (e.viewName) item.ultimaVista = String(e.viewName);
    const usuarioEvt = String(e.userName || e.meta?.usuario || e.meta?.userName || '').trim();
    if (usuarioEvt) {
      item.usuario = usuarioEvt;
      usuarios.set(usuarioEvt, (usuarios.get(usuarioEvt) || 0) + 1);
    }
    if (ts >= last24h) activos24h.add(sid);
    const dayKey = new Date(ts).toISOString().slice(0, 10);
    if (!eventosDia.has(dayKey)) eventosDia.set(dayKey, { totalEventos: 0, sesiones: new Set() });
    const d = eventosDia.get(dayKey);
    d.totalEventos += 1;
    d.sesiones.add(sid);
    if (e.eventName === 'view_enter') {
      const key = e.viewName || '(sin vista)';
      vistas.set(key, (vistas.get(key) || 0) + 1);
    }
    if (e.eventName === 'view_leave' && Number.isFinite(e.durationMs) && e.durationMs > 0) {
      const key = e.viewName || '(sin vista)';
      vistaTiempoMs.set(key, (vistaTiempoMs.get(key) || 0) + e.durationMs);
    }
    const ev = e.eventName || '(sin evento)';
    eventos.set(ev, (eventos.get(ev) || 0) + 1);
  }

  let sumaMin = 0;
  for (const s of sesiones.values()) {
    sumaMin += Math.max(0, (s.fin - s.inicio) / 60000);
  }
  const duracionPromedioMin = sesiones.size ? sumaMin / sesiones.size : 0;
  const eventosRecientes = [...filtrados]
    .sort((a, b) => Date.parse(b.eventTime || 0) - Date.parse(a.eventTime || 0))
    .slice(0, 80)
    .map((e) => ({
      tiempo: e.eventTime || null,
      evento: e.eventName || null,
      vista: e.viewName || null,
      sesion: e.sessionId || null,
      usuario: e.userName || e.meta?.usuario || e.meta?.userName || null,
      duracionMs: Number.isFinite(e.durationMs) ? e.durationMs : null,
      path: e.path || null,
      ip: e.ip || null,
    }));
  const sesionesRecientes = [...sesiones.entries()]
    .map(([sessionId, s]) => ({
      sessionId,
      inicio: new Date(s.inicio).toISOString(),
      fin: new Date(s.fin).toISOString(),
      duracionMin: Math.max(0, (s.fin - s.inicio) / 60000),
      totalEventos: Number(s.eventos || 0),
      ultimaVista: s.ultimaVista || null,
      usuario: s.usuario || null,
    }))
    .sort((a, b) => Date.parse(b.fin) - Date.parse(a.fin))
    .slice(0, 20);

  return {
    rango: { desde: desde || null, hasta: hasta || null },
    kpi: {
      totalEventos,
      sesionesUnicas: sesiones.size,
      usuariosActivos24h: activos24h.size,
      duracionPromedioMin,
    },
    vistasTop: [...vistas.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([vista, total]) => ({ vista, total })),
    eventosTop: [...eventos.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([evento, total]) => ({ evento, total })),
    usuariosTop: [...usuarios.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([usuario, total]) => ({ usuario, total })),
    detalle: {
      eventosPorDia: [...eventosDia.entries()]
        .map(([fecha, v]) => ({
          fecha,
          totalEventos: Number(v.totalEventos || 0),
          sesiones: v.sesiones.size,
        }))
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
        .slice(-31),
      vistasTiempoMin: [...vistaTiempoMs.entries()]
        .map(([vista, ms]) => ({ vista, minutos: Number((ms / 60000).toFixed(2)) }))
        .sort((a, b) => b.minutos - a.minutos)
        .slice(0, 12),
      sesionesRecientes,
      eventosRecientes,
    },
    almacenamiento: 'file',
  };
}

async function ensureAnalyticsStorage() {
  if (storageMode) return storageMode;
  if (ensured) {
    storageMode = 'db';
    return storageMode;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_analytics_events (
        id BIGSERIAL PRIMARY KEY,
        event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        session_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        view_name TEXT,
        duration_ms INTEGER,
        path TEXT,
        user_agent TEXT,
        ip TEXT,
        meta JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_app_analytics_events_time
        ON app_analytics_events(event_time DESC);
      CREATE INDEX IF NOT EXISTS idx_app_analytics_events_session
        ON app_analytics_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_app_analytics_events_event
        ON app_analytics_events(event_name);
    `);
    ensured = true;
    storageMode = 'db';
    return storageMode;
  } catch (err) {
    if (!esErrorSoloLectura(err)) throw err;
    console.warn('⚠️ Analitica: BD en solo lectura, se usara almacenamiento local JSON.');
    await ensureFileStore();
    storageMode = 'file';
    return storageMode;
  }
}

export async function registrarEventoAnalytics({
  sessionId,
  eventName,
  viewName = null,
  userName = null,
  durationMs = null,
  path = null,
  userAgent = null,
  ip = null,
  meta = null,
}) {
  if (!sessionId || !eventName) {
    throw new Error('sessionId y eventName son obligatorios');
  }
  const mode = await ensureAnalyticsStorage();
  const ev = sanitizarEvento({ sessionId, eventName, viewName, userName, durationMs, path, userAgent, ip, meta });

  if (mode === 'file') {
    await appendFileEvent({
      eventTime: new Date().toISOString(),
      ...ev,
    });
    return;
  }

  await pool.query(
    `INSERT INTO app_analytics_events
      (session_id, event_name, view_name, duration_ms, path, user_agent, ip, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ev.sessionId,
      ev.eventName,
      ev.viewName,
      ev.durationMs,
      ev.path,
      ev.userAgent,
      ev.ip,
      {
        ...(ev.meta && typeof ev.meta === 'object' ? ev.meta : {}),
        ...(ev.userName ? { usuario: ev.userName } : {}),
      },
    ]
  );
}

export async function obtenerResumenAnalytics({ desde, hasta } = {}) {
  const mode = await ensureAnalyticsStorage();
  if (mode === 'file') {
    const rows = await readFileEvents();
    return resumenDesdeEventosJs(rows, { desde, hasta });
  }
  const desdeTs = desde ? `${desde}T00:00:00.000Z` : null;
  const hastaTs = hasta ? `${hasta}T23:59:59.999Z` : null;

  const params = [];
  let where = 'WHERE 1=1';
  if (desdeTs) {
    params.push(desdeTs);
    where += ` AND event_time >= $${params.length}`;
  }
  if (hastaTs) {
    params.push(hastaTs);
    where += ` AND event_time <= $${params.length}`;
  }

  const [kpi, vistas, eventos, usuariosTop, eventosDia, vistasTiempo, sesionesRecientes, eventosRecientes] = await Promise.all([
    pool.query(
      `
      WITH base AS (
        SELECT * FROM app_analytics_events
        ${where}
      ),
      sesiones AS (
        SELECT session_id, MIN(event_time) AS inicio, MAX(event_time) AS fin
        FROM base
        GROUP BY session_id
      )
      SELECT
        (SELECT COUNT(*)::INT FROM base) AS total_eventos,
        (SELECT COUNT(DISTINCT session_id)::INT FROM base) AS sesiones_unicas,
        (SELECT COUNT(DISTINCT session_id)::INT
           FROM base
          WHERE event_time >= NOW() - INTERVAL '24 hours') AS usuarios_activos_24h,
        (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (fin - inicio)) / 60.0), 0)
           FROM sesiones) AS duracion_promedio_min
      `,
      params
    ),
    pool.query(
      `
      SELECT COALESCE(view_name, '(sin vista)') AS vista, COUNT(*)::INT AS total
      FROM app_analytics_events
      ${where}
        AND event_name = 'view_enter'
      GROUP BY COALESCE(view_name, '(sin vista)')
      ORDER BY total DESC
      LIMIT 10
      `,
      params
    ),
    pool.query(
      `
      SELECT event_name, COUNT(*)::INT AS total
      FROM app_analytics_events
      ${where}
      GROUP BY event_name
      ORDER BY total DESC
      LIMIT 15
      `,
      params
    ),
    pool.query(
      `
      SELECT COALESCE(meta->>'usuario', '(sin usuario)') AS usuario, COUNT(*)::INT AS total
      FROM app_analytics_events
      ${where}
      GROUP BY COALESCE(meta->>'usuario', '(sin usuario)')
      ORDER BY total DESC
      LIMIT 15
      `,
      params
    ),
    pool.query(
      `
      SELECT DATE(event_time)::TEXT AS fecha,
             COUNT(*)::INT AS total_eventos,
             COUNT(DISTINCT session_id)::INT AS sesiones
      FROM app_analytics_events
      ${where}
      GROUP BY DATE(event_time)
      ORDER BY DATE(event_time) DESC
      LIMIT 31
      `,
      params
    ),
    pool.query(
      `
      SELECT COALESCE(view_name, '(sin vista)') AS vista,
             ROUND(COALESCE(SUM(duration_ms),0) / 60000.0, 2) AS minutos
      FROM app_analytics_events
      ${where}
        AND event_name = 'view_leave'
      GROUP BY COALESCE(view_name, '(sin vista)')
      ORDER BY minutos DESC
      LIMIT 12
      `,
      params
    ),
    pool.query(
      `
      WITH base AS (
        SELECT * FROM app_analytics_events
        ${where}
      ),
      ses AS (
        SELECT
          session_id,
          MIN(event_time) AS inicio,
          MAX(event_time) AS fin,
          COUNT(*)::INT AS total_eventos
        FROM base
        GROUP BY session_id
      ),
      last_view AS (
        SELECT DISTINCT ON (session_id)
          session_id,
          COALESCE(view_name, '(sin vista)') AS ultima_vista,
          COALESCE(meta->>'usuario', '(sin usuario)') AS usuario
        FROM base
        ORDER BY session_id, event_time DESC
      )
      SELECT
        ses.session_id,
        ses.inicio,
        ses.fin,
        ROUND(EXTRACT(EPOCH FROM (ses.fin - ses.inicio)) / 60.0, 2) AS duracion_min,
        ses.total_eventos,
        lv.ultima_vista,
        lv.usuario
      FROM ses
      LEFT JOIN last_view lv ON lv.session_id = ses.session_id
      ORDER BY ses.fin DESC
      LIMIT 20
      `,
      params
    ),
    pool.query(
      `
      SELECT
        event_time,
        event_name,
        view_name,
        session_id,
        duration_ms,
        path,
        ip,
        COALESCE(meta->>'usuario', null) AS usuario
      FROM app_analytics_events
      ${where}
      ORDER BY event_time DESC
      LIMIT 80
      `,
      params
    ),
  ]);

  const row = kpi.rows[0] || {};
  return {
    rango: { desde: desde || null, hasta: hasta || null },
    kpi: {
      totalEventos: Number(row.total_eventos || 0),
      sesionesUnicas: Number(row.sesiones_unicas || 0),
      usuariosActivos24h: Number(row.usuarios_activos_24h || 0),
      duracionPromedioMin: Number(row.duracion_promedio_min || 0),
    },
    vistasTop: vistas.rows.map((r) => ({ vista: r.vista, total: Number(r.total || 0) })),
    eventosTop: eventos.rows.map((r) => ({ evento: r.event_name, total: Number(r.total || 0) })),
    usuariosTop: usuariosTop.rows.map((r) => ({ usuario: r.usuario, total: Number(r.total || 0) })),
    detalle: {
      eventosPorDia: [...eventosDia.rows]
        .reverse()
        .map((r) => ({
          fecha: r.fecha,
          totalEventos: Number(r.total_eventos || 0),
          sesiones: Number(r.sesiones || 0),
        })),
      vistasTiempoMin: vistasTiempo.rows.map((r) => ({
        vista: r.vista,
        minutos: Number(r.minutos || 0),
      })),
      sesionesRecientes: sesionesRecientes.rows.map((r) => ({
        sessionId: r.session_id,
        inicio: r.inicio ? new Date(r.inicio).toISOString() : null,
        fin: r.fin ? new Date(r.fin).toISOString() : null,
        duracionMin: Number(r.duracion_min || 0),
        totalEventos: Number(r.total_eventos || 0),
        ultimaVista: r.ultima_vista || null,
        usuario: r.usuario || null,
      })),
      eventosRecientes: eventosRecientes.rows.map((r) => ({
        tiempo: r.event_time ? new Date(r.event_time).toISOString() : null,
        evento: r.event_name || null,
        vista: r.view_name || null,
        sesion: r.session_id || null,
        usuario: r.usuario || null,
        duracionMs: Number.isFinite(Number(r.duration_ms)) ? Number(r.duration_ms) : null,
        path: r.path || null,
        ip: r.ip || null,
      })),
    },
    almacenamiento: 'db',
  };
}
