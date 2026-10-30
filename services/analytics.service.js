import { getMySQLPool, isMySQLReady } from '../config/mysql.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileStorePath = path.join(__dirname, '..', 'data', 'analytics-events.json');
const fileStoreTmpPath = `${fileStorePath}.tmp`;

let fileWriteQueue = Promise.resolve();

function forzarSoloArchivo() {
  const v = String(process.env.ANALYTICS_USE_FILE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function usarMySQL() {
  return !forzarSoloArchivo() && isMySQLReady();
}

async function ensureFileStore() {
  await fs.mkdir(path.dirname(fileStorePath), { recursive: true });
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
  const tmpPath = `${fileStoreTmpPath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(rows), 'utf8');
    await fs.rename(tmpPath, fileStorePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
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
  fileWriteQueue = fileWriteQueue
    .catch((err) => {
      console.warn('⚠️ Analitica: se recupera cola de escritura local:', err.message || err);
    })
    .then(async () => {
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
  if (usarMySQL()) return 'mysql';
  await ensureFileStore();
  return 'file';
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
  const ev = sanitizarEvento({ sessionId, eventName, viewName, userName, durationMs, path, userAgent, ip, meta });

  if (usarMySQL()) {
    try {
      const db = getMySQLPool();
      const metaObj = {
        ...(ev.meta && typeof ev.meta === 'object' ? ev.meta : {}),
        ...(ev.userName ? { usuario: ev.userName } : {}),
      };
      await db.query(
        `INSERT INTO analytics_eventos
          (event_time, session_id, event_name, view_name, user_name, duration_ms, path, ip, user_agent, meta_json)
         VALUES (NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ev.sessionId,
          ev.eventName,
          ev.viewName    ?? null,
          ev.userName    ?? null,
          ev.durationMs  ?? null,
          ev.path        ?? null,
          ev.ip          ?? null,
          ev.userAgent   ? ev.userAgent.slice(0, 300) : null,
          Object.keys(metaObj).length ? JSON.stringify(metaObj) : null,
        ]
      );
      return;
    } catch (e) {
      console.warn('⚠️ Analytics MySQL write error, cayendo a archivo:', e.message);
    }
  }

  await ensureFileStore();
  await appendFileEvent({ eventTime: new Date().toISOString(), ...ev });
}

export async function obtenerResumenAnalytics({ desde, hasta } = {}) {
  // MySQL: leer eventos y computar resumen en JS (reutiliza lógica existente)
  if (usarMySQL()) {
    try {
      const db = getMySQLPool();
      const parts = ['1=1'];
      const params = [];
      if (desde) { parts.push('event_time >= ?'); params.push(new Date(`${desde}T00:00:00.000Z`)); }
      if (hasta) { parts.push('event_time <= ?'); params.push(new Date(`${hasta}T23:59:59.999Z`)); }
      const where = parts.join(' AND ');

      const [rawRows] = await db.query(
        `SELECT event_time AS eventTime, session_id AS sessionId, event_name AS eventName,
                view_name AS viewName, user_name AS userName, duration_ms AS durationMs,
                path, ip, user_agent AS userAgent, meta_json AS meta
         FROM analytics_eventos
         WHERE ${where}
         ORDER BY event_time DESC
         LIMIT 120000`,
        params
      );

      const rows = (rawRows || []).map((r) => ({
        eventTime:  r.eventTime instanceof Date ? r.eventTime.toISOString() : String(r.eventTime || ''),
        sessionId:  r.sessionId  || '',
        eventName:  r.eventName  || '',
        viewName:   r.viewName   || null,
        userName:   r.userName   || null,
        durationMs: r.durationMs ?? null,
        path:       r.path       || null,
        ip:         r.ip         || null,
        userAgent:  r.userAgent  || null,
        meta: (() => { try { return typeof r.meta === 'string' ? JSON.parse(r.meta) : (r.meta ?? null); } catch { return null; } })(),
      }));

      const resumen = resumenDesdeEventosJs(rows, { desde, hasta });
      resumen.almacenamiento = 'mysql';
      return resumen;
    } catch (e) {
      console.warn('⚠️ Analytics MySQL read error, cayendo a archivo:', e.message);
    }
  }

  const rows = await readFileEvents();
  return resumenDesdeEventosJs(rows, { desde, hasta });
}
