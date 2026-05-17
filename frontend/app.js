const API_URL      = '/api/librillos';
const API_CIERRE_PROCESO = '/api/cierre-proceso';
const SALIDAS_URL  = '/api/salidas';
const GUIAS_URL = '/api/guias';
const ANALYTICS_URL = '/api/analytics/event';
const ANALYTICS_RESUMEN_ADMIN_URL = '/api/analytics/resumen-admin';
const AUDITORIA_CAMBIOS_URL = '/api/auditoria/cambios';

/** Auto-actualización (ms); se puede sobreescribir desde config-ui.json. */
let AUTO_REFRESH_DATOS_MS = 30000;
/** Detección de cambios en observaciones (ms). */
let AUTO_REFRESH_OBS_MS = 20000;
/** Heartbeat de uso para estimar tiempo activo en la app. */
const ANALYTICS_HEARTBEAT_MS = 60000;
/** html2canvas: scale 2 bloquea el hilo principal mucho tiempo; 1.35 suele verse bien en PDF. */
const PDF_HTML2CANVAS_SCALE = 1.35;

/** Cancela peticiones automáticas (polling) en curso; evita que un tick viejo pise datos nuevos. */
let _libAutoAbort = null;
function nuevaSenalLibAuto() {
  try {
    _libAutoAbort?.abort();
  } catch (_) {
    /* ignore */
  }
  _libAutoAbort = new AbortController();
  return _libAutoAbort.signal;
}
function abortarLibAuto() {
  try {
    _libAutoAbort?.abort();
  } catch (_) {
    /* ignore */
  }
  _libAutoAbort = null;
}

const LS_ANALYTICS_SESSION = 'colbeef_analytics_session_v1';
const LS_ANALYTICS_ADMIN_KEY = 'colbeef_analytics_admin_key_v1';
let _analyticsSessionId = '';
let _analyticsStartedAt = Date.now();
let _analyticsViewActual = null;
let _analyticsViewAt = Date.now();
let _analyticsHeartbeat = null;
let _analyticsUsuarioActivo = '';
let _loaderDepth = 0;
let _loaderDelayTimer = null;
let _loaderHideTimer = null;
let _loaderVisibleSince = 0;

function setAppLoaderText(msg) {
  const txt = document.getElementById('app-loader-text');
  if (!txt) return;
  txt.textContent = String(msg || 'Estamos preparando la informacion');
}

function beginAppLoader(msg) {
  _loaderDepth += 1;
  if (msg) setAppLoaderText(msg);
  if (_loaderDepth > 1) return;
  clearTimeout(_loaderHideTimer);
  clearTimeout(_loaderDelayTimer);
  _loaderDelayTimer = setTimeout(() => {
    const overlay = document.getElementById('app-loader');
    if (!overlay || _loaderDepth <= 0) return;
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    _loaderVisibleSince = Date.now();
  }, 180);
}

function endAppLoader() {
  if (_loaderDepth <= 0) return;
  _loaderDepth -= 1;
  if (_loaderDepth > 0) return;
  clearTimeout(_loaderDelayTimer);
  const hide = () => {
    const overlay = document.getElementById('app-loader');
    if (!overlay) return;
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    _loaderVisibleSince = 0;
  };
  if (_loaderVisibleSince) {
    const elapsed = Date.now() - _loaderVisibleSince;
    const wait = Math.max(0, 420 - elapsed);
    _loaderHideTimer = setTimeout(hide, wait);
    return;
  }
  hide();
}

async function runWithAppLoader(msg, fn) {
  beginAppLoader(msg);
  try {
    return await fn();
  } finally {
    endAppLoader();
  }
}

function crearSesionAnalyticsId() {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `s_${Date.now().toString(36)}_${rnd}`;
}

function obtenerSesionAnalytics() {
  try {
    const saved = localStorage.getItem(LS_ANALYTICS_SESSION);
    if (saved) return saved;
    const id = crearSesionAnalyticsId();
    localStorage.setItem(LS_ANALYTICS_SESSION, id);
    return id;
  } catch {
    return crearSesionAnalyticsId();
  }
}

/** Usuario que viene de Inventarios vía ?usuario= o postMessage (persistido en esta pestaña). */
const SS_USUARIO_INVENTARIO = 'colbeef_usuario_inventario_v1';

function leerUsuarioDesdeQueryString() {
  try {
    const q = new URLSearchParams(window.location.search || '');
    const keys = [
      'usuario',
      'user',
      'username',
      'u',
      'login',
      'inventarios_usuario',
      'inv_usuario',
      'invUser',
    ];
    for (const k of keys) {
      const v = String(q.get(k) || '').trim();
      if (v) return v;
    }
  } catch {
    // ignore
  }
  return '';
}

function persistirUsuarioSesionInventario(u) {
  const s = String(u || '').trim();
  if (!s) return;
  try {
    sessionStorage.setItem(SS_USUARIO_INVENTARIO, s);
    sessionStorage.setItem('inventarios_usuario', s);
  } catch {
    // ignore
  }
}

function detectarUsuarioActivoAnalytics() {
  const desdeUrl = leerUsuarioDesdeQueryString();
  if (desdeUrl) {
    persistirUsuarioSesionInventario(desdeUrl);
    return desdeUrl;
  }
  try {
    const ss =
      sessionStorage.getItem(SS_USUARIO_INVENTARIO) || sessionStorage.getItem('inventarios_usuario');
    if (String(ss || '').trim()) return String(ss).trim();
  } catch {
    // ignore
  }
  try {
    const g = window.__COLBEEF_USER__ || window.__USUARIO_ACTIVO__;
    if (String(g || '').trim()) return String(g).trim();
  } catch {
    // ignore
  }
  const keys = [
    'usuario_activo',
    'inventarios_usuario',
    'inventarios.user',
    'auth_user',
    'username',
    'user',
  ];
  for (const k of keys) {
    try {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (String(v || '').trim()) return String(v).trim();
    } catch {
      // ignore
    }
  }
  return '';
}

/**
 * Actualiza usuario para analytics y operaciones (despachos) cuando llega después del arranque
 * (p. ej. postMessage desde la app Inventarios embebida o ventana padre).
 */
function aplicarUsuarioCaptadoInventario(u, origen = '') {
  const s = String(u || '').trim();
  if (!s) return;
  persistirUsuarioSesionInventario(s);
  try {
    window.__COLBEEF_USER__ = s;
  } catch {
    // ignore
  }
  if (_analyticsUsuarioActivo === s) return;
  _analyticsUsuarioActivo = s;
  enviarEventoAnalytics({
    eventName: 'usuario_contexto',
    viewName: _analyticsViewActual,
    meta: { usuario: s, origen: origen || 'desconocido' },
  });
}

function esOrigenPostMessageInventariosPermitido(origin) {
  const list = colbeefUiConfig?.inventariosPostMessageOrigins;
  if (Array.isArray(list) && list.length) {
    for (const entry of list) {
      try {
        if (new URL(String(entry).trim()).origin === origin) return true;
      } catch {
        // ignore
      }
    }
  }
  const links = colbeefUiConfig?.externalLinks;
  if (Array.isArray(links)) {
    for (const x of links) {
      if (!x?.url) continue;
      try {
        if (new URL(x.url).origin === origin) return true;
      } catch {
        // ignore
      }
    }
  }
  return false;
}

function initListenerUsuarioDesdeInventario() {
  if (typeof window !== 'undefined' && window.__colbeefInvMsgInit) return;
  if (typeof window !== 'undefined') window.__colbeefInvMsgInit = true;
  window.addEventListener('message', (ev) => {
    if (!esOrigenPostMessageInventariosPermitido(ev.origin)) return;
    const d = ev.data;
    let u = '';
    if (d && typeof d === 'object') {
      u =
        d.usuario ||
        d.user ||
        d.username ||
        d.colbeefUsuario ||
        d.login ||
        (d.payload && (d.payload.usuario || d.payload.user)) ||
        '';
    } else if (typeof d === 'string' && /^usuario\s*[:=]/i.test(d)) {
      u = d.replace(/^usuario\s*[:=]\s*/i, '').trim();
    }
    u = String(u || '').trim();
    if (u) aplicarUsuarioCaptadoInventario(u, 'postMessage');
  });
}

function labelEventoAnalitica(e) {
  const map = {
    app_open: 'Apertura de aplicacion',
    app_close: 'Cierre de aplicacion',
    view_enter: 'Ingreso a vista',
    view_leave: 'Salida de vista',
    heartbeat: 'Actividad continua',
    historial_subtab: 'Cambio subvista historial',
    inventario_subtab: 'Cambio subvista inventario',
    usuario_contexto: 'Usuario identificado (Inventarios)',
    dashboard_open: 'Apertura dashboard privado',
    dashboard_refresh: 'Actualización dashboard',
    export_excel: 'Descarga Excel',
    export_pdf: 'Descarga PDF',
    export_html: 'Descarga HTML',
    print_report: 'Impresión reporte',
    print_labels_crudas: 'Impresión etiquetas crudas',
    historico_auditoria_cargar: 'Histórico de cambios (consulta)',
    reporte_librillos_cargar: 'Reporte de librillos (consulta)',
  };
  return map[e] || e || 'Sin evento';
}

function enviarEventoAnalytics(payload) {
  const body = JSON.stringify({
    sessionId: _analyticsSessionId || (_analyticsSessionId = obtenerSesionAnalytics()),
    userName: _analyticsUsuarioActivo || null,
    path: location.pathname,
    ...payload,
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const ok = navigator.sendBeacon(ANALYTICS_URL, blob);
      if (ok) return;
    }
  } catch {
    // fallback a fetch
  }

  void fetch(ANALYTICS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

function trackVista(nombre) {
  const now = Date.now();
  if (_analyticsViewActual) {
    enviarEventoAnalytics({
      eventName: 'view_leave',
      viewName: _analyticsViewActual,
      durationMs: Math.max(0, now - _analyticsViewAt),
    });
  }
  _analyticsViewActual = nombre || null;
  _analyticsViewAt = now;
  enviarEventoAnalytics({
    eventName: 'view_enter',
    viewName: _analyticsViewActual,
  });
}

function iniciarAnalyticsUso() {
  _analyticsSessionId = obtenerSesionAnalytics();
  _analyticsUsuarioActivo = detectarUsuarioActivoAnalytics();
  _analyticsStartedAt = Date.now();
  _analyticsViewAt = _analyticsStartedAt;
  enviarEventoAnalytics({
    eventName: 'app_open',
    meta: { ua: navigator.userAgent, lang: navigator.language, usuario: _analyticsUsuarioActivo || null },
  });

  if (_analyticsHeartbeat) clearInterval(_analyticsHeartbeat);
  _analyticsHeartbeat = setInterval(() => {
    if (document.hidden) return;
    enviarEventoAnalytics({
      eventName: 'heartbeat',
      viewName: _analyticsViewActual,
      durationMs: Math.max(0, Date.now() - _analyticsStartedAt),
    });
  }, ANALYTICS_HEARTBEAT_MS);

  const vistaActiva = document.querySelector('.vista.active')?.id || '';
  const nombreVista = vistaActiva.startsWith('vista-') ? vistaActiva.slice(6) : null;
  if (nombreVista) trackVista(nombreVista);
}

function cerrarAnalyticsUso() {
  const now = Date.now();
  if (_analyticsViewActual) {
    enviarEventoAnalytics({
      eventName: 'view_leave',
      viewName: _analyticsViewActual,
      durationMs: Math.max(0, now - _analyticsViewAt),
    });
  }
  enviarEventoAnalytics({
    eventName: 'app_close',
    durationMs: Math.max(0, now - _analyticsStartedAt),
    viewName: _analyticsViewActual,
  });
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('es-CO');
}

function fmtMin(v) {
  const n = Number(v || 0);
  return `${n.toFixed(1)} min`;
}

function fmtFechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleString('es-CO');
}

function renderAnalyticsDashboardHtml(data, ctx = {}) {
  const k = data?.kpi || {};
  const vistas = Array.isArray(data?.vistasTop) ? data.vistasTop : [];
  const eventos = Array.isArray(data?.eventosTop) ? data.eventosTop : [];
  const usuariosTop = Array.isArray(data?.usuariosTop) ? data.usuariosTop : [];
  const det = data?.detalle || {};
  const eventosDia = Array.isArray(det.eventosPorDia) ? det.eventosPorDia : [];
  const vistasTiempo = Array.isArray(det.vistasTiempoMin) ? det.vistasTiempoMin : [];
  const sesionesRecientes = Array.isArray(det.sesionesRecientes) ? det.sesionesRecientes : [];
  const eventosRecientes = Array.isArray(det.eventosRecientes) ? det.eventosRecientes : [];
  const storage = data?.almacenamiento || 'desconocido';
  const desde = ctx.desde || '';
  const hasta = ctx.hasta || '';
  const backUrl = ctx.backUrl || '/';
  const cambios = Array.isArray(ctx.cambios) ? ctx.cambios : [];

  const rowsVistas = vistas.length
    ? vistas
        .map((r) => `<tr><td>${escapeHtml(r.vista || '')}</td><td style="text-align:right">${fmtNum(r.total)}</td></tr>`)
        .join('')
    : '<tr><td colspan="2" style="opacity:.72">Sin datos todavía</td></tr>';
  const rowsEventos = eventos.length
    ? eventos
        .map(
          (r) =>
            `<tr><td title="${escapeHtml(String(r.evento || ''))}">${escapeHtml(
              labelEventoAnalitica(r.evento || '')
            )}</td><td style="text-align:right">${fmtNum(r.total)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="2" style="opacity:.72">Sin datos todavía</td></tr>';
  const rowsUsuariosTop = usuariosTop.length
    ? usuariosTop
        .map((r) => `<tr><td>${escapeHtml(r.usuario || '(sin usuario)')}</td><td style="text-align:right">${fmtNum(r.total)}</td></tr>`)
        .join('')
    : '<tr><td colspan="2" style="opacity:.72">Sin usuarios identificados</td></tr>';
  const topVista = vistas.length ? String(vistas[0]?.vista || '—') : '—';
  const totalEvtUsuarios = usuariosTop.reduce((acc, r) => acc + Number(r?.total || 0), 0);
  const sinUsuarioEvt = usuariosTop
    .filter((r) => String(r?.usuario || '').trim().toLowerCase() === '(sin usuario)')
    .reduce((acc, r) => acc + Number(r?.total || 0), 0);
  const pctIdentificados = totalEvtUsuarios > 0
    ? Math.max(0, Math.min(100, ((totalEvtUsuarios - sinUsuarioEvt) / totalEvtUsuarios) * 100))
    : 0;
  const topEventoLabel = eventos.length ? labelEventoAnalitica(eventos[0]?.evento || '—') : '—';
  const topEventoTotal = eventos.length ? Number(eventos[0]?.total || 0) : 0;
  const topVistaTotal = vistas.length ? Number(vistas[0]?.total || 0) : 0;
  const donutIdentSvg = (() => {
    const size = 120;
    const r = 42;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, Number(pctIdentificados || 0)));
    const dash = (p / 100) * c;
    const rest = c - dash;
    return `<svg viewBox="0 0 ${size} ${size}" width="120" height="120" aria-label="Eventos con usuario">
      <g transform="translate(${size / 2}, ${size / 2}) rotate(-90)">
        <circle r="${r}" fill="none" stroke="#e7ece7" stroke-width="12"></circle>
        <circle r="${r}" fill="none" stroke="#1a7a42" stroke-width="12" stroke-linecap="round"
          stroke-dasharray="${dash.toFixed(2)} ${rest.toFixed(2)}"></circle>
      </g>
      <text x="50%" y="49%" text-anchor="middle" dominant-baseline="middle" font-size="20" font-weight="800" fill="#1a7a42">${fmtNum(p)}%</text>
      <text x="50%" y="64%" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#566">identificado</text>
    </svg>`;
  })();
  const maxMinVista = Math.max(1, ...vistasTiempo.map((x) => Number(x.minutos || 0)));
  const rowsVistasTiempo = vistasTiempo.length
    ? vistasTiempo
        .map((r) => {
          const m = Number(r.minutos || 0);
          const p = Math.max(2, Math.round((m / maxMinVista) * 100));
          return `<tr>
            <td>${escapeHtml(r.vista || '')}</td>
            <td style="width:42%">
              <div style="height:8px;background:#eef2ee;border-radius:10px;overflow:hidden">
                <div style="height:8px;width:${p}%;background:#1a7a42"></div>
              </div>
            </td>
            <td style="text-align:right;white-space:nowrap">${fmtMin(m)}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="3" style="opacity:.72">Sin tiempos acumulados</td></tr>';
  const rowsDia = eventosDia.length
    ? eventosDia
        .map((r) => {
          return `<tr>
            <td>${escapeHtml(r.fecha || '')}</td>
            <td style="text-align:right">${fmtNum(r.totalEventos)}</td>
            <td style="text-align:right">${fmtNum(r.sesiones)}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="3" style="opacity:.72">Sin datos por día</td></tr>';
  const maxEventosDia = Math.max(1, ...eventosDia.map((x) => Number(x.totalEventos || 0)));
  const rowBarsDia = eventosDia.length
    ? eventosDia
        .map((r) => {
          const n = Number(r.totalEventos || 0);
          const p = Math.max(2, Math.round((n / maxEventosDia) * 100));
          return `<tr>
            <td>${escapeHtml(r.fecha || '')}</td>
            <td style="width:50%">
              <div style="height:8px;background:#eef2ee;border-radius:10px;overflow:hidden">
                <div style="height:8px;width:${p}%;background:#3d8bfd"></div>
              </div>
            </td>
            <td style="text-align:right">${fmtNum(n)}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="3" style="opacity:.72">Sin datos por día</td></tr>';
  const rowsSesiones = sesionesRecientes.length
    ? sesionesRecientes
        .map((r) => {
          const sid = String(r.sessionId || '');
          const sidShort = sid.length > 18 ? `${sid.slice(0, 9)}…${sid.slice(-6)}` : sid;
          return `<tr>
            <td title="${escapeHtml(sid)}">${escapeHtml(sidShort)}</td>
            <td>${escapeHtml(r.usuario || '(sin usuario)')}</td>
            <td>${escapeHtml(r.ultimaVista || '—')}</td>
            <td style="text-align:right">${fmtNum(r.totalEventos)}</td>
            <td style="text-align:right">${fmtMin(r.duracionMin)}</td>
            <td style="white-space:nowrap">${escapeHtml(fmtFechaHora(r.fin))}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" style="opacity:.72">Sin sesiones recientes</td></tr>';
  const rowsEventosRec = eventosRecientes.length
    ? eventosRecientes
        .map((r) => {
          const sid = String(r.sesion || '');
          const sidShort = sid.length > 14 ? `${sid.slice(0, 7)}…${sid.slice(-4)}` : sid;
          return `<tr>
            <td style="white-space:nowrap">${escapeHtml(fmtFechaHora(r.tiempo))}</td>
            <td title="${escapeHtml(String(r.evento || ''))}">${escapeHtml(labelEventoAnalitica(r.evento || ''))}</td>
            <td>${escapeHtml(r.vista || '—')}</td>
            <td>${escapeHtml(r.usuario || '(sin usuario)')}</td>
            <td title="${escapeHtml(sid)}">${escapeHtml(sidShort || '—')}</td>
            <td style="text-align:right">${r.duracionMs ? fmtNum(r.duracionMs) : '—'}</td>
            <td>${escapeHtml(r.path || '—')}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" style="opacity:.72">Sin eventos recientes</td></tr>';
  const descargasPorUsuario = new Map();
  (eventosRecientes || []).forEach((r) => {
    const ev = String(r?.evento || '');
    if (!['export_excel', 'export_pdf', 'export_html', 'print_report', 'print_labels_crudas'].includes(ev)) return;
    const u = String(r?.usuario || '(sin usuario)').trim() || '(sin usuario)';
    if (!descargasPorUsuario.has(u)) {
      descargasPorUsuario.set(u, { usuario: u, descargas: 0, impresiones: 0 });
    }
    const item = descargasPorUsuario.get(u);
    if (ev.startsWith('export_')) item.descargas += 1;
    else item.impresiones += 1;
  });
  const rowsActividadSalida = [...descargasPorUsuario.values()]
    .sort((a, b) => (b.descargas + b.impresiones) - (a.descargas + a.impresiones))
    .slice(0, 12)
    .map((x) => `<tr><td>${escapeHtml(x.usuario)}</td><td style="text-align:right">${fmtNum(x.descargas)}</td><td style="text-align:right">${fmtNum(x.impresiones)}</td><td style="text-align:right">${fmtNum(x.descargas + x.impresiones)}</td></tr>`)
    .join('') || '<tr><td colspan="4" style="opacity:.72">Sin descargas/impresiones en el rango</td></tr>';
  const statsUsuario = new Map();
  const eventoEsEntrega = new Set(['export_excel', 'export_pdf', 'export_html', 'print_report', 'print_labels_crudas']);
  (eventosRecientes || []).forEach((r) => {
    const usuario = String(r?.usuario || '(sin usuario)').trim() || '(sin usuario)';
    const ev = String(r?.evento || '').trim();
    if (!statsUsuario.has(usuario)) {
      statsUsuario.set(usuario, {
        usuario,
        eventos: 0,
        entregas: 0,
        reintentos: 0,
        heartbeat: 0,
        ultimaVista: '—',
        ultimaAccion: null,
      });
    }
    const s = statsUsuario.get(usuario);
    s.eventos += 1;
    if (eventoEsEntrega.has(ev)) s.entregas += 1;
    if (ev === 'heartbeat') s.heartbeat += 1;
    if ((ev === 'print_labels_crudas' || ev === 'print_report') && Number(r?.duracionMs || 0) < 1200) s.reintentos += 1;
    if (r?.vista) s.ultimaVista = String(r.vista);
    if (r?.tiempo && (!s.ultimaAccion || String(r.tiempo) > String(s.ultimaAccion))) s.ultimaAccion = r.tiempo;
  });
  const radarUsers = [...statsUsuario.values()]
    .map((s) => {
      const friccion = s.reintentos + (s.heartbeat > Math.max(6, s.eventos * 0.55) ? 1 : 0);
      const score = Math.max(0, (s.entregas * 6) + (s.eventos * 0.6) - (friccion * 4));
      const conversion = s.eventos > 0 ? (s.entregas / s.eventos) * 100 : 0;
      return { ...s, score, friccion, conversion };
    })
    .sort((a, b) => b.score - a.score);
  const rowsRadarScore = radarUsers.slice(0, 12)
    .map((u, idx) => `<tr>
      <td style="text-align:right">${idx + 1}</td>
      <td>${escapeHtml(u.usuario)}</td>
      <td style="text-align:right">${fmtNum(Math.round(u.score))}</td>
      <td style="text-align:right">${fmtNum(u.entregas)}</td>
      <td style="text-align:right">${fmtNum(Number(u.conversion.toFixed(1)))}%</td>
      <td style="white-space:nowrap">${escapeHtml(fmtFechaHora(u.ultimaAccion))}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="opacity:.72">Sin actividad por usuario en el rango</td></tr>';
  const rowsFriccion = radarUsers.slice(0, 12)
    .sort((a, b) => b.friccion - a.friccion)
    .map((u) => `<tr>
      <td>${escapeHtml(u.usuario)}</td>
      <td style="text-align:right">${fmtNum(u.friccion)}</td>
      <td style="text-align:right">${fmtNum(u.reintentos)}</td>
      <td style="text-align:right">${fmtNum(u.heartbeat)}</td>
      <td>${escapeHtml(u.ultimaVista || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="opacity:.72">Sin señales de fricción en el rango</td></tr>';
  const timelineRows = [...(eventosRecientes || [])]
    .filter((r) => ['view_enter', 'export_excel', 'export_pdf', 'export_html', 'print_report', 'print_labels_crudas', 'inventario_subtab', 'historial_subtab'].includes(String(r?.evento || '')))
    .slice(0, 60)
    .map((r) => `<tr>
      <td style="white-space:nowrap">${escapeHtml(fmtFechaHora(r.tiempo))}</td>
      <td>${escapeHtml(r.usuario || '(sin usuario)')}</td>
      <td>${escapeHtml(labelEventoAnalitica(r.evento || ''))}</td>
      <td>${escapeHtml(r.vista || '—')}</td>
      <td>${escapeHtml(r.path || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="opacity:.72">Sin actividad reciente filtrada</td></tr>';
  const detectarTipoCambio = (c) => {
    const acc = String(c?.accion || '').toLowerCase();
    const tieneAntes = !!(c?.antes && typeof c.antes === 'object' && Object.keys(c.antes).length);
    const tieneDespues = !!(c?.despues && typeof c.despues === 'object' && Object.keys(c.despues).length);
    if (acc.includes('insert') || acc.includes('crear') || acc.includes('nuevo')) return 'creado';
    if (acc.includes('update') || acc.includes('actualiz') || acc.includes('editar') || acc.includes('modific')) return 'modificado';
    if (!tieneAntes && tieneDespues) return 'creado';
    if (tieneAntes && tieneDespues) return 'modificado';
    return 'modificado';
  };
  const camposCambiados = (c) => {
    const a = c?.antes && typeof c.antes === 'object' ? c.antes : {};
    const d = c?.despues && typeof c.despues === 'object' ? c.despues : {};
    const keys = new Set([...Object.keys(a), ...Object.keys(d)]);
    const changed = [];
    keys.forEach((k) => {
      const va = a?.[k];
      const vd = d?.[k];
      if (JSON.stringify(va ?? null) !== JSON.stringify(vd ?? null)) changed.push(k);
    });
    return changed;
  };
  const fechaDia = (iso) => {
    const d = new Date(iso || 0);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleDateString('es-CO');
  };
  const cambiosTipados = (cambios || []).map((c) => ({
    ...c,
    _tipo: detectarTipoCambio(c),
    _campos: camposCambiados(c),
    _dia: fechaDia(c?.fecha),
  }));
  const resumenPorFechaMap = new Map();
  cambiosTipados.forEach((c) => {
    const dia = String(c._dia || '—');
    if (!resumenPorFechaMap.has(dia)) resumenPorFechaMap.set(dia, { dia, creados: 0, modificados: 0 });
    const r = resumenPorFechaMap.get(dia);
    if (c._tipo === 'creado') r.creados += 1;
    else r.modificados += 1;
  });
  const rowsResumenFecha = [...resumenPorFechaMap.values()]
    .sort((a, b) => {
      const da = Date.parse(String(a.dia).split('/').reverse().join('-') || 0);
      const db = Date.parse(String(b.dia).split('/').reverse().join('-') || 0);
      return db - da;
    })
    .map((r) => `<tr><td>${escapeHtml(r.dia)}</td><td style="text-align:right">${fmtNum(r.creados)}</td><td style="text-align:right">${fmtNum(r.modificados)}</td><td style="text-align:right">${fmtNum(r.creados + r.modificados)}</td></tr>`)
    .join('') || '<tr><td colspan="4" style="opacity:.72">Sin histórico en el rango</td></tr>';
  const renderRowsCambios = (tipo) => {
    const rows = cambiosTipados.filter((c) => {
      if (c._tipo !== tipo) return false;
      const antesObs = String(c?.antes?.observacion ?? '').replace(/\s+/g, ' ').trim();
      const despuesObs = String(c?.despues?.observacion ?? '').replace(/\s+/g, ' ').trim();
      return antesObs !== despuesObs;
    });
    if (!rows.length) return `<tr><td colspan="6" style="opacity:.72">Sin cambios reales de observación en el rango</td></tr>`;
    return rows.map((c) => {
      const a = c?.antes || {};
      const d = c?.despues || {};
      const idProducto = String(d?.id_producto ?? a?.id_producto ?? c?.idEntidad ?? '—');
      const antesObs = String(a?.observacion ?? '').trim() || '—';
      const despuesObs = String(d?.observacion ?? '').trim() || '—';
      const usernameBd = String(d?.username_bd || a?.username_bd || c.usuario || '(sin username_bd)');
      return `<tr>
        <td style="white-space:nowrap">${escapeHtml(fmtFechaHora(c.fecha))}</td>
        <td>${escapeHtml(idProducto)}</td>
        <td title="${escapeHtml(antesObs)}">${escapeHtml(antesObs.slice(0, 120))}</td>
        <td title="${escapeHtml(despuesObs)}">${escapeHtml(despuesObs.slice(0, 120))}</td>
        <td>${escapeHtml(usernameBd)}</td>
        <td>${escapeHtml(c._dia)}</td>
      </tr>`;
    }).join('');
  };
  const rowsCambiosCreados = renderRowsCambios('creado');
  const rowsCambiosModificados = renderRowsCambios('modificado');

  const grafLineEventosDia = (() => {
    const pts = eventosDia.slice(-14);
    const w = 520;
    const h = 170;
    const padL = 32;
    const padR = 8;
    const padT = 10;
    const padB = 22;
    if (!pts.length) return `<div style="padding:12px;color:#6f7e6f">Sin datos para graficar.</div>`;
    const maxY = Math.max(1, ...pts.map((p) => Number(p.totalEventos || 0)));
    const spanX = Math.max(1, pts.length - 1);
    const points = pts
      .map((p, i) => {
        const x = padL + ((w - padL - padR) * i) / spanX;
        const y = h - padB - ((h - padT - padB) * Number(p.totalEventos || 0)) / maxY;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const labels = pts
      .map((p, i) => {
        if (i !== 0 && i !== pts.length - 1 && i % 3 !== 0) return '';
        const x = padL + ((w - padL - padR) * i) / spanX;
        const fecha = String(p.fecha || '');
        return `<text x="${x.toFixed(1)}" y="${h - 5}" text-anchor="middle" font-size="10" fill="#556">${escapeHtml(fecha.slice(5))}</text>`;
      })
      .join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="170" role="img" aria-label="Eventos por dia">
      <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="#d7e0d7" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" stroke="#d7e0d7" />
      <polyline fill="none" stroke="#1a7a42" stroke-width="2.5" points="${points}" />
      ${labels}
      <text x="${padL - 4}" y="${padT + 4}" text-anchor="end" font-size="10" fill="#556">${fmtNum(maxY)}</text>
      <text x="${padL - 4}" y="${h - padB + 4}" text-anchor="end" font-size="10" fill="#556">0</text>
    </svg>`;
  })();

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Analitica privada · Colbeef</title>
  <style>
    :root{
      --bg:#f2f5f2;
      --card:#ffffff;
      --line:#dbe5db;
      --ink:#182018;
      --muted:#5b6b5b;
      --brand:#1a7a42;
      --brand-soft:#edf7f1;
    }
    body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:linear-gradient(180deg,#f6f8f6 0%,#f0f3f0 100%);color:var(--ink)}
    .wrap{max-width:1180px;margin:0 auto;padding:16px}
    .head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
    .ttl{font-size:24px;font-weight:900;color:var(--brand);letter-spacing:.2px}
    .sub{font-size:12px;color:var(--muted)}
    .filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    input,button{height:34px;border-radius:10px;border:1px solid #cfd8cf;padding:0 10px}
    button{cursor:pointer;background:#fff;font-weight:700;transition:all .18s ease}
    button:hover{transform:translateY(-1px);box-shadow:0 4px 10px rgba(0,0,0,.10)}
    button.primary{background:var(--brand);color:#fff;border-color:#166637}
    #a-back{
      background:linear-gradient(135deg,#ff6a00 0%,#ff3d00 100%);
      color:#fff;border-color:#c03200;
      box-shadow:0 6px 14px rgba(255,86,34,.25);
      animation:pulseBack 1.7s ease-in-out infinite;
    }
    #a-back:hover{box-shadow:0 8px 16px rgba(255,86,34,.35)}
    @keyframes pulseBack{
      0%,100%{transform:translateY(0)}
      50%{transform:translateY(-1px) scale(1.01)}
    }
    .grid{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:10px;margin:12px 0 16px}
    .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;box-shadow:0 2px 6px rgba(20,40,20,.04)}
    .kpi .l{font-size:11px;color:#667766;text-transform:uppercase}
    .kpi .n{font-size:27px;font-weight:900;color:#c0392b;margin-top:4px;line-height:1}
    .kpi .h{margin-top:6px;font-size:11px;color:#4f604f}
    .panels{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .p{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(20,40,20,.04)}
    .ph{padding:10px 12px;background:var(--brand-soft);font-weight:800;color:#1f3525}
    table{width:100%;border-collapse:collapse}
    td,th{padding:8px 10px;border-top:1px solid #ecf0ec;font-size:13px}
    th{text-align:left;background:#f7faf7}
    .scroll-y{max-height:280px;overflow:auto}
    .mono{font-family:Consolas,Monaco,monospace;font-size:12px}
    .foot{margin-top:10px;font-size:11px;color:#6f7e6f}
    .chart-wrap{padding:10px 12px}
    .hero{display:grid;grid-template-columns:1fr 280px;gap:12px;margin-top:8px}
    .insight{padding:12px;border:1px solid var(--line);border-radius:12px;background:#fff}
    .insight .t{font-size:12px;color:#5d6e5d;text-transform:uppercase;font-weight:700}
    .insight .v{font-size:18px;color:#143a23;font-weight:800;margin-top:2px}
    .insight .mut{font-size:12px;color:#5d6e5d;margin-top:6px}
    .donut-card{display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:12px;background:#fff}
    .tag-new{display:inline-block;background:#1a7a42;color:#fff;border-radius:999px;padding:2px 8px;font-size:11px;margin-left:6px}
    @media (max-width:960px){.grid{grid-template-columns:1fr 1fr}.panels,.hero{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <div class="ttl">Dashboard de usabilidad (privado)</div>
        <div class="sub">Almacenamiento: <strong>${escapeHtml(storage)}</strong> · Actualizado: ${escapeHtml(
          new Date().toLocaleString('es-CO')
        )}</div>
        <div class="sub">Usuario detectado en esta sesion: <strong>${escapeHtml(_analyticsUsuarioActivo || '(sin usuario)')}</strong></div>
      </div>
      <div class="filters">
        <button id="a-back" title="Volver al programa" data-back="${escapeHtml(backUrl)}">Volver al programa</button>
        <label>Desde</label>
        <input id="a-desde" type="date" value="${escapeHtml(desde)}" />
        <label>Hasta</label>
        <input id="a-hasta" type="date" value="${escapeHtml(hasta)}" />
        <button class="primary" id="a-refresh">Actualizar</button>
        <button id="a-key">Cambiar clave</button>
        <button type="button" id="a-dash-lib" title="Tablero gerencial librillos (nueva pestaña)">Tablero librillos (gerencia) ↗</button>
      </div>
    </div>

    <div class="hero">
      <div class="insight">
        <div class="t">Lectura rápida</div>
        <div class="v">Vista top: ${escapeHtml(topVista)} (${fmtNum(topVistaTotal)} ingresos)</div>
        <div class="mut">Evento dominante: <strong>${escapeHtml(topEventoLabel)}</strong> (${fmtNum(topEventoTotal)}). Rango aplicado: ${escapeHtml(desde || 'inicio')} a ${escapeHtml(hasta || 'hoy')}.</div>
      </div>
      <div class="donut-card">${donutIdentSvg}</div>
    </div>

    <div class="grid">
      <div class="kpi"><div class="l">Total eventos</div><div class="n">${fmtNum(k.totalEventos)}</div><div class="h">Base total de interacciones</div></div>
      <div class="kpi"><div class="l">Sesiones únicas</div><div class="n">${fmtNum(k.sesionesUnicas)}</div><div class="h">Navegadores/sesiones distintas</div></div>
      <div class="kpi"><div class="l">Activos 24h</div><div class="n">${fmtNum(k.usuariosActivos24h)}</div><div class="h">Uso reciente</div></div>
      <div class="kpi"><div class="l">Duración promedio</div><div class="n">${fmtMin(k.duracionPromedioMin)}</div><div class="h">Por sesión</div></div>
      <div class="kpi"><div class="l">Vista más usada</div><div class="n" style="font-size:18px;color:#1f5f3b">${escapeHtml(topVista)}</div><div class="h">${fmtNum(topVistaTotal)} entradas</div></div>
      <div class="kpi"><div class="l">% con usuario</div><div class="n" style="color:#1f5f3b">${fmtNum(pctIdentificados)}%</div><div class="h">${fmtNum(totalEvtUsuarios - sinUsuarioEvt)} identificados</div></div>
    </div>

    <div class="p" style="margin:8px 0 12px">
      <div class="ph">Radar operativo por usuario <span class="tag-new">NUEVO</span></div>
      <div class="panels" style="padding:10px">
        <div class="p">
          <div class="ph">Ranking de operadores (score)</div>
          <table><thead><tr><th>#</th><th>Usuario</th><th style="text-align:right">Score</th><th style="text-align:right">Entregas</th><th style="text-align:right">Conversión</th><th>Última acción</th></tr></thead><tbody>${rowsRadarScore}</tbody></table>
        </div>
        <div class="p">
          <div class="ph">Riesgo / fricción por usuario</div>
          <table><thead><tr><th>Usuario</th><th style="text-align:right">Fricción</th><th style="text-align:right">Reintentos</th><th style="text-align:right">Heartbeat</th><th>Última vista</th></tr></thead><tbody>${rowsFriccion}</tbody></table>
        </div>
      </div>
      <div class="p" style="margin:10px">
        <div class="ph">Línea de tiempo reciente (quién hizo qué)</div>
        <div class="scroll-y" style="max-height:220px">
          <table><thead><tr><th>Fecha/hora</th><th>Usuario</th><th>Acción</th><th>Vista</th><th>Ruta</th></tr></thead><tbody class="mono">${timelineRows}</tbody></table>
        </div>
      </div>
    </div>

    <div class="panels">
      <div class="p">
        <div class="ph">Tendencia de eventos (ultimos 14 dias)</div>
        <div class="chart-wrap">${grafLineEventosDia}</div>
      </div>
      <div class="p">
        <div class="ph">Top vistas</div>
        <table><thead><tr><th>Vista</th><th style="text-align:right">Total</th></tr></thead><tbody>${rowsVistas}</tbody></table>
      </div>
      <div class="p">
        <div class="ph">Top eventos</div>
        <table><thead><tr><th>Evento</th><th style="text-align:right">Total</th></tr></thead><tbody>${rowsEventos}</tbody></table>
      </div>
    </div>

    <div class="panels" style="margin-top:12px">
      <div class="p">
        <div class="ph">Top usuarios detectados</div>
        <table><thead><tr><th>Usuario</th><th style="text-align:right">Eventos</th></tr></thead><tbody>${rowsUsuariosTop}</tbody></table>
      </div>
      <div class="p">
        <div class="ph">Actividad de salida por usuario</div>
        <table><thead><tr><th>Usuario</th><th style="text-align:right">Descargas</th><th style="text-align:right">Impresiones</th><th style="text-align:right">Total</th></tr></thead><tbody>${rowsActividadSalida}</tbody></table>
      </div>
      <div class="p">
        <div class="ph">Actividad por día</div>
        <table><thead><tr><th>Fecha</th><th style="text-align:right">Eventos</th><th style="text-align:right">Sesiones</th></tr></thead><tbody>${rowsDia}</tbody></table>
      </div>
      <div class="p">
        <div class="ph">Eventos por día (barras)</div>
        <table><thead><tr><th>Fecha</th><th></th><th style="text-align:right">Eventos</th></tr></thead><tbody>${rowBarsDia}</tbody></table>
      </div>
    </div>

    <div class="p" style="margin-top:12px">
      <div class="ph">Histórico planillaje por fecha (resumen)</div>
      <div class="scroll-y" style="max-height:190px">
        <table>
          <thead><tr><th>Fecha</th><th style="text-align:right">Creados</th><th style="text-align:right">Modificados</th><th style="text-align:right">Total</th></tr></thead>
          <tbody class="mono">${rowsResumenFecha}</tbody>
        </table>
      </div>
    </div>

    <div class="panels" style="margin-top:12px">
      <div class="p">
        <div class="ph">Registros creados</div>
        <div class="scroll-y" style="max-height:230px">
          <table>
            <thead><tr><th>Fecha/hora</th><th>ID producto</th><th>Observación antes</th><th>Observación ahora</th><th>Usuario</th><th>Día</th></tr></thead>
            <tbody class="mono">${rowsCambiosCreados}</tbody>
          </table>
        </div>
      </div>
      <div class="p">
        <div class="ph">Registros modificados</div>
        <div class="scroll-y" style="max-height:230px">
          <table>
            <thead><tr><th>Fecha/hora</th><th>ID producto</th><th>Observación antes</th><th>Observación ahora</th><th>Usuario</th><th>Día</th></tr></thead>
            <tbody class="mono">${rowsCambiosModificados}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panels" style="margin-top:12px">
      <div class="p">
        <div class="ph">Tiempo acumulado por vista</div>
        <table><thead><tr><th>Vista</th><th></th><th style="text-align:right">Tiempo</th></tr></thead><tbody>${rowsVistasTiempo}</tbody></table>
      </div>
      <div class="p">
        <div class="ph">Interpretacion rapida</div>
        <div style="padding:12px 14px;font-size:13px;line-height:1.45;color:#304230">
          Si un evento aparece como <strong>(sin usuario)</strong>, el sistema Inventarios no envio el usuario al abrir Control Librillos.
          Recomendado: abrir esta app con URL tipo <code>?usuario=nombre.login</code>.
        </div>
      </div>
    </div>

    <div class="panels" style="margin-top:12px">
      <div class="p">
        <div class="ph">Sesiones recientes (top 20)</div>
        <div class="scroll-y">
          <table>
            <thead><tr><th>Sesion</th><th>Usuario</th><th>Ultima vista</th><th style="text-align:right">Eventos</th><th style="text-align:right">Duracion</th><th>Ultimo evento</th></tr></thead>
            <tbody class="mono">${rowsSesiones}</tbody>
          </table>
        </div>
      </div>
      <div class="p">
        <div class="ph">Eventos recientes (top 80)</div>
        <div class="scroll-y">
          <table>
            <thead><tr><th>Tiempo</th><th>Evento</th><th>Vista</th><th>Usuario</th><th>Sesion</th><th style="text-align:right">ms</th><th>Path</th></tr></thead>
            <tbody class="mono">${rowsEventosRec}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="foot">Tip: este panel se abre solo desde el boton oculto (Shift + clic).</div>
  </div>
</body>
</html>`;
}

async function fetchAnalyticsResumenPrivado(key, desde = '', hasta = '') {
  const q = new URLSearchParams();
  if (desde) q.set('desde', desde);
  if (hasta) q.set('hasta', hasta);
  const [resAnalitica, resCambios] = await Promise.all([
    fetch(`${ANALYTICS_RESUMEN_ADMIN_URL}?${q.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-analytics-key': key },
    }),
    fetch(`${AUDITORIA_CAMBIOS_URL}?${q.toString()}&modulo=planillaje&limit=160`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-analytics-key': key },
    }),
  ]);
  const payloadAnalitica = await resAnalitica.json().catch(() => ({}));
  const payloadCambios = await resCambios.json().catch(() => ({}));
  if (!resAnalitica.ok) throw new Error(payloadAnalitica?.error || `HTTP ${resAnalitica.status}`);
  if (!resCambios.ok) throw new Error(payloadCambios?.error || `HTTP ${resCambios.status}`);
  return {
    analitica: payloadAnalitica,
    cambios: Array.isArray(payloadCambios?.items) ? payloadCambios.items : [],
  };
}

async function abrirDashboardAnaliticaPrivado(key, desde = '', hasta = '') {
  const doc = window.document;
  const backUrl = `${window.location.pathname}${window.location.search}`;
  doc.open();
  doc.write('<!doctype html><html><body style="font-family:Arial;padding:16px">Cargando dashboard...</body></html>');
  doc.close();

  const render = async (nextDesde = desde, nextHasta = hasta) => {
    const data = await fetchAnalyticsResumenPrivado(key, nextDesde, nextHasta);
    doc.open();
    doc.write(
      renderAnalyticsDashboardHtml(data.analitica, {
        desde: nextDesde,
        hasta: nextHasta,
        cambios: data.cambios,
        backUrl,
      })
    );
    doc.close();

    const btnBack = doc.getElementById('a-back');
    const btnRefresh = doc.getElementById('a-refresh');
    const btnKey = doc.getElementById('a-key');
    btnBack?.addEventListener('click', () => {
      window.location.href = backUrl;
    });
    btnRefresh?.addEventListener('click', () => {
      const d = String(doc.getElementById('a-desde')?.value || '');
      const h = String(doc.getElementById('a-hasta')?.value || '');
      enviarEventoAnalytics({
        eventName: 'dashboard_refresh',
        viewName: 'dashboard_privado',
        meta: { desde: d || null, hasta: h || null },
      });
      void render(d, h);
    });
    btnKey?.addEventListener('click', async () => {
      const nk = await promptClaveOcultaAnalitica({
        title: 'Cambiar clave analítica',
        message: 'Ingresa la nueva clave del dashboard privado.',
        initialValue: '',
        confirmText: 'Guardar',
      });
      if (!nk) return;
      key = nk;
      try {
        localStorage.setItem(LS_ANALYTICS_ADMIN_KEY, nk);
      } catch {
        // ignore
      }
      void render(
        String(doc.getElementById('a-desde')?.value || ''),
        String(doc.getElementById('a-hasta')?.value || '')
      );
    });
    const btnDashLib = doc.getElementById('a-dash-lib');
    btnDashLib?.addEventListener('click', () => {
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const dash = new URL('dashboard-ejecutivo-librillos.html', window.location.href);
      dash.searchParams.set('fecha', hoy);
      window.open(dash.href, '_blank', 'noopener,noreferrer');
    });
  };

  try {
    await render(desde, hasta);
  } catch (e) {
    doc.open();
    doc.write(
      `<html><body style="font-family:Arial;padding:16px;color:#b00020">No se pudo cargar dashboard: ${escapeHtml(
        String(e?.message || e)
      )}<div style="margin-top:12px"><button onclick="location.href='${escapeHtml(backUrl)}'">Volver al programa</button></div></body></html>`
    );
    doc.close();
  }
}

async function promptClaveOcultaAnalitica(opts = {}) {
  const title = String(opts.title || 'Clave de analitica (solo admin)');
  const message = String(opts.message || 'Ingresa la clave para continuar.');
  const initialValue = String(opts.initialValue || '');
  const confirmText = String(opts.confirmText || 'Entrar');
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(10,18,12,.52);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="width:min(420px,92vw);background:#fff;border-radius:14px;border:1px solid #d6e2d7;box-shadow:0 16px 40px rgba(0,0,0,.2);padding:16px">
        <div style="font-weight:900;color:#1a7a42;font-size:18px">${escapeHtml(title)}</div>
        <div style="margin-top:6px;color:#4e5f52;font-size:13px">${escapeHtml(message)}</div>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
          <input id="ana-pin-input" type="password" autocomplete="off" spellcheck="false"
                 style="flex:1;height:38px;border:1px solid #cfd8cf;border-radius:10px;padding:0 10px;font-size:14px"
                 value="${escapeHtml(initialValue)}" />
          <button id="ana-pin-toggle" type="button"
                  style="height:38px;border:1px solid #cfd8cf;border-radius:10px;padding:0 10px;background:#fff;cursor:pointer">Mostrar</button>
        </div>
        <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px">
          <button id="ana-pin-cancel" type="button"
                  style="height:34px;border:1px solid #cfd8cf;border-radius:10px;padding:0 12px;background:#fff;cursor:pointer">Cancelar</button>
          <button id="ana-pin-ok" type="button"
                  style="height:34px;border:1px solid #166637;border-radius:10px;padding:0 14px;background:#1a7a42;color:#fff;font-weight:700;cursor:pointer">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    const done = (val) => {
      overlay.remove();
      resolve(val);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done('');
    });
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#ana-pin-input');
    const btnOk = overlay.querySelector('#ana-pin-ok');
    const btnCancel = overlay.querySelector('#ana-pin-cancel');
    const btnToggle = overlay.querySelector('#ana-pin-toggle');
    input?.focus();
    input?.select();
    btnCancel?.addEventListener('click', () => done(''));
    btnOk?.addEventListener('click', () => done(String(input?.value || '').trim()));
    btnToggle?.addEventListener('click', () => {
      if (!input) return;
      const nextType = input.type === 'password' ? 'text' : 'password';
      input.type = nextType;
      btnToggle.textContent = nextType === 'password' ? 'Mostrar' : 'Ocultar';
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done('');
      if (e.key === 'Enter') done(String(input?.value || '').trim());
    });
  });
}

async function abrirAnaliticaOculta(ev) {
  if (!ev?.shiftKey) {
    mostrarToast('Atajo privado: usa Shift + clic.', 'warn');
    return;
  }
  // Siempre pedir PIN al abrir el dashboard privado.
  let keyGuardada = '';
  try {
    keyGuardada = localStorage.getItem(LS_ANALYTICS_ADMIN_KEY) || '';
  } catch {
    keyGuardada = '';
  }
  const key = await promptClaveOcultaAnalitica({
    title: 'Dashboard privado',
    message: 'Ingresa el PIN para acceder al dashboard de usabilidad.',
    initialValue: keyGuardada,
    confirmText: 'Entrar',
  });
  if (!key) return;
  enviarEventoAnalytics({
    eventName: 'dashboard_open',
    viewName: 'dashboard_privado',
    meta: { acceso: 'shift_click' },
  });
  void abrirDashboardAnaliticaPrivado(key);
}

// Sin login/roles: comportamiento único
const USUARIO_ACTUAL = 'usuario';
function usuarioOperacionActual() {
  return _analyticsUsuarioActivo || USUARIO_ACTUAL;
}

// ── DATOS ─────────────────────────────────────────────────────────────────────
let datosGlobal   = [];   // API: solo retiro librillos + crudas
let datosLibrillos = [];  // RETIRAR LIBRILLOS (historial librillos)
let datosCrudasHist = []; // observación solo CRUDAS/CRUDA
let datosClientes  = [];
let salidasRegistradas = [];
let fechaDatosGlobal = '';
const cacheRangoFront = new Map();
let cacheSalidasFront = { ts: 0, data: null };
const cacheResumenMacroFront = new Map();
const CACHE_FRONT_MS = 60000;
/** Evita repetir GET /universo-meta para la misma fecha en paralelo al listado/resumen (respuesta liviana pero suelta en grupo). */
const cacheMetaUniversoFront = new Map();
/** Caché más larga para rangos (reporte de librillos): evita repetir consultas pesadas al cambiar de vista. */
const CACHE_RANGO_DATOS_MS = 5 * 60 * 1000;
let inventarioSubtab = 'lib'; // 'lib' | 'crud'
let _autoInvSnapshot = '';
let _autoGlobalTimer = null;
let _cuadreDebounceT = null;
let _autoObsTimer = null;
let _visCatchupTimer = null;
let _autoObsSnapshot = '';
let _obsTextoMapPrev = new Map();
/** Plan faena vs insensibilización (GET /api/librillos/universo-meta). */
let metaUniversoTurno = null;
let _toastOnClick = null;
let historicoCambios = [];
let historicoCambiosFiltrados = [];
let historicoCrudasSeleccionadas = new Set();
/** Cancelación incremental: tablas principal y crudas usan contadores distintos (evita cruce al marcar checkboxes). */
let _histMainPaintGen = 0;
let _histCrudasPaintGen = 0;
let _histSearchDebounceT = null;
const HIST_RENDER_CHUNK = 110;
const HIST_RENDER_SYNC_MAX = 180;
let historialSoloPendientes = false;
const gruposHistorialColapsados = new Set();
let tablaCompacta = false;
let PLAZAS_ALIAS = { exact: {}, contains: {} };

/** Config resumen LISTA LIBRILLOS: modo cliente + overrides (clientes-resumen-config.json). */
const DEFAULT_CLIENTES_RESUMEN_CONFIG = {
  modoClienteResumen: 'auto',
  auto: {
    regexEmpresaEsUbicacion: [
      '(PLAZA|BUCARAMANGA|FLORIDABLANCA|PIEDECUESTA|MESA DE LOS SANTOS|GIRON|GUARIN|REAL DE MINAS|CAVA)',
      '^\\d{2}\\s+PLAZA\\b',
    ],
    empresaExactaUsaPropietario: ['COLBEEF S.A.S'],
  },
  clientePorIdProducto: {},
};

function mergeClienteResumenConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const b = DEFAULT_CLIENTES_RESUMEN_CONFIG;
  const modos = new Set(['auto', 'empresa_destino', 'propietario']);
  const modo = modos.has(r.modoClienteResumen) ? r.modoClienteResumen : b.modoClienteResumen;
  const autoIn = r.auto && typeof r.auto === 'object' ? r.auto : {};
  return {
    modoClienteResumen: modo,
    auto: {
      regexEmpresaEsUbicacion:
        Array.isArray(autoIn.regexEmpresaEsUbicacion) && autoIn.regexEmpresaEsUbicacion.length
          ? autoIn.regexEmpresaEsUbicacion.map(String)
          : [...b.auto.regexEmpresaEsUbicacion],
      empresaExactaUsaPropietario:
        Array.isArray(autoIn.empresaExactaUsaPropietario) && autoIn.empresaExactaUsaPropietario.length
          ? autoIn.empresaExactaUsaPropietario.map(String)
          : [...b.auto.empresaExactaUsaPropietario],
    },
    clientePorIdProducto:
      r.clientePorIdProducto && typeof r.clientePorIdProducto === 'object'
        ? { ...r.clientePorIdProducto }
        : { ...b.clientePorIdProducto },
  };
}

let CLIENTES_RESUMEN_CONFIG = mergeClienteResumenConfig({});

function empresaPareceUbicacionResumen(emp) {
  const e = String(emp || '');
  const patterns = CLIENTES_RESUMEN_CONFIG?.auto?.regexEmpresaEsUbicacion || [];
  for (const p of patterns) {
    try {
      if (new RegExp(p, 'i').test(e)) return true;
    } catch {
      /* regex inválido en JSON: ignorar */
    }
  }
  return false;
}

// ── NOTIFICACIONES (sonido) ────────────────────────────────────────────────────
let _audioUnlocked = false;
const LS_SONIDO = 'colbeef_sonido_notif';

function sonidoHabilitado() {
  const v = localStorage.getItem(LS_SONIDO);
  return v === null ? true : v === '1';
}
const SVG_CAMPANA_ON = `<svg class="ico-sound foot-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
</svg>`;

/** Campana + línea encima (notificaciones silenciadas). */
const SVG_CAMPANA_OFF = `<svg class="ico-sound ico-sound-muted foot-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="3" y1="4" x2="21" y2="4"/>
  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
</svg>`;

function renderBotonSonido() {
  const b = document.getElementById('btn-sound');
  if (!b) return;
  const on = sonidoHabilitado();
  b.classList.toggle('off', !on);
  const badge = on ? '<span class="foot-ico-badge" aria-hidden="true"></span>' : '';
  b.innerHTML = `<span class="foot-ico-wrap">${on ? SVG_CAMPANA_ON : SVG_CAMPANA_OFF}${badge}</span>`;
  b.title = on ? 'Silenciar notificaciones' : 'Activar sonido de notificaciones';
  b.setAttribute('aria-label', on ? 'Silenciar notificaciones' : 'Activar sonido de notificaciones');
}
function toggleSonidoNotificaciones() {
  const next = !sonidoHabilitado();
  localStorage.setItem(LS_SONIDO, next ? '1' : '0');
  renderBotonSonido();
  if (next) unlockAudio();
}
function unlockAudio() {
  if (_audioUnlocked) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.02);
    _audioUnlocked = true;
    ctx.close?.();
  } catch {
    // si el navegador bloquea audio, quedará solo toast
  }
}
function beepNotif() {
  if (!sonidoHabilitado()) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume?.();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    g.gain.value = 0.0001;

    // Alerta más notoria: 3 tonos, más volumen y ~1.2s total.
    const tonos = [
      { f: 880, dur: 0.28, gap: 0.08 },
      { f: 740, dur: 0.28, gap: 0.08 },
      { f: 990, dur: 0.34, gap: 0.00 },
    ];

    let t = ctx.currentTime;
    tonos.forEach(({ f, dur, gap }) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      o.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur + 0.01);
      t += dur + gap;
    });

    setTimeout(() => ctx.close?.(), 1700);
  } catch {
    // silencioso
  }
}

function actualizarColumnasRol() {
  ['th-acciones-inv', 'th-acciones-desp', 'th-acciones-desp-crud'].forEach(id => {
    const th = document.getElementById(id);
    if (th) th.style.display = 'table-cell';
  });
}

/** KPI del turno: plan faena vs insensibilizados (meta API) o fallback al listado. */
function actualizarKpiTurno() {
  const elPlan = document.getElementById('kpi-plan-total');
  const elCon = document.getElementById('kpi-con-parte');
  const elPend = document.getElementById('kpi-pend-parte');
  const wrap = document.getElementById('kpi-turno');
  if (!elPlan || !elCon || !elPend || !wrap) return;
  const meta = metaUniversoTurno;
  if (meta && Number(meta.total_plan_faena) > 0) {
    const nPlan = Number(meta.total_plan_faena) || 0;
    const nInsens = Number(meta.plan_con_insensibilizacion) || 0;
    const nSinInsens = Number(meta.plan_sin_insensibilizar) || 0;
    wrap.classList.remove('kpi-turno--empty');
    elPlan.textContent = String(nPlan);
    elCon.textContent = String(nInsens);
    elPend.textContent = String(nSinInsens);
    return;
  }
  const datos = Array.isArray(datosGlobal) ? datosGlobal : [];
  const nUniverso = datos.length;
  const nConParte = datos.filter((d) => d?.pendiente_registro_parte !== true).length;
  const nPendienteParte = datos.filter((d) => d?.pendiente_registro_parte === true).length;
  if (!nUniverso) {
    elPlan.textContent = '0';
    elCon.textContent = '0';
    elPend.textContent = '0';
    wrap.classList.add('kpi-turno--empty');
    return;
  }
  wrap.classList.remove('kpi-turno--empty');
  elPlan.textContent = String(nUniverso);
  elCon.textContent = String(nConParte);
  elPend.textContent = String(nPendienteParte);
}

// ── FECHAS ────────────────────────────────────────────────────────────────────
function hoyISO() {
  return diaOperacionISOFromTimestamp(new Date().toISOString());
}

/** Hora civil 0–23 en America/Bogota. */
function horaActualBogota() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value;
  return h != null ? parseInt(h, 10) : 12;
}

/** Resta un día calendario a YYYY-MM-DD (sin depender del huso del navegador). */
function diaAnteriorISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Día operativo por defecto al abrir la app: hasta las 13:00 (Bogotá) = día anterior;
 * desde las 13:00 = día actual. Por la mañana revisan cierre del día previo; por la tarde
 * el trabajo del día en curso (códigos, destinos, observaciones para etiquetas / logística).
 */
function fechaOperativaDefectoISO() {
  const cal = hoyISO();
  if (horaActualBogota() < 13) return diaAnteriorISO(cal);
  return cal;
}
function formatFecha(f) {
  if (!f) return '—';
  return new Date(f).toLocaleString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

/** Fecha calendario DD/MM/AAAA para títulos de reporte. */
function formatFechaCorta(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return '—';
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}
function labelFecha(iso) {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00-05:00`).toLocaleDateString('es-CO', {
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  });
}

/**
 * Fecha calendario (YYYY-MM-DD) en America/Bogota (sin corte por turno).
 */
function diaOperacionISOFromTimestamp(val) {
  if (!val) return null;
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;

  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/**
 * Corte de turno para salidas (0–23, hora Colombia). Salidas entre 00:00 y (hora-1)
 * cuentan como día operativo anterior (turno que cruza medianoche). Por defecto 6.
 */
let HORA_CORTE_TURNO_SALIDA_BOGOTA = 6;

function actualizarLabelCorteTurno() {
  const el = document.getElementById('inv-corte-turno-label');
  if (!el) return;
  const hh = String(HORA_CORTE_TURNO_SALIDA_BOGOTA).padStart(2, '0');
  el.textContent = `Gestión de librillos y crudas por despacho · corte turno salida ${hh}:00`;
}

async function cargarConfigOperacion() {
  try {
    const r = await fetch(`${API_URL}/config`);
    if (!r.ok) return;
    const cfg = await r.json();
    const n = parseInt(String(cfg?.hora_corte_turno_salida_bogota ?? ''), 10);
    if (Number.isFinite(n) && n >= 0 && n <= 23) {
      HORA_CORTE_TURNO_SALIDA_BOGOTA = n;
      actualizarLabelCorteTurno();
      renderInventario();
      filtrarCli();
      filtrarHistorialLib();
      filtrarHistorialCrud();
    }
  } catch {
    // fallback a valor por defecto
  }
}

function horaEnBogotaParaTimestamp(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value;
  return h != null ? parseInt(h, 10) : null;
}

/**
 * Día operativo YYYY-MM-DD de una fecha/hora de salida (Colbeef o cava).
 * Madrugada antes del corte → asignado al día calendario anterior.
 */
function diaOperativoSalidaISO(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const cal = diaOperacionISOFromTimestamp(val);
  if (!cal) return null;
  const h = horaEnBogotaParaTimestamp(val);
  if (h == null) return cal;
  if (h < HORA_CORTE_TURNO_SALIDA_BOGOTA) return diaAnteriorISO(cal);
  return cal;
}

const fechaDefectoOperacion = fechaOperativaDefectoISO();
// Fecha global: regla operativa (mañana = día anterior, tarde = hoy); el usuario puede cambiarla
const fechaGlobalEl = document.getElementById('fecha-global');
if (fechaGlobalEl) {
  fechaGlobalEl.value = fechaDefectoOperacion;
  fechaGlobalEl.defaultValue = fechaDefectoOperacion;
  fechaGlobalEl.setAttribute('value', fechaDefectoOperacion);
  fechaGlobalEl.title =
    'Hasta las 13:00 (Hora Colombia) se abre en el día anterior; desde las 13:00, en el día actual. Puede cambiar la fecha manualmente.';
}
const fechaRepCliDesdeEl = document.getElementById('fecha-rep-cli-desde');
const fechaRepCliHastaEl = document.getElementById('fecha-rep-cli-hasta');
if (fechaRepCliDesdeEl) fechaRepCliDesdeEl.value = fechaDefectoOperacion;
if (fechaRepCliHastaEl) fechaRepCliHastaEl.value = fechaDefectoOperacion;
const fechaGuiaEl = document.getElementById('inp-guia-fecha');
if (fechaGuiaEl) fechaGuiaEl.value = fechaDefectoOperacion;

function sincronizarFechaGuiaConFechaGlobal() {
  const fg = String(document.getElementById('fecha-global')?.value || '').trim();
  const operativa = fg || fechaOperativaDefectoISO();
  const inp = document.getElementById('inp-guia-fecha');
  if (inp) inp.value = operativa;
  return operativa;
}

const DEFAULT_COLBEEF_UI = {
  navHistorialHint: 'Plan faena · insensibilizados',
  kpiStripTitle:
    'Plan de faena del día vs insensibilizados: el listado solo incluye códigos en plan que sí fueron insensibilizados esa fecha.',
  kpiLabels: {
    universo: 'En plan de faena',
    conParte: 'Insensibilizados (en listado)',
    pendiente: 'En plan sin insensibilizar',
  },
  /** Orígenes permitidos para window.postMessage con el usuario (app Inventarios). Vacío = solo se usa externalLinks. */
  inventariosPostMessageOrigins: [],
  externalLinks: [],
  /** Menos peticiones a BD = interfaz más fluida (mín. 15000). */
  autoRefreshDatosMs: 30000,
  autoRefreshObsMs: 20000,
};
let colbeefUiConfig = { ...DEFAULT_COLBEEF_UI };

async function cargarConfigUi() {
  try {
    const r = await fetch('/config-ui.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('config');
    const j = await r.json();
    colbeefUiConfig = {
      ...DEFAULT_COLBEEF_UI,
      ...j,
      kpiLabels: { ...DEFAULT_COLBEEF_UI.kpiLabels, ...(j.kpiLabels || {}) },
      inventariosPostMessageOrigins: Array.isArray(j.inventariosPostMessageOrigins)
        ? j.inventariosPostMessageOrigins
        : DEFAULT_COLBEEF_UI.inventariosPostMessageOrigins,
    };
  } catch {
    colbeefUiConfig = { ...DEFAULT_COLBEEF_UI };
  }
  aplicarConfigUi();
  reiniciarIntervalosAutoRefresh();
}

function reiniciarIntervalosAutoRefresh() {
  const d = Number(colbeefUiConfig.autoRefreshDatosMs);
  const o = Number(colbeefUiConfig.autoRefreshObsMs);
  if (Number.isFinite(d) && d >= 15000) AUTO_REFRESH_DATOS_MS = d;
  if (Number.isFinite(o) && o >= 15000) AUTO_REFRESH_OBS_MS = o;
  if (_autoGlobalTimer) {
    clearInterval(_autoGlobalTimer);
    _autoGlobalTimer = null;
  }
  if (_autoObsTimer) {
    clearInterval(_autoObsTimer);
    _autoObsTimer = null;
  }
  iniciarAutoRefreshGlobal();
  iniciarWatchObservaciones();
}

function vistaActivaNombre() {
  return document.querySelector('.nav-item.active')?.dataset?.vista || 'historial';
}

/** Tras cargar datos: solo repinta la vista visible (evita 4 tablas grandes en cada cambio de fecha). */
function aplicarUiTrasCargarDatos(opts = {}) {
  const v = opts.vista || vistaActivaNombre();
  actualizarKpiTurno();
  poblarSelectReporteCliente(datosGlobal);
  if (v === 'historial') {
    renderHistorialLib(datosLibrillos);
    renderHistorialCrudas(datosCrudasHist);
    void refrescarToolbarCierreProceso();
    refrescarPanelPlanInsens();
  } else if (v === 'inventario') {
    renderInventario();
  } else if (v === 'clientes') {
    filtrarCli();
  } else if (v === 'totales') {
    void actualizarVistaTotales();
  } else if (v === 'rep-librillos') {
    void cargarReporteLibrillosVista();
  } else if (v === 'historico') {
    void cargarHistoricoCambios();
  }
}

function aplicarConfigUi() {
  const c = colbeefUiConfig;
  const nh = document.getElementById('nav-hint-historial');
  if (nh && c.navHistorialHint) nh.textContent = c.navHistorialHint;
  const kpi = document.getElementById('kpi-turno');
  if (kpi && c.kpiStripTitle) kpi.setAttribute('title', c.kpiStripTitle);
  const kl = c.kpiLabels || {};
  const lu = document.getElementById('kpi-lbl-universo');
  const lc = document.getElementById('kpi-lbl-con-parte');
  const lp = document.getElementById('kpi-lbl-pendiente');
  if (lu && kl.universo) lu.textContent = kl.universo;
  if (lc && kl.conParte) lc.textContent = kl.conParte;
  if (lp && kl.pendiente) lp.textContent = kl.pendiente;
  const links = Array.isArray(c.externalLinks) ? c.externalLinks : [];
  const back = document.getElementById('btn-ext-back');
  const home = document.getElementById('btn-ext-home');
  const construirLinkExternoConUsuario = (rawUrl) => {
    const raw = String(rawUrl || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw, window.location.href);
      const usuario = detectarUsuarioActivoAnalytics();
      if (usuario) {
        // Inventarios puede leer cualquiera de estos aliases.
        u.searchParams.set('usuario', usuario);
        u.searchParams.set('login', usuario);
        u.searchParams.set('inventarios_usuario', usuario);
      }
      return u.toString();
    } catch {
      return raw;
    }
  };
  const bind = (btn, entry, fallback) => {
    if (!btn) return;
    btn.style.display = '';
    if (entry && entry.url) {
      const urlConUsuario = construirLinkExternoConUsuario(entry.url);
      btn.onclick = () => {
        window.location.href = urlConUsuario || entry.url;
      };
      if (entry.title) btn.title = entry.title;
      const al = entry.ariaLabel || entry.title || '';
      if (al) btn.setAttribute('aria-label', al);
      return;
    }
    btn.onclick = fallback;
  };
  bind(back, links.find((x) => x && x.id === 'back'), () => window.history.back());
  bind(home, links.find((x) => x && x.id === 'home'), () => window.location.assign('/'));
}

/** Deep link: ?vista=inventario|historial|… al cargar la página. */
function aplicarVistaDesdeQueryString() {
  try {
    const q = new URLSearchParams(window.location.search || '');
    const v = (q.get('vista') || '').trim().toLowerCase();
    if (!v) return;
    const permitidas = new Set(['historial', 'inventario', 'clientes', 'totales', 'reportes', 'rep-librillos', 'guias', 'historico']);
    if (!permitidas.has(v)) return;
    const nav = document.querySelector(`.nav-item[data-vista="${v}"]`);
    if (nav) irVista(v, nav);
  } catch {
    /* ignore */
  }
}

// ── NAVEGACIÓN ────────────────────────────────────────────────────────────────
function irVista(nombre, btn, opts = {}) {
  document.querySelectorAll('.vista').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const vista = document.getElementById('vista-' + nombre);
  if (!vista) return;
  vista.classList.add('active');
  if (btn) btn.classList.add('active');
  const titulos = {
    historial: 'Turno / Detalle',
    inventario: 'Inventario y despacho',
    clientes: 'Por cliente',
    totales: 'Resumen del día',
    reportes: 'Reportes',
    'rep-librillos': 'Reporte de librillos',
    guias: 'Guía de despacho',
    historico: 'Historico de cambios',
  };
  document.getElementById('pg-title').textContent = titulos[nombre] || nombre;
  let sub = '';
  if (['historial', 'inventario', 'clientes'].includes(nombre)) {
    sub = labelFecha(document.getElementById('fecha-global').value);
  } else if (nombre === 'totales') {
    const d = String(document.getElementById('fecha-rep-cli-desde')?.value || '').trim();
    const h = String(document.getElementById('fecha-rep-cli-hasta')?.value || '').trim();
    sub =
      d && h && d !== h
        ? `${labelFecha(d)} — ${labelFecha(h)}`
        : labelFecha(document.getElementById('fecha-global')?.value || hoyISO());
  } else if (nombre === 'reportes') {
    const d = String(document.getElementById('fecha-rep-cli-desde')?.value || '').trim();
    const h = String(document.getElementById('fecha-rep-cli-hasta')?.value || '').trim();
    sub =
      d && h
        ? `${labelFecha(d)} — ${labelFecha(h)}`
        : labelFecha(document.getElementById('fecha-global')?.value || hoyISO());
  }
  document.getElementById('pg-sub').textContent = sub;
  const fg = document.getElementById('fecha-global');
  const ba = document.getElementById('btn-actualizar');
  if (fg) fg.style.display = '';
  if (ba) ba.style.display = '';
  if (nombre === 'inventario') renderInventario();
  else if (nombre === 'historial') {
    if (datosGlobal?.length) {
      renderHistorialLib(datosLibrillos);
      renderHistorialCrudas(datosCrudasHist);
    } else {
      filtrarHistorialLib();
      filtrarHistorialCrud();
    }
    void refrescarToolbarCierreProceso();
    refrescarPanelPlanInsens();
  } else if (nombre === 'clientes') filtrarCli();
  else if (nombre === 'totales') void actualizarVistaTotales();
  else if (nombre === 'rep-librillos') void cargarReporteLibrillosVista();
  if (nombre === 'historico') {
    if (!opts.skipHistoricoFechas) {
      const fechaRevision = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
      const fd = document.getElementById('fecha-historico-desde');
      const fh = document.getElementById('fecha-historico-hasta');
      if (fd) fd.value = diaAnteriorISO(fechaRevision);
      if (fh) fh.value = fechaRevision;
    }
    actualizarHistoricoReimpFechas();
    if (!opts.skipHistoricoCarga) void cargarHistoricoCambios();
  }
  trackVista(nombre);
  if (window.innerWidth <= 900) cerrarMenuMovil();
}

function toggleMenuMovil() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const open = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  document.body.classList.toggle('mobile-nav-open', open);
}

function cerrarMenuMovil() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  sidebar.classList.remove('open');
  document.body.classList.remove('mobile-nav-open');
}

// ── SUBTABS HISTORIAL ─────────────────────────────────────────────────────────
function cambiarSubtab(tab) {
  document.querySelectorAll('#vista-historial .subtab-historial').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.histTab === tab);
  });
  const elLib = document.getElementById('subtab-librillos');
  const elC = document.getElementById('subtab-crudas-h');
  if (elLib) elLib.style.display = 'none';
  if (elC) elC.style.display = 'none';
  if (tab === 'librillos') {
    if (elLib) elLib.style.display = 'block';
  } else if (tab === 'crudas-h') {
    if (elC) elC.style.display = 'block';
  }
  enviarEventoAnalytics({ eventName: 'historial_subtab', meta: { tab } });
}

// ── SUBTABS INVENTARIO ────────────────────────────────────────────────────────
function cambiarSubtabInventario(tab) {
  inventarioSubtab = tab;
  document.getElementById('stab-inv-lib')?.classList.toggle('active', tab === 'lib');
  document.getElementById('stab-inv-crud')?.classList.toggle('active', tab === 'crud');
  const sLib = document.getElementById('subtab-inv-lib');
  const sCr = document.getElementById('subtab-inv-crud');
  const tLib = document.getElementById('inv-toolbar-lib-top');
  const tCr = document.getElementById('inv-toolbar-crud-top');
  if (sLib) sLib.style.display = tab === 'lib' ? 'block' : 'none';
  if (sCr) sCr.style.display = tab === 'crud' ? 'block' : 'none';
  if (tLib) tLib.style.display = tab === 'lib' ? 'flex' : 'none';
  if (tCr) tCr.style.display = tab === 'crud' ? 'flex' : 'none';
  seleccionados.clear();
  seleccionadosCrud.clear();
  renderInventario();
  enviarEventoAnalytics({ eventName: 'inventario_subtab', meta: { tab } });
}

// ── FETCH ─────────────────────────────────────────────────────────────────────
/** Peticiones duplicadas de la misma fecha se comparten (evita doble carga BD). Ignorado si hay AbortSignal. */
const fetchPorFechaInflight = new Map();

async function fetchPorFecha(fecha, opts = {}) {
  const signal = opts && opts.signal;
  const f = String(fecha || '').trim() || hoyISO();
  if (!signal) {
    const prev = fetchPorFechaInflight.get(f);
    if (prev) return prev;
  }
  const run = async () => {
    const url = `${API_URL}?fecha=${encodeURIComponent(f)}`;
    const res = await fetch(url, signal ? { signal } : {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error('fetchPorFecha: respuesta no es un arreglo', typeof data);
      throw new Error('Respuesta API inválida');
    }
    return data;
  };
  const p = run().finally(() => {
    if (!signal) fetchPorFechaInflight.delete(f);
  });
  if (!signal) fetchPorFechaInflight.set(f, p);
  return p;
}

async function fetchMetaUniverso(fecha, opts = {}) {
  const bypass = opts && opts.bypassCache === true;
  const f = String(fecha || '').trim() || hoyISO();
  if (!bypass) {
    const hit = cacheMetaUniversoFront.get(f);
    if (hit && Date.now() - Number(hit.ts || 0) <= CACHE_FRONT_MS) {
      return hit.data;
    }
  }
  try {
    const res = await fetch(`${API_URL}/universo-meta?fecha=${encodeURIComponent(f)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!bypass && data !== undefined) cacheMetaUniversoFront.set(f, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

async function refrescarMetaUniversoTurno() {
  const fecha = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  metaUniversoTurno = await fetchMetaUniverso(fecha, { bypassCache: true });
  actualizarKpiTurno();
  refrescarPanelPlanInsens();
}

function htmlCuadroPlanVsInsens(meta) {
  if (!meta || !Number(meta.total_plan_faena)) return '';
  const nPlan = Number(meta.total_plan_faena) || 0;
  const nInsens = Number(meta.plan_con_insensibilizacion) || 0;
  const nSinInsens = Number(meta.plan_sin_insensibilizar) || 0;
  const nListado = Number(meta.total_en_listado) || 0;
  return `
    <div class="plan-insens-cuadro">
      <div class="tw rep-table-wrap">
        <table class="dt plan-insens-table" style="max-width:520px">
          <thead><tr><th>Indicador</th><th>Cantidad</th></tr></thead>
          <tbody>
            <tr><td>En plan de faena (fecha plan)</td><td><strong>${nPlan}</strong></td></tr>
            <tr><td>Ya insensibilizados (en plan)</td><td><strong>${nInsens}</strong></td></tr>
            <tr><td>En plan sin insensibilizar</td><td><strong>${nSinInsens}</strong></td></tr>
            <tr><td>En listado / resumen (clasificados)</td><td><strong>${nListado}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function refrescarPanelPlanInsens() {
  const panel = document.getElementById('panel-plan-insens');
  const body = document.getElementById('panel-plan-insens-body');
  const lblFecha = document.getElementById('panel-plan-insens-fecha');
  if (!panel || !body) return;
  const meta = metaUniversoTurno;
  const vistaHistorial = document.getElementById('vista-historial')?.classList.contains('active');
  if (!meta || !Number(meta.total_plan_faena) || !vistaHistorial) {
    panel.style.display = 'none';
    body.innerHTML = '';
    return;
  }
  const fecha = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  if (lblFecha) lblFecha.textContent = labelFecha(fecha);
  body.innerHTML = htmlCuadroPlanVsInsens(meta);
  panel.style.display = 'block';
}

async function fetchSalidas() {
  if ((Date.now() - Number(cacheSalidasFront.ts || 0)) <= CACHE_FRONT_MS && Array.isArray(cacheSalidasFront.data)) {
    return cacheSalidasFront.data;
  }
  try {
    const res = await fetch(SALIDAS_URL);
    if (!res.ok) return [];
    const data = await res.json();
    const out = normalizarListaSalidas(data);
    cacheSalidasFront = { ts: Date.now(), data: out };
    return out;
  } catch {
    return [];
  }
}

async function fetchResumenMacro(fecha) {
  if (!fecha) return null;
  const hit = cacheResumenMacroFront.get(String(fecha));
  if (hit && (Date.now() - Number(hit.ts || 0)) <= CACHE_FRONT_MS) {
    return hit.data;
  }
  try {
    const res = await fetch(`${API_URL}/resumen?fecha=${encodeURIComponent(fecha)}`);
    if (!res.ok) return null;
    const data = await res.json();
    cacheResumenMacroFront.set(String(fecha), { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

function normalizarIdProducto(v) {
  return String(v ?? '').trim();
}

function normalizarListaSalidas(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map(s => ({ ...s, id_producto: normalizarIdProducto(s?.id_producto) }))
    .filter(s => s.id_producto);
}

async function fetchObservacionesPorFecha(fecha, opts = {}) {
  const signal = opts && opts.signal;
  try {
    const res = await fetch(`${API_URL}/observaciones?fecha=${encodeURIComponent(fecha)}`, signal ? { signal } : {});
    if (!res.ok) return [];
    return res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return [];
  }
}

/**
 * Ya despachado en Colbeef (lista explícita o la global) o salida de cava en trazabilidad
 * → no debe aparecer como pendiente de despacho en inventario.
 */
function productoYaSalidaColbeefOTraz(d, salidasLista = salidasRegistradas) {
  const id = normalizarIdProducto(d?.id_producto);
  if (!id) return false;
  const lista = salidasLista || [];
  if (lista.some((s) => normalizarIdProducto(s.id_producto) === id && s.fecha_salida)) return true;
  if (d?.fecha_salida_cava) return true;
  return false;
}

function snapshotPendientes(datos, salidas) {
  const lib = (datos || [])
    .filter(esVistaHistorialLibrillos)
    .filter((d) => !productoYaSalidaColbeefOTraz(d, salidas))
    .map(d => `L:${d.id_producto}||${String(d.observacion || '').trim()}||${d.cliente_destino || ''}`)
    .sort()
    .join('##');
  const crud = (datos || [])
    .filter(esVistaHistorialCrudasSolo)
    .filter((d) => !productoYaSalidaColbeefOTraz(d, salidas))
    .map(d => `C:${d.id_producto}||${String(d.observacion || '').trim()}`)
    .sort()
    .join('##');
  return `${lib}##${crud}`;
}

async function refrescarGlobal() {
  if (document.hidden) return;
  if (_loaderDepth > 0) return;
  const signal = nuevaSenalLibAuto();
  const fecha = document.getElementById('fecha-global')?.value || hoyISO();
  try {
    const [datos, salidas] = await Promise.all([
      fetchPorFecha(fecha, { signal }),
      fetchSalidas(),
    ]);
    const invActiva = document.getElementById('vista-inventario')?.classList.contains('active');
    const histActiva = document.getElementById('vista-historial')?.classList.contains('active');
    const cliActiva = document.getElementById('vista-clientes')?.classList.contains('active');
    const snapNuevo = snapshotPendientes(datos, salidas);
    const huboCambioInv =
      invActiva && _autoInvSnapshot && snapNuevo !== _autoInvSnapshot;

    datosGlobal = datos;
    fechaDatosGlobal = fecha;
    datosClientes = datos;
    salidasRegistradas = salidas;
    separarDatos(datos);
    actualizarEstado(true);
    if (huboCambioInv) {
      seleccionados.clear();
      seleccionadosCrud.clear();
      mostrarToast('Inventario actualizado por cambios recientes en observación/salida.', 'ok');
    }
    aplicarUiTrasCargarDatos();
    _autoInvSnapshot = snapNuevo;
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    // silencioso: conservar último estado visible
  }
}

function iniciarAutoRefreshGlobal() {
  if (_autoGlobalTimer) return;
  _autoGlobalTimer = setInterval(refrescarGlobal, AUTO_REFRESH_DATOS_MS);
}

/** Listado del reporte: códigos API con etiqueta tipo hoja Excel (ASURCARNES, DERIVADOS, …). */
function poblarSelectReporteCliente(lista = datosGlobal) {
  const sel = document.getElementById('sel-rep-cliente');
  if (!sel) return;
  const prev = sel.value || '';
  const porCodigo = new Map();
  (lista || []).forEach((d) => {
    const cod = codigoAgrupacionMacro(d);
    const etiqueta = etiquetaAgrupacionMacro(d);
    if (!porCodigo.has(cod)) porCodigo.set(cod, etiqueta);
  });
  const ordenados = [...porCodigo.entries()].sort((a, b) => {
    const ia = ORDEN_MACRO_REPORTE.indexOf(a[1]);
    const ib = ORDEN_MACRO_REPORTE.indexOf(b[1]);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return String(a[1]).localeCompare(String(b[1]), 'es');
  });
  sel.innerHTML = '<option value="">Todas las agrupaciones</option>' +
    ordenados.map(([cod, etiqueta]) => {
      const esc = String(cod).replace(/\\/g, '\\\\').replace(/"/g, '&quot;');
      return `<option value="${esc}">${escapeHtml(etiqueta)}</option>`;
    }).join('');
  if (prev && porCodigo.has(prev)) sel.value = prev;
}

function rangoFechasISO(desde, hasta) {
  const out = [];
  let d = new Date(`${desde}T00:00:00-05:00`);
  const h = new Date(`${hasta}T00:00:00-05:00`);
  while (d <= h) {
    out.push(d.toLocaleDateString('en-CA'));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function fetchDatosRango(desde, hasta) {
  const key = `${String(desde || '').trim()}|${String(hasta || '').trim()}`;
  const hit = cacheRangoFront.get(key);
  if (hit && (Date.now() - Number(hit.ts || 0)) <= CACHE_RANGO_DATOS_MS && Array.isArray(hit.data)) {
    return hit.data;
  }
  try {
    const res = await fetch(`${API_URL}?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`);
    if (res.ok) {
      const data = await res.json();
      cacheRangoFront.set(key, { ts: Date.now(), data: Array.isArray(data) ? data : [] });
      return data;
    }
  } catch {
    /* sin endpoint / red */
  }
  const fechas = rangoFechasISO(desde, hasta);
  const BATCH = 14;
  const all = [];
  for (let i = 0; i < fechas.length; i += BATCH) {
    const tramo = fechas.slice(i, i + BATCH);
    const partes = await Promise.all(tramo.map((f) => fetchPorFecha(f).catch(() => [])));
    partes.forEach((arr) => {
      if (Array.isArray(arr)) all.push(...arr);
    });
  }
  const m = new Map();
  all.forEach((d) => {
    const k = `${String(d.id_producto || '')}|${String(d.fecha || '')}`;
    if (!m.has(k)) m.set(k, d);
  });
  const out = [...m.values()];
  cacheRangoFront.set(key, { ts: Date.now(), data: out });
  return out;
}

function tipoOperacionTexto(d) {
  const c = clasificarRegistro(d || {});
  if (c.tieneRetiro && c.tieneCrudas) return 'MIXTO';
  if (c.tieneRetiro) return 'LIBRILLO';
  if (c.tieneCrudas) return 'CRUDA';
  return 'OBSERVACION';
}

function resumenAgrupacionesClienteDestino(lista = datosGlobal) {
  const orden = [
    'asurcarnes_glo',
    'asurcarnescol',
    'global_hides',
    'asurcarnes',
    'cat',
    'derivados_carnicos',
    'cocidos',
    'otros',
    'sin_destino',
  ];
  const etiquetas = {
    asurcarnes_glo: 'Asurcarnes GLO',
    asurcarnescol: 'Asurcarnescol',
    global_hides: 'Global Hides',
    asurcarnes: 'Asurcarnes',
    cat: 'CAT',
    derivados_carnicos: 'Derivados cárnicos',
    cocidos: 'Cocidos',
    otros: 'Otros',
    sin_destino: 'Sin destino (retiro)',
  };

  const m = new Map();
  orden.forEach(k => m.set(k, { codigo: k, etiqueta: etiquetas[k], total: 0 }));

  (lista || []).forEach(d => {
    const c = String(d?.agrupacion_codigo || 'asurcarnes').trim() || 'asurcarnes';
    if (!m.has(c)) m.set(c, { codigo: c, etiqueta: String(d?.agrupacion || c), total: 0 });
    m.get(c).total += 1;
  });

  const base = orden.map(k => m.get(k)).filter(Boolean);
  const extras = [...m.values()]
    .filter(x => !orden.includes(x.codigo))
    .sort((a, b) => String(a.etiqueta || '').localeCompare(String(b.etiqueta || ''), 'es'));
  return [...base, ...extras].filter(x => x.total > 0);
}

/** HTML del cuadro «Resumen de libros y chunchullas crudas» (solo Reporte general / export). */
function htmlResumenLibrosChunchullasCrudas(lista, opts = {}) {
  const rm = opts?.resumenMacro || null;
  const usarSoloLibrillos = opts?.soloLibrillos === true;
  const baseLista = usarSoloLibrillos
    ? (lista || []).filter(esLibrilloParaReporteAgrupacion)
    : (lista || []);
  // En macro, varios "cocidos" llegan sin observacion y el backend los deja como
  // asurcarnes por default. Para que el cuadro cuadre con la hoja operativa,
  // reclasificamos localmente esos casos al generar este bloque.
  const codigosBase = new Set([
    'asurcarnes_glo',
    'asurcarnescol',
    'global_hides',
    'asurcarnes',
    'cat',
    'derivados_carnicos',
    'cocidos',
    'otros',
    'sin_destino',
  ]);
  const conteoAgr = new Map();
  const sumarAgr = (codigo, n = 1) => {
    const c = String(codigo || '').trim();
    if (!c) return;
    conteoAgr.set(c, Number(conteoAgr.get(c) || 0) + Number(n || 0));
  };
  (baseLista || []).forEach((d) => {
    sumarAgr(codigoAgrupacionMacro(d), 1);
  });
  const mapAgr = conteoAgr;
  const textoObsResumenLch = (d) =>
    [d?.observaciones, d?.observacion, d?.observacion_plan, d?.observaciones_parte, d?.texto_retiro_obs]
      .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  const sinTildesLch = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '');
  const esCrudaLch = (d) => /\bCRUDAS?\b/i.test(textoObsResumenLch(d));
  const tieneEstiloBogotaLch = (d) =>
    sinTildesLch(textoObsResumenLch(d)).toUpperCase().includes('ESTILO BOGOTA');
  const esSucursalOlimpicaLch = (d) => {
    const u = (s) =>
      String(s || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toUpperCase();
    return u(d?.sucursal).includes('OLIMPICA') || u(d?.plaza).includes('OLIMPICA');
  };

  const totalCrudas = rm && !usarSoloLibrillos
    ? Number(rm?.categorias?.chunchullas_crudas || 0)
    : (baseLista || []).filter((d) => esCrudaLch(d) && !tieneEstiloBogotaLch(d)).length;

  const vOlimpica =
    rm && !usarSoloLibrillos
      ? Number(rm?.categorias?.olimpica ?? 0)
      : (baseLista || []).filter(esSucursalOlimpicaLch).length;
  const vEstiloBogota =
    rm && !usarSoloLibrillos
      ? Number(rm?.categorias?.estilo_bogota ?? 0)
      : (baseLista || []).filter(tieneEstiloBogotaLch).length;

  /** Conteo por agrupacion_codigo del plan completo (misma fuente que listado / API). */
  const vAsurGlo = mapAgr.get('asurcarnes_glo') || 0;
  const vAsurCol = mapAgr.get('asurcarnescol') || 0;
  const vGlobal = mapAgr.get('global_hides') || 0;
  const vAsur = mapAgr.get('asurcarnes') || 0;
  const vCat = mapAgr.get('cat') || 0;
  const vDeriv = mapAgr.get('derivados_carnicos') || 0;
  const totalCocidos = mapAgr.get('cocidos') || 0;
  const vOtros = mapAgr.get('otros') || 0;
  const vSinDestino = mapAgr.get('sin_destino') || 0;

  const nPlanFaena = Number(opts?.metaUniverso?.total_plan_faena || rm?.categorias?.total_plan_faena || 0);
  const totalGeneral = (baseLista || []).length || nPlanFaena || Number(rm?.categorias?.total || 0);
  const fechaSel =
    String(opts.fechaReporte || opts.fechaISO || '').trim() ||
    document.getElementById('fecha-global')?.value ||
    hoyISO();

  const resumenEstado = (items) => {
    let despDia = 0;
    let pendiente = 0;
    let otroDia = 0;
    (items || []).forEach((d) => {
      const ts = salidaEfectivaTimestamp(d.id_producto, d);
      if (!ts) {
        pendiente += 1;
        return;
      }
      const dia = diaOperativoSalidaISO(ts);
      if (dia === fechaSel) despDia += 1;
      else otroDia += 1;
    });
    return { despDia, pendiente, otroDia };
  };

  /**
   * Resumen de libros (cuadro derecho tipo macro INICIO):
   * - CRUDOS    = CAT + ASURCARNESCOL (+ ajustes I4-J4 del libro; aquí 0)
   * - COCIDOS   = COCIDOS (menos CAVA K5; aquí 0)
   * - DERIVADOS = DERIVADOS + ASURCARNES + GLOBAL HIDES (+ ajustes I6-J6; aquí 0)
   * - TOTAL     = suma filas (no necesariamente igual al total general de vísceras)
   */
  const ajustesCrudos = 0;
  const ajustesDerivados = 0;
  const cavaCocidos = 0;
  const totalCrudosMacro = rm
    ? Number(rm?.resumen_libros?.crudos || 0)
    : (vCat + vAsurCol + ajustesCrudos);
  const totalCocidosMacro = rm
    ? Number(rm?.resumen_libros?.cocidos || 0)
    : Math.max(0, totalCocidos - cavaCocidos);
  const totalDerivadosMacro = rm
    ? Number(rm?.resumen_libros?.derivados || 0)
    : (vDeriv + vAsur + vGlobal + ajustesDerivados);
  /** Subtotal tipo hoja INICIO (solo tres filas; no incluye ASURCARNESGLO ni otros códigos). */
  const totalSubInicio = rm
    ? Number(rm?.resumen_libros?.total || 0)
    : (totalCrudosMacro + totalCocidosMacro + totalDerivadosMacro);
  /**
   * Lo que falta para igualar el total de categorías comerciales (p. ej. ASURCARNESGLO, otros/sin destino).
   * Así el TOTAL del segundo cuadro coincide con el de la primera tabla.
   */
  const deltaRestoComercial = Math.max(0, totalGeneral - totalSubInicio - vAsurGlo);
  const totalLibrosMacro = totalGeneral;
  // Nuevo armado solicitado por usuario para la tabla "Resumen de libros".
  const totalFilaCocidos = Number(totalCocidos || 0);
  const totalFilaDerivados = Number(vDeriv || 0) + Number(vAsur || 0);
  const totalFilaCat = Number(vCat || 0) + Number(vAsurCol || 0);
  const totalFilaGlobalHides = Number(vGlobal || 0) + Number(vAsurGlo || 0);
  const totalTablaLibros =
    totalFilaCocidos + totalFilaDerivados + totalFilaCat + totalFilaGlobalHides;

  /**
   * Partición disjunta operativa (para columnas Pendientes/Salió/Despachado).
   */
  const listaCocidos = (baseLista || []).filter((d) => codigoAgrupacionMacro(d) === 'cocidos');
  const listaDerivados = (baseLista || []).filter(
    (d) => esVistaHistorialLibrillos(d) && codigoAgrupacionMacro(d) === 'derivados_carnicos'
  );
  const listaCrudosLib = (baseLista || []).filter(
    (d) =>
      esVistaHistorialLibrillos(d) &&
      codigoAgrupacionMacro(d) !== 'cocidos' &&
      codigoAgrupacionMacro(d) !== 'derivados_carnicos'
  );
  const cubiertos = new Set(
    [...listaCrudosLib, ...listaCocidos, ...listaDerivados].map((d) => String(d?.id_producto ?? ''))
  );
  const listaRestoLib = (baseLista || []).filter((d) => !cubiertos.has(String(d?.id_producto ?? '')));
  const estCr = resumenEstado(listaCrudosLib);
  const estCo = resumenEstado(listaCocidos);
  const estDe = resumenEstado(listaDerivados);
  const estRe = resumenEstado(listaRestoLib);
  const listaLibrillosHoy = (baseLista || []).filter(esVistaHistorialLibrillos);
  const listaCrudasHoy = (baseLista || []).filter(esVistaHistorialCrudasSolo);
  const estLibrillosHoy = resumenEstado(listaLibrillosHoy);
  const estCrudasHoy = resumenEstado(listaCrudasHoy);

  const tbody = `
    <tr class="resumen-dia-head"><td>CHUNCHULLAS CRUDAS</td><td>${totalCrudas}</td></tr>
    <tr class="resumen-dia-asur-glo"><td>ASURCARNESGLO</td><td>${vAsurGlo}</td></tr>
    <tr class="resumen-dia-asur-col"><td>ASURCARNESCOL</td><td>${vAsurCol}</td></tr>
    <tr class="resumen-dia-global"><td>GLOBAL HIDES SAS</td><td>${vGlobal}</td></tr>
    <tr class="resumen-dia-asur"><td>ASURCARNES</td><td>${vAsur}</td></tr>
    <tr class="resumen-dia-cat"><td>CAT</td><td>${vCat}</td></tr>
    <tr class="resumen-dia-deriv"><td>DERIVADOS</td><td>${vDeriv}</td></tr>
    ${(vOtros || vSinDestino) ? `<tr><td>OTROS / SIN DESTINO</td><td>${vOtros + vSinDestino}</td></tr>` : ''}
    <tr class="resumen-dia-coc"><td>COCIDOS</td><td>${totalCocidos}</td></tr>
    <tr class="resumen-dia-total"><td>TOTAL</td><td>${totalGeneral}</td></tr>
  `;
  const nPlan = Number(opts?.metaUniverso?.total_plan_faena || 0);
  const metaTotal =
    nPlan > 0 && nPlan !== totalGeneral
      ? `Total consolidado: <strong>${totalGeneral}</strong> · plan faena: <strong>${nPlan}</strong>`
      : `Total consolidado: <strong>${totalGeneral}</strong>`;

  const cuadroPlan = opts?.metaUniverso ? htmlCuadroPlanVsInsens(opts.metaUniverso) : '';

  return `
    <div class="rep-bloque-resumen-lch">
      <h3 class="rep-bloque-resumen-h">Resumen de libros y chunchullas crudas</h3>
      <p class="rep-bloque-resumen-meta">${metaTotal}</p>
      ${cuadroPlan}
      <div class="resumen-dia-dos-tablas">
        <div class="tw rep-table-wrap">
        <table class="dt resumen-dia-table" style="max-width:520px">
          <thead><tr><th>Categoría</th><th>Total</th></tr></thead>
          <tbody>${tbody}</tbody>
        </table>
        </div>
        <div class="tw rep-table-wrap resumen-dia-tabla-extras">
          <table class="dt resumen-dia-table" style="max-width:520px">
            <thead><tr><th>Indicador</th><th>Total</th></tr></thead>
            <tbody>
              <tr><td>OLIMPICA</td><td>${vOlimpica}</td></tr>
              <tr><td>ESTILO BOGOTA</td><td>${vEstiloBogota}</td></tr>
            </tbody>
          </table>
          <p class="rep-bloque-resumen-meta" style="margin:8px 0 0;font-size:11px;color:var(--tx3);max-width:520px">
            OLIMPICA: sucursal o plaza contiene «OLIMPICA» (con o sin tilde). ESTILO BOGOTA: cualquier fila con ese texto en observación/plan/parte/retiro (con o sin CRUDAS; no entran en CHUNCHULLAS CRUDAS).
          </p>
        </div>
      </div>
      <div class="tw rep-table-wrap" style="margin-top:14px">
        <p class="rep-bloque-resumen-meta" style="margin:0 0 8px;font-size:12px;color:var(--tx3)">
          COCIDOS = COCIDOS · DERIVADOS = DERIVADOS + ASURCARNES · CAT = CAT + ASURCARNESCOL ·
          GLOBAL HIDES = GLOBAL HIDES + ASURCARNESGLO.
        </p>
        <table class="dt" style="max-width:460px">
          <thead>
            <tr>
              <th>Resumen de libros</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>COCIDOS</td><td>${totalFilaCocidos}</td></tr>
            <tr><td>DERIVADOS</td><td>${totalFilaDerivados}</td></tr>
            <tr><td>CAT</td><td>${totalFilaCat}</td></tr>
            <tr><td>GLOBAL HIDES</td><td>${totalFilaGlobalHides}</td></tr>
            <tr class="resumen-dia-total"><td>TOTAL</td><td>${totalTablaLibros}</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function salidaUltimaEnRango(idProducto, salidas, desde, hasta) {
  const rows = (salidas || [])
    .filter(s => s.id_producto === idProducto && s.fecha_salida)
    .filter(s => {
      const dia = diaOperativoSalidaISO(s.fecha_salida);
      return dia && dia >= desde && dia <= hasta;
    })
    .sort((a, b) => new Date(b.fecha_salida) - new Date(a.fecha_salida));
  return rows[0]?.fecha_salida || null;
}

/** Colbeef en rango o, si no hay, salida de cava cuyo día operativo cae en [desde,hasta]. */
function salidaDisplayEnRango(idProducto, salidas, desde, hasta, dRow) {
  const colb = salidaUltimaEnRango(idProducto, salidas, desde, hasta);
  if (colb) return colb;
  if (dRow?.fecha_salida_cava) {
    const dia = diaOperativoSalidaISO(dRow.fecha_salida_cava);
    if (dia && dia >= desde && dia <= hasta) return dRow.fecha_salida_cava;
  }
  return null;
}

function validarRangoReportes(desde, hasta) {
  if (!desde || !hasta) {
    mostrarToast('Selecciona fecha desde y hasta', 'err');
    return false;
  }
  if (desde > hasta) {
    mostrarToast('La fecha desde no puede ser mayor que hasta', 'err');
    return false;
  }
  return true;
}

/** Alinea «Desde / Hasta» del reporte por agrupación y del histórico de auditoría con la fecha de la barra superior. */
function sincronizarFechasSecundariasConFechaGlobal() {
  const fg = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  const de = document.getElementById('fecha-rep-cli-desde');
  const ha = document.getElementById('fecha-rep-cli-hasta');
  if (de) de.value = fg;
  if (ha) ha.value = fg;
  const hd = document.getElementById('fecha-historico-desde');
  const hh = document.getElementById('fecha-historico-hasta');
  if (hd) hd.value = diaAnteriorISO(fg);
  if (hh) hh.value = fg;
}

function vistaReporteCliente() {
  // Reportes queda fijo en modo resumido.
  return 'resumen';
}

/** Resumen del día (vista Totales): usa el mismo rango «Desde / Hasta» que el reporte por agrupación (alineado con la fecha de la barra al actualizar). */
async function actualizarVistaTotales() {
  return runWithAppLoader('Cargando resumen...', async () => {
    const fg = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
    const desde = String(document.getElementById('fecha-rep-cli-desde')?.value || '').trim() || fg;
    const hasta = String(document.getElementById('fecha-rep-cli-hasta')?.value || '').trim() || fg;
    if (!validarRangoReportes(desde, hasta)) return false;

    const unDia = desde === hasta;
    let datos;
    let salidas;
    let resumenMacro = null;

    try {
      if (unDia) {
        const fecha = desde;
        const usarCacheDia =
          fecha && fecha === fechaDatosGlobal && Array.isArray(datosGlobal) && datosGlobal.length > 0;
        if (usarCacheDia) {
          [salidas, resumenMacro] = await Promise.all([fetchSalidas(), fetchResumenMacro(fecha)]);
          datos = datosGlobal;
          metaUniversoTurno =
            resumenMacro?.meta_universo || (await fetchMetaUniverso(fecha));
        } else {
          [datos, salidas, resumenMacro] = await Promise.all([
            fetchPorFecha(fecha),
            fetchSalidas(),
            fetchResumenMacro(fecha),
          ]);
          metaUniversoTurno =
            resumenMacro?.meta_universo || (await fetchMetaUniverso(fecha));
        }
        actualizarKpiTurno();
        refrescarPanelPlanInsens();
        if (!resumenMacro?.categorias) {
          resumenMacro = {
            categorias: { total: datos.length },
            resumen_libros: {},
            meta_universo: metaUniversoTurno,
          };
        }
      } else {
        const dias = rangoFechasISO(desde, hasta).length;
        if (dias > 95) {
          mostrarToast('El rango no puede superar 95 días', 'err');
          return false;
        }
        [datos, salidas] = await Promise.all([fetchDatosRango(desde, hasta), fetchSalidas()]);
      }
    } catch (e) {
      mostrarToast('No se pudo cargar el resumen. Intenta actualizar.', 'err');
      const prev = document.getElementById('rep-preview');
      const body = document.getElementById('rep-prev-body');
      const t = document.getElementById('rep-prev-title');
      if (prev && body) {
        if (t) t.textContent = 'Totales';
        body.innerHTML =
          '<p class="empty" style="padding:24px;text-align:center">Error al cargar datos.</p>';
        prev.style.display = 'block';
      }
      return false;
    }

    const prev = document.getElementById('rep-preview');
    const body = document.getElementById('rep-prev-body');
    const t = document.getElementById('rep-prev-title');
    if (!prev || !body) return false;
    if (t) t.textContent = 'Totales';
    const fechaLabel = unDia ? labelFecha(desde) : `${labelFecha(desde)} a ${labelFecha(hasta)}`;
    if (!datos.length) {
      body.innerHTML = `<p class="empty" style="padding:24px;text-align:center">Sin datos para <strong>${escapeHtml(fechaLabel)}</strong>.</p>`;
      prev.style.display = 'block';
      prev.scrollIntoView({ behavior: 'smooth' });
      return false;
    }
    mostrarPreview('Totales', fechaLabel, hasta, datos, salidas, {
      desde,
      hasta,
      vistaReporte: 'resumen',
      incluirResumenLibrosChunchullas: true,
      ocultarKpis: true,
      omitTablaProcesados: true,
      universoPlanCompleto: true,
      resumenMacro,
      metaUniverso: metaUniversoTurno,
    });
    return true;
  });
}

async function descargarExcelTotales() {
  const fg = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  const desde = String(document.getElementById('fecha-rep-cli-desde')?.value || '').trim() || fg;
  const hasta = String(document.getElementById('fecha-rep-cli-hasta')?.value || '').trim() || fg;
  if (!validarRangoReportes(desde, hasta)) return;
  let datos;
  try {
    if (desde === hasta) {
      datos = await fetchPorFecha(desde);
    } else {
      const dias = rangoFechasISO(desde, hasta).length;
      if (dias > 95) {
        mostrarToast('El rango no puede superar 95 días', 'err');
        return;
      }
      datos = await fetchDatosRango(desde, hasta);
    }
  } catch (e) {
    mostrarToast(String(e.message || e) || 'Error al cargar', 'err');
    return;
  }
  if (!datos.length) {
    mostrarToast('Sin datos para exportar', 'err');
    return;
  }
  const marca = await obtenerMarcaExportColbeefImgHtml({ paraExcel: true });
  const salidas = await fetchSalidas();
  const rows = [...datos].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  const n = rows.length;
  const gen = new Date().toLocaleString('es-CO');
  const NC = 14;
  const rangoTxt = desde === hasta ? desde : `${desde} a ${hasta}`;
  const nombreArchivo = desde === hasta ? `Totales_${desde}` : `Totales_${desde}_a_${hasta}`;
  const body = rows.map((d) => {
    const salTxt = textoSalidaReporteExport(d, salidas, desde, hasta);
    const diaOp = d.fecha ? formatFechaSolo(String(d.fecha)) : '—';
    return `<tr>
      <td>${escapeHtml(d.id_producto || '—')}</td>
      <td>${escapeHtml(String(d.identificacion || '').trim() || '—')}</td>
      <td>${escapeHtml(tipoOperacionTexto(d))}</td>
      <td>${escapeHtml(d.propietario || '—')}</td>
      <td>${escapeHtml(d.cliente_destino || '—')}</td>
      <td>${escapeHtml(etiquetaAgrupacionMacro(d))}</td>
      <td>${escapeHtml(String(d.destino || '').trim() || '—')}</td>
      <td>${escapeHtml(String(d.sucursal || '').trim() || '—')}</td>
      <td>${escapeHtml(destinoTabla(d))}</td>
      <td>${escapeHtml(d.empresa_destino || '—')}</td>
      <td>${escapeHtml(String(d.observacion || '').trim() || '—')}</td>
      <td>${escapeHtml(diaOp)}</td>
      <td>${escapeHtml(formatFecha(d.fecha_ingreso_cava))}</td>
      <td>${escapeHtml(salTxt)}</td>
    </tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    .rep-xls-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
    .rep-xls-head .rep-export-logo-img{height:24px!important;max-width:90px!important}
    table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11px}
    th{background:#1a5f35;color:#fff;padding:6px 8px;text-align:left;font-weight:700}
    td{padding:5px 8px;border:1px solid #ccc;vertical-align:top}
    .meta td{background:#f5f5f5;font-weight:600;border-color:#bbb}
    .nota{font-size:10px;color:#444;margin-top:10px;max-width:900px}
  </style></head><body>
    <div class="rep-xls-head">${marca}<span style="font-weight:700;color:#333">Totales (rango operativo)</span></div>
    <table border="1">
      <tr class="meta"><td colspan="${NC}">Rango: ${escapeHtml(rangoTxt)}</td></tr>
      <tr class="meta"><td colspan="${NC}">Total registros: ${n} · Generado: ${escapeHtml(gen)}</td></tr>
      <tr>
        <th>ID producto</th>
        <th>Identificación</th>
        <th>Tipo operación</th>
        <th>Propietario</th>
        <th>Cliente destino (comercial)</th>
        <th>Agrupación (tipo Excel)</th>
        <th>Destino (código trazabilidad)</th>
        <th>Sucursal</th>
        <th>Plaza / ubicación</th>
        <th>Empresa destino</th>
        <th>Observación</th>
        <th>Día operación (registro)</th>
        <th>Ingreso a cava</th>
        <th>Salida (despacho o cava)</th>
      </tr>
      ${body}
    </table>
    <p class="nota"><strong>Nota:</strong> Misma lógica de columnas que el reporte por cliente. «Salida» usa despacho Colbeef en el día o salida de cava en trazabilidad.</p>
  </body></html>`;
  descargarExcel(nombreArchivo, html);
}

async function descargarPDFTotales() {
  await actualizarVistaTotales();
  descargarPDFReporte();
}

async function imprimirTotalesListo() {
  if (!document.getElementById('rep-prev-body')?.innerHTML?.trim()) {
    await actualizarVistaTotales();
  }
  imprimirReporte();
}

/**
 * Misma estructura que «Resumen del día» (Totales): cuadro macro + tabla resumida o listado detallado.
 * `resumenMacro` solo aplica a un día sin filtro por código (coincide con el backend /resumen).
 */
function buildOptsReporteEstiloTotales(ctx) {
  const esVistaResumen = ctx.vistaReporte !== 'detalle';
  /** Una sola agrupación en el selector: solo pivote CLIENTE/PLAZA + auditoría (como la captura), sin cuadro macro ni tabla de movimiento. */
  const filtroAgr = !!(ctx.agrupacionCodigo && String(ctx.agrupacionCodigo).trim());
  return {
    desde: ctx.desde,
    hasta: ctx.hasta,
    vistaReporte: esVistaResumen ? 'resumen' : 'detalle',
    modoTotalesSimple: esVistaResumen && !filtroAgr,
    incluirResumenLibrosChunchullas: !filtroAgr,
    soloListasLibrillosPorAgrupacion: filtroAgr,
    resumenMacro: ctx.resumenMacro || null,
  };
}

async function obtenerContextoReporteCliente() {
  const desde = document.getElementById('fecha-rep-cli-desde')?.value;
  const hasta = document.getElementById('fecha-rep-cli-hasta')?.value;
  const agrupacionCodigo = document.getElementById('sel-rep-cliente')?.value || '';
  if (!validarRangoReportes(desde, hasta)) return null;
  const dias = rangoFechasISO(desde, hasta).length;
  if (dias > 95) {
    mostrarToast('El rango no puede superar 95 días', 'err');
    return null;
  }
  const codFiltro = agrupacionCodigo || '';
  const cargarMacro =
    desde === hasta && !codFiltro ? fetchResumenMacro(desde) : Promise.resolve(null);
  const [datos, salidas, resumenMacro] = await Promise.all([
    fetchDatosRango(desde, hasta),
    fetchSalidas(),
    cargarMacro,
  ]);
  const filtrados = codFiltro
    ? datos.filter((d) => {
        const c = codigoAgrupacionMacro(d);
        return c === codFiltro;
      })
    : datos;
  if (!filtrados.length) {
    mostrarToast('Sin datos para esa agrupación en el rango', 'err');
    return null;
  }
  const agrupacionEtiqueta = codFiltro ? etiquetaAgrupacionMacro(filtrados[0]) : '';
  const titulo = codFiltro
    ? `Reporte por agrupación: ${agrupacionEtiqueta || codFiltro}`
    : 'Reporte por agrupación (todos)';
  const etiqueta = `${labelFecha(desde)} a ${labelFecha(hasta)}`;
  const vistaReporte = vistaReporteCliente();
  return {
    desde,
    hasta,
    agrupacionCodigo: codFiltro,
    agrupacionEtiqueta,
    filtrados,
    salidas,
    titulo,
    etiqueta,
    vistaReporte,
    resumenMacro,
  };
}

async function generarReporteCliente() {
  return runWithAppLoader('Generando vista previa del reporte...', async () => {
    const ctx = await obtenerContextoReporteCliente();
    if (!ctx) return false;
    mostrarPreview(ctx.titulo, ctx.etiqueta, ctx.hasta, ctx.filtrados, ctx.salidas, {
      ...buildOptsReporteEstiloTotales(ctx),
      destino: 'reportes',
      ocultarKpis: true,
    });
    return true;
  });
}

async function generarReporteGeneralRango() {
  return actualizarVistaTotales();
}

function fechaGuiaTexto(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtKg(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg`;
}

function fechaGuiaSolo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fechaGuiaLarga(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function normalizarCategoriaGuiaCodigo(valor) {
  const t = String(valor || '').trim().toLowerCase();
  if (!t) return '';
  if (t.includes('deriv')) return 'derivados';
  if (t.includes('global')) return 'global_hides';
  if (t.includes('cat')) return 'cat';
  return t;
}

function plantillaGuiaPredeterminada(categoria) {
  const basePlanta = {
    planta_beneficio: 'Colbeef S.A.S',
    direccion_planta: 'Via Corredor Río Frío Calle 210 No. 9 - 631',
    codigo_invima: '696BD',
    departamento_planta: 'Santander',
    ciudad_planta: 'Florida Blanca',
    tipo_vehiculo: 'TRANSPORTE DE ALIMENTO NO COMESTIBLE',
  };
  const baseFirma = {
    firma_responsable: 'Maria Filomena Segura Barrera',
    firma_cedula: '1056908061',
  };
  if (categoria === 'cat') {
    return {
      ...basePlanta,
      ...baseFirma,
      conductor_nombre: 'GILBERTO ZAMBRANO ROJAS',
      id_conductor: '1100220267',
      placa: 'UFW 238',
      firma_cargo: 'Directora de Planta',
    };
  }
  if (categoria === 'derivados') {
    return {
      ...basePlanta,
      ...baseFirma,
      conductor_nombre: 'Jorge Parra',
      placa: 'CRA-782',
      firma_cargo: 'Directora de Planta',
    };
  }
  if (categoria === 'global_hides') {
    return {
      ...basePlanta,
      ...baseFirma,
      conductor_nombre: 'Franki Alexis Gamarra',
      id_conductor: '91534708',
      placa: 'SUF-086',
      firma_cargo: 'Directora de Planta',
    };
  }
  return { ...basePlanta, ...baseFirma };
}

function destinoFijoGuiaPorCategoria(categoria) {
  const cat = normalizarCategoriaGuiaCodigo(categoria);
  if (cat === 'cat') return 'PIEDECUESTA';
  if (cat === 'derivados') return 'BUCARAMANGA. DERIVADOS CARNICOS';
  if (cat === 'global_hides') return 'BUCARAMANGA';
  return '';
}

function valorEnteroGuia(id) {
  const raw = String(document.getElementById(id)?.value || '').trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** Cantidad manual de libros despachados: null = usar total calculado. */
function leerLibrosDespachadosManualGuia() {
  const raw = String(document.getElementById('inp-guia-libros-despachados')?.value || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/**
 * Compara total esperado (tras ajuste/decomiso) con lo despachado manualmente.
 * @returns {{ tieneManual: boolean, estado: 'completo'|'pendientes'|'adicionales'|null, pendientes: number, adicionales: number, mensaje: string }}
 */
function compararDespachoConTotalGuia(totalEsperado, manualDespachados) {
  const te = Number(totalEsperado);
  if (!Number.isFinite(te) || te < 0) {
    return { tieneManual: false, estado: null, pendientes: 0, adicionales: 0, mensaje: '' };
  }
  if (manualDespachados == null) {
    return { tieneManual: false, estado: null, pendientes: 0, adicionales: 0, mensaje: '' };
  }
  const m = Number(manualDespachados);
  if (!Number.isFinite(m) || m < 0) {
    return { tieneManual: false, estado: null, pendientes: 0, adicionales: 0, mensaje: '' };
  }
  const delta = te - m;
  if (delta === 0) {
    return {
      tieneManual: true,
      estado: 'completo',
      pendientes: 0,
      adicionales: 0,
      mensaje: 'Despacho completo: coincide con el total a despachar.',
    };
  }
  if (delta > 0) {
    return {
      tieneManual: true,
      estado: 'pendientes',
      pendientes: delta,
      adicionales: 0,
      mensaje: `Faltan ${delta} libro(s) — cuentan como pendientes.`,
    };
  }
  const add = -delta;
  return {
    tieneManual: true,
    estado: 'adicionales',
    pendientes: 0,
    adicionales: add,
    mensaje: `Sobran ${add} libro(s) — cuentan como adicionales.`,
  };
}

function diaAnteriorIsoLocal(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return '';
  dt.setDate(dt.getDate() - 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function descomponerTotalesGuia(cabecera = {}) {
  const r = cabecera?.resumen_categoria || {};
  const tipo = String(cabecera?.tipo_despacho_nombre || '').toUpperCase();
  if (tipo.includes('CAT')) {
    const cat = Number(r.cat || 0);
    const asur = Number(r.asurcarnescol || 0);
    return { a: cat, b: asur, nombreA: 'CAT', nombreB: 'ASURCARNESCOL' };
  }
  if (tipo.includes('DERIVADOS')) {
    const der = Number(r.derivados || 0);
    const asur = Number(r.asurcarnes || 0);
    return { a: der, b: asur, nombreA: 'DERIVADOS', nombreB: 'ASURCARNES' };
  }
  const glo = Number(r.global_hides || 0);
  const asurG = Number(r.asurcarnes_glo || 0);
  return { a: glo, b: asurG, nombreA: 'GLOBAL HIDES', nombreB: 'ASURCARNESGLO' };
}

async function fetchGuiaData(fecha, categoria) {
  const qs = new URLSearchParams({ fecha, categoria }).toString();
  const r = await fetch(`${GUIAS_URL}/generar?${qs}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

function construirGuiaVaciaFallback(fecha, categoria) {
  const catNorm = normalizarCategoriaGuiaCodigo(categoria);
  const tipo = catNorm === 'cat'
    ? 'CAT'
    : (catNorm === 'derivados' ? 'DERIVADOS' : 'GLOBAL HIDES');
  const resumen = catNorm === 'cat'
    ? { cat: 0, asurcarnescol: 0, pendientes_hoy: 0 }
    : (catNorm === 'derivados'
      ? { derivados: 0, asurcarnes: 0, pendientes_hoy: 0 }
      : { global_hides: 0, asurcarnes_glo: 0, pendientes_hoy: 0 });
  return {
    cabecera: {
      fecha_creacion: fecha ? `${fecha}T12:00:00` : new Date().toISOString(),
      fecha_fin_vigencia: null,
      tipo_despacho_nombre: tipo,
      total_productos: 0,
      decomiso: 0,
      destino_principal: '',
      destinos: '',
      observacion_producto: 'LIBROS CRUDOS',
      resumen_categoria: resumen,
    },
    detalle: [],
  };
}

function construirGuiaDesdeResumenDia(fecha, categoria, resumenMacro) {
  const catNorm = normalizarCategoriaGuiaCodigo(categoria);
  const cats = resumenMacro?.categorias || {};
  const tipo = catNorm === 'cat'
    ? 'CAT'
    : (catNorm === 'derivados' ? 'DERIVADOS' : 'GLOBAL HIDES');
  const resumenCategoria = catNorm === 'cat'
    ? {
        cat: Number(cats.cat || 0),
        asurcarnescol: Number(cats.asurcarnescol || 0),
        pendientes_hoy: 0,
      }
    : (catNorm === 'derivados'
      ? {
          derivados: Number(cats.derivados || 0),
          asurcarnes: Number(cats.asurcarnes || 0),
          pendientes_hoy: 0,
        }
      : {
          global_hides: Number(cats.global_hides || 0),
          asurcarnes_glo: Number(cats.asurcarnes_glo || 0),
          pendientes_hoy: 0,
        });
  const total = catNorm === 'cat'
    ? Number(resumenCategoria.cat || 0) + Number(resumenCategoria.asurcarnescol || 0)
    : (catNorm === 'derivados'
      ? Number(resumenCategoria.derivados || 0) + Number(resumenCategoria.asurcarnes || 0)
      : Number(resumenCategoria.global_hides || 0) + Number(resumenCategoria.asurcarnes_glo || 0));
  return {
    cabecera: {
      fecha_creacion: fecha ? `${fecha}T12:00:00` : new Date().toISOString(),
      fecha_fin_vigencia: null,
      tipo_despacho_nombre: tipo,
      total_productos: total,
      decomiso: 0,
      destino_principal: destinoFijoGuiaPorCategoria(catNorm),
      destinos: '',
      observacion_producto: 'LIBROS CRUDOS',
      resumen_categoria: resumenCategoria,
    },
    detalle: [],
  };
}

function leerManualGuiaDesdeFormulario() {
  return {
    ajusteValor: valorEnteroGuia('inp-guia-ajuste-valor'),
    decomiso: valorEnteroGuia('inp-guia-decomiso'),
    ajusteTipo: String(document.getElementById('sel-guia-ajuste-tipo')?.value || 'pendientes').trim(),
    ajusteFecha: String(document.getElementById('inp-guia-ajuste-fecha')?.value || '').trim(),
    librosDespachados: leerLibrosDespachadosManualGuia(),
  };
}

function pintarPendientesHoyAutomatico(data) {
  const n = Number(data?.cabecera?.resumen_categoria?.pendientes_hoy || 0);
  const inp = document.getElementById('inp-guia-pendientes');
  if (inp) inp.value = String(Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);
}

function actualizarResumenControlGuia(data, manual) {
  const box = document.getElementById('guia-resumen-control');
  if (!box) return;
  const calc = calcularControlGuia(data, manual);
  const pendientesApi = Number(data?.cabecera?.resumen_categoria?.pendientes_hoy || 0);
  const cmp = compararDespachoConTotalGuia(calc.final, manual?.librosDespachados);
  let estadoBloque = '';
  if (!cmp.tieneManual) {
    estadoBloque = `<div class="guia-resumen-linea guia-resumen-hint">Libros despachados: <strong>${calc.final}</strong> (automático, igual al total). Completa el campo manual arriba si el cargue real fue distinto.</div>`;
  } else {
    const cls =
      cmp.estado === 'completo'
        ? 'guia-resumen-ok'
        : cmp.estado === 'pendientes'
          ? 'guia-resumen-warn'
          : 'guia-resumen-extra';
    estadoBloque = `<div class="guia-resumen-linea ${cls}"><strong>Control despacho:</strong> ${cmp.mensaje} <span class="guia-resumen-hint">(total esperado: ${calc.final} · ingresado: ${manual.librosDespachados})</span></div>`;
  }
  box.innerHTML = `
    <div class="guia-resumen-titulo"><strong>Control de cálculo</strong> <span class="guia-resumen-sub">(datos del día y categoría: ajuste/decomiso solo si los editaste)</span></div>
    <div class="guia-resumen-linea">Pendientes hoy (API): <strong>${pendientesApi}</strong></div>
    <div class="guia-resumen-linea">LIBROS A DESPACHAR (${calc.partes.nombreA}: ${calc.partes.a} + ${calc.partes.nombreB}: ${calc.partes.b}) = <strong>${calc.base}</strong></div>
    <div class="guia-resumen-linea">TOTAL = ${calc.base} ${calc.op} ${calc.ajusteValor} ${calc.lbl} – ${calc.decomiso} DECOMISO = <strong>${calc.final}</strong></div>
    ${estadoBloque}
  `;
}

function calcularControlGuia(data, manual = {}) {
  const c = data?.cabecera || {};
  const partes = descomponerTotalesGuia(c);
  const base = Number(partes.a || 0) + Number(partes.b || 0);
  const ajusteValor = Number(manual?.ajusteValor || 0);
  const ajusteTipo = manual?.ajusteTipo === 'adicionales' ? 'adicionales' : 'pendientes';
  const decomiso = Number(manual?.decomiso || 0);
  const totalAjustado = ajusteTipo === 'adicionales' ? (base - ajusteValor) : (base + ajusteValor);
  const final = Math.max(0, totalAjustado - decomiso);
  const op = ajusteTipo === 'adicionales' ? '-' : '+';
  const lbl = ajusteTipo === 'adicionales' ? 'ADICIONALES' : 'PENDIENTES';
  return { partes, base, ajusteValor, ajusteTipo, decomiso, totalAjustado, final, op, lbl };
}

function validarGuiaAntesDeGenerar(data, manual) {
  const calc = calcularControlGuia(data, manual);
  const errores = [];
  if (calc.ajusteValor > 0 && !String(manual?.ajusteFecha || '').trim()) {
    errores.push('Cuando hay ajuste, debes seleccionar la fecha del ajuste.');
  }
  if (calc.decomiso > calc.base + calc.ajusteValor) {
    errores.push('El decomiso no puede ser mayor al total calculado.');
  }
  return { ok: errores.length === 0, errores, calc };
}

// Editor duplicado en la vista previa eliminado: los campos de ajuste/decomiso
// ya viven en el formulario principal. Se conserva la firma como no-op por
// si algun llamado externo aun la referencia.
function renderEditorEnVistaPreviaGuia() {}

async function obtenerDataGuiaConFallback(fecha, categoria, conToast = false) {
  // Fuente principal: mismos totales del "Resumen del día"
  try {
    const rm = await fetchResumenMacro(fecha);
    if (rm?.categorias) {
      return construirGuiaDesdeResumenDia(fecha, categoria, rm);
    }
  } catch {
    // fallback a endpoint de guías
  }
  try {
    return await fetchGuiaData(fecha, categoria);
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (/No hay productos despachados/i.test(msg)) {
      if (conToast) mostrarToast('No hay despachos en esa fecha: se genera guía base en ceros', 'ok');
      return construirGuiaVaciaFallback(fecha, categoria);
    }
    throw e;
  }
}

async function generarVistaPreviaGuiaDespacho() {
  return runWithAppLoader('Preparando vista previa de guia...', async () => {
    const fecha = sincronizarFechaGuiaConFechaGlobal();
    const categoria = String(document.getElementById('sel-guia-categoria')?.value || '').trim();
    if (!fecha) {
      mostrarToast('Selecciona la fecha de salida', 'err');
      return;
    }
    if (!categoria) {
      mostrarToast('Selecciona la categoria', 'err');
      return;
    }
    let data = null;
    try {
      data = await obtenerDataGuiaConFallback(fecha, categoria, true);
    } catch (e) {
      mostrarToast(`No se pudo cargar la guía: ${e.message || e}`, 'err');
      return;
    }
    const manual = leerManualGuiaDesdeFormulario();
    pintarPendientesHoyAutomatico(data);
    actualizarResumenControlGuia(data, manual);
    const check = validarGuiaAntesDeGenerar(data, manual);
    enviarEventoAnalytics({
      eventName: 'guia_preview_control',
      viewName: _analyticsViewActual,
      meta: {
        fecha,
        categoria,
        ok: check.ok,
        base: check.calc.base,
        ajuste: check.calc.ajusteValor,
        decomiso: check.calc.decomiso,
        final: check.calc.final,
      },
    });
    const firmaGuia = await resolverFirmaGuiaParaHtml();
    const html = construirHtmlGuiaDespachoPdf(data, {
      logoDataUrl: (typeof window !== 'undefined' ? window.COLBEEF_LOGO_DATA_URL : null),
      categoria,
      manual,
      firmaGuia,
    });
    const panel = document.getElementById('guia-preview-panel');
    const body = document.getElementById('guia-preview-body');
    if (panel && body) {
      body.innerHTML = `<div style="background:#f6f6f6;padding:12px;overflow:auto"><div style="margin:0 auto;width:760px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12);box-sizing:border-box">${html}</div></div>`;
      panel.style.display = '';
    }
  });
}

async function autocompletarAjusteGuiaDesdeDiaAnterior() {
  const fecha = sincronizarFechaGuiaConFechaGlobal();
  const categoria = String(document.getElementById('sel-guia-categoria')?.value || '').trim();
  if (!fecha || !categoria) return;
  const prev = diaAnteriorIsoLocal(fecha);
  if (!prev) return;
  try {
    const dataPrev = await fetchGuiaData(prev, categoria);
    const cabPrev = dataPrev?.cabecera || {};
    const tPrev = descomponerTotalesGuia(cabPrev);
    const basePrev = Number(tPrev.a || 0) + Number(tPrev.b || 0);
    const despPrev = Number(cabPrev.total_productos || 0);
    const diffPrev = basePrev - despPrev; // >0: pendientes; <0: adicionales
    const inpAjuste = document.getElementById('inp-guia-ajuste-valor');
    const selTipo = document.getElementById('sel-guia-ajuste-tipo');
    const inpFecha = document.getElementById('inp-guia-ajuste-fecha');
    if (inpAjuste && (!String(inpAjuste.value || '').trim() || Number(inpAjuste.value) === 0)) {
      inpAjuste.value = String(Math.abs(diffPrev || 0));
    }
    if (selTipo && (!String(selTipo.value || '').trim() || selTipo.value === 'pendientes')) {
      selTipo.value = diffPrev < 0 ? 'adicionales' : 'pendientes';
    }
    if (inpFecha && !String(inpFecha.value || '').trim()) {
      inpFecha.value = prev;
    }
  } catch {
    // Si no hay guía previa, se mantiene edición manual sin bloquear.
  }
}

function urlFirmaGuiaResponsableEstatica() {
  if (typeof window === 'undefined') return 'img/firma-responsable-planta.png';
  try {
    return new URL('img/firma-responsable-planta.png', window.location.href).href;
  } catch {
    return 'img/firma-responsable-planta.png';
  }
}

/**
 * Quita blanco y grises muy uniformes (p. ej. tablero exportado por error) para dejar solo el trazo de la firma.
 * @returns {Promise<string|null>} data URL PNG o null si no aplica / falla
 */
async function firmaGuiaPngDataUrlSinFondoClaro(imageUrl) {
  if (!imageUrl || typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          resolve(null);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const maxc = Math.max(r, g, b);
          const minc = Math.min(r, g, b);
          const spread = maxc - minc;
          const sum = r + g + b;
          if (sum >= 3 * 246) {
            d[i + 3] = 0;
            continue;
          }
          if (spread <= 12 && minc >= 170 && maxc <= 248) {
            d[i + 3] = 0;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

/** Firma en guía: recorte del trazo; capturas de pantalla muy grandes se rechazan. */
const FIRMA_GUIA_MAX_ANCHO = 720;
const FIRMA_GUIA_MAX_ALTO = 560;

function medirImagenFirmaGuia(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/**
 * @returns {Promise<{ modo: 'imagen', dataUrl: string } | { modo: 'linea' }>}
 */
async function resolverFirmaGuiaParaHtml() {
  const candidato =
    typeof window !== 'undefined' && window.GUIA_FIRMA_RESPONSABLE_DATA_URL
      ? window.GUIA_FIRMA_RESPONSABLE_DATA_URL
      : urlFirmaGuiaResponsableEstatica();
  const dim = await medirImagenFirmaGuia(candidato);
  if (!dim) {
    if (typeof window !== 'undefined' && !window.__firmaGuiaAvisoCargaHecho) {
      window.__firmaGuiaAvisoCargaHecho = true;
      mostrarToast(
        'No se cargó la firma (revisar img/firma-responsable-planta.png o variable GUIA_FIRMA_RESPONSABLE_DATA_URL). Se deja línea para firmar a mano.',
        'err'
      );
    }
    return { modo: 'linea' };
  }
  if (dim.w > FIRMA_GUIA_MAX_ANCHO || dim.h > FIRMA_GUIA_MAX_ALTO) {
    if (typeof window !== 'undefined' && !window.__firmaGuiaAvisoTamanoHecho) {
      window.__firmaGuiaAvisoTamanoHecho = true;
      mostrarToast(
        `La imagen de firma mide ${dim.w}×${dim.h}px: es demasiado grande (máx. ${FIRMA_GUIA_MAX_ANCHO}×${FIRMA_GUIA_MAX_ALTO}px, solo el recorte del trazo). Se usa línea en blanco.`,
        'err'
      );
    }
    return { modo: 'linea' };
  }
  if (typeof window !== 'undefined' && window.GUIA_FIRMA_RESPONSABLE_DATA_URL) {
    return { modo: 'imagen', dataUrl: candidato };
  }
  const processed = await firmaGuiaPngDataUrlSinFondoClaro(candidato);
  if (processed) return { modo: 'imagen', dataUrl: processed };
  return { modo: 'linea' };
}

function construirHtmlGuiaDespachoPdf(data, opts = {}) {
  const cRaw = data?.cabecera || {};
  const categoria = normalizarCategoriaGuiaCodigo(opts.categoria || cRaw?.tipo_despacho_nombre);
  const c = { ...cRaw, ...plantillaGuiaPredeterminada(categoria) };
  const detalle = Array.isArray(data?.detalle) ? data.detalle : [];
  const fechaExp = fechaGuiaSolo(c.fecha_creacion);
  const fechaExpLarga = fechaGuiaLarga(c.fecha_creacion);
  const fechaVig = fechaGuiaTexto(c.fecha_fin_vigencia);
  const conductor = c.conductor_nombre || (c.id_conductor != null ? `ID ${c.id_conductor}` : '—');
  const guiaTransporte = c.numero_guia_transporte_completo || c.numero_guia_transporte || 'Colbeef - 06389 - 18';
  const destinoFijo = destinoFijoGuiaPorCategoria(categoria);
  const destinoTxt = destinoFijo || c.destino_principal || c.destinos || (detalle.find((x) => x?.destino)?.destino || '—');
  const especie = c.especie_producto || detalle.find((x) => x?.especie)?.especie || 'bovina';
  const observacionProducto = c.observacion_producto || 'LIBROS CRUDOS';
  const r = c.resumen_categoria || {};
  const manual = opts.manual || {};
  const partes = descomponerTotalesGuia(c);
  const librosADespachar = Number(partes.a || 0) + Number(partes.b || 0);
  const ajusteValor = Number.isFinite(manual.ajusteValor) ? manual.ajusteValor : 0;
  const ajusteTipo = manual.ajusteTipo === 'adicionales' ? 'adicionales' : 'pendientes';
  const ajusteFecha = String(manual.ajusteFecha || '').trim();
  const decomisoManual = Number.isFinite(manual.decomiso) ? manual.decomiso : Number(c.decomiso || 0);
  const tipo = String(c.tipo_despacho_nombre || '').toUpperCase();
  const horaDespacho = c.hora_salida || '—';
  const fechaHoraDesp = `${fechaExp} ${horaDespacho}`.trim();
  const totalBase = librosADespachar;
  const totalConAjuste = ajusteTipo === 'adicionales'
    ? totalBase - ajusteValor
    : totalBase + ajusteValor;
  const totalFinal = Math.max(0, totalConAjuste - decomisoManual);
  const librosDespManual =
    manual.librosDespachados != null && Number.isFinite(Number(manual.librosDespachados))
      ? Math.trunc(Number(manual.librosDespachados))
      : null;
  const cmpDesp = compararDespachoConTotalGuia(totalFinal, librosDespManual);
  const cantidadDespachados = librosDespManual != null ? librosDespManual : totalFinal;
  const controlPdfHtml = (() => {
    if (!cmpDesp.tieneManual) {
      return '<div style="margin-top:6px;font-size:15px;line-height:1.3"><span class="k">CONTROL:</span> <span class="v">—</span></div>';
    }
    if (cmpDesp.estado === 'completo') {
      return '<div style="margin-top:6px;font-size:15px;line-height:1.3"><span class="k">CONTROL:</span> <span class="v">DESPACHO COMPLETO</span></div>';
    }
    if (cmpDesp.estado === 'pendientes') {
      return `<div style="margin-top:6px;font-size:15px;line-height:1.3"><span class="k">CONTROL:</span> <span class="v">PENDIENTES: ${cmpDesp.pendientes}</span></div>`;
    }
    if (cmpDesp.estado === 'adicionales') {
      return `<div style="margin-top:6px;font-size:15px;line-height:1.3"><span class="k">CONTROL:</span> <span class="v">ADICIONALES: ${cmpDesp.adicionales}</span></div>`;
    }
    return '<div style="margin-top:6px;font-size:15px;line-height:1.3"><span class="k">CONTROL:</span> <span class="v">—</span></div>';
  })();
  const fechaAjusteTexto = ajusteFecha ? fechaGuiaSolo(ajusteFecha) : '';
  const sufijoAjusteHastaTotal = (() => {
    const tieneExtra = ajusteValor > 0 || decomisoManual > 0;
    let s = '';
    if (ajusteValor > 0) {
      const sign = ajusteTipo === 'adicionales' ? '-' : '+';
      const lbl = ajusteTipo === 'adicionales' ? 'ADICIONALES' : 'PENDIENTES';
      s += ` ${sign} ${ajusteValor} ${lbl}`;
      if (fechaAjusteTexto) s += ` DEL ${fechaAjusteTexto}`;
    }
    if (decomisoManual > 0) s += ` - ${decomisoManual} DECOMISO`;
    if (tieneExtra) s += ` = ${totalFinal}`;
    return s;
  })();

  const fg = opts.firmaGuia && opts.firmaGuia.modo === 'imagen' && opts.firmaGuia.dataUrl
    ? opts.firmaGuia
    : { modo: 'linea' };
  const firmaCeldaHtml =
    fg.modo === 'imagen' && fg.dataUrl
      ? `<div class="guia-firma-wrap"><img class="guia-firma-img" src="${escapeHtml(fg.dataUrl)}" alt="" /></div>`
      : '<div class="guia-firma-line" aria-hidden="true"></div>';

  let bloqueTotales = '';
  if (tipo.includes('CAT')) {
    bloqueTotales = `
      <div class="resumen">
        <div><span class="k">LIBROS A DESPACHAR:</span> <span class="v">${Number(r.cat || 0)} + ${Number(r.asurcarnescol || 0)} = ${librosADespachar}${sufijoAjusteHastaTotal}</span></div>
        <div style="margin-top:6px"><span class="k">LIBROS DESPACHADOS:</span> <span class="v">${cantidadDespachados}</span></div>
        ${controlPdfHtml}
        <div style="margin-top:8px"><span class="k">CAT:</span> <span class="v">${Number(r.cat || 0)}</span></div>
        <div><span class="k">ASURCARNESCOL:</span> <span class="v">${Number(r.asurcarnescol || 0)}</span></div>
      </div>
    `;
  } else if (tipo.includes('DERIVADOS')) {
    bloqueTotales = `
      <div class="resumen">
        <div><span class="k">LIBROS A DESPACHAR:</span> <span class="v">${Number(r.derivados || 0)} + ${Number(r.asurcarnes || 0)} = ${librosADespachar}${sufijoAjusteHastaTotal}</span></div>
        <div style="margin-top:6px"><span class="k">LIBROS DESPACHADOS:</span> <span class="v">${cantidadDespachados}</span></div>
        ${controlPdfHtml}
        <div style="margin-top:8px"><span class="k">DERIVADOS:</span> <span class="v">${Number(r.derivados || 0)}</span></div>
        <div><span class="k">ASURCARNES:</span> <span class="v">${Number(r.asurcarnes || 0)}</span></div>
      </div>
    `;
  } else {
    bloqueTotales = `
      <div class="resumen">
        <div><span class="k">LIBROS A DESPACHAR:</span> <span class="v">${Number(r.global_hides || 0)} + ${Number(r.asurcarnes_glo || 0)} = ${librosADespachar}${sufijoAjusteHastaTotal}</span></div>
        <div style="margin-top:6px"><span class="k">LIBROS DESPACHADOS:</span> <span class="v">${cantidadDespachados}</span></div>
        ${controlPdfHtml}
        <div style="margin-top:8px"><span class="k">GLOBAL HIDES:</span> <span class="v">${Number(r.global_hides || 0)}</span></div>
        <div><span class="k">ASURCARNESGLO:</span> <span class="v">${Number(r.asurcarnes_glo || 0)}</span></div>
      </div>
    `;
  }

  const logoHtml = `<div class="logo-txt"><span class="logo-col">Col</span><span class="logo-beef">beef</span></div>`;

  return `
  <style>
    .guia-pdf-root{font-family:Arial,sans-serif;color:#111;margin:0;padding:6px 10px;font-size:10.5px;background:#fff;width:100%;box-sizing:border-box}
    .h-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px}
    .h-top > div:first-child{flex:0 0 auto;min-width:200px}
    .h-top > table{flex:1 1 auto;max-width:360px}
    .cap{font-size:10px;margin-bottom:4px;text-align:center;letter-spacing:.2px;font-weight:700}
    .logo-txt{font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:46px;font-weight:900;line-height:1;letter-spacing:-2px;white-space:nowrap;margin:0;padding:0;display:inline-block}
    .logo-col{color:#1A7A42}
    .logo-beef{color:#C0392B}
    .t{width:100%;border-collapse:collapse;table-layout:fixed;page-break-inside:avoid}
    .t th,.t td{border:1px solid #333;padding:2px 5px;vertical-align:top;word-wrap:break-word;overflow-wrap:break-word;font-size:10px;line-height:1.3}
    .t th{font-weight:700;background:#f2f2f2;text-align:center}
    .t-kv td:first-child{font-weight:600;width:38%;background:#fafafa}
    .sec{margin-top:5px;page-break-inside:avoid}
    .sec-title{font-size:12.5px;margin:6px 0 3px;font-weight:800;letter-spacing:.2px}
    .k{font-weight:700}
    .v{font-weight:800;color:#C0392B}
    .resumen{font-size:16px;margin-top:5px;line-height:1.25;page-break-inside:avoid}
    .firma{margin-top:8px;page-break-inside:avoid}
    table.t.t-kv.firma{table-layout:auto}
    .firma td{padding:4px 6px;font-size:10.5px;overflow:visible}
    .firma td:first-child{width:36%;min-width:140px;font-weight:700;white-space:normal}
    .guia-firma-wrap{display:inline-block;line-height:0}
    .guia-firma-img{max-height:48px;max-width:260px;width:auto;height:auto;object-fit:contain;display:block;vertical-align:top}
    .guia-firma-line{min-height:38px;border-bottom:1.5px solid #111;max-width:100%;width:100%;box-sizing:border-box;margin-top:4px}
    .nota{font-size:9px;margin-top:6px;line-height:1.3;text-align:justify}
  </style>
<div class="guia-pdf-root">
  <div class="cap">UNICAMENTE PARA CONSUMO NACIONAL GUIA DE TRANSPORTE DE SUBPRODUCTOS NO COMESTIBLES</div>
  <div class="h-top">
    <div>
      ${logoHtml}
    </div>
    <table class="t" style="max-width:420px">
      <tr><th>FECHA DE EXPEDICION</th><th>Numero</th></tr>
      <tr><td>${escapeHtml(fechaExpLarga)}</td><td>${escapeHtml(String(guiaTransporte))}</td></tr>
    </table>
  </div>

  <div class="sec sec-title">1. IDENTIFICACION DE LA PLANTA DE BENEFICIO DE PROCEDENCIA</div>
  <table class="t t-kv">
    <tr><td>Planta de Beneficio</td><td>${escapeHtml(c.planta_beneficio || 'Colbeef S.A.S')}</td></tr>
    <tr><td>Direccion o ubicacion</td><td>${escapeHtml(c.direccion_planta || '—')}</td></tr>
    <tr><td>Fecha (dd/mm/aaaa) y Hora (hh:mm) despacho</td><td>${escapeHtml(fechaHoraDesp)}</td></tr>
    <tr><td>Código Invima</td><td>${escapeHtml(c.codigo_invima || '—')}</td></tr>
    <tr><td>Departamento</td><td>${escapeHtml(c.departamento_planta || '—')}</td></tr>
    <tr><td>Ciudad</td><td>${escapeHtml(c.ciudad_planta || '—')}</td></tr>
  </table>

  <div class="sec sec-title">2. TIPO DE PRODUCTO</div>
  <table class="t">
    <colgroup>
      <col style="width:5%">
      <col style="width:42%">
      <col style="width:14%">
      <col style="width:13%">
      <col style="width:26%">
    </colgroup>
    <tr><th></th><th>Producto</th><th>Especie</th><th>Peso</th><th>observación</th></tr>
    <tr><td style="text-align:center">1</td><td>Sub-Productos no comestibles libros crudos</td><td>${escapeHtml(especie)}</td><td></td><td>${escapeHtml(observacionProducto)}</td></tr>
  </table>

  <div class="sec sec-title">3. VEHICULO TRANSPORTADOR</div>
  <table class="t t-kv">
    <tr><td>Nombre del Conductor</td><td>${escapeHtml(conductor)}</td></tr>
    <tr><td>Cedula de ciudadanía</td><td>${escapeHtml(String(c.id_conductor || '—'))}</td></tr>
    <tr><td>Tipo de vehículo</td><td>${escapeHtml(c.tipo_vehiculo || 'TRANSPORTE DE ALIMENTO NO COMESTIBLE')}</td></tr>
    <tr><td>Placas</td><td>${escapeHtml(c.placa || '—')}</td></tr>
    <tr><td>Precinto</td><td>${escapeHtml(c.precinto || '—')}</td></tr>
  </table>

  <div class="sec sec-title">4. DESTINO: ${escapeHtml(destinoTxt)}${tipo ? `, ${escapeHtml(tipo)}` : ''}</div>
  ${bloqueTotales}

  <table class="t t-kv firma">
    <tr><td>NOMBRE COMPLETO:</td><td>${escapeHtml(c.firma_responsable || c.responsable || '—')}</td></tr>
    <tr><td>FIRMA RESPONSABLE PLANTA DE BENEFICIO:</td><td>${firmaCeldaHtml}</td></tr>
    <tr><td>CEDULA DE CIUDADANIA:</td><td>${escapeHtml(c.firma_cedula || '—')}</td></tr>
    <tr><td>CARGO:</td><td>${escapeHtml(c.firma_cargo || '—')}</td></tr>
  </table>

  <div class="nota">
    Esta guía se expide bajo responsabilidad de la planta de beneficio y su alteración, modificación o sustitución,
    será objeto de las acciones penales correspondientes conforme a la Ley 906 de 2004.
  </div>
</div>
`;
}

async function descargarPdfGuiaDespacho() {
  return runWithAppLoader('Generando guia de despacho en PDF...', async () => {
    const fecha = sincronizarFechaGuiaConFechaGlobal();
    const categoria = String(document.getElementById('sel-guia-categoria')?.value || '').trim();
    const manual = leerManualGuiaDesdeFormulario();
    if (!fecha) {
      mostrarToast('Selecciona la fecha de salida', 'err');
      return;
    }
    if (!categoria) {
      mostrarToast('Selecciona la categoria', 'err');
      return;
    }

    let data = null;
    try {
      data = await obtenerDataGuiaConFallback(fecha, categoria, true);
    } catch (e) {
      mostrarToast(`No se pudo cargar la guia: ${e.message || e}`, 'err');
      return;
    }

    pintarPendientesHoyAutomatico(data);
    const check = validarGuiaAntesDeGenerar(data, manual);
    actualizarResumenControlGuia(data, manual);
    if (!check.ok) {
      mostrarToast(check.errores[0], 'err');
      enviarEventoAnalytics({
        eventName: 'guia_generate_blocked',
        viewName: _analyticsViewActual,
        meta: { fecha, categoria, error: check.errores[0] },
      });
      return;
    }
    const firmaGuia = await resolverFirmaGuiaParaHtml();
    const html = construirHtmlGuiaDespachoPdf(data, {
      logoDataUrl: (typeof window !== 'undefined' ? window.COLBEEF_LOGO_DATA_URL : null),
      categoria,
      manual,
      firmaGuia,
    });
    // Formato CARTA (Letter 8.5" x 11" = 215.9 x 279.4 mm).
    // Margen 6mm => area util ~ 203.9 x 267.4 mm.
    // 760px a 96 DPI ~ 201mm => calza dentro del area util sin recortes laterales.
    const htmlForPdf = `<div style="width:760px;background:#fff;box-sizing:border-box;font-family:Arial,sans-serif">${html}</div>`;
    try {
      const h2p = await ensureHtml2PdfDisponible();
      await h2p()
        .set({
          margin: [6, 6, 6, 6],
          filename: `Guia_Despacho_${categoria}_${fecha}.pdf`,
          image: { type: 'png', quality: 1 },
          html2canvas: {
            scale: PDF_HTML2CANVAS_SCALE,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
          },
          jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait', compress: true },
          pagebreak: {
            mode: ['avoid-all', 'css', 'legacy'],
            avoid: ['.t', '.sec', '.resumen', '.firma', '.nota', '.h-top'],
          },
        })
        .from(htmlForPdf, 'string')
        .save();
      mostrarToast('Guia PDF generada', 'ok');
      enviarEventoAnalytics({
        eventName: 'export_pdf',
        viewName: _analyticsViewActual,
        meta: {
          archivo: `Guia_Despacho_${categoria}_${fecha}`,
          base: check.calc.base,
          ajuste: check.calc.ajusteValor,
          decomiso: check.calc.decomiso,
          total_final: check.calc.final,
          ajuste_tipo: check.calc.ajusteTipo,
        },
      });
    } catch (e) {
      mostrarToast(`No se pudo generar PDF: ${e.message || e}`, 'err');
    }
  });
}

if (fechaGuiaEl) {
  fechaGuiaEl.addEventListener('change', () => {
    void autocompletarAjusteGuiaDesdeDiaAnterior();
  });
}
if (fechaGlobalEl) {
  fechaGlobalEl.addEventListener('change', () => {
    sincronizarFechaGuiaConFechaGlobal();
    void autocompletarAjusteGuiaDesdeDiaAnterior();
    const fecha = String(document.getElementById('inp-guia-fecha')?.value || '').trim();
    const categoria = String(document.getElementById('sel-guia-categoria')?.value || '').trim();
    if (!fecha || !categoria) return;
    void (async () => {
      try {
        const data = await obtenerDataGuiaConFallback(fecha, categoria, false);
        pintarPendientesHoyAutomatico(data);
        actualizarResumenControlGuia(data, leerManualGuiaDesdeFormulario());
      } catch {
        /* ignore */
      }
    })();
  });
}
const selGuiaCategoriaEl = document.getElementById('sel-guia-categoria');
if (selGuiaCategoriaEl) {
  selGuiaCategoriaEl.addEventListener('change', () => {
    void autocompletarAjusteGuiaDesdeDiaAnterior();
    const fecha = String(document.getElementById('inp-guia-fecha')?.value || '').trim();
    const categoria = String(document.getElementById('sel-guia-categoria')?.value || '').trim();
    if (!fecha || !categoria) return;
    void (async () => {
      try {
        const data = await obtenerDataGuiaConFallback(fecha, categoria, false);
        pintarPendientesHoyAutomatico(data);
        actualizarResumenControlGuia(data, leerManualGuiaDesdeFormulario());
      } catch {
        /* ignore */
      }
    })();
  });
}
['inp-guia-ajuste-valor', 'sel-guia-ajuste-tipo', 'inp-guia-ajuste-fecha', 'inp-guia-decomiso', 'inp-guia-libros-despachados']
  .forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const refrescar = () => {
      const fecha = String(document.getElementById('inp-guia-fecha')?.value || '').trim();
      const categoria = String(document.getElementById('sel-guia-categoria')?.value || '').trim();
      if (!fecha || !categoria) return;
      void (async () => {
        try {
          const data = await obtenerDataGuiaConFallback(fecha, categoria, false);
          pintarPendientesHoyAutomatico(data);
          actualizarResumenControlGuia(data, leerManualGuiaDesdeFormulario());
        } catch {
          /* ignore */
        }
      })();
    };
    el.addEventListener('change', refrescar);
    if (id === 'inp-guia-libros-despachados') el.addEventListener('input', refrescar);
  });

sincronizarFechaGuiaConFechaGlobal();
void (async () => {
  const fecha = String(document.getElementById('inp-guia-fecha')?.value || '').trim();
  const categoria = String(document.getElementById('sel-guia-categoria')?.value || '').trim();
  if (!fecha || !categoria) return;
  try {
    const data = await obtenerDataGuiaConFallback(fecha, categoria, false);
    pintarPendientesHoyAutomatico(data);
    actualizarResumenControlGuia(data, leerManualGuiaDesdeFormulario());
  } catch {
    /* ignore */
  }
})();

function descargarExcel(nombre, html) {
  const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.xls`;
  a.click();
  URL.revokeObjectURL(a.href);
  mostrarToast('Excel generado', 'ok');
  enviarEventoAnalytics({
    eventName: 'export_excel',
    viewName: _analyticsViewActual,
    meta: { archivo: `${nombre}.xls` },
  });
}

/**
 * Marca Colbeef solo en export (no en vista previa).
 * `paraExcel: true` → texto bicolor (Excel no muestra imágenes data:URL en .xls y las marca como rotas).
 * `paraExcel: false` (por defecto en HTML descargado) → img embebida, visible en el navegador.
 */
async function obtenerMarcaExportColbeefImgHtml(opts = {}) {
  if (opts.paraExcel === true) {
    return (
      '<span style="font-family:Arial Black,Arial,sans-serif;font-size:15px;font-weight:bold;letter-spacing:-0.5px;white-space:nowrap">' +
      '<span style="color:#2e7d32">Col</span>' +
      '<span style="color:#c62828">beef</span>' +
      '</span>'
    );
  }
  let dataUrl = typeof window !== 'undefined' && window.COLBEEF_LOGO_DATA_URL;
  if (!dataUrl) {
    try {
      const href = new URL('assets/colbeef-logo.png', window.location.href).href;
      const r = await fetch(href, { cache: 'force-cache' });
      if (r.ok) {
        const blob = await r.blob();
        dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      }
    } catch {
      dataUrl = null;
    }
  }
  if (!dataUrl) {
    return (
      '<span style="font-family:Arial Black,Arial,sans-serif;font-size:15px;font-weight:bold;white-space:nowrap">' +
      '<span style="color:#2e7d32">Col</span><span style="color:#c62828">beef</span></span>'
    );
  }
  return `<img class="rep-export-logo-img" src="${dataUrl}" alt="Colbeef" style="height:26px;max-width:100px;width:auto;object-fit:contain;vertical-align:middle;border:0;display:inline-block;-ms-interpolation-mode:bicubic" />`;
}

/** Texto de salida para reporte cliente: despacho en rango, luego salida cava en vista, si no Pendiente. */
function textoSalidaReporteExport(d, salidas, desde, hasta) {
  const desp = salidaDisplayEnRango(d.id_producto, salidas, desde, hasta, d);
  if (desp) return formatFecha(desp);
  return 'Pendiente';
}

async function descargarExcelReporteCliente() {
  return runWithAppLoader('Generando archivo Excel...', async () => {
    const ctx = await obtenerContextoReporteCliente();
    if (!ctx) return;
    // Unificar diseño para todas las exportaciones por agrupación:
    // una hoja por grupo con formato tipo Asur (IDs + pivote cliente/plaza).
    const byGrupo = new Map();
    (ctx.filtrados || []).forEach((d) => {
      const g = String(etiquetaAgrupacionMacro(d) || 'AGRUPACION').trim().toUpperCase();
      if (!byGrupo.has(g)) byGrupo.set(g, []);
      byGrupo.get(g).push(d);
    });
    const orden = ordenGruposMacro([...byGrupo.keys()]);
    const sheets = orden.map((g) => ({
      name: String(g || 'AGRUPACION').slice(0, 31),
      rows: rowsAsurDualSheet(byGrupo.get(g) || [], g, ctx.hasta),
    }));
    if (!sheets.length) {
      mostrarToast('Sin datos para exportar en el rango seleccionado', 'err');
      return;
    }
    const slug = ctx.agrupacionCodigo ? String(ctx.agrupacionCodigo).replace(/[^\w\-]+/g, '_') : 'Todos';
    const nombre = `Reporte_Agrupacion_${slug}_${ctx.desde}_a_${ctx.hasta}`;
    descargarExcelMultiHojaXml(nombre, sheets);
    const metaArchivo = ctx.agrupacionCodigo
      ? `Agrupación individual (${sheets[0]?.name || 'AGRUPACION'})`
      : `Agrupaciones (${sheets.length} hojas)`;
    enviarEventoAnalytics({
      eventName: 'export_excel',
      viewName: _analyticsViewActual,
      meta: { archivo: metaArchivo, desde: ctx.desde, hasta: ctx.hasta },
    });
  });
}

function escapeXml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function agrCodigoNorm(d) {
  return String(codigoAgrupacionMacro(d)).trim().toLowerCase() || 'asurcarnes';
}

function rowsResumenAsurSheet(items, nombreGrupo) {
  const rows = contarPorClienteComercialPuesto(items || [], nombreGrupo);
  const out = [];
  const total = rows.reduce((s, r) => s + Number(r.cantidad || 0), 0);
  out.push(['CLIENTE / PUESTO', 'CANTIDAD']);
  if (!rows.length) {
    out.push(['Sin datos para este grupo en el rango', '0']);
    return { rows: out, total: 0 };
  }
  const byCli = new Map();
  rows.forEach((r) => {
    const c = String(r.cliente || 'SIN ASIGNAR');
    if (!byCli.has(c)) byCli.set(c, []);
    byCli.get(c).push(r);
  });
  [...byCli.keys()].sort((a, b) => a.localeCompare(b)).forEach((cli) => {
    const sub = byCli.get(cli).sort((a, b) => String(a.ubicacion || '').localeCompare(String(b.ubicacion || '')));
    const tCli = sub.reduce((s, x) => s + Number(x.cantidad || 0), 0);
    out.push([String(cli).toUpperCase(), String(tCli)]);
    sub.forEach((s) => out.push([`  - ${String(s.ubicacion || '—')}`, String(s.cantidad || 0)]));
  });
  out.push(['TOTAL GENERAL', String(total)]);
  return { rows: out, total };
}

function rowsDetalleAsurSheet(items, nombreGrupo) {
  const sorted = [...(items || [])].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  const out = [['ID PRODUCTO', 'PROPIETARIO', 'CLIENTE RESUMEN', 'PLAZA / PUESTO', 'OBSERVACION']];
  sorted.forEach((d) => {
    const cli = clientePivotMacro(d, nombreGrupo);
    out.push([
      String(d?.id_producto || '—'),
      String(d?.propietario || 'SIN ASIGNAR').toUpperCase(),
      String(cli || 'SIN ASIGNAR').toUpperCase(),
      String(resolverPlazaReporte(d, nombreGrupo) || '—'),
      String(d?.observacion || d?.observaciones || '—'),
    ]);
  });
  return out;
}

function rowsAsurDualSheet(items, nombreGrupo, fechaISO) {
  const listSorted = [...(items || [])].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  const resumen = rowsResumenAsurSheet(items || [], nombreGrupo).rows;
  const leftRows = [
    [
      { v: 'Identificación', style: 'sLeftHead' },
      { v: 'Empresa propietaria', style: 'sLeftHead' },
      { v: 'Vísceras blancas', style: 'sLeftHead' },
    ],
    ...listSorted.map((d, idx) => ([
      { v: String(d?.id_producto || '—'), style: idx % 2 ? 'sLeftIdAlt' : 'sLeftId' },
      { v: String(d?.propietario || 'SIN ASIGNAR').toUpperCase(), style: idx % 2 ? 'sLeftCellAlt' : 'sLeftCell' },
      { v: String(resolverPlazaReporte(d, nombreGrupo) || '—').toUpperCase(), style: idx % 2 ? 'sLeftCellAlt' : 'sLeftCell' },
    ])),
  ];

  const rightRows = [
    [
      { v: `LISTA LIBRILLOS ${String(nombreGrupo || '').toUpperCase()}`, style: 'sTitle' },
      { v: formatFechaCorta(fechaISO), style: 'sTitleDate' },
    ],
    ...resumen.map((r, idx) => {
      const l = String(r?.[0] || '');
      const q = String(r?.[1] || '');
      if (/^CLIENTE \/ PUESTO$/i.test(l)) return [{ v: l, style: 'sHeadL' }, { v: q, style: 'sHeadR' }];
      if (/^TOTAL GENERAL$/i.test(l)) return [{ v: l, style: 'sTotalL' }, { v: q, style: 'sTotalR' }];
      if (/^\s*-\s+/.test(l)) return [{ v: l, style: 'sChildL' }, { v: q, style: 'sChildR' }];
      return [{ v: l, style: 'sGroupL' }, { v: q, style: 'sGroupR' }];
    }),
  ];

  const rows = [];
  // Bloque derecho inicia en columnas G/H (7/8), separado del bloque izquierdo.
  rows.push([
    { v: 'Identificación', style: 'sLeftHead', col: 1 },
    { v: 'Empresa propietaria', style: 'sLeftHead', col: 2 },
    { v: 'Vísceras blancas', style: 'sLeftHead', col: 3 },
    { v: `LISTA LIBRILLOS ${String(nombreGrupo || '').toUpperCase()}`, style: 'sTitle', col: 7 },
    { v: formatFechaCorta(fechaISO), style: 'sTitleDate', col: 8 },
  ]);
  rows.push([
    { v: 'CLIENTE / PUESTO', style: 'sHeadL', col: 7 },
    { v: 'CANTIDAD', style: 'sHeadR', col: 8 },
  ]);

  // Contenido de ambas tablas con posicionamiento independiente por columna.
  const maxRows = Math.max(leftRows.length, Math.max(0, rightRows.length - 2));
  for (let i = 0; i < maxRows; i++) {
    const rowCells = [];
    const l = leftRows[i] || null;
    const r = rightRows[i + 2] || null;
    if (l) {
      rowCells.push({ ...l[0], col: 1 }, { ...l[1], col: 2 }, { ...l[2], col: 3 });
    }
    if (r) {
      rowCells.push({ ...r[0], col: 7 }, { ...r[1], col: 8 });
    }
    rows.push(rowCells.length ? rowCells : [{ v: '', style: 'sBlank', col: 1 }]);
  }
  return rows;
}

function descargarExcelMultiHojaXml(nombreBase, sheets) {
  const safeName = String(nombreBase || 'Reporte').replace(/[^\w\-]+/g, '_');
  const xmlSheets = sheets.map((s) => {
    const sheetName = String(s.name || 'Hoja').slice(0, 31);
    let inDetalle = false;
    let nextDetalleHeader = false;
    const rowsXml = (s.rows || [])
      .map((r, rowIdx) => {
        const row = Array.isArray(r) ? r : [];
        const first = String(row[0] || '').trim();
        if (/^DETALLE POR IDs/i.test(first)) {
          inDetalle = true;
          nextDetalleHeader = true;
        }
        const cells = row.map((c, colIdx) => {
          const isObj = c && typeof c === 'object' && !Array.isArray(c);
          const raw = String(isObj ? (c.v ?? c.value ?? '') : c ?? '');
          const isNum = /^-?\d+(\.\d+)?$/.test(raw.trim());
          const isRightCol = colIdx > 0;
          const colIndex = isObj && Number.isFinite(Number(c.col)) ? Number(c.col) : null;
          let style = isObj && c.style ? String(c.style) : (isRightCol ? 'sCellR' : 'sCellL');

          // Solo inferir estilos cuando la celda no trae estilo explícito.
          if (!(isObj && c.style)) {
            if (rowIdx === 0) style = isRightCol ? 'sTitleDate' : 'sTitle';
            else if (rowIdx === 1 && /^CLIENTE \/ PUESTO$/i.test(first)) style = isRightCol ? 'sHeadR' : 'sHeadL';
            else if (rowIdx === 1) style = 'sMeta';
            else if (!raw && row.length <= 1) style = 'sBlank';
            else if (/^CLIENTE \/ PUESTO$/i.test(first)) style = isRightCol ? 'sHeadR' : 'sHeadL';
            else if (/^TOTAL GENERAL$/i.test(first)) style = isRightCol ? 'sTotalR' : 'sTotalL';
            else if (inDetalle && /^DETALLE POR IDs/i.test(first)) style = 'sDetBlock';
            else if (inDetalle && nextDetalleHeader) style = isRightCol ? 'sDetHeadR' : 'sDetHeadL';
            else if (inDetalle) style = isRightCol ? 'sDetCellR' : 'sDetCellL';
            else if (/^\s*-\s+/.test(first)) style = isRightCol ? 'sChildR' : 'sChildL';
            else style = isRightCol ? 'sGroupR' : 'sGroupL';
          }

          if (nextDetalleHeader) nextDetalleHeader = false;
          const idxAttr = colIndex && colIndex > 1 ? ` ss:Index="${colIndex}"` : '';
          if (isObj && c.type === 'string') {
            return `<Cell${idxAttr} ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(raw)}</Data></Cell>`;
          }
          if (isNum && Number.isFinite(Number(raw))) {
            return `<Cell${idxAttr} ss:StyleID="${style}"><Data ss:Type="Number">${Number(raw)}</Data></Cell>`;
          }
          return `<Cell${idxAttr} ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(raw)}</Data></Cell>`;
        }).join('');
        return `<Row>${cells}</Row>`;
      })
      .join('');
    return `<Worksheet ss:Name="${escapeXml(sheetName)}">
      <Table>
        <Column ss:AutoFitWidth="0" ss:Width="130"/>
        <Column ss:AutoFitWidth="0" ss:Width="230"/>
        <Column ss:AutoFitWidth="0" ss:Width="175"/>
        <Column ss:AutoFitWidth="0" ss:Width="20"/>
        <Column ss:AutoFitWidth="0" ss:Width="20"/>
        <Column ss:AutoFitWidth="0" ss:Width="20"/>
        <Column ss:AutoFitWidth="0" ss:Width="260"/>
        <Column ss:AutoFitWidth="0" ss:Width="95"/>
        ${rowsXml}
      </Table>
    </Worksheet>`;
  }).join('');

  const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Borders/>
      <Font ss:FontName="Calibri" ss:Size="11"/>
      <Interior/>
      <NumberFormat/>
      <Protection/>
    </Style>
    <Style ss:ID="sBlank"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sTitle">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
      <Font ss:Bold="1" ss:Size="13"/>
      <Interior ss:Color="#C8E6C9" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sTitleDate">
      <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
      <Font ss:Bold="1" ss:Size="13"/>
      <Interior ss:Color="#C8E6C9" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sMeta"><Font ss:Bold="1"/><Interior ss:Color="#E8F5E9" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sHeadL">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
      <Font ss:Bold="1" ss:Color="#111111"/>
      <Interior ss:Color="#D9D9D9" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sHeadR">
      <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
      <Font ss:Bold="1" ss:Color="#111111"/>
      <Interior ss:Color="#D9D9D9" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sGroupL"><Font ss:Bold="1"/><Interior ss:Color="#FFB74D" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sGroupR"><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#D50000"/><Interior ss:Color="#FFB74D" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sChildL"><Interior ss:Color="#DCEAF7" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sChildR"><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><Interior ss:Color="#DCEAF7" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sTotalL"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Size="14"/><Interior ss:Color="#FF66FF" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sTotalR"><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><Font ss:Bold="1" ss:Size="14"/><Interior ss:Color="#FF66FF" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sCellL"><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2DC"/></Borders></Style>
    <Style ss:ID="sCellR"><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E2DC"/></Borders></Style>
    <Style ss:ID="sDetBlock"><Font ss:Bold="1"/><Interior ss:Color="#F3E5F5" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sDetHeadL"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#455A64" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sDetHeadR"><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#455A64" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sDetCellL"><Interior ss:Color="#FAFAFA" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sDetCellR"><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><Interior ss:Color="#FAFAFA" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sMetaBrand"><Font ss:Bold="1" ss:Color="#1A7A42"/></Style>
    <Style ss:ID="sLeftHead"><Font ss:Bold="1"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#D9D9D9" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sLeftCell"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sLeftCellAlt"><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sLeftId"><Font ss:Color="#C0392B" ss:Bold="1"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="sLeftIdAlt"><Font ss:Color="#C0392B" ss:Bold="1"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/><Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  </Styles>
  ${xmlSheets}
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName}.xls`;
  a.click();
  URL.revokeObjectURL(a.href);
  mostrarToast('Excel multihoja generado', 'ok');
}

async function descargarExcelAsurEspecial(modo = 'resumen') {
  return runWithAppLoader('Generando Excel especial de Asurcarnes...', async () => {
    const desde = document.getElementById('fecha-rep-cli-desde')?.value;
    const hasta = document.getElementById('fecha-rep-cli-hasta')?.value;
    if (!validarRangoReportes(desde, hasta)) return;
    const dias = rangoFechasISO(desde, hasta).length;
    if (dias > 95) {
      mostrarToast('El rango no puede superar 95 días', 'err');
      return;
    }
    const datos = await fetchDatosRango(desde, hasta);
    const base = (datos || []).filter(esLibrilloParaReporteAgrupacion);
    const grupos = [
      { code: 'asurcarnes', name: 'ASURCARNES' },
      { code: 'asurcarnes_glo', name: 'ASURCARNESGLO' },
      { code: 'asurcarnescol', name: 'ASURCARNESCOL' },
    ];
    const sheets = grupos.map((g) => {
      const items = base.filter((d) => agrCodigoNorm(d) === g.code);
      const rows = rowsAsurDualSheet(items, g.name, hasta);
      return { name: g.name, rows };
    });
    const totalData = sheets.reduce((s, sh) => s + (sh.rows.length > 5 ? 1 : 0), 0);
    if (!totalData) {
      mostrarToast('Sin datos ASURCARNES/ASURCARNESGLO/ASURCARNESCOL en el rango', 'err');
      return;
    }
    const suf = modo === 'resumen_detalle' ? 'resumen_detalle' : 'resumen';
    descargarExcelMultiHojaXml(`Reporte_Asurcarnes_3hojas_${suf}_${desde}_a_${hasta}`, sheets);
    enviarEventoAnalytics({
      eventName: 'export_excel',
      viewName: _analyticsViewActual,
      meta: { archivo: `Asurcarnes 3 hojas (${suf})`, desde, hasta },
    });
  });
}

async function descargarPDFReporteGeneralRango() {
  await descargarPDFTotales();
}

function snapshotObservaciones(datos) {
  const arr = (datos || [])
    .map(d => `${d.id_producto}||${String(d.observacion || '').trim()}`)
    .sort();
  return arr.join('##');
}

function tipoRegistroNotificacion(d) {
  if (!d) return 'OBSERVACION';
  const obs = normalizarObs(String(d.observacion || ''));
  const tieneCrudas = /\bCRUDAS?\b/.test(obs);
  const tieneRetiro = !!(d?.cliente_destino && String(d.cliente_destino).trim()) || /RETIRAR\s+LIBRILLOS\b/.test(obs);
  // Para notificación priorizamos CRUDA cuando la observación contiene CRUDAS/CRUDA.
  if (tieneCrudas) return 'CRUDA';
  if (tieneRetiro) return 'LIBRILLO';
  return 'OBSERVACION';
}

function obtenerCambiosObservacion(prev, next, obsMapPrev = new Map(), obsMapNow = new Map()) {
  const prevMap = new Map((prev || []).map(d => [String(d.id_producto), d]));
  const nextMap = new Map((next || []).map(d => [String(d.id_producto), d]));
  const cambios = [];
  const ids = new Set([...prevMap.keys(), ...nextMap.keys()]);
  ids.forEach((id) => {
    const p = prevMap.get(id);
    const n = nextMap.get(id);
    // Priorizar siempre texto completo de observación desde backend (/observaciones),
    // y usar el texto de fila solo como respaldo.
    const antesMap = String(obsMapPrev.get(id) || '').trim();
    const despuesMap = String(obsMapNow.get(id) || '').trim();
    const antesFila = p ? String(p.observaciones || p.observacion || '').trim() : '';
    const despuesFila = n ? String(n.observaciones || n.observacion || '').trim() : '';
    const antes = antesMap || antesFila;
    const despues = despuesMap || despuesFila;

    // Caso 1: sigue en la vista, pero cambió observación.
    if (p && n && antes !== despues) {
      cambios.push({ id, tipo: tipoRegistroNotificacion(n), antes, despues });
    }
    // Caso 2: salió de la vista actual por cambio de observación (no cuenta en librillo/cruda).
    if (p && !n) {
      const obsNueva = despuesMap;
      const obsAnterior = antesMap || antesFila;
      cambios.push({
        id,
        tipo: 'OBSERVACION',
        antes: obsAnterior || antes || '—',
        despues: obsNueva || '[Sin conteo en vista actual]',
      });
      return;
    }
    // Caso 3: entró a la vista actual por cambio/alta.
    if (!p && n) {
      const obsAnterior = antesMap;
      cambios.push({
        id,
        tipo: tipoRegistroNotificacion(n),
        antes: obsAnterior || '[No estaba en vista]',
        despues,
      });
    }

    // Crudas: cambio de sucursal en planilla (logística debe reimprimir etiqueta con puesto correcto).
    if (p && n) {
      const nObsRaw = String(n.observaciones ?? n.observacion ?? '');
      const nObsNorm = normalizarObs(nObsRaw);
      if (/\bCRUDAS?\b/.test(nObsNorm)) {
        const sAnt = String(p.sucursal ?? '').replace(/\s+/g, ' ').trim();
        const sNue = String(n.sucursal ?? '').replace(/\s+/g, ' ').trim();
        if (sAnt !== sNue) {
          cambios.push({
            id,
            tipo: 'CRUDA_SUCURSAL',
            antes: sAnt || '—',
            despues: sNue || '—',
            sucursal_antes: sAnt,
            sucursal_despues: sNue,
            observacion_texto: nObsRaw.replace(/\s+/g, ' ').trim(),
            propietario: String(n.propietario || p.propietario || '').trim(),
            empresa_destino: String(n.empresa_destino || p.empresa_destino || '').trim(),
            identificacion: String(n.identificacion || p.identificacion || '').trim(),
          });
        }
      }
    }
  });
  return cambios;
}

/** Texto breve para el toast; clic abre Histórico de cambios. */
function textoToastCambiosObservacion(cantidad) {
  const n = Number(cantidad) || 0;
  if (n <= 0) return 'Cambios detectados. Ver histórico.';
  if (n === 1) return '1 cambio detectado. Ver histórico.';
  return `${n} cambios detectados. Ver histórico.`;
}

/** Enriquece cambios en vivo con momento BD (toast → histórico). */
function registrarCambiosObservacion(cambios, momentoPorId = new Map()) {
  if (!cambios?.length) return [];
  const detectadoApp = new Date().toISOString();
  return cambios.map((c) => {
    const id = String(c.id);
    const momentoBd = momentoPorId.get(id) || null;
    return {
      ...c,
      momento_bd: momentoBd,
      detectado_en: detectadoApp,
    };
  });
}

async function irHistorialYMostrarCambios(cambios) {
  const fecha = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  await irHistoricoReimpresionCrudas(cambios, {
    fechaPlan: fecha,
    fechaRevision: sumarDiasISO(fecha, 1) || fecha,
  });
}

function fechasReimpresionHistorico() {
  const fechaPlan = String(document.getElementById('fecha-historico-desde')?.value || '').trim();
  const fechaRevision = String(document.getElementById('fecha-historico-hasta')?.value || '').trim();
  const fechaEtiquetas = fechaPlan ? sumarDiasISO(fechaPlan, 1) || fechaPlan : '';
  return { fechaPlan, fechaRevision, fechaEtiquetas };
}

function actualizarHistoricoReimpFechas() {
  const { fechaPlan, fechaRevision, fechaEtiquetas } = fechasReimpresionHistorico();
  const el = document.getElementById('historico-reimp-fechas');
  if (!el) return;
  if (!fechaPlan || !fechaEtiquetas) {
    el.textContent = '';
    return;
  }
  const revTxt = fechaRevision ? labelFecha(fechaRevision) : '—';
  el.textContent =
    `Plan ${labelFecha(fechaPlan)} → revisión ${revTxt} · datos de puesto: ${labelFecha(fechaEtiquetas)} · ` +
    `F.B. ${labelFecha(fechaPlan)} · F.V. ${labelFecha(fechaEtiquetas)}`;
}

function sucursalHistoricoNorm(val) {
  const t = normalizarObsHistorico(val);
  if (!t || t === '—' || t === '-') return '';
  return t;
}

function esFilaReimpresionCruda(r) {
  if (!r?.idProducto) return false;
  const sucAnt = sucursalHistoricoNorm(r.sucursalAntes);
  const sucDes = sucursalHistoricoNorm(r.sucursalDespues);
  const sucCambio = sucAnt !== sucDes && (sucAnt !== '' || sucDes !== '');
  if (!sucCambio) return false;
  const obsCruda =
    r.tipo === 'cruda' ||
    /\bCRUDAS?\b/i.test(String(r.despues || '')) ||
    /\bCRUDAS?\b/i.test(String(r.antes || ''));
  return r.esCambioSucursalRevision ? obsCruda : r.tipo === 'cruda' && sucCambio;
}

async function irHistoricoReimpresionCrudas(cambiosExplicitos = null, opts = {}) {
  const btn = document.querySelector('.nav-item[data-vista="historico"]');
  const fechaRevDefault =
    String(opts.fechaRevision || document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  const fechaPlanDefault = String(opts.fechaPlan || diaAnteriorISO(fechaRevDefault)).trim();
  const fd = document.getElementById('fecha-historico-desde');
  const fh = document.getElementById('fecha-historico-hasta');
  if (fd) fd.value = fechaPlanDefault;
  if (fh) fh.value = fechaRevDefault;
  irVista('historico', btn || null, { skipHistoricoFechas: true, skipHistoricoCarga: true });
  await cargarHistoricoCambios();
  actualizarHistoricoReimpFechas();
  if (cambiosExplicitos?.length) {
    const ids = new Set(
      cambiosExplicitos
        .map((c) => String(c.id || c.id_producto || '').trim())
        .filter(Boolean)
    );
    historicoCrudasSeleccionadas = new Set(
      historicoCambiosFiltrados.filter(esFilaReimpresionCruda).filter((r) => ids.has(r.idProducto)).map((r) => r.idProducto)
    );
    pintarTablaHistoricoCrudas();
  }
  document.querySelector('.panel-reimp-crudas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function textoObsHistorico(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(payload.observacion ?? payload.observaciones ?? '').trim();
}

function textoSucursalHistorico(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(payload.sucursal ?? '').trim();
}

function idProductoHistorico(item) {
  const desdeCambios = String(
    item?.despues?.id_producto ??
    item?.antes?.id_producto ??
    item?.idEntidad ??
    ''
  ).trim();
  if (!desdeCambios) return '';
  const m = desdeCambios.match(/\d{4,}-\d+/);
  return m ? m[0] : desdeCambios;
}

function tipoResultadoHistorico(obsAntes, obsDespues) {
  const antes = String(obsAntes || '').trim();
  const despues = String(obsDespues || '').trim();
  if (antes && !despues) return 'vacia';
  if (/\bCRUDAS?\b/i.test(despues)) return 'cruda';
  return 'otro';
}

function normalizarObsHistorico(txt) {
  return String(txt || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function esAltaTurnoSinCambioReal(item, antes, despues, sucursalAntes, sucursalDespues) {
  const accion = String(item?.accion || '').trim();
  if (accion !== 'crear_en_turno') return false;
  const obsAntes = normalizarObsHistorico(antes);
  const obsDespues = normalizarObsHistorico(despues);
  const sucAntes = normalizarObsHistorico(sucursalAntes);
  const sucDespues = normalizarObsHistorico(sucursalDespues);
  return !obsAntes && !obsDespues && !sucAntes && !!sucDespues;
}

function normalizarCambioHistorico(item) {
  const antes = textoObsHistorico(item?.antes);
  const despues = textoObsHistorico(item?.despues);
  const antesNorm = normalizarObsHistorico(antes);
  const despuesNorm = normalizarObsHistorico(despues);
  const sucursalAntes = textoSucursalHistorico(item?.antes);
  const sucursalDespues = textoSucursalHistorico(item?.despues);
  const sucAntesNorm = normalizarObsHistorico(sucursalAntes);
  const sucDespuesNorm = normalizarObsHistorico(sucursalDespues);
  const tipo = tipoResultadoHistorico(antes, despues);
  const idProducto = idProductoHistorico(item);
  const usuario = String(item?.usuario || item?.despues?.username_bd || item?.antes?.username_bd || '(sin usuario)').trim();
  const fechaIso = String(item?.fecha || '').trim();
  const momento = fechaIso ? formatFecha(fechaIso) : '—';
  const obsCambio = antesNorm !== despuesNorm;
  const sucCambio = sucAntesNorm !== sucDespuesNorm;
  const accion = String(item?.accion || '').trim();
  const fuenteHistorico = 'auditoria';
  const esCambioReal =
    (obsCambio || sucCambio) && !esAltaTurnoSinCambioReal(item, antes, despues, sucursalAntes, sucursalDespues);
  return {
    id: String(item?.id || ''),
    fecha: fechaIso,
    momento,
    usuario,
    idProducto,
    antes,
    despues,
    sucursalAntes,
    sucursalDespues,
    accion,
    esCambioRealObservacion: esCambioReal,
    esCambioSucursalRevision: false,
    tipo,
    tipoLabel: tipo === 'cruda' ? 'CRUDAS' : (tipo === 'vacia' ? 'VACIA' : 'OTRO'),
    fuenteHistorico,
    fuenteLabel: 'Auditoría',
    searchText: [
      idProducto,
      usuario,
      antes,
      despues,
      sucursalAntes,
      sucursalDespues,
      tipo,
      fechaIso,
      momento,
      accion,
      fuenteHistorico,
    ].join(' ').toLowerCase(),
  };
}

function normalizarCambioHistoricoCruce(c, meta) {
  const obsAntes = String(c?.observacion_antes || '').trim();
  const obsDespues = String(c?.observacion_despues || c?.observacion_texto || '').trim();
  const sAnt = String(c?.sucursal_antes || '').trim();
  const sDes = String(c?.sucursal_despues || '').trim();
  const tipo = tipoResultadoHistorico(obsAntes, obsDespues);
  const fechaPlan = String(meta?.fecha_plan || '').trim();
  const fechaRev = String(meta?.fecha_revision || '').trim();
  const momento = fechaRev
    ? `Revisión ${labelFecha(fechaRev)} (plan ${labelFecha(fechaPlan)})`
    : 'Revisión BD';
  return {
    id: `cruce_${String(c?.id || '')}_${fechaPlan}_${fechaRev}`,
    fecha: String(meta?.generado_en || '').trim(),
    momento,
    usuario: '(BD)',
    idProducto: String(c?.id || '').trim(),
    antes: obsAntes || '—',
    despues: obsDespues || '—',
    sucursalAntes: sAnt || '—',
    sucursalDespues: sDes || '—',
    accion: 'cruce_sucursal',
    esCambioRealObservacion: true,
    esCambioSucursalRevision: true,
    tipo,
    tipoLabel: tipo === 'cruda' ? 'CRUDAS' : (tipo === 'vacia' ? 'VACIA' : 'SUCURSAL'),
    fuenteHistorico: 'cruce_plan_revision',
    fuenteLabel: 'Cruce plan',
    searchText: [
      c?.id,
      obsAntes,
      obsDespues,
      sAnt,
      sDes,
      tipo,
      fechaPlan,
      fechaRev,
      'cruce',
    ].join(' ').toLowerCase(),
  };
}

function fusionarHistoricoCambios(filasAuditoria, filasCruce) {
  const porClave = new Map();
  const clave = (r) =>
    `${String(r.idProducto || '').trim()}|${normalizarObsHistorico(r.sucursalAntes)}|${normalizarObsHistorico(r.sucursalDespues)}`;
  for (const r of filasCruce || []) {
    if (!r?.idProducto) continue;
    porClave.set(clave(r), r);
  }
  for (const r of filasAuditoria || []) {
    if (!r?.idProducto) continue;
    const k = clave(r);
    if (r.esCambioSucursalRevision && porClave.has(k)) continue;
    if (!porClave.has(k) || r.fuenteHistorico === 'cruce_plan_revision') porClave.set(k, r);
  }
  return [...porClave.values()].sort((a, b) => Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0));
}

function htmlFilaHistoricoCambio(r) {
  const cls = r.tipo === 'cruda' ? 'row-hist-cruda' : (r.tipo === 'vacia' ? 'row-hist-vacia' : 'row-hist-otro');
  const badgeCls = r.tipo === 'cruda' ? 'hist-badge-cruda' : (r.tipo === 'vacia' ? 'hist-badge-vacia' : 'hist-badge-otro');
  const fuenteCls = r.fuenteHistorico === 'cruce_plan_revision' ? 'hist-badge-cruce' : 'hist-badge-aud';
  const sAnt = r.sucursalAntes || '—';
  const sDes = r.sucursalDespues || '—';
  return `<tr class="${cls}">
      <td>${escapeHtml(r.momento)}</td>
      <td><span class="hist-badge ${fuenteCls}" title="${escapeHtml(r.fuenteHistorico || '')}">${escapeHtml(r.fuenteLabel || '—')}</span></td>
      <td>${escapeHtml(r.usuario)}</td>
      <td>${escapeHtml(r.idProducto || '—')}</td>
      <td title="${escapeHtml(r.antes || '—')}">${escapeHtml((r.antes || '—').slice(0, 120))}</td>
      <td title="${escapeHtml(r.despues || '—')}">${escapeHtml((r.despues || '—').slice(0, 120))}</td>
      <td title="${escapeHtml(sAnt)}">${escapeHtml((sAnt || '—').slice(0, 80))}</td>
      <td title="${escapeHtml(sDes)}">${escapeHtml((sDes || '—').slice(0, 80))}</td>
      <td><span class="hist-badge ${badgeCls}">${escapeHtml(r.tipoLabel)}</span></td>
    </tr>`;
}

function pintarTablaHistoricoCambios(gen) {
  const g = gen == null ? ++_histMainPaintGen : gen;
  const tbody = document.getElementById('tbody-historico');
  if (!tbody) return;
  const rows = historicoCambiosFiltrados;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Sin cambios en el rango seleccionado</td></tr>';
    return;
  }
  if (rows.length <= HIST_RENDER_SYNC_MAX) {
    tbody.innerHTML = rows.map(htmlFilaHistoricoCambio).join('');
    return;
  }
  const firstEnd = Math.min(HIST_RENDER_CHUNK, rows.length);
  tbody.innerHTML = rows.slice(0, firstEnd).map(htmlFilaHistoricoCambio).join('');
  let i = firstEnd;
  const pump = () => {
    if (_histMainPaintGen !== g) return;
    const end = Math.min(i + HIST_RENDER_CHUNK, rows.length);
    if (i >= end) return;
    const chunk = rows.slice(i, end).map(htmlFilaHistoricoCambio).join('');
    tbody.insertAdjacentHTML('beforeend', chunk);
    i = end;
    if (i < rows.length) requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
}

function actualizarContadorHistoricoCrudas() {
  const el = document.getElementById('n-hist-crudas-sel');
  if (el) el.textContent = String(historicoCrudasSeleccionadas.size);
}

function htmlFilaHistoricoCruda(r) {
  const checked = historicoCrudasSeleccionadas.has(r.idProducto) ? 'checked' : '';
  const sAnt = r.sucursalAntes || '—';
  const sDes = r.sucursalDespues || '—';
  return `<tr class="row-hist-cruda">
      <td><input type="checkbox" ${checked} onchange="toggleSeleccionHistoricoCruda('${escapeHtml(r.idProducto)}', this)"></td>
      <td>${escapeHtml(r.momento)}</td>
      <td>${escapeHtml(r.usuario)}</td>
      <td>${escapeHtml(r.idProducto)}</td>
      <td title="${escapeHtml(r.antes || '—')}">${escapeHtml((r.antes || '—').slice(0, 100))}</td>
      <td title="${escapeHtml(r.despues || '—')}">${escapeHtml((r.despues || '—').slice(0, 100))}</td>
      <td title="${escapeHtml(sAnt)}">${escapeHtml((sAnt || '—').slice(0, 72))}</td>
      <td title="${escapeHtml(sDes)}">${escapeHtml((sDes || '—').slice(0, 72))}</td>
    </tr>`;
}

function pintarTablaHistoricoCrudas(gen) {
  const g = gen == null ? ++_histCrudasPaintGen : gen;
  const tbody = document.getElementById('tbody-historico-crudas');
  const chkAll = document.getElementById('chk-historico-crudas');
  if (!tbody) return;
  const rows = historicoCambiosFiltrados.filter(esFilaReimpresionCruda);
  if (!rows.length) {
    historicoCrudasSeleccionadas.clear();
    if (chkAll) chkAll.checked = false;
    actualizarContadorHistoricoCrudas();
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Sin crudas con cambio de sucursal en el rango</td></tr>';
    return;
  }
  rows.forEach((r) => {
    if (!historicoCrudasSeleccionadas.has(r.idProducto)) return;
  });
  const valid = new Set(rows.map((r) => r.idProducto));
  historicoCrudasSeleccionadas = new Set([...historicoCrudasSeleccionadas].filter((id) => valid.has(id)));
  if (chkAll) chkAll.checked = rows.length > 0 && rows.every((r) => historicoCrudasSeleccionadas.has(r.idProducto));
  actualizarContadorHistoricoCrudas();
  if (rows.length <= HIST_RENDER_SYNC_MAX) {
    tbody.innerHTML = rows.map(htmlFilaHistoricoCruda).join('');
    return;
  }
  const firstEnd = Math.min(HIST_RENDER_CHUNK, rows.length);
  tbody.innerHTML = rows.slice(0, firstEnd).map(htmlFilaHistoricoCruda).join('');
  let i = firstEnd;
  const pump = () => {
    if (_histCrudasPaintGen !== g) return;
    const end = Math.min(i + HIST_RENDER_CHUNK, rows.length);
    if (i >= end) return;
    const chunk = rows.slice(i, end).map(htmlFilaHistoricoCruda).join('');
    tbody.insertAdjacentHTML('beforeend', chunk);
    i = end;
    if (i < rows.length) requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
}

function aplicarFiltroHistoricoCambios() {
  const q = String(document.getElementById('srch-historico')?.value || '').trim().toLowerCase();
  historicoCambiosFiltrados = q
    ? historicoCambios.filter((r) => r.searchText.includes(q))
    : [...historicoCambios];
  const count = document.getElementById('historico-count');
  if (count) count.textContent = `${historicoCambiosFiltrados.length} cambios`;
  _histMainPaintGen++;
  _histCrudasPaintGen++;
  const gMain = _histMainPaintGen;
  const gCrud = _histCrudasPaintGen;
  pintarTablaHistoricoCrudas(gCrud);
  pintarTablaHistoricoCambios(gMain);
}

function filtrarHistoricoCambios() {
  aplicarFiltroHistoricoCambios();
}

function filtrarHistoricoCambiosDebounced() {
  clearTimeout(_histSearchDebounceT);
  _histSearchDebounceT = setTimeout(() => {
    _histSearchDebounceT = null;
    aplicarFiltroHistoricoCambios();
  }, 240);
}

function toggleSeleccionHistoricoCruda(id, chk) {
  const k = String(id || '').trim();
  if (!k) return;
  if (chk?.checked) historicoCrudasSeleccionadas.add(k);
  else historicoCrudasSeleccionadas.delete(k);
  actualizarContadorHistoricoCrudas();
  const rows = historicoCambiosFiltrados.filter(esFilaReimpresionCruda);
  const chkAll = document.getElementById('chk-historico-crudas');
  if (chkAll) chkAll.checked = rows.length > 0 && rows.every((r) => historicoCrudasSeleccionadas.has(r.idProducto));
}

function toggleTodasHistoricoCrudas(chkAll) {
  const rows = historicoCambiosFiltrados.filter(esFilaReimpresionCruda);
  if (chkAll?.checked) rows.forEach((r) => historicoCrudasSeleccionadas.add(r.idProducto));
  else rows.forEach((r) => historicoCrudasSeleccionadas.delete(r.idProducto));
  pintarTablaHistoricoCrudas();
}

function seleccionarTodosHistoricoCrudas() {
  const chkAll = document.getElementById('chk-historico-crudas');
  if (chkAll) chkAll.checked = true;
  toggleTodasHistoricoCrudas(chkAll);
}

async function cargarHistoricoCambios() {
  return runWithAppLoader('Cargando historico de cambios...', async () => {
    const t0 = Date.now();
    const fechaPlan = String(document.getElementById('fecha-historico-desde')?.value || '').trim();
    const fechaRevision = String(document.getElementById('fecha-historico-hasta')?.value || '').trim();
    if (!fechaPlan || !fechaRevision) {
      mostrarToast('Selecciona día del plan (desde) y día de revisión (hasta)', 'err');
      return;
    }
    if (fechaPlan > fechaRevision) {
      mostrarToast('El día del plan no puede ser posterior al día de revisión', 'err');
      return;
    }
    clearTimeout(_histSearchDebounceT);
    _histSearchDebounceT = null;
    const qAud = new URLSearchParams({
      desde: fechaPlan,
      hasta: fechaRevision,
      modulo: 'planillaje',
      limit: '400',
    });
    const qCruce = new URLSearchParams({
      fecha_plan: fechaPlan,
      fecha_revision: fechaRevision,
    });
    const headers = { Accept: 'application/json' };
    try {
      const key = String(localStorage.getItem(LS_ANALYTICS_ADMIN_KEY) || '').trim();
      if (key) headers['x-analytics-key'] = key;
    } catch {
      // ignore
    }
    const [resAud, resCruce] = await Promise.all([
      fetch(`${AUDITORIA_CAMBIOS_URL}?${qAud.toString()}`, { headers }),
      fetch(`${API_URL}/cambios-sucursal-revision?${qCruce.toString()}`, { headers }),
    ]);
    const payloadAud = await resAud.json().catch(() => ({}));
    const payloadCruce = await resCruce.json().catch(() => ({}));
    if (!resAud.ok && !resCruce.ok) {
      const msg = payloadAud?.error || payloadCruce?.error || `HTTP ${resAud.status}`;
      if (resAud.status === 403) {
        mostrarToast('Sin permisos para ver historico de auditoria. Configurar acceso en servidor.', 'err');
      } else {
        mostrarToast(`No se pudo cargar el historico: ${msg}`, 'err');
      }
      return;
    }
    const filasAud = resAud.ok
      ? (Array.isArray(payloadAud?.items) ? payloadAud.items : [])
          .map(normalizarCambioHistorico)
          .filter((r) => r.esCambioRealObservacion)
      : [];
    const filasCruce = resCruce.ok
      ? (Array.isArray(payloadCruce?.cambios) ? payloadCruce.cambios : []).map((c) =>
          normalizarCambioHistoricoCruce(c, payloadCruce)
        )
      : [];
    if (!resAud.ok) {
      mostrarToast('Auditoría no disponible; mostrando solo cruce plan → revisión', 'warn');
    }
    if (!resCruce.ok) {
      mostrarToast('Cruce de sucursal no disponible; mostrando solo auditoría', 'warn');
    }
    historicoCambios = fusionarHistoricoCambios(filasAud, filasCruce);
    const lbl = document.getElementById('historico-rango-label');
    const nCruce = filasCruce.length;
    const nAud = filasAud.length;
    if (lbl) {
      lbl.textContent =
        `Plan ${labelFecha(fechaPlan)} → revisión ${labelFecha(fechaRevision)} · ` +
        `${historicoCambios.length} cambios (${nCruce} cruce BD, ${nAud} auditoría)`;
    }
    filtrarHistoricoCambios();
    actualizarHistoricoReimpFechas();
    const ms = Math.max(0, Date.now() - t0);
    enviarEventoAnalytics({
      eventName: 'historico_auditoria_cargar',
      viewName: 'historico',
      durationMs: ms,
      meta: {
        fecha_plan: fechaPlan,
        fecha_revision: fechaRevision,
        total: historicoCambios.length,
        totalCruce: nCruce,
        totalAuditoria: nAud,
        total_plan: Number(payloadCruce?.total_plan_faena || 0),
      },
    });
  });
}

async function imprimirEtiquetasHistoricoCrudasSeleccion() {
  const ids = [...historicoCrudasSeleccionadas];
  if (!ids.length) {
    mostrarToast('Selecciona cambios a crudas para imprimir etiquetas', 'err');
    return;
  }
  return runWithAppLoader('Preparando etiquetas (día siguiente al plan)…', async () => {
    const { fechaPlan, fechaEtiquetas } = fechasReimpresionHistorico();
    const fechaDatos = fechaEtiquetas || sumarDiasISO(fechaPlan, 1) || hoyISO();
    if (!fechaPlan) {
      mostrarToast('Selecciona el día del plan (desde) en histórico', 'err');
      return;
    }
    const datosDia = await fetchPorFecha(fechaDatos);
    const map = new Map((datosDia || []).map((d) => [String(d.id_producto), d]));
    const lista = ids
      .map((id) => map.get(String(id)))
      .filter(Boolean)
      .filter(esVistaHistorialCrudasSolo);
    if (!lista.length) {
      mostrarToast(
        `No se encontraron crudas en ${labelFecha(fechaDatos)} para esos IDs (verifique día de etiquetas = plan + 1).`,
        'err'
      );
      return;
    }
    abrirVentanaEtiquetasCrudas(lista, { fechaPlanEtiqueta: fechaPlan });
    mostrarToast(
      `${lista.length} etiqueta(s) · puesto ${labelFecha(fechaDatos)} · F.B. ${labelFecha(fechaPlan)} · F.V. ${labelFecha(fechaDatos)}`,
      'ok'
    );
  });
}

async function refrescarSiCambioObservacion() {
  if (document.hidden) return;
  if (_loaderDepth > 0) return;
  const signal = nuevaSenalLibAuto();
  const fecha = document.getElementById('fecha-global')?.value || hoyISO();
  try {
    const [datosFresh, obsDia] = await Promise.all([
      fetchPorFecha(fecha, { signal }),
      fetchObservacionesPorFecha(fecha, { signal }),
    ]);
    const invActiva = document.getElementById('vista-inventario')?.classList.contains('active');
    const histActiva = document.getElementById('vista-historial')?.classList.contains('active');
    const cliActiva = document.getElementById('vista-clientes')?.classList.contains('active');
    const obsMapNow = new Map((obsDia || []).map(x => [String(x.id_producto), String(x.observacion_actual || '').trim()]));
    const momentoPorId = new Map(
      (obsDia || [])
        .map((x) => [String(x.id_producto), x.momento_registro_bd || null])
        .filter(([, t]) => t)
    );
    const snapNuevo = snapshotObservaciones(datosFresh);
    if (_autoObsSnapshot && snapNuevo !== _autoObsSnapshot) {
      const cambios = obtenerCambiosObservacion(datosGlobal, datosFresh, _obsTextoMapPrev, obsMapNow);
      const salidasFresh = await fetchSalidas();
      datosGlobal = datosFresh;
      datosClientes = datosFresh;
      salidasRegistradas = salidasFresh;
      separarDatos(datosFresh);
      _autoInvSnapshot = snapshotPendientes(datosFresh, salidasFresh);
      actualizarKpiTurno();
      if (histActiva) {
        renderHistorialLib(datosLibrillos);
        renderHistorialCrudas(datosCrudasHist);
      }
      if (cliActiva) filtrarCli();
      if (invActiva) renderInventario();
      actualizarPanelCuadre();
      beepNotif();
      const cambiosRegistrados = registrarCambiosObservacion(cambios, momentoPorId) || [];
      mostrarToast(textoToastCambiosObservacion(cambiosRegistrados.length), 'ok', {
        durationMs: 20000,
        onClick: () => irHistorialYMostrarCambios(cambiosRegistrados),
      });
    }
    _autoObsSnapshot = snapNuevo;
    _obsTextoMapPrev = obsMapNow;
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    // silencioso
  }
}

function iniciarWatchObservaciones() {
  if (_autoObsTimer) return;
  _autoObsTimer = setInterval(refrescarSiCambioObservacion, AUTO_REFRESH_OBS_MS);
}

function mostrarToast(msg, tipo = 'ok', opts = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  _toastOnClick = typeof opts.onClick === 'function' ? opts.onClick : null;
  const clickable = _toastOnClick ? ' clickable' : '';
  el.className = 'toast show ' + (tipo === 'err' ? 'err' : 'ok') + clickable;
  el.onclick = _toastOnClick || null;
  clearTimeout(mostrarToast._t);
  const durationMs = Number(opts.durationMs) > 0 ? Number(opts.durationMs) : 3800;
  mostrarToast._t = setTimeout(() => {
    el.classList.remove('show');
    el.onclick = null;
    _toastOnClick = null;
  }, durationMs);
}

function grupoKey(txt) {
  return String(txt || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function toggleDensity() {
  tablaCompacta = !tablaCompacta;
  document.body.classList.toggle('dense', tablaCompacta);
  const b = document.getElementById('btn-density');
  if (b) b.textContent = `Densidad: ${tablaCompacta ? 'Compacta' : 'Normal'}`;
}

function toggleHistorialPendientes() {
  historialSoloPendientes = !historialSoloPendientes;
  const b = document.getElementById('btn-hlib-pend');
  if (b) {
    b.textContent = historialSoloPendientes ? 'Mostrando pendientes' : 'Solo pendientes';
    b.classList.toggle('active', historialSoloPendientes);
  }
  filtrarHistorialLib();
}

function toggleGrupoHistorial(prop) {
  const k = grupoKey(prop);
  if (gruposHistorialColapsados.has(k)) gruposHistorialColapsados.delete(k);
  else gruposHistorialColapsados.add(k);
  filtrarHistorialLib();
}

async function copiarIdsHistorialLib() {
  const tbody = document.getElementById('tbody-hlib');
  if (!tbody) return;
  const ids = [...tbody.querySelectorAll('.id-link')].map(x => x.textContent.trim()).filter(Boolean);
  const uniq = [...new Set(ids)];
  if (!uniq.length) {
    mostrarToast('No hay IDs visibles para copiar', 'err');
    return;
  }
  try {
    await navigator.clipboard.writeText(uniq.join('\n'));
    mostrarToast(`${uniq.length} IDs copiados`, 'ok');
  } catch {
    mostrarToast('No se pudo copiar al portapapeles', 'err');
  }
}

// ── SEPARAR DATOS ─────────────────────────────────────────────────────────────
function separarDatos(datos) {
  const lista = Array.isArray(datos) ? datos : [];
  datosLibrillos = lista.filter(esVistaHistorialLibrillos);
  datosCrudasHist = lista.filter(esVistaHistorialCrudasSolo);
  poblarFiltroAgrupaciones();
}

// ── CIERRE DE PROCESO (snapshot crudas → comparar sucursal en BD) ─────────────
async function refrescarToolbarCierreProceso() {
  const lbl = document.getElementById('lbl-estado-cierre');
  const btnR = document.getElementById('btn-cierre-revisar');
  const btnT = document.getElementById('btn-cierre-terminar');
  if (!lbl || !btnR || !btnT) return;
  const fecha = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  try {
    const r = await fetch(`${API_CIERRE_PROCESO}/${encodeURIComponent(fecha)}`);
    if (!r.ok) throw new Error('HTTP');
    const j = await r.json();
    if (j.cerrado) {
      lbl.textContent = `Cerrado ${j.cerrado_en ? formatFecha(j.cerrado_en) : '—'} · ${j.total_items ?? 0} crudas en snapshot.`;
      btnR.disabled = false;
      btnT.textContent = 'Volver a cerrar (sobrescribe snapshot)';
    } else {
      lbl.textContent = 'Sin cierre registrado para esta fecha.';
      btnR.disabled = true;
      btnT.textContent = 'Terminar proceso';
    }
  } catch {
    lbl.textContent = 'No se pudo consultar el estado de cierre.';
    btnR.disabled = true;
  }
}

async function terminarProcesoCierre() {
  const fecha = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  if (
    !confirm(
      `¿Confirma TERMINAR PROCESO para la fecha ${fecha}?\n\nSe guardará la sucursal actual de cada cruda (texto con CRUDA/CRUDAS) para comparar después con la base de datos.`
    )
  ) {
    return;
  }
  try {
    const r = await fetch(`${API_CIERRE_PROCESO}/${encodeURIComponent(fecha)}/registrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    mostrarToast(`Proceso cerrado: ${j.total_items ?? 0} crudas en snapshot.`, 'ok');
    await refrescarToolbarCierreProceso();
  } catch (e) {
    mostrarToast(String(e.message || e), 'err');
  }
}

async function revisarPostCierreSucursal() {
  const fecha = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
  try {
    const r = await fetch(`${API_CIERRE_PROCESO}/${encodeURIComponent(fecha)}/revisar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) {
      mostrarToast(j.error || 'No hay cierre para esta fecha.', 'err');
      return;
    }
    if (!r.ok) throw new Error(j.error || r.statusText);
    const sinFila = Array.isArray(j.sin_fila_hoy) ? j.sin_fila_hoy : [];
    if (sinFila.length) {
      const muestra = sinFila
        .slice(0, 6)
        .map((x) => String(x?.id_producto || '').trim())
        .filter(Boolean)
        .join(', ');
      const suf = sinFila.length > 6 ? '…' : '';
      mostrarToast(
        `Atención: ${sinFila.length} código(s) del cierre no aparecen hoy en el día (${muestra}${suf}). Revisar planilla o trazabilidad.`,
        'err',
        { durationMs: 9000 }
      );
    }
    const lista = (j.cambios_sucursal || []).map((c) => ({
      id: c.id_producto,
      tipo: 'CRUDA_SUCURSAL',
      antes: c.sucursal_cierre || '—',
      despues: c.sucursal_actual || '—',
      sucursal_antes: c.sucursal_cierre || '—',
      sucursal_despues: c.sucursal_actual || '—',
      propietario: c.propietario || null,
      identificacion: c.identificacion || null,
      cliente_destino: c.cliente_destino || null,
      agrupacion: c.agrupacion || null,
      plaza: c.plaza || null,
      empresa_destino: c.empresa_destino || null,
      destino: c.destino || null,
      observacion_texto:
        String(c.observacion_texto || '').trim() || 'Conciliación vs cierre de proceso (sucursal)',
      fuente: 'post_cierre',
    }));
    if (!lista.length) {
      if (!sinFila.length) {
        mostrarToast('Sin diferencias de sucursal respecto al cierre.', 'ok');
      }
      return;
    }
    let msg = `${lista.length} cambio(s) de sucursal vs cierre. Abriendo histórico…`;
    if (sinFila.length) msg += ` (${sinFila.length} sin fila hoy: ver aviso anterior).`;
    mostrarToast(msg, 'ok', { durationMs: 5200 });
    await irHistoricoReimpresionCrudas(lista, {
      fechaPlan: fecha,
      fechaRevision: sumarDiasISO(fecha, 1) || fecha,
    });
  } catch (e) {
    mostrarToast(String(e.message || e), 'err');
  }
}

// ── CAMBIAR FECHA ─────────────────────────────────────────────────────────────
async function cambiarFecha() {
  return runWithAppLoader('Actualizando datos por fecha...', async () => {
    abortarLibAuto();
    const fecha = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
    document.getElementById('pg-sub').textContent = labelFecha(fecha);
    try {
      const [datos, salidas, meta] = await Promise.all([
        fetchPorFecha(fecha),
        fetchSalidas(),
        fetchMetaUniverso(fecha),
      ]);
      datosGlobal = datos;
      fechaDatosGlobal = fecha;
      datosClientes = datos;
      metaUniversoTurno = meta;
      salidasRegistradas = salidas;
      separarDatos(datosGlobal);
      actualizarEstado(true);
      _autoInvSnapshot = snapshotPendientes(datosGlobal, salidasRegistradas);
      sincronizarFechasSecundariasConFechaGlobal();
      aplicarUiTrasCargarDatos();
    } catch (e) {
      console.error(e);
      actualizarEstado(false);
      mostrarToast(`No se pudieron cargar los datos: ${e?.message || e}`, 'err');
    }
  });
}

// ── CARGAR DATOS ──────────────────────────────────────────────────────────────
async function cargarDatos() {
  return runWithAppLoader('Cargando inventario del turno...', async () => {
    try {
      abortarLibAuto();
      const fecha = String(document.getElementById('fecha-global')?.value || '').trim() || hoyISO();
      const [datos, salidas, meta] = await Promise.all([
        fetchPorFecha(fecha),
        fetchSalidas(),
        fetchMetaUniverso(fecha),
      ]);
      datosGlobal = datos;
      fechaDatosGlobal = fecha;
      datosClientes = datos;
      metaUniversoTurno = meta;
      salidasRegistradas = salidas;
      separarDatos(datos);
      actualizarEstado(true);
      _autoInvSnapshot = snapshotPendientes(datos, salidasRegistradas);
      sincronizarFechasSecundariasConFechaGlobal();
      aplicarUiTrasCargarDatos();
    } catch (e) {
      console.error('Error:', e);
      actualizarEstado(false);
      mostrarToast(`No se pudieron cargar los datos: ${e?.message || e}`, 'err');
    }
  });
}

function actualizarEstado(ok) {
  document.getElementById('conn-dot').className = 'conn-dot ' + (ok ? 'ok' : 'err');
  document.getElementById('conn-txt').textContent = ok ? 'Conectado' : 'Sin conexión';
  document.getElementById('last-upd').textContent = 'Act: ' + new Date().toLocaleTimeString('es-CO');
}

/** Cuadre del día: API validación (trazabilidad + pendientes de despacho). */
async function actualizarPanelCuadreInterno() {
  const strip = document.getElementById('cuadre-strip');
  const txt = document.getElementById('cuadre-strip-txt');
  if (!strip || !txt) return;
  const fecha = document.getElementById('fecha-global')?.value || hoyISO();
  txt.textContent = 'Comprobando…';
  strip.classList.remove('cuadre-ok', 'cuadre-warn');
  try {
    const r = await fetch(`${API_URL}/validacion?fecha=${encodeURIComponent(fecha)}`);
    if (!r.ok) throw new Error('HTTP');
    const v = await r.json();
    strip.classList.add(v.ok ? 'cuadre-ok' : 'cuadre-warn');
    const pend = v.pendientes_despacho_librillos ?? 0;
    const desp = v.despachos_registrados_dia ?? 0;
    const pa = v.por_agrupacion && typeof v.por_agrupacion === 'object' ? v.por_agrupacion : null;
    strip.title = pa
      ? 'Con retiro por agrupación (código): ' +
        Object.entries(pa)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k}=${n}`)
          .join(', ')
      : '';
    if (v.ok) {
      txt.textContent = `OK · ${v.total_registros} reg. · ${desp} despachos · ${pend} librillos pendientes`;
    } else {
      const p1 = v.sin_datos_vista ? `${v.sin_datos_vista} sin vista` : '';
      const p2 = v.retiros_sin_cliente_parseado ? `${v.retiros_sin_cliente_parseado} sin cliente` : '';
      const extra = [p1, p2].filter(Boolean).join(' · ');
      txt.textContent = extra
        ? `Revisar: ${extra} · ${pend} pendientes despacho`
        : `Revisar datos · ${pend} pendientes despacho`;
    }
  } catch {
    txt.textContent = 'Cuadre no disponible';
  }
}

function actualizarPanelCuadre() {
  clearTimeout(_cuadreDebounceT);
  _cuadreDebounceT = setTimeout(() => {
    _cuadreDebounceT = null;
    void actualizarPanelCuadreInterno();
  }, 350);
}

function topConteoPor(items, keyFn, limit = 8) {
  const m = new Map();
  (items || []).forEach((x) => {
    const k = String(keyFn(x) || '—').trim() || '—';
    m.set(k, (m.get(k) || 0) + 1);
  });
  return [...m.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function renderChartLista(containerId, rows, color) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="chart-empty">Sin datos para esta fecha</div>';
    return;
  }
  const max = Math.max(...rows.map(r => r.value), 1);
  el.innerHTML = rows.map((r) => {
    const w = Math.max(6, Math.round((r.value / max) * 100));
    return `<div class="chart-row">
      <div class="chart-lbl" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
      <div class="chart-bar-bg"><div class="chart-bar" style="width:${w}%;background:${color}"></div></div>
      <div class="chart-val">${r.value}</div>
    </div>`;
  }).join('');
}

function renderPieAgrupaciones(obj) {
  const pie = document.getElementById('dash-pie');
  const legend = document.getElementById('dash-pie-legend');
  if (!pie || !legend) return;
  const entries = Object.entries(obj || {}).filter(([, v]) => Number(v) > 0);
  if (!entries.length) {
    pie.style.background = '#e7eee9';
    legend.innerHTML = '<div class="chart-empty">Sin distribución para la fecha</div>';
    return;
  }
  const pal = ['#b93729', '#1f7a45', '#c46b08', '#2f5ea8', '#7e57c2', '#0097a7'];
  const total = entries.reduce((s, [, v]) => s + Number(v || 0), 0);
  let acc = 0;
  const parts = entries.map(([k, v], i) => {
    const pct = (Number(v || 0) / total) * 100;
    const start = acc;
    const end = acc + pct;
    acc = end;
    return { k, v, pct, color: pal[i % pal.length], start, end };
  });
  pie.style.background = `conic-gradient(${parts.map(p => `${p.color} ${p.start}% ${p.end}%`).join(',')})`;
  legend.innerHTML = parts.map(p => `<div class="chart-pie-item">
    <span class="chart-dot" style="background:${p.color}"></span>
    <span>${escapeHtml(p.k)}</span>
    <strong>${p.v}</strong>
  </div>`).join('');
}

function renderDashboard() {
  if (!dashboardResumen) return;
  const d = dashboardResumen;
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v ?? '—'); };
  setTxt('dk-total-librillos', d.total_librillos ?? 0);
  setTxt('dk-en-cava', d.librillos_en_cava ?? 0);
  setTxt('dk-despachados', d.librillos_despachados ?? 0);
  setTxt('dk-crudas', d.total_crudas ?? 0);
  setTxt('dk-cocidos', d.total_cocidos ?? 0);

  const arrAgr = Object.entries(d.por_agrupacion || {}).map(([label, value]) => ({ label, value: Number(value || 0) }));
  renderChartLista('dash-chart-clientes', arrAgr.sort((a,b)=>b.value-a.value), 'linear-gradient(90deg,#b93729,#d65546)');
  renderPieAgrupaciones(d.por_agrupacion || {});

  const topLib = topConteoPor((d.ultimos_despachos || []).filter(x => x.tipo === 'LIBRILLO'), x => x.propietario || '—', 6);
  const topCrud = topConteoPor((d.ultimos_despachos || []).filter(x => x.tipo === 'CRUDA'), x => x.propietario || '—', 6);
  renderChartLista('dash-chart-desp-lib', topLib, 'linear-gradient(90deg,#c46b08,#e2962d)');
  renderChartLista('dash-chart-desp-crud', topCrud, 'linear-gradient(90deg,#1f7a45,#2e9d5b)');

  const pend = d.pendientes_en_cava || [];
  const tbPend = document.getElementById('dash-tbody-pend');
  const pendCount = document.getElementById('dash-pend-count');
  if (pendCount) pendCount.textContent = `${pend.length}`;
  if (tbPend) tbPend.innerHTML = pend.length
    ? pend.map(x => `<tr>
      <td>${escapeHtml(x.id_producto)}</td>
      <td>${escapeHtml(x.propietario || '—')}</td>
      <td>${escapeHtml(x.cliente_destino || '—')}</td>
      <td>${escapeHtml(x.agrupacion_codigo || '—')}</td>
      <td>${escapeHtml(x.destino || '—')}</td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="empty">Sin pendientes en cava</td></tr>';

  const desp = d.ultimos_despachos || [];
  const tbDesp = document.getElementById('dash-tbody-desp');
  const despCount = document.getElementById('dash-desp-count');
  if (despCount) despCount.textContent = `${desp.length}`;
  if (tbDesp) tbDesp.innerHTML = desp.length
    ? desp.map(x => `<tr>
      <td>${escapeHtml(x.id_producto)}</td>
      <td>${escapeHtml(x.tipo)}</td>
      <td>${escapeHtml(x.propietario || '—')}</td>
      <td>${formatFecha(x.fecha_salida)}</td>
    </tr>`).join('')
    : '<tr><td colspan="4" class="empty">Sin despachos registrados</td></tr>';

  const alert = document.getElementById('dash-alerta');
  if (alert) {
    const ok = d.validacion?.ok === true;
    alert.className = `cuadre-strip ${ok ? 'cuadre-ok' : 'cuadre-warn'}`;
    if (ok) {
      alert.textContent = `OK · BD ${d.validacion.total_bd} vs clasificados ${d.validacion.total_clasificados}`;
    } else {
      const ids = (d.validacion?.sin_clasificar || []).slice(0, 8).join(', ');
      alert.textContent = `Revisar cuadre · BD ${d.validacion?.total_bd || 0} vs clasificados ${d.validacion?.total_clasificados || 0} · IDs: ${ids || '—'}`;
    }
  }
}

function actualizarGraficasDashboard() {
  const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
  const salidasDiaOperativo = listaSalidasInventarioParaDia(fechaSel);
  const byId = new Map((datosGlobal || []).map(d => [String(d.id_producto), d]));

  const libs = (datosGlobal || []).filter(esLibrilloParaReporteAgrupacion);
  const topAgrup = topConteoPor(libs, d => etiquetaAgrupacionMacro(d), 8);

  const libsDesp = salidasDiaOperativo
    .map(s => byId.get(String(s.id_producto)))
    .filter(Boolean)
    .filter(esVistaHistorialLibrillos);
  const crudDesp = salidasDiaOperativo
    .map(s => byId.get(String(s.id_producto)))
    .filter(Boolean)
    .filter(esVistaHistorialCrudasSolo);

  const topLibDesp = topConteoPor(libsDesp, d => d.propietario || 'Sin asignar', 8);
  const topCrudDesp = topConteoPor(crudDesp, d => d.propietario || 'Sin asignar', 8);

  renderChartLista('chart-agrupaciones', topAgrup, 'linear-gradient(90deg,#b93729,#d65546)');
  renderChartLista('chart-desp-lib', topLibDesp, 'linear-gradient(90deg,#c46b08,#e2962d)');
  renderChartLista('chart-desp-crud', topCrudDesp, 'linear-gradient(90deg,#1f7a45,#2e9d5b)');
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function esCocida(d) {
  const c = clasificarRegistro(d);
  return c.viscera && !c.visceraCruda;
}

function badgeObs(obs, row = null, ctx = 'auto') {
  return badgeObsConContexto(obs, row, ctx);
}

function badgeObsConContexto(obs, row = null, ctx = 'auto') {
  const r = row || {};
  const c = clasificarRegistro({ observacion: obs, cliente_destino: r?.cliente_destino || null });
  const texto = (obs || '').trim() || '—';

  const usar = (() => {
    if (ctx === 'librillo') return { tipo: 'librillo', visible: c.librillo };
    if (ctx === 'viscera') return { tipo: 'viscera', visible: c.viscera };
    // auto: preferir librillo si aplica, si no visceras
    if (c.librillo) return { tipo: 'librillo', visible: true };
    return { tipo: 'viscera', visible: true };
  })();

  let base = '';
  let tipoBadge = '';

  if (usar.tipo === 'librillo') {
    // En librillos lo importante es si es crudo o no (por presencia de CRUDAS)
    // Con retiro de librillos se trata como crudo en la vista librillos.
    base = `<span class="b b-cruda">${escapeHtml(texto)}</span>`;
    tipoBadge = '<span class="b b-tipo">LIBRILLO</span>';
  } else {
    // En vísceras: vacía => cocida, CRUDAS => cruda, ACONDICIONAMIENTO => completa
    if (c.vacia) base = '<span class="b b-cocida">COCIDA</span>';
    else if (c.visceraCruda) base = `<span class="b b-cruda">${escapeHtml(texto)}</span>`;
    else base = `<span class="b b-destino">${escapeHtml(texto)}</span>`;

    tipoBadge = c.visceraCruda ? '<span class="b b-tipo">VISCERA CRUDA</span>' : '<span class="b b-tipo">VISCERA</span>';
  }
  return `${base} ${tipoBadge}`;
}
function resolverCliente(d) { return d.cliente_destino || d.destino || '—'; }

/** Etiqueta de agrupación comercial (viene de API o fallback). */
function etiquetaAgrupacion(d) {
  const t = (d && d.agrupacion != null) ? String(d.agrupacion).trim() : '';
  return t || '—';
}

/**
 * Títulos de bloque alineados a hojas/pivots del libro «RETIRO DE LIBROS» (ASURCARNES, DERIVADOS, …).
 * Misma `agrupacion_codigo` que calcula el backend desde la observación.
 */
const ETIQUETA_MACRO_EXCEL = {
  asurcarnes_glo: 'ASURCARNESGLO',
  asurcarnescol: 'ASURCARNESCOL',
  global_hides: 'GLOBAL HIDES SAS',
  asurcarnes: 'ASURCARNES',
  cat: 'CAT',
  derivados_carnicos: 'DERIVADOS',
  cocidos: 'COCIDOS',
};

const ORDEN_MACRO_REPORTE = [
  'ASURCARNESGLO',
  'ASURCARNESCOL',
  'GLOBAL HIDES SAS',
  'ASURCARNES',
  'CAT',
  'DERIVADOS',
  'COCIDOS',
];

function etiquetaAgrupacionMacro(d) {
  const cod = codigoAgrupacionMacro(d);
  if (cod && ETIQUETA_MACRO_EXCEL[cod]) return ETIQUETA_MACRO_EXCEL[cod];
  const t = etiquetaAgrupacion(d);
  return t && t !== '—' ? t : cod || '—';
}

function codigoAgrupacionMacro(d) {
  const codRaw = String(d?.agrupacion_codigo || 'asurcarnes').trim() || 'asurcarnes';
  const obsTxt = String(d?.observaciones ?? d?.observacion ?? '').trim();
  // Regla macro histórica: observación vacía en asurcarnes se reporta como cocidos.
  return (codRaw === 'asurcarnes' && !obsTxt) ? 'cocidos' : codRaw;
}

function ordenGruposMacro(etiquetas) {
  const idx = (e) => {
    const i = ORDEN_MACRO_REPORTE.indexOf(e);
    return i === -1 ? 999 : i;
  };
  return [...etiquetas].sort((a, b) => {
    const ia = idx(a);
    const ib = idx(b);
    if (ia !== ib) return ia - ib;
    return String(a).localeCompare(String(b), 'es');
  });
}

function poblarFiltroAgrupaciones() {
  const sel = document.getElementById('filtro-agrup-hlib');
  if (!sel) return;
  const prev = sel.value;
  const set = new Set();
  (datosLibrillos || []).filter(esVistaHistorialLibrillos).forEach(d => {
    set.add(etiquetaAgrupacionMacro(d));
  });
  const sorted = [...set].sort((a, b) => a.localeCompare(b, 'es'));
  sel.innerHTML = '<option value="">Todas las agrupaciones</option>' +
    sorted.map(a => {
      const esc = String(a).replace(/\\/g, '\\\\').replace(/"/g, '&quot;');
      return `<option value="${esc}">${escapeHtml(a)}</option>`;
    }).join('');
  if (prev && sorted.includes(prev)) sel.value = prev;
}

function esCruda(d) {
  const c = clasificarRegistro(d);
  return c.librillo || c.visceraCruda;
}

function normalizarObs(obs) {
  return String(obs || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

const RX_RETIRO_LIBRILLO_FRONT = /\bRETIRAR?\s+LIBRIL+OS?\b/;

/** Alineado con services/agrupaciones.service.js (códigos del merge API). */
const COD_AGRUP_COMERCIAL = new Set([
  'asurcarnes',
  'asurcarnescol',
  'asurcarnes_glo',
  'global_hides',
  'cat',
  'derivados_carnicos',
]);

function clasificarRegistro(d) {
  const cod = String(d?.agrupacion_codigo || '').trim();
  const obsRaw = String(d?.observaciones ?? d?.observacion ?? '').trim();
  const obs = normalizarObs(obsRaw);
  const vacia = obs === '';

  if (cod === 'cocidos') {
    return {
      librillo: false,
      viscera: true,
      visceraCruda: false,
      vacia: !obsRaw,
      tieneRetiro: false,
      tieneCrudas: false,
      tieneAcond: /\bACONDICIONAMIENTO\b/.test(obs),
    };
  }

  const tieneRetiro =
    !!(d?.cliente_destino && String(d.cliente_destino).trim()) ||
    RX_RETIRO_LIBRILLO_FRONT.test(obs) ||
    /\bRETIRA(R)?\b/.test(obs) ||
    COD_AGRUP_COMERCIAL.has(cod);
  const tieneCrudas = /\bCRUDAS?\b/.test(obs);
  const tieneAcond = /\bACONDICIONAMIENTO\b/.test(obs);

  // Reglas de clasificación por observación (vistas historial):
  // - Un registro puede aplicar a LIBRILLO y/o VISCERA.
  // - Criterio macro: si hay CRUDA, también debe caer en crudas; y si no hay RETIRA,
  //   CRUDA se maneja como LIBRO Y CRUDA (doble conteo operativo).
  // - El usuario lo verá en su tabla correspondiente (sin mostrar “MIXTO” en badges).
  const casoVacia = vacia;
  const casoSoloCrudas = tieneCrudas && !tieneRetiro;       // víscera cruda
  const casoSoloRetiro = tieneRetiro && !tieneCrudas;       // librillo crudo
  const casoCrudasMasRetiro = tieneCrudas && tieneRetiro;    // librillo crudo + víscera cruda
  const casoAcond = tieneAcond && !tieneRetiro;              // víscera completa

  const librillo = casoSoloRetiro || casoCrudasMasRetiro || casoSoloCrudas;
  const viscera = casoVacia || casoSoloCrudas || casoCrudasMasRetiro || casoAcond || (!tieneRetiro && !vacia);
  const visceraCruda = casoSoloCrudas || casoCrudasMasRetiro;

  return { librillo, viscera, visceraCruda, vacia, tieneRetiro, tieneCrudas, tieneAcond };
}

function esLibrillo(d) {
  return clasificarRegistro(d).librillo;
}

function esVisceraBlanca(d) {
  return clasificarRegistro(d).viscera;
}

/** Historial — Librillos: RETIRAR LIBRILLOS (cliente_destino u observación). */
function esVistaHistorialLibrillos(d) {
  return clasificarRegistro(d).tieneRetiro;
}

/** Historial — Crudas: cualquier observación con CRUDAS/CRUDA (conteo paralelo a categoría comercial). */
function esVistaHistorialCrudasSolo(d) {
  const obs = normalizarObs(String(d?.observaciones ?? d?.observacion ?? ''));
  return /\bCRUDAS?\b/.test(obs);
}

/**
 * Librillos en reportes por bloque tipo Excel: todo retiro de librillos según observación/API
 * (mismos buckets que pivots ASURCARNES / DERIVADOS / …); no se exige cliente parseado.
 * Los datos del turno vienen del API (consultas a tablas base, sin vista analítica vw_pbi01).
 */
function esLibrilloParaReporteAgrupacion(d) {
  const obs = normalizarObs(String(d?.observaciones ?? d?.observacion ?? ''));
  const cliente = String(d?.cliente_destino || '').trim();
  const clienteValido = cliente && !esPlaceholderTexto(cliente) && !/^SIN\s+CLIENTE$/i.test(cliente);
  // Solo retiros explícitos de librillos para el reporte por agrupación.
  return Boolean(clienteValido) || RX_RETIRO_LIBRILLO_FRONT.test(obs) || /\bRETIRA(R)?\b/.test(obs);
}

function colorPorClave(str) {
  const s = String(str || '—');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 62% 42%)`;
}

function fondoPorClave(str) {
  const s = String(str || '—');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 95%)`;
}

function fondoHoverPorClave(str) {
  const s = String(str || '—');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 92%)`;
}

function clienteChipHtml(cliente) {
  const n = cliente || '—';
  const col = colorPorClave(n);
  return `<span class="client-chip" style="--cc:${col}" title="${escapeHtml(n)}">${escapeHtml(n)}</span>`;
}

function textoCampoBusqueda(d, campo) {
  const c = String(campo || 'all').toLowerCase();
  const map = {
    id: d?.id_producto,
    propietario: d?.propietario,
    cliente: d?.cliente_destino,
    agrupacion: etiquetaAgrupacionMacro(d),
    plaza: ubicacionPlaza(d),
    sucursal: d?.sucursal,
    empresa: d?.empresa_destino,
    observacion: d?.observacion,
  };
  if (c === 'all') {
    return [
      d?.id_producto, d?.propietario, d?.cliente_destino, etiquetaAgrupacionMacro(d),
      ubicacionPlaza(d), d?.sucursal, d?.empresa_destino, d?.observacion, d?.observaciones,
    ].map((x) => String(x || '')).join(' ').toLowerCase();
  }
  return String(map[c] || '').toLowerCase();
}

/** Búsqueda única: todos los textos visibles + fechas formateadas y datos auxiliares del registro. */
function textoBusquedaLibre(d) {
  const parts = [textoCampoBusqueda(d, 'all')];
  try {
    parts.push(String(d?.agrupacion_codigo || ''));
    parts.push(String(d?.agrupacion || ''));
    parts.push(formatFecha(d?.fecha_ingreso_cava));
    if (d?.fecha_salida_cava) parts.push(formatFecha(d.fecha_salida_cava));
    const sal = typeof salidaUltimaGrupo === 'function' ? salidaUltimaGrupo([d]) : null;
    if (sal) parts.push(formatFecha(sal));
  } catch (_) {
    /* helpers opcionales */
  }
  if (d?.pendiente_registro_parte === true) parts.push('pendiente parte registro');
  return parts.join(' ').toLowerCase();
}

function estilosFilaCliente(cliente) {
  const n = cliente || '—';
  const cc = colorPorClave(n);
  const cbg = fondoPorClave(n);
  const cbgH = fondoHoverPorClave(n);
  return `--cc:${cc};--cbg:${cbg};--cbg-h:${cbgH};`;
}

function animar(id, final) {
  const el = document.getElementById(id);
  if (!el) return;
  let n = 0;
  const step = Math.max(1, Math.ceil(final / 25));
  const t = setInterval(() => { n = Math.min(n + step, final); el.textContent = n; if (n >= final) clearInterval(t); }, 30);
}

async function cargarAliasPlazas() {
  try {
    const r = await fetch('./plazas-alias.json');
    if (!r.ok) return;
    const cfg = await r.json();
    PLAZAS_ALIAS = {
      exact: cfg?.exact && typeof cfg.exact === 'object' ? cfg.exact : {},
      contains: cfg?.contains && typeof cfg.contains === 'object' ? cfg.contains : {},
    };
  } catch {
    // sin alias personalizados
  }
}

async function cargarConfigClienteResumen() {
  try {
    const r = await fetch('./clientes-resumen-config.json');
    if (!r.ok) return;
    const raw = await r.json();
    CLIENTES_RESUMEN_CONFIG = mergeClienteResumenConfig(raw);
  } catch {
    CLIENTES_RESUMEN_CONFIG = mergeClienteResumenConfig({});
  }
}

// ── HISTORIAL LIBRILLOS ───────────────────────────────────────────────────────
function renderHistorialLib(lista) {
  const tbody = document.getElementById('tbody-hlib');
  const filtrada = (lista || []).filter(esVistaHistorialLibrillos).filter((d) =>
    !historialSoloPendientes || !productoYaSalidaColbeefOTraz(d)
  );
  document.getElementById('hlib-count').textContent = filtrada.length + ' registros';
  const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
  const mov = resumenMovimientoRealInventario(filtrada, fechaSel);
  document.getElementById('hlib-total-label').innerHTML =
    `Total: <strong style="color:var(--rojo)">${filtrada.length}</strong> librillos · ` +
    `<span style="color:var(--tx2)">Mov. real: ${mov.despachadoDia} día · ${mov.pendiente} pendiente · ${mov.salioOtroDia} otro día</span>`;

  if (!filtrada.length) { tbody.innerHTML = '<tr><td colspan="11" class="empty">Sin librillos crudos para esta fecha</td></tr>'; return; }

  const sorted = [...filtrada].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  tbody.innerHTML = sorted.map(d => {
    const sal = salidaUltimaGrupo([d]);
    const prop = d.propietario || 'Sin asignar';
    const titProp = d.propietario_origen === 'vista_ultimo'
      ? 'Propietario según último registro disponible en la vista'
      : '';
    const pendParte =
      d.pendiente_registro_parte === true
        ? ' <span class="badge-pend-parte" title="En plan de faena pero sin movimiento Colbeef registrado este día">Pend. parte</span>'
        : '';
    return `<tr class="client-row" style="${estilosFilaCliente(d.cliente_destino || '—')}">
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto || '—')}${pendParte}</td>
      <td style="font-weight:600"${titProp ? ` title="${escapeHtml(titProp).replace(/"/g, '&quot;')}"` : ''}>${escapeHtml(prop)}${d.propietario_origen === 'vista_ultimo' ? ' <span class="prop-origen" aria-hidden="true">·</span>' : ''}</td>
      <td>${clienteChipHtml(d.cliente_destino || '—')}</td>
      <td><span class="b b-agru">${escapeHtml(etiquetaAgrupacionMacro(d))}</span></td>
      <td>${badgeObs(d.observacion, d, 'librillo')}</td>
      <td>${escapeHtml(destinoTabla(d))}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td style="font-size:12px">${sal ? formatFecha(sal) : '—'}</td>
      <td><span style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--rojo)">1</span></td>
    </tr>`;
  }).join('');
}

function filtrarHistorialLib() {
  const txt = (document.getElementById('srch-hlib')?.value || '').toLowerCase().trim();
  const agrSel = (document.getElementById('filtro-agrup-hlib') && document.getElementById('filtro-agrup-hlib').value) || '';
  renderHistorialLib(datosLibrillos.filter(d => {
    if (!esVistaHistorialLibrillos(d)) return false;
    const matchTxt = !txt || textoBusquedaLibre(d).includes(txt);
    const matchAgr =
      !agrSel ||
      etiquetaAgrupacionMacro(d) === agrSel ||
      etiquetaAgrupacion(d) === agrSel;
    return matchTxt && matchAgr;
  }));
}

// ── HISTORIAL CRUDAS ──────────────────────────────────────────────────────────
function renderHistorialCrudas(lista) {
  const tbody = document.getElementById('tbody-hcrud');
  if (!tbody) return;
  const n = (lista || []).length;
  const cEl = document.getElementById('hcrud-count');
  const tEl = document.getElementById('hcrud-total-label');
  if (cEl) cEl.textContent = n + ' registros';
  if (tEl) {
    const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
    const mov = resumenMovimientoRealInventario(lista || [], fechaSel);
    tEl.innerHTML =
      `Total: <strong style="color:var(--verde)">${n}</strong> crudas · ` +
      `<span style="color:var(--tx2)">Mov. real: ${mov.despachadoDia} día · ${mov.pendiente} pendiente · ${mov.salioOtroDia} otro día</span>`;
  }

  if (!n) { tbody.innerHTML = '<tr><td colspan="9" class="empty">Sin crudas para esta fecha</td></tr>'; return; }

  const sorted = [...(lista || [])].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  tbody.innerHTML = sorted.map(d => {
    const sal = salidaUltimaGrupo([d]);
    const titProp = d.propietario_origen === 'vista_ultimo'
      ? 'Propietario según último registro disponible en la vista'
      : '';
    return `<tr>
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto || '—')}</td>
      <td style="font-weight:600"${titProp ? ` title="${escapeHtml(titProp).replace(/"/g, '&quot;')}"` : ''}>${escapeHtml(d.propietario || 'Sin asignar')}${d.propietario_origen === 'vista_ultimo' ? ' <span class="prop-origen" aria-hidden="true">·</span>' : ''}</td>
      <td>${badgeObs(d.observacion, d, 'viscera')}</td>
      <td>${escapeHtml(destinoTabla(d))}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td style="font-size:12px">${sal ? formatFecha(sal) : '—'}</td>
      <td><span style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--verde)">1</span></td>
    </tr>`;
  }).join('');
}

function filtrarHistorialCrud() {
  const txt = (document.getElementById('srch-hcrud')?.value || '').toLowerCase().trim();
  renderHistorialCrudas(datosCrudasHist.filter(d => !txt || textoBusquedaLibre(d).includes(txt)));
}

// ── INVENTARIO ────────────────────────────────────────────────────────────────
let seleccionados = new Set();
let seleccionadosCrud = new Set();

function claveGrupoInventario(d) {
  if (esCocida(d)) return `COC||${d.propietario || '—'}||${d.cliente_destino || '—'}`;
  return `CRU||${d.propietario || '—'}||${d.cliente_destino || '—'}||${(d.observacion || '').trim()}`;
}

/** Pendientes de inventario (librillos) */
function obtenerPendientesInventario() {
  let pendientes = (datosLibrillos || []).filter((d) => !productoYaSalidaColbeefOTraz(d));
  const el = document.getElementById('srch-inv');
  const txt = (el && el.value.toLowerCase().trim()) || '';
  if (txt) {
    pendientes = pendientes.filter((d) => textoBusquedaLibre(d).includes(txt));
  }
  return pendientes;
}

function obtenerPendientesInventarioCrud() {
  let pendientes = (datosCrudasHist || []).filter((d) => !productoYaSalidaColbeefOTraz(d));
  const el = document.getElementById('srch-inv-crud');
  const txt = (el && el.value.toLowerCase().trim()) || '';
  if (txt) {
    pendientes = pendientes.filter((d) => textoBusquedaLibre(d).includes(txt));
  }
  return pendientes;
}

function resumenMovimientoRealInventario(items, fechaSel) {
  const out = { despachadoDia: 0, pendiente: 0, salioOtroDia: 0 };
  (items || []).forEach((d) => {
    const ts = salidaEfectivaTimestamp(d.id_producto, d);
    if (!ts) {
      out.pendiente += 1;
      return;
    }
    const dia = diaOperativoSalidaISO(ts);
    if (dia === fechaSel) out.despachadoDia += 1;
    else out.salioOtroDia += 1;
  });
  return out;
}

function htmlFilasPendientesInv(pendientes, mensajeVacio) {
  if (!pendientes.length) return `<tr><td colspan="11" class="empty">${mensajeVacio}</td></tr>`;
  const sorted = [...pendientes].sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
  return sorted.map(d => {
    const id = String(d.id_producto || '');
    const chk = seleccionados.has(id) ? 'checked' : '';
    const prop = d.propietario || 'Sin asignar';
    return `<tr class="${seleccionados.has(id) ? 'fila-sel ' : ''}client-row" style="${estilosFilaCliente(d.cliente_destino || '—')}">
      <td><input type="checkbox" ${chk} onchange="toggleSeleccion('${id}',this)"></td>
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
      <td style="font-size:12px">${escapeHtml(prop)}</td>
      <td>${clienteChipHtml(d.cliente_destino || '—')}</td>
      <td><span class="b b-agru">${escapeHtml(etiquetaAgrupacionMacro(d))}</span></td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td>${badgeObs(d.observacion, d, 'librillo')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td><span class="b b-cava">Pendiente</span></td>
      <td></td>
    </tr>`;
  }).join('');
}

/**
 * Despachos del día operativo: Colbeef + filas solo con salida de cava en trazabilidad (sin duplicar).
 */
function listaSalidasInventarioParaDia(fechaSel) {
  const colb = (salidasRegistradas || []).filter(
    (s) => s.fecha_salida && diaOperativoSalidaISO(s.fecha_salida) === fechaSel
  );
  const porId = new Map(
    colb.map((s) => [
      String(s.id_producto),
      { ...s, soloTrazabilidad: false },
    ])
  );

  const tryTraz = (lista, filtroFn) => {
    (lista || []).filter(filtroFn).forEach((d) => {
      const id = String(d.id_producto || '');
      if (!id || !d.fecha_salida_cava) return;
      if (diaOperativoSalidaISO(d.fecha_salida_cava) !== fechaSel) return;
      if (porId.has(id)) return;
      porId.set(id, {
        id: null,
        id_producto: d.id_producto,
        fecha_salida: d.fecha_salida_cava,
        registrado_por: 'Trazabilidad (salida cava)',
        soloTrazabilidad: true,
      });
    });
  };
  tryTraz(datosLibrillos, esVistaHistorialLibrillos);
  tryTraz(datosCrudasHist, esVistaHistorialCrudasSolo);

  return [...porId.values()].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
}

function listaSalioOtroDiaInventario(fechaSel) {
  const byId = new Map();
  const pushIf = (d, filtroFn) => {
    if (!filtroFn(d)) return;
    const det = salidaEfectivaDetalle(d.id_producto, d);
    if (!det?.ts) return;
    const dia = diaOperativoSalidaISO(det.ts);
    if (!dia || dia === fechaSel) return;
    const id = String(d.id_producto || '');
    if (!id || byId.has(id)) return;
    byId.set(id, {
      id_producto: d.id_producto,
      fecha_salida: det.ts,
      fuente: det.fuente,
      d,
    });
  };
  (datosLibrillos || []).forEach((d) => pushIf(d, esVistaHistorialLibrillos));
  (datosCrudasHist || []).forEach((d) => pushIf(d, esVistaHistorialCrudasSolo));
  return [...byId.values()].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
}

function htmlFilasDespachadosHoy(despachados, modo) {
  const esCrud = modo === 'crud';
  const filtro = esCrud ? esVistaHistorialCrudasSolo : esVistaHistorialLibrillos;
  const rows = despachados
    .map((s) => {
      const d = datosGlobal.find((x) => x.id_producto === s.id_producto) || {};
      return { s, d };
    })
    .filter(({ d }) => filtro(d))
    .sort((a, b) => String(a.s.id_producto || '').localeCompare(String(b.s.id_producto || ''), undefined, { numeric: true }));

  const colSpan = esCrud ? 7 : 8;
  if (!rows.length) return `<tr><td colspan="${colSpan}" class="empty">Sin despachos en esta fecha operativa</td></tr>`;

  return rows.map(({ s, d }) => {
    const prop = d.propietario || 'Sin asignar';
    const cli = d.cliente_destino || '—';
    const escF = String(s.fecha_salida || '').replace(/'/g, "\\'");
    const estilo = estilosFilaCliente(esCrud ? prop : cli);
    const btnEdit =
      s.soloTrazabilidad || s.id == null
        ? '<span style="font-size:11px;color:var(--tx3)" title="Salida registrada en trazabilidad; use despacho Colbeef si debe corregirse aquí">—</span>'
        : `<button type="button" class="btn-edit-salida" title="Editar salida" onclick="abrirModalEditSalida('${s.id}','${s.id_producto}','${escF}')">Editar</button>`;
    if (esCrud) {
      return `<tr class="client-row" style="${estilo}">
        <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(s.id_producto)}</td>
        <td style="font-size:12px">${escapeHtml(prop)}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
        <td style="font-size:12px">${formatFecha(s.fecha_salida)}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(s.registrado_por || '—')}</td>
        <td>${btnEdit}</td>
      </tr>`;
    }
    return `<tr class="client-row" style="${estilo}">
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(s.id_producto)}</td>
      <td style="font-size:12px">${escapeHtml(prop)}</td>
      <td>${clienteChipHtml(cli)}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td style="font-size:12px">${formatFecha(s.fecha_salida)}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(s.registrado_por || '—')}</td>
      <td>${btnEdit}</td>
    </tr>`;
  }).join('');
}

function htmlFilasPendientesInvCrud(pendientes, mensajeVacio) {
  if (!pendientes.length) return `<tr><td colspan="9" class="empty">${mensajeVacio}</td></tr>`;
  const sorted = [...pendientes].sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
  return sorted.map(d => {
    const id = String(d.id_producto || '');
    const chk = seleccionadosCrud.has(id) ? 'checked' : '';
    const prop = d.propietario || 'Sin asignar';
    return `<tr class="${seleccionadosCrud.has(id) ? 'fila-sel ' : ''}client-row" style="${estilosFilaCliente(prop)}">
      <td><input type="checkbox" ${chk} onchange="toggleSeleccionCrud('${id}',this)"></td>
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
      <td style="font-size:12px">${escapeHtml(prop)}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td>${badgeObs(d.observacion, d, 'viscera')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td><span class="b b-cava">Pendiente</span></td>
      <td><button type="button" class="btn-etq-mini" title="Crear etiqueta para imprimir (esta cruda)" onclick="imprimirEtiquetasCrudasUnId(${JSON.stringify(id)})">Etiqueta</button></td>
    </tr>`;
  }).join('');
}

function htmlFilasSalioOtroDiaInventario(registros, modo) {
  const esCrud = modo === 'crud';
  const rows = (registros || [])
    .filter(({ d }) => esCrud ? esVistaHistorialCrudasSolo(d) : esVistaHistorialLibrillos(d))
    .sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));

  const colSpan = esCrud ? 6 : 7;
  if (!rows.length) return `<tr><td colspan="${colSpan}" class="empty">Sin registros en este estado</td></tr>`;

  return rows.map(({ id_producto, fecha_salida, fuente, d }) => {
    const prop = d?.propietario || 'Sin asignar';
    const cli = d?.cliente_destino || '—';
    const estilo = estilosFilaCliente(esCrud ? prop : cli);
    if (esCrud) {
      return `<tr class="client-row" style="${estilo}">
        <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(id_producto)}</td>
        <td style="font-size:12px">${escapeHtml(prop)}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d?.sucursal || '—')}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d?.empresa_destino || '—')}</td>
        <td style="font-size:12px">${formatFecha(fecha_salida)}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(fuente || '—')}</td>
      </tr>`;
    }
    return `<tr class="client-row" style="${estilo}">
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(id_producto)}</td>
      <td style="font-size:12px">${escapeHtml(prop)}</td>
      <td>${clienteChipHtml(cli)}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d?.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d?.empresa_destino || '—')}</td>
      <td style="font-size:12px">${formatFecha(fecha_salida)}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(fuente || '—')}</td>
    </tr>`;
  }).join('');
}

function renderInventario() {
  const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
  const despachados = listaSalidasInventarioParaDia(fechaSel);
  const otroDia = listaSalioOtroDiaInventario(fechaSel);
  const movLib = resumenMovimientoRealInventario(datosLibrillos || [], fechaSel);
  const movCrud = resumenMovimientoRealInventario(datosCrudasHist || [], fechaSel);

  const pendLib = obtenerPendientesInventario();
  const txtLib = (document.getElementById('srch-inv') && document.getElementById('srch-inv').value.toLowerCase().trim()) || '';
  const tbody = document.getElementById('tbody-inv');
  const tbodyDesp = document.getElementById('tbody-desp');
  if (tbody) {
    document.getElementById('inv-count').textContent = pendLib.length + ' pendientes';
    document.getElementById('inv-total-label').textContent = txtLib
      ? pendLib.length + ' coincidencias'
      : pendLib.length + ' pendientes de despacho';
    const lblMov = document.getElementById('inv-mov-real-label');
    if (lblMov) {
      lblMov.textContent =
        `Mov. real: ${movLib.despachadoDia} despachado(s) día · ${movLib.pendiente} pendiente(s) · ${movLib.salioOtroDia} salió otro día`;
    }
    const vacioPend = txtLib ? 'Sin resultados' : 'Todos los librillos han sido despachados';
    tbody.innerHTML = htmlFilasPendientesInv(pendLib, vacioPend);
  }
  if (tbodyDesp) {
    const nLibDesp = despachados.filter(s => esVistaHistorialLibrillos(datosGlobal.find(x => x.id_producto === s.id_producto) || {})).length;
    document.getElementById('desp-count').textContent = nLibDesp + ' despachos';
    tbodyDesp.innerHTML = htmlFilasDespachadosHoy(despachados, 'lib');
  }
  const tbodyOtroLib = document.getElementById('tbody-otro-dia-lib');
  if (tbodyOtroLib) {
    const rows = otroDia.filter((r) => esVistaHistorialLibrillos(r.d));
    const lbl = document.getElementById('otro-dia-lib-count');
    if (lbl) lbl.textContent = `${rows.length} registros`;
    tbodyOtroLib.innerHTML = htmlFilasSalioOtroDiaInventario(rows, 'lib');
  }

  const pendCr = obtenerPendientesInventarioCrud();
  const txtCr = (document.getElementById('srch-inv-crud') && document.getElementById('srch-inv-crud').value.toLowerCase().trim()) || '';
  const tbodyC = document.getElementById('tbody-inv-crud');
  const tbodyDespC = document.getElementById('tbody-desp-crud');
  if (tbodyC) {
    document.getElementById('inv-crud-count').textContent = pendCr.length + ' pendientes';
    document.getElementById('inv-crud-total-label').textContent = txtCr
      ? pendCr.length + ' coincidencias'
      : pendCr.length + ' pendientes de despacho';
    const lblMovCrud = document.getElementById('inv-crud-mov-real-label');
    if (lblMovCrud) {
      lblMovCrud.textContent =
        `Mov. real: ${movCrud.despachadoDia} despachado(s) día · ${movCrud.pendiente} pendiente(s) · ${movCrud.salioOtroDia} salió otro día`;
    }
    const vacioCr = txtCr ? 'Sin resultados' : 'Todas las crudas han sido despachadas';
    tbodyC.innerHTML = htmlFilasPendientesInvCrud(pendCr, vacioCr);
  }
  if (tbodyDespC) {
    const nCrDesp = despachados.filter(s => esVistaHistorialCrudasSolo(datosGlobal.find(x => x.id_producto === s.id_producto) || {})).length;
    document.getElementById('desp-crud-count').textContent = nCrDesp + ' despachos';
    tbodyDespC.innerHTML = htmlFilasDespachadosHoy(despachados, 'crud');
  }
  const tbodyOtroCrud = document.getElementById('tbody-otro-dia-crud');
  if (tbodyOtroCrud) {
    const rows = otroDia.filter((r) => esVistaHistorialCrudasSolo(r.d));
    const lbl = document.getElementById('otro-dia-crud-count');
    if (lbl) lbl.textContent = `${rows.length} registros`;
    tbodyOtroCrud.innerHTML = htmlFilasSalioOtroDiaInventario(rows, 'crud');
  }

  actualizarBotonDespachar();
}

function filtrarInventario() {
  renderInventario();
}

function filtrarInventarioCrud() {
  renderInventario();
}

function toggleSeleccionGrupo(ids, chk) {
  if (chk.checked) ids.forEach(id => seleccionados.add(id));
  else ids.forEach(id => seleccionados.delete(id));
  renderInventario();
}

function toggleSeleccion(id, chk) {
  const key = String(id);
  if (chk.checked) seleccionados.add(key);
  else seleccionados.delete(key);
  actualizarBotonDespachar();
  const tr = chk.closest('tr');
  if (tr) tr.classList.toggle('fila-sel', chk.checked);
}

function toggleTodos(chkAll) {
  const pendientes = obtenerPendientesInventario();
  if (chkAll.checked) pendientes.forEach(d => seleccionados.add(String(d.id_producto)));
  else seleccionados.clear();
  renderInventario();
}

function toggleTodosCrud(chkAll) {
  const pendientes = obtenerPendientesInventarioCrud();
  if (chkAll.checked) pendientes.forEach(d => seleccionadosCrud.add(String(d.id_producto)));
  else seleccionadosCrud.clear();
  renderInventario();
}

function seleccionarTodos() {
  const chkAll = document.getElementById('chk-all');
  chkAll.checked = true;
  toggleTodos(chkAll);
}

function seleccionarTodosCrud() {
  const chkAll = document.getElementById('chk-all-crud');
  chkAll.checked = true;
  toggleTodosCrud(chkAll);
}

function toggleSeleccionCrud(id, chk) {
  const key = String(id);
  if (chk.checked) seleccionadosCrud.add(key);
  else seleccionadosCrud.delete(key);
  actualizarBotonDespachar();
  const tr = chk.closest('tr');
  if (tr) tr.classList.toggle('fila-sel', chk.checked);
}

function actualizarBotonDespachar() {
  const btn = document.getElementById('btn-despachar');
  const n = seleccionados.size;
  if (document.getElementById('n-seleccionados')) document.getElementById('n-seleccionados').textContent = n;
  if (btn) { btn.disabled = n === 0; btn.title = ''; }
  const btnC = document.getElementById('btn-despachar-crud');
  const nC = seleccionadosCrud.size;
  if (document.getElementById('n-seleccionados-crud')) document.getElementById('n-seleccionados-crud').textContent = nC;
  if (btnC) { btnC.disabled = nC === 0; btnC.title = ''; }
}

function expandirIdsRelacionadosPorIdentificacion(idsBase, datosFresh, salidasFresh) {
  const set = new Set((idsBase || []).map(String));
  const byId = new Map((datosFresh || []).map(d => [String(d.id_producto), d]));
  const idents = new Set();
  set.forEach(id => {
    const r = byId.get(id);
    const ident = String(r?.identificacion || '').trim();
    if (ident) idents.add(ident);
  });
  if (!idents.size) return [...set];
  (datosFresh || []).forEach(d => {
    const id = String(d.id_producto || '');
    if (!id || productoYaSalidaColbeefOTraz(d, salidasFresh)) return;
    if (!esVistaHistorialLibrillos(d) && !esVistaHistorialCrudasSolo(d)) return;
    const ident = String(d.identificacion || '').trim();
    if (ident && idents.has(ident)) set.add(id);
  });
  return [...set];
}

async function despacharSeleccionadosCrud() {
  if (seleccionadosCrud.size === 0) { mostrarToast('Selecciona al menos una cruda', 'err'); return; }

  const ids = Array.from(seleccionadosCrud).map(String);
  return runWithAppLoader('Registrando despacho de crudas...', async () => {
    try {
      const fecha = document.getElementById('fecha-global')?.value || hoyISO();
      const [datosFresh, salidasFresh] = await Promise.all([fetchPorFecha(fecha), fetchSalidas()]);
      const pendientesFresh = (datosFresh || []).filter(esVistaHistorialCrudasSolo).filter((d) => !productoYaSalidaColbeefOTraz(d, salidasFresh));
      const mapFresh = new Map(pendientesFresh.map(d => [String(d.id_producto), d]));
      const idsValidos = ids.filter(id => mapFresh.has(id));
      if (!idsValidos.length) {
        datosGlobal = datosFresh;
        datosClientes = datosFresh;
        salidasRegistradas = salidasFresh;
        separarDatos(datosFresh);
        seleccionadosCrud.clear();
        renderInventario();
        mostrarToast('Las crudas seleccionadas ya no están pendientes. Se actualizó inventario.', 'err');
        return;
      }

      const idsConRelacionados = expandirIdsRelacionadosPorIdentificacion(idsValidos, datosFresh, salidasFresh);
      const res = await fetch(SALIDAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids_productos: idsConRelacionados, rol: USUARIO_ACTUAL, usuario: usuarioOperacionActual() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      salidasRegistradas = await fetchSalidas();
      seleccionadosCrud.clear();
      const ca = document.getElementById('chk-all-crud');
      if (ca) ca.checked = false;
      await cargarDatos();
      const extras = Math.max(0, idsConRelacionados.length - idsValidos.length);
      mostrarToast(`${data.registradas || idsConRelacionados.length} salida(s) registradas. ${extras ? `Incluye ${extras} relacionada(s) por identificación.` : ''}`, 'ok');
    } catch(e) {
      mostrarToast('Error al registrar despacho: ' + e.message, 'err');
    }
  });
}

async function despacharSeleccionados() {
  if (seleccionados.size === 0) { mostrarToast('Selecciona al menos un librillo', 'err'); return; }

  const ids = Array.from(seleccionados).map(String);
  return runWithAppLoader('Registrando despacho de librillos...', async () => {
    try {
      // Usa estado fresco de BD para despachar lo que siga pendiente sin bloquear por cambios menores.
      const fecha = document.getElementById('fecha-global')?.value || hoyISO();
      const [datosFresh, salidasFresh] = await Promise.all([fetchPorFecha(fecha), fetchSalidas()]);
      const pendientesFresh = (datosFresh || []).filter(esVistaHistorialLibrillos).filter((d) => !productoYaSalidaColbeefOTraz(d, salidasFresh));
      const mapFresh = new Map(pendientesFresh.map(d => [String(d.id_producto), d]));
      const idsValidos = ids.filter(id => mapFresh.has(id));
      if (!idsValidos.length) {
        datosGlobal = datosFresh;
        datosClientes = datosFresh;
        salidasRegistradas = salidasFresh;
        separarDatos(datosFresh);
        seleccionados.clear();
        renderInventario();
        mostrarToast('Los librillos seleccionados ya no están pendientes. Se actualizó inventario.', 'err');
        return;
      }

      const idsConRelacionados = expandirIdsRelacionadosPorIdentificacion(idsValidos, datosFresh, salidasFresh);
      const res = await fetch(SALIDAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids_productos: idsConRelacionados, rol: USUARIO_ACTUAL, usuario: usuarioOperacionActual() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      salidasRegistradas = await fetchSalidas();
      seleccionados.clear();
      const ca = document.getElementById('chk-all');
      if (ca) ca.checked = false;
      await cargarDatos();
      const extras = Math.max(0, idsConRelacionados.length - idsValidos.length);
      mostrarToast(`${data.registradas || idsConRelacionados.length} salida(s) registradas. ${extras ? `Incluye ${extras} relacionada(s) por identificación.` : ''}`, 'ok');
    } catch(e) {
      mostrarToast('Error al registrar despacho: ' + e.message, 'err');
    }
  });
}

// ── MODAL EDITAR SALIDA ───────────────────────────────────────────────────────
let editSalidaId = null;

function abrirModalEditSalida(id, idProducto, fechaSalida) {
  editSalidaId = id;
  document.getElementById('edit-id-producto').value = idProducto;
  // Convertir ISO a datetime-local
  const dt = new Date(fechaSalida);
  const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  document.getElementById('edit-fecha-salida').value = local;
  document.getElementById('modal-edit-salida').classList.add('open');
}

function cerrarModalEditSalida() {
  document.getElementById('modal-edit-salida').classList.remove('open');
  editSalidaId = null;
}

async function guardarEditSalida() {
  if (!editSalidaId) return;
  const nuevaFecha = document.getElementById('edit-fecha-salida').value;
  if (!nuevaFecha) { alert('Ingresa una fecha válida'); return; }
  try {
    const res = await fetch(`${SALIDAS_URL}/${editSalidaId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha_salida: new Date(nuevaFecha).toISOString(), rol: 'admin', usuario: usuarioOperacionActual() }),
    });
    const data = await res.json();
    if (data.error) { alert('Error: ' + data.error); return; }
    salidasRegistradas = normalizarListaSalidas(await fetch(SALIDAS_URL).then(r => r.json()));
    cerrarModalEditSalida();
    renderInventario();
    actualizarPanelCuadre();
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

// Eliminación deshabilitada (solo existía para admin)

// ── CLIENTES ──────────────────────────────────────────────────────────────────
/** Observación completa tal como viene del API (prioriza `observaciones` fusionadas). Solo vista Por cliente. */
function textoObservacionCompletaPorCliente(d) {
  return String(d?.observaciones ?? d?.observacion ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function esFilaVistaPorCliente(d) {
  return esVistaHistorialLibrillos(d) || esVistaHistorialCrudasSolo(d);
}

function leerFiltroColumnaCliente(domId) {
  const el = document.getElementById(domId);
  if (!el) return '';
  return String(el.value || '').trim().toLowerCase();
}

function renderTablaClientes(lista) {
  const tbody = document.getElementById('tbody-cli');
  const titulo = document.getElementById('cli-title');
  if (titulo) titulo.textContent = 'Información — Consulta unificada';

  const datos = Array.isArray(lista) ? lista : [];
  const rows = datos.filter(esFilaVistaPorCliente);

  const cnt = document.getElementById('cli-count');
  if (cnt) cnt.textContent = rows.length + ' registros';
  const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
  const mov = resumenMovimientoRealInventario(rows, fechaSel);
  const elLab = document.getElementById('cli-total-label');
  if (elLab) {
    elLab.textContent = `${rows.length} registros · Mov. real: ${mov.despachadoDia} día · ${mov.pendiente} pendiente · ${mov.salioOtroDia} otro día`;
  }
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Sin registros</td></tr>';
    return;
  }

  const sorted = [...rows].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  tbody.innerHTML = sorted.map((d) => {
    const sal = salidaUltimaGrupo([d]);
    const prop = d.propietario || 'Sin asignar';
    const titProp =
      d.propietario_origen === 'vista_ultimo'
        ? 'Propietario según último registro disponible en la vista'
        : '';
    const obsCompleta = textoObservacionCompletaPorCliente(d);
    const obsShown = obsCompleta || '—';
    const escObs = escapeHtml(obsShown).replace(/"/g, '&quot;');
    const soloCrudaSinRetiro = esVistaHistorialCrudasSolo(d) && !esVistaHistorialLibrillos(d);
    const colorTotal = soloCrudaSinRetiro ? 'var(--verde)' : 'var(--rojo)';
    return `<tr class="client-row" style="${estilosFilaCliente(d.cliente_destino || '—')}">
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto || '—')}</td>
      <td style="font-weight:600"${titProp ? ` title="${escapeHtml(titProp).replace(/"/g, '&quot;')}"` : ''}>${escapeHtml(prop)}${d.propietario_origen === 'vista_ultimo' ? ' <span class="prop-origen" aria-hidden="true">·</span>' : ''}</td>
      <td><span class="b b-agru">${escapeHtml(etiquetaAgrupacionMacro(d))}</span></td>
      <td class="cli-obs-cell" title="${escObs}">${escapeHtml(obsShown)}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td style="font-size:12px">${sal ? formatFecha(sal) : '—'}</td>
      <td><span style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:${colorTotal}">1</span></td>
    </tr>`;
  }).join('');
}

/** Texto agregado de un registro para búsqueda global en vista Clientes (todas las columnas visibles + campos API). */
function textoBusquedaClienteRow(d) {
  if (!d) return '';
  const partes = [];
  const add = (v) => {
    if (v == null) return;
    if (typeof v === 'object') return;
    partes.push(String(v));
  };
  add(d.propietario);
  add(d.cliente_destino);
  add(d.destino);
  add(d.observacion);
  add(d.observaciones);
  add(textoObservacionCompletaPorCliente(d));
  add(d.sucursal);
  add(d.empresa_destino);
  add(d.agrupacion);
  add(d.id_producto);
  try {
    partes.push(String(etiquetaAgrupacionMacro(d)));
    partes.push(String(etiquetaAgrupacion(d)));
    partes.push(String(ubicacionPlaza(d)));
    partes.push(String(resolverCliente(d)));
    partes.push(String(formatFecha(d.fecha_ingreso_cava)));
    partes.push(String(formatFecha(d.fecha_salida_cava)));
  } catch (_) { /* fechas o helpers */ }
  for (const k of Object.keys(d)) {
    const v = d[k];
    if (v != null && typeof v !== 'object' && typeof v !== 'function') partes.push(String(v));
  }
  return partes.join(' ').toLowerCase();
}

function filtrarCli() {
  const raw = (document.getElementById('srch-cli')?.value || '').trim().toLowerCase();
  const fId = leerFiltroColumnaCliente('srch-cli-c-id');
  const fProp = leerFiltroColumnaCliente('srch-cli-c-prop');
  const fAgr = leerFiltroColumnaCliente('srch-cli-c-agr');
  const fObs = leerFiltroColumnaCliente('srch-cli-c-obs');
  const fSuc = leerFiltroColumnaCliente('srch-cli-c-suc');
  const fEmp = leerFiltroColumnaCliente('srch-cli-c-emp');
  const fIng = leerFiltroColumnaCliente('srch-cli-c-ing');
  const fSal = leerFiltroColumnaCliente('srch-cli-c-sal');
  const fTot = leerFiltroColumnaCliente('srch-cli-c-tot');

  const pre = (datosClientes || []).filter(esFilaVistaPorCliente);

  const filtrados = pre.filter((d) => {
    if (raw && !textoBusquedaClienteRow(d).includes(raw)) return false;
    if (fId && !String(d.id_producto || '').toLowerCase().includes(fId)) return false;
    if (fProp && !String(d.propietario || '').toLowerCase().includes(fProp)) return false;
    let agrTxt = '';
    try {
      agrTxt = String(etiquetaAgrupacionMacro(d) || '').toLowerCase();
    } catch (_) {
      agrTxt = String(d?.agrupacion || d?.agrupacion_codigo || '').toLowerCase();
    }
    if (fAgr && !agrTxt.includes(fAgr)) return false;
    const obsFull = textoObservacionCompletaPorCliente(d).toLowerCase();
    if (fObs && !obsFull.includes(fObs)) return false;
    if (fSuc && !String(d.sucursal || '').toLowerCase().includes(fSuc)) return false;
    if (fEmp && !String(d.empresa_destino || '').toLowerCase().includes(fEmp)) return false;
    const ingTxt = String(formatFecha(d.fecha_ingreso_cava) || '').toLowerCase();
    if (fIng && !ingTxt.includes(fIng)) return false;
    const sal = salidaUltimaGrupo([d]);
    const salTxt = (sal ? String(formatFecha(sal) || '') : '—').toLowerCase();
    if (fSal && !salTxt.includes(fSal)) return false;
    if (fTot && !'1'.includes(fTot)) return false;
    return true;
  });

  renderTablaClientes(filtrados);
}

// ── MODAL IDs ─────────────────────────────────────────────────────────────────
function abrirModal(prop, items, ctx = 'auto') {
  const arr = items || [];
  const esGrupoLibrillo = (() => {
    if (ctx === 'librillo') return true;
    if (ctx === 'viscera') return false;
    // auto: si al menos un item aplica como librillo, mostramos columnas de librillo
    return arr.some(esVistaHistorialLibrillos);
  })();
  document.getElementById('modal-title').textContent = `${prop} — ${items.length} registros`;
  const thead = document.getElementById('modal-thead');
  if (thead) {
    thead.innerHTML = esGrupoLibrillo
      ? '<tr><th>ID Producto</th><th>Observación</th><th>Cliente Destino</th><th>Sucursal</th><th>Empresa destino</th><th>Salida</th></tr>'
      : '<tr><th>ID Producto</th><th>Observación</th><th>Cliente Destino</th><th>Sucursal</th><th>Empresa destino</th><th>Ingreso Cava</th><th>Salida Cava</th></tr>';
  }
  document.getElementById('modal-body').innerHTML = items.map(d => {
    if (esGrupoLibrillo) {
      const sal = salidaUltimaRegistrada(d.id_producto);
      return `<tr>
        <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${d.id_producto||'—'}</td>
        <td>${badgeObs(d.observacion, d, 'librillo')}</td>
        <td>${clienteChipHtml(d.cliente_destino || '—')}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
        <td style="font-size:12px">${sal ? formatFecha(sal) : '—'}</td>
      </tr>`;
    }
    return `<tr>
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${d.id_producto||'—'}</td>
      <td>${badgeObs(d.observacion, d, 'viscera')}</td>
      <td>${clienteChipHtml(d.cliente_destino || '—')}</td>
      <td>${escapeHtml(ubicacionPlaza(d))}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_salida_cava)}</td>
    </tr>`;
  }).join('');
  document.getElementById('modal-bg').classList.add('open');
}
function cerrarModal() { document.getElementById('modal-bg').classList.remove('open'); }

// ── REPORTES ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function salidaRegistrada(idProducto, fechaDia, salidas, dRow) {
  if (!fechaDia) return null;
  const lista = salidas || [];
  const row = lista.find(
    (x) =>
      x.id_producto === idProducto &&
      x.fecha_salida &&
      diaOperativoSalidaISO(x.fecha_salida) === fechaDia
  );
  if (row) return row.fecha_salida;
  if (
    dRow?.fecha_salida_cava &&
    diaOperativoSalidaISO(dRow.fecha_salida_cava) === fechaDia
  ) {
    return dRow.fecha_salida_cava;
  }
  return null;
}

function salidaUltimaRegistrada(idProducto) {
  const rows = (salidasRegistradas || []).filter(s => s.id_producto === idProducto && s.fecha_salida);
  if (!rows.length) return null;
  rows.sort((a, b) => new Date(b.fecha_salida) - new Date(a.fecha_salida));
  return rows[0].fecha_salida;
}

/** Colbeef o cava (la más reciente) para mostrar en tablas. */
function salidaEfectivaTimestamp(idProducto, dRow) {
  const colb = salidaUltimaRegistrada(idProducto);
  const cava = dRow?.fecha_salida_cava ? String(dRow.fecha_salida_cava) : null;
  if (!colb && !cava) return null;
  if (!cava) return colb;
  if (!colb) return cava;
  return new Date(colb) >= new Date(cava) ? colb : cava;
}

function salidaEfectivaDetalle(idProducto, dRow) {
  const colb = salidaUltimaRegistrada(idProducto);
  const cava = dRow?.fecha_salida_cava ? String(dRow.fecha_salida_cava) : null;
  if (!colb && !cava) return null;
  if (!cava) return { ts: colb, fuente: 'Colbeef' };
  if (!colb) return { ts: cava, fuente: 'Trazabilidad' };
  return new Date(colb) >= new Date(cava)
    ? { ts: colb, fuente: 'Colbeef' }
    : { ts: cava, fuente: 'Trazabilidad' };
}

function salidaUltimaGrupo(items) {
  const fechas = (items || [])
    .map((d) => salidaEfectivaTimestamp(d.id_producto, d))
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a));
  return fechas[0] || null;
}

function badgeObsHtmlExport(obs) {
  if (!obs || String(obs).trim() === '') return '<span style="background:rgba(26,122,66,.15);color:#1a7a42;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600">COCIDA</span>';
  if (String(obs).toUpperCase().includes('CRUD')) return `<span style="background:rgba(192,57,43,.12);color:#c0392b;padding:2px 8px;border-radius:99px;font-size:11px">${escapeHtml(obs)}</span>`;
  return `<span style="background:rgba(176,141,10,.12);color:#b08d0a;padding:2px 8px;border-radius:99px;font-size:11px">${escapeHtml(obs)}</span>`;
}

function tablaReporteGeneralLibrillosHTML(datos, fechaISO, salidas) {
  const librillos = (datos || []).filter(esVistaHistorialLibrillos);
  if (!librillos.length) return '';
  const sorted = [...librillos].sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
  let h = `<h3 class="rep-sec-title">Librillos (crudos)</h3><div class="tw rep-table-wrap"><table class="dt" style="font-size:12px"><thead><tr>
    <th>ID Producto</th><th>Cliente Destino</th><th>Sucursal</th><th>Empresa destino</th><th>Entrada</th><th>Salida</th>
  </tr></thead><tbody>`;
  sorted.forEach(d => {
    const sal = salidaRegistrada(d.id_producto, fechaISO, salidas, d);
    h += `<tr>
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
      <td style="color:var(--verde);font-weight:500">${escapeHtml(d.cliente_destino) || '—'}</td>
      <td>${escapeHtml(ubicacionPlaza(d))}</td>
      <td>${escapeHtml(d.empresa_destino) || '—'}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td style="font-size:12px">${sal ? formatFecha(sal) : '—'}</td>
    </tr>`;
  });
  h += '</tbody></table></div>';
  return h;
}

function tablaReporteGeneralLibrillosHTMLExport(datos, fechaISO, salidas) {
  const librillos = (datos || []).filter(esVistaHistorialLibrillos);
  if (!librillos.length) return '';
  const sorted = [...librillos].sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
  let h = `<h3 style="font-size:14px;color:#8b0000;margin:20px 0 10px;text-transform:uppercase">Librillos (crudos)</h3><table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #bbb"><thead><tr style="background:#8b0000;color:#fff">
    <th style="padding:10px;border:1px solid #666">ID Producto</th><th style="padding:10px;border:1px solid #666">Cliente Destino</th><th style="padding:10px;border:1px solid #666">Sucursal</th><th style="padding:10px;border:1px solid #666">Empresa destino</th><th style="padding:10px;border:1px solid #666">Entrada</th><th style="padding:10px;border:1px solid #666">Salida</th>
  </tr></thead><tbody>`;
  sorted.forEach(d => {
    const sal = salidaRegistrada(d.id_producto, fechaISO, salidas, d);
    h += `<tr>
      <td style="padding:8px;border:1px solid #ccc;font-weight:700;color:#8b0000">${escapeHtml(d.id_producto)}</td>
      <td style="padding:8px;border:1px solid #ccc">${escapeHtml(d.cliente_destino) || '—'}</td>
      <td style="padding:8px;border:1px solid #ccc">${escapeHtml(ubicacionPlaza(d))}</td>
      <td style="padding:8px;border:1px solid #ccc">${escapeHtml(d.empresa_destino) || '—'}</td>
      <td style="padding:8px;border:1px solid #ccc">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td style="padding:8px;border:1px solid #ccc">${sal ? formatFecha(sal) : '—'}</td>
    </tr>`;
  });
  h += '</tbody></table>';
  return h;
}

/**
 * KPIs alineados con «LISTA LIBRILLOS / CRUDAS» y el pivote: mismos registros que
 * `filtrarPorIngresoRango` cuando hay período (día operativo de ingreso a cava).
 * Sin período, cuenta todo el conjunto recibido (comportamiento previo).
 */
function kpisGeneral(datos, opts = {}) {
  const desde = opts.desde;
  const hasta = opts.hasta;
  let librillos = (datos || []).filter(esVistaHistorialLibrillos);
  let crudas = (datos || []).filter(esVistaHistorialCrudasSolo);
  if (desde && hasta) {
    librillos = filtrarPorIngresoRango(librillos, desde, hasta);
    crudas = filtrarPorIngresoRango(crudas, desde, hasta);
  }
  const clis = new Set(librillos.map(d => d.cliente_destino).filter(Boolean));
  const propsCrud = new Set(crudas.map(d => d.propietario).filter(Boolean));
  const tipKpis =
    desde && hasta
      ? ' title="Mismo criterio que el resumen y el total general: ingreso a cava en el período (día operativo)."'
      : '';
  return `<div class="rep-kpis"${tipKpis}>
    <div class="rep-kpi"><div class="rep-kpi-n">${librillos.length}</div><div class="rep-kpi-l">Librillos</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${crudas.length}</div><div class="rep-kpi-l">Crudas</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${clis.size}</div><div class="rep-kpi-l">Clientes destino</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${propsCrud.size}</div><div class="rep-kpi-l">Propietarios (crudas)</div></div>
  </div>`;
}

/** Mismas tablas tipo pivote «LISTA LIBRILLOS ASURCARNESGLO» (CLIENTE/PLAZA × CANTIDAD) que el Excel. */
function filasListasAgrupacionComercial(datos, opts = {}) {
  if (opts.universoPlanCompleto) {
    return (datos || []).filter((d) => {
      const c = String(d?.agrupacion_codigo || '').trim();
      return Boolean(c) && c !== 'otros';
    });
  }
  return (datos || []).filter(esLibrilloParaReporteAgrupacion);
}

function debeIncluirListasPorAgrupacion(opts, datos) {
  if (opts.incluirListasPorAgrupacion === false) return false;
  if (opts.universoPlanCompleto) {
    return filasListasAgrupacionComercial(datos, opts).length > 0;
  }
  if (!(datos || []).some((d) => esLibrilloParaReporteAgrupacion(d))) return false;
  const desde = opts?.desde;
  const hasta = opts?.hasta;
  if (opts.incluirResumenLibrosChunchullas === true) return true;
  if (desde && hasta && desde === hasta) return true;
  return false;
}

function cuerpoReporteGeneral(datos, fechaISO, salidas, opts = {}) {
  if (opts.soloListasLibrillosPorAgrupacion) {
    const soloResumen = opts.vistaReporte !== 'detalle';
    const soloLista = htmlReporteAgrupaciones(datos, fechaISO, salidas, {
      soloResumen,
      omitTotalesAside: true,
    });
    return (
      soloLista ||
      '<p style="color:var(--tx3);padding:12px">Sin datos de librillos para esta agrupación</p>'
    );
  }
  const t = tablaMovimientoResumenDiaHTML(datos, fechaISO, salidas, opts);
  let listasAgrup = '';
  if (debeIncluirListasPorAgrupacion(opts, datos)) {
    listasAgrup = htmlReporteAgrupaciones(datos, fechaISO, salidas, {
      soloResumen: true,
      universoPlanCompleto: opts.universoPlanCompleto === true,
    });
  }
  if (!t && !listasAgrup) return '<p style="color:var(--tx3);padding:12px">Sin datos</p>';
  const sep =
    t && listasAgrup
      ? `<div style="margin:28px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--brd2)"><strong style="font-size:15px;color:var(--rojo)">Listas por agrupación</strong> <span style="font-size:12px;color:var(--tx3)">(mismo criterio que el libro RETIRO: una tabla por bucket comercial)</span></div>`
      : '';
  return (t || '') + sep + listasAgrup;
}

function cuerpoReporteGeneralExport(datos, fechaISO, salidas, opts = {}) {
  const desde = opts?.desde || fechaISO;
  const hasta = opts?.hasta || fechaISO;
  if (opts.soloListasLibrillosPorAgrupacion) {
    const soloResumen = opts.vistaReporte !== 'detalle';
    const inner = htmlReporteAgrupacionesExport(datos, fechaISO, salidas, {
      soloResumen,
      omitTotalesAside: true,
    });
    if (!inner || String(inner).includes('Sin librillos')) {
      return inner || '<p>Sin datos</p>';
    }
    return `<div>${inner}</div>`;
  }
  const inner = tablaMovimientoResumenDiaHTML(datos, fechaISO, salidas, opts);
  let listasAgrup = '';
  if (debeIncluirListasPorAgrupacion(opts, datos)) {
    listasAgrup =
      `<div style="margin:28px 0 10px;padding-bottom:8px;border-bottom:2px solid #ccc"><strong style="font-size:15px;color:#8b0000">Listas por agrupación</strong> <span style="font-size:12px;color:#666">(CLIENTE / PLAZA × CANTIDAD, tipo Excel)</span></div>` +
      htmlReporteAgrupacionesExport(datos, fechaISO, salidas, {
        soloResumen: true,
        universoPlanCompleto: opts.universoPlanCompleto === true,
      });
  }
  if (!inner && !listasAgrup) return '<p>Sin datos</p>';
  const librIng = filtrarPorIngresoRango(datos.filter(esVistaHistorialLibrillos), desde, hasta);
  const crudIng = filtrarPorIngresoRango(datos.filter(esVistaHistorialCrudasSolo), desde, hasta);
  const totalLib = contarPorClienteComercialPuesto(librIng).reduce((a, b) => a + b.cantidad, 0);
  const totalCrud = contarPorPropietarioUbicacion(crudIng).reduce((a, b) => a + b.cantidad, 0);
  const bloqueLch = opts.incluirResumenLibrosChunchullas
    ? htmlResumenLibrosChunchullasCrudas(datos, {
        fechaReporte: fechaISO,
        resumenMacro: opts.resumenMacro,
        soloLibrillos: opts?.destino === 'reportes',
      })
    : '';
  return `
    <div>
      <div style="font-weight:900;color:#8b0000;margin-top:10px">Movimiento (procesados) — ${escapeHtml(desde)} a ${escapeHtml(hasta)}</div>
      <p style="font-size:12px;color:#666;margin:8px 0">Cada fila del listado detallado = 1 unidad. Tabla resumida = conteo por propietario y plaza.</p>
      <div style="margin-top:8px">Total Librillos: <strong>${totalLib}</strong> · Total Crudas: <strong>${totalCrud}</strong></div>
      ${bloqueLch}
      ${inner || ''}
      ${listasAgrup}
    </div>`;
}

function filtrarPorIngresoDia(items, fechaISO) {
  return (items || []).filter(d => {
    const fi = diaOperacionISOFromTimestamp(d.fecha_ingreso_cava);
    return fi === fechaISO;
  });
}

function filtrarPorIngresoRango(items, desde, hasta) {
  return (items || []).filter(d => {
    const fi = diaOperacionISOFromTimestamp(d.fecha_ingreso_cava);
    return fi && fi >= desde && fi <= hasta;
  });
}

function contarPorClientePuesto(items, getCliente, getPuesto) {
  const m = new Map();
  (items || []).forEach(d => {
    const cli = String(getCliente(d) || '—').trim() || '—';
    const pto = String(getPuesto(d) || '—').trim() || '—';
    const key = `${cli}||${pto}`;
    m.set(key, (m.get(key) || 0) + 1);
  });
  const out = [];
  for (const [key, cantidad] of m.entries()) {
    const [cliente, puesto] = key.split('||');
    out.push({ cliente, puesto, cantidad });
  }
  out.sort((a, b) => {
    const c = String(a.cliente).localeCompare(String(b.cliente));
    if (c !== 0) return c;
    return String(a.puesto).localeCompare(String(b.puesto));
  });
  return out;
}

function limpiarPuestoTxt(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function esPlaceholderTexto(v) {
  const t = String(v || '').trim().toUpperCase();
  return !t || t === '-' || t === '--' || t === '—' || t === 'N/A' || t === 'NA' || t === 'NULL';
}

function esEtiquetaInstruccionOperativa(txt) {
  const u = String(txt || '').toUpperCase();
  if (!u) return false;
  return /\bRETIRAR?\s+LIBRIL+OS?\b|\bCRUDAS?\b|\bDERIVADOS?\b|\bCARNICOS?\b|\bOBSERVA?CION\b|\bACONDICIONAMIENTO\b|\bDESPOSTE\b|\bCONGELACION\b|\bCABEZA\b|\bCUAJOS\b|\bCANUTAS\b|\bLENGUAS\b/.test(u);
}

/**
 * Texto completo de observación (estilo hoja DATOS col D): prioriza `observaciones` del merge;
 * si no hay, usa `observacion` (puede venir sin la parte antes del retiro).
 */
function textoObservacionFuente(d) {
  const full = limpiarPuestoTxt(d?.observaciones);
  if (full) return full;
  return limpiarPuestoTxt(d?.observacion);
}

/**
 * Plaza / puesto: tramo antes del primer "(" (sin la instrucción RETIRAR LIBRILLOS…).
 * Si el formato es «ZONA - PLAZA», la plaza operativa es lo que va **después del primer guion**.
 */
function plazaLogisticaTrasGuion(antesParentesis) {
  const s = limpiarPuestoTxt(antesParentesis);
  if (!s) return null;
  const m = s.match(/^(.+?)\s*-\s*(.+)$/s);
  if (m && limpiarPuestoTxt(m[2])) return limpiarPuestoTxt(m[2]);
  return s;
}

function plazaDesdeTextoObservacion(raw) {
  const s = limpiarPuestoTxt(raw);
  if (!s) return null;
  const idx = s.indexOf('(');
  const antes = idx === -1 ? s : s.slice(0, idx);
  return plazaLogisticaTrasGuion(antes) || null;
}

/**
 * Detecta plaza operativa en cualquier tramo de la observación
 * (incluyendo el texto dentro de paréntesis), para evitar usar frases
 * de instrucción como "RETIRAR LIBRILLOS ..." en el pivote.
 */
function plazaOperativaDesdeObservacion(raw) {
  const s = limpiarPuestoTxt(raw);
  if (!s) return null;
  const u = s.toUpperCase();

  // Codigo con turno, p.ej. 01500 /VxS/
  const mTurno = u.match(/\b(\d{4,6})\s*\/([A-Z])X([A-Z])\//);
  if (mTurno) return `${mTurno[1]} /${mTurno[2]}x${mTurno[3]}/`;

  // Codigo + CAVA, p.ej. 02083 CAVA
  const mCodCava = u.match(/\b(\d{4,6})\s*CAVA\b/);
  if (mCodCava) return `${mCodCava[1]} CAVA`;

  // Siglas/plazas típicas
  const mTf = u.match(/\bTF\d+\b/);
  if (mTf) return mTf[0];
  if (/\bDRA\s*CAVA\b/.test(u)) return 'DRA CAVA';
  if (/\bCAVA\s*WO\b/.test(u)) return 'CAVA WO';
  if (/\bCAVA\s*MIREYA\b/.test(u)) return 'CAVA MIREYA';
  if (/\bCAVA\s*FREDY\b/.test(u)) return 'CAVA FREDY';

  return null;
}

/** Aplica `plazas-alias.json` (exact + contains) sobre una etiqueta base y variantes de búsqueda. */
function aplicarMapaPlazasAlias(base, variantesParaContains) {
  const baseU = String(base).toUpperCase();
  const exact = PLAZAS_ALIAS?.exact || {};
  if (exact[baseU]) return String(exact[baseU]).trim();

  const contains = PLAZAS_ALIAS?.contains || {};
  const universo = (variantesParaContains || [])
    .map((x) => String(x || '').toUpperCase())
    .join(' | ');
  for (const [k, v] of Object.entries(contains)) {
    if (k && universo.includes(String(k).toUpperCase())) return String(v).trim();
  }
  return base;
}

function extraerPuestoMacroDesdeCampos(d) {
  const suc = limpiarPuestoTxt(d?.sucursal);
  const dest = limpiarPuestoTxt(d?.destino);
  const joinedU = [suc, dest].filter(Boolean).join(' | ').toUpperCase();

  // Patrones directos estilo macro.
  const mCodCava = joinedU.match(/\b(\d{4,6})\s*CAVA\b/);
  if (mCodCava) return `${mCodCava[1]} CAVA`;
  if (/\bDRA\s*CAVA\b/.test(joinedU)) return 'DRA CAVA';
  if (/\bCAVA\s*FREDY\b/.test(joinedU)) return 'CAVA FREDY';
  return null;
}

/**
 * Puesto/plaza normalizado para resumen tipo macro:
 * - Si hay destino y sucursal:
 *   - destino con CAVA + sucursal numérica => "<sucursal> CAVA"
 *   - de lo contrario, prioriza destino (criterio logístico)
 * - Si no hay destino, usa sucursal.
 */
function puestoNormalizado(d) {
  const macro = extraerPuestoMacroDesdeCampos(d);
  if (macro && !esEtiquetaInstruccionOperativa(macro)) return macro;

  const suc = limpiarPuestoTxt(d?.sucursal);
  const dest = limpiarPuestoTxt(d?.destino);
  // Regla de negocio: plaza se maneja por sucursal.
  // Solo si no hay sucursal, se usa destino como respaldo.
  const sucOk = (esPlaceholderTexto(suc) || esEtiquetaInstruccionOperativa(suc)) ? '' : suc;
  const destOk = (esPlaceholderTexto(dest) || esEtiquetaInstruccionOperativa(dest)) ? '' : dest;
  const base = sucOk || destOk || '—';
  return aplicarMapaPlazasAlias(base, [suc, dest, base]);
}

/**
 * Plaza para UI y reportes:
 * 1) `plaza` del API (parseada desde observación; p.ej. "01014 CAVA")
 * 2) fallback `sucursal` de BD
 * 3) último fallback: detección dentro de observación completa
 */
function ubicacionPlaza(d) {
  const apiPlazaRaw = limpiarPuestoTxt(d?.plaza);
  const apiPlaza = esPlaceholderTexto(apiPlazaRaw) ? '' : apiPlazaRaw;
  const sucRaw = limpiarPuestoTxt(d?.sucursal);
  const suc = esPlaceholderTexto(sucRaw) ? '' : sucRaw;
  // Regla operativa solicitada: la sucursal real de BD nunca se remapea.
  // Si existe, se usa exactamente como llega para etiquetas de crudas.
  if (suc && !esEtiquetaInstruccionOperativa(suc)) return suc;
  const obsFull = textoObservacionFuente(d);
  const obsPlazaRaw = plazaOperativaDesdeObservacion(obsFull) || plazaDesdeTextoObservacion(obsFull);
  const obsPlaza = esPlaceholderTexto(obsPlazaRaw) ? '' : limpiarPuestoTxt(obsPlazaRaw);
  const base = apiPlaza || obsPlaza;
  if (!base) return '—';
  if (esEtiquetaInstruccionOperativa(base)) return '—';
  return aplicarMapaPlazasAlias(base, [apiPlaza, obsPlaza, base]);
}

function destinoTabla(d) {
  const limpio = (v) => String(v || '').trim();
  const destino = limpio(d?.destino);
  if (!esPlaceholderTexto(destino)) return destino;
  const sucursal = limpio(d?.sucursal);
  if (!esPlaceholderTexto(sucursal)) return sucursal;
  const plaza = limpio(ubicacionPlaza(d));
  if (!esPlaceholderTexto(plaza)) return plaza;
  const empresa = limpio(d?.empresa_destino);
  if (!esPlaceholderTexto(empresa)) return empresa;
  return '—';
}

/**
 * Etiqueta de puesto para pivote tipo macro (INICIO).
 * `plazaDesdeTextoObservacion` ya deja solo el tramo tras «-» si venía «ZONA - PUESTO».
 * Respaldo: si aún hay « - », se toma la última parte.
 */
function puestoPivotMacro(d) {
  return ubicacionPlaza(d);
}

function resolverPlazaReporte(d, nombreGrupo = '') {
  const sucRaw = limpiarPuestoTxt(d?.sucursal);
  if (sucRaw && !esPlaceholderTexto(sucRaw) && !esEtiquetaInstruccionOperativa(sucRaw)) {
    // Regla operativa: en la columna PLAZA mostrar primero el dato real de sucursal.
    return sucRaw;
  }

  const candidatos = [
    puestoPivotMacro(d),
    d?.plaza,
    d?.destino,
    d?.empresa_destino,
  ];
  for (const c of candidatos) {
    const t = limpiarPuestoTxt(c);
    if (!t) continue;
    if (esPlaceholderTexto(t)) continue;
    if (esEtiquetaInstruccionOperativa(t)) continue;
    return aplicarMapaPlazasAlias(t, candidatos);
  }
  // Fallback forzado: nunca dejar plaza vacía en reportes.
  const emergencia = [
    d?.sucursal,
    d?.plaza,
    d?.destino,
    d?.empresa_destino,
    d?.cliente_destino,
    d?.propietario,
  ]
    .map((x) => limpiarPuestoTxt(x))
    .find((x) => x && !esPlaceholderTexto(x));
  return emergencia || 'SIN PLAZA';
}

/** Para pivote DERIVADOS: nombres tal como vienen en BD (empresa / propietario / cliente parseado), no etiquetas cortas. */
function candidatosNombreCliente(d) {
  return [
    String(d?.propietario || '').trim(),
    String(d?.empresa_destino || '').trim(),
    String(d?.cliente_destino || '').trim(),
  ].filter(Boolean);
}

/** Entre candidatos que cumplen el test, el más largo suele ser la razón social o nombre completo. */
function elegirNombreMasCompleto(candidatos, test) {
  const hits = candidatos.filter((s) => test(s));
  if (!hits.length) return null;
  return [...hits].sort((a, b) => b.length - a.length)[0];
}

/** Misma normalización que el backend (`reglaOverrideGutierrezCarviscol`). */
function propietarioNormEsGutierrezSuarezCamilo(propietarioRaw) {
  const p = String(propietarioRaw || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return p === 'gutierrez suarez camilo andres';
}

function clientePivotMacro(d, nombreGrupo = '') {
  const g = String(nombreGrupo || '').toUpperCase();
  const obsU = String(textoObservacionFuente(d) || '').toUpperCase();
  const cliDestU = String(d?.cliente_destino || '').toUpperCase();

  const clienteDerivadosMacro = () => {
    const src = `${obsU} ${cliDestU}`;
    const cand = candidatosNombreCliente(d);
    const prop = String(d?.propietario || '').trim();
    const emp = String(d?.empresa_destino || '').trim();
    const cliDest = String(d?.cliente_destino || '').trim();
    const esEtiquetaOperativa = (txt) =>
      /\bPLAZA\b|\bCAVA\b|\bRETIRAR?\s+LIBRIL+OS?\b|\bDERIVADOS?\b|\bCARNICOS?\b/.test(String(txt || '').toUpperCase());

    // CARVISCOL → DERIVADOS: cliente comercial Uriel Vargas (no agrupar bajo la palabra «CARVISCOL»).
    if (src.includes('CARVISCOL')) {
      if (cliDest && !esEtiquetaOperativa(cliDest)) return cliDest;
      const retObs =
        /\bRETIRAR?\s+LIBRIL+OS?\b/i.test(obsU) ||
        /\bRETIRAR?\s+LIBRIL+O\b/i.test(obsU) ||
        /\bRETIRA?\s+LIBRIL+OS?\b/i.test(obsU);
      if (retObs && propietarioNormEsGutierrezSuarezCamilo(prop)) return 'Uriel Vargas';
      const sub =
        (prop && !esEtiquetaOperativa(prop) ? prop : null) ||
        elegirNombreMasCompleto(cand, (s) => /carviscol/i.test(s));
      if (sub && !esEtiquetaOperativa(sub) && String(sub).replace(/\s+/g, ' ').trim().toUpperCase() !== 'CARVISCOL') {
        return sub;
      }
      if (retObs) return 'Uriel Vargas';
      return 'CARVISCOL';
    }
    // Canoniza todas las variantes de "CACUA" hacia la misma etiqueta comercial (como en VBA: RUT/CACUA/CARMEN/LARROTA => RUTH CACUA).
    const hasCacua =
      /\bCACUA\b/.test(src) ||
      cand.some((s) => /cacua/i.test(String(s)));
    const hasRutCacua = /\bRUT\s*CACUA\b/.test(src) || cand.some((s) => /rut/i.test(String(s)) && /cacua/i.test(String(s)));
    const hasRuthCacua = src.includes('RUTH CACUA') || cand.some((s) => /ruth/i.test(String(s)) && /cacua/i.test(String(s)));
    const hasCarmen = /\bCARMEN\b/.test(src) || cand.some((s) => /carmen/i.test(String(s)));
    const hasLarrota =
      /\bLARROTA\s*EDINSON\b/.test(src) ||
      /\bLARROTA\s*EDINISON\b/.test(src) ||
      /\bLARROTA\s*EDIN(?:SON|ISON)\b/i.test(src);
    if (hasRuthCacua || hasRutCacua || hasCacua || hasCarmen || hasLarrota) return 'RUTH CACUA';
    if (
      src.includes('JUAN CARLOS RUEDA') ||
      src.includes('JUAN RUEDA') ||
      cand.some((s) => /rueda/i.test(s))
    ) {
      // Canonizar RUEDA en una sola etiqueta comercial (evita partirlo por razón social).
      return 'JUAN CARLOS RUEDA';
    }
    if (src.includes('WALTER ARGUELLO') || cand.some((s) => /walter/i.test(s) && /arguello/i.test(s))) {
      const n = elegirNombreMasCompleto(cand, (s) => /walter/i.test(s) || /arguello/i.test(s));
      return n || cliDest || 'WALTER ARGUELLO';
    }
    if (cand.some((s) => /carnes/i.test(s) && /santacruz/i.test(s))) {
      return 'WALTER ARGUELLO';
    }
    if (
      src.includes('DERIVADOS CARNICOS VISCERAS PARA ACONDICIONAMIENTO') ||
      src.includes('ARMANDO MURILLO')
    ) {
      const largoMacro =
        'DERIVADOS CARNICOS VISCERAS PARA ACONDICIONAMIENTO-DESPOSTE-CONGELACION CARNE DE CABEZA-CUAJOS-CHUNCHULLAS-CANUTAS PARA ARMANDO MURILLO';
      const n = elegirNombreMasCompleto(cand, (s) =>
        /olimpica|armando|murillo|acondicionamiento|super\s*tiendas/i.test(s)
      );
      return n || emp || cliDest || largoMacro;
    }
    if (src.includes('DERIVADOS CARNICOS')) {
      if (prop && !esEtiquetaOperativa(prop)) return prop;
      return emp || cliDest || 'DERIVADOS CARNICOS';
    }

    // Regla principal para esta hoja: agrupar por cliente/persona (propietario) y no por plaza ni texto RETIRAR...
    if (prop && !esEtiquetaOperativa(prop)) return prop;
    if (emp && !esEtiquetaOperativa(emp)) return emp;
    if (cliDest && !esEtiquetaOperativa(cliDest)) return cliDest;

    // Si no hay un nombre limpio, usar cualquier candidato no-operativo.
    const candidatoLimpio = cand.find((s) => !esEtiquetaOperativa(s));
    if (candidatoLimpio) return candidatoLimpio;

    // Destino comercial típico en hoja DERIVADOS (último respaldo).
    if (emp || cliDest) return emp || cliDest;
    return clienteResumenMacro(d);
  };

  // En la hoja DERIVADOS del macro, el agrupador principal es el destino comercial
  // (RUTH CACUA, JUAN CARLOS RUEDA, OLIMPICA, etc.).
  if (g.includes('DERIVADOS')) {
    return clienteDerivadosMacro();
  }
  return clienteResumenMacro(d);
}

function clienteResumenMacro(d) {
  const id = String(d?.id_producto || '').trim();
  const porId = CLIENTES_RESUMEN_CONFIG?.clientePorIdProducto;
  if (id && porId && Object.prototype.hasOwnProperty.call(porId, id)) {
    const v = String(porId[id] ?? '').trim();
    if (v) return v;
  }

  const prop = String(d?.propietario || '').trim();
  const emp = String(d?.empresa_destino || '').trim();
  const modo = CLIENTES_RESUMEN_CONFIG?.modoClienteResumen || 'auto';

  if (modo === 'propietario') return prop || emp || 'Sin cliente';
  if (modo === 'empresa_destino') return emp || prop || 'Sin cliente';

  if (!emp) return prop || 'Sin cliente';
  if (empresaPareceUbicacionResumen(emp)) return prop || emp;
  const exact = CLIENTES_RESUMEN_CONFIG?.auto?.empresaExactaUsaPropietario || [];
  const eU = emp.toUpperCase();
  if (exact.some((x) => String(x).toUpperCase() === eU) && prop) return prop;
  return emp;
}

/** Texto corto para notas de reporte según modo de cliente. */
function notaModoClienteResumenHtml() {
  const m = CLIENTES_RESUMEN_CONFIG?.modoClienteResumen || 'auto';
  if (m === 'empresa_destino') {
    return 'Nivel <strong>CLIENTE</strong> = <code>empresa_destino</code> (columna Empresa en DERIVADOS). <strong>PLAZA</strong> = <code>sucursal</code> de BD.';
  }
  if (m === 'propietario') {
    return 'Nivel <strong>CLIENTE</strong> = <code>propietario</code> (Empresa propietaria, col B DATOS). <strong>PLAZA</strong> = <code>sucursal</code> de BD.';
  }
  return 'Modo <strong>auto</strong>: el cliente del resumen es <code>empresa_destino</code> salvo cuando parece ubicación o está en excepciones del JSON → entonces <code>propietario</code>. La plaza es <code>sucursal</code> en BD.';
}

/**
 * Tabla de auditoría: ID y valores usados en el pivote (cliente resumen + plaza normalizada).
 */
function htmlAuditoriaClientePlaza(items, opts = {}) {
  const list = [...(items || [])]
    .filter(Boolean)
    .sort((a, b) =>
      String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
    );
  if (!list.length) return '';
  const exp = opts.exportInline === true;
  const border = '#bdbdbd';

  const rows = list
    .map((d) => {
      const id = escapeHtml(d.id_producto || '—');
      const g = grupoPivotParaFila(d, opts?.nombreGrupo || '');
      const cli = escapeHtml(clientePivotMacro(d, g));
      const prop = escapeHtml(String(d?.propietario || '').trim() || 'Sin asignar');
      const plz = escapeHtml(resolverPlazaReporte(d, g));
      if (exp) {
        return `<tr style="background:#fafafa;-webkit-print-color-adjust:exact;print-color-adjust:exact">
          <td style="border:1px solid ${border};padding:5px 8px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:#c0392b">${id}</td>
          <td style="border:1px solid ${border};padding:5px 8px;font-size:11px">${cli}</td>
          <td style="border:1px solid ${border};padding:5px 8px;font-size:11px">${prop}</td>
          <td style="border:1px solid ${border};padding:5px 8px;font-size:11px">${plz}</td>
        </tr>`;
      }
      return `<tr class="mov-audit-row">
        <td class="mov-audit-td-id">${id}</td>
        <td class="mov-audit-td-cli">${cli}</td>
        <td class="mov-audit-td-prop">${prop}</td>
        <td class="mov-audit-td-plz">${plz}</td>
      </tr>`;
    })
    .join('');
  if (exp) {
    return `
      <div style="margin-top:8px">
        <div style="font-weight:800;font-size:11px;margin-bottom:6px;color:#37474f">Auditoría: cliente / plaza por ID</div>
        <table style="width:100%;max-width:100%;border-collapse:collapse;font-size:11px;border:1px solid ${border}">
          <thead>
            <tr style="background:#eceff1">
              <th style="border:1px solid ${border};padding:6px 8px;text-align:left">ID</th>
              <th style="border:1px solid ${border};padding:6px 8px;text-align:left">Cliente resumen</th>
              <th style="border:1px solid ${border};padding:6px 8px;text-align:left">Propietario</th>
              <th style="border:1px solid ${border};padding:6px 8px;text-align:left">Plaza / puesto</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
  return `
    <div class="mov-audit-block">
      <div class="mov-audit-h">Auditoría: cliente / plaza por ID</div>
      <div class="mov-audit-scroll">
        <table class="mov-audit-table dt">
          <thead>
            <tr>
              <th>ID</th>
              <th>Cliente resumen</th>
              <th>Propietario</th>
              <th>Plaza / puesto</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Conteo por cliente comercial final + puesto/plaza (estilo macro):
 * - CLIENTE = según clientes-resumen-config.json (modo + overrides)
 * - PUESTO = plaza desde observación (antes de "(") o sucursal/destino normalizado
 */
function grupoPivotParaFila(d, nombreGrupo = '') {
  const g = String(nombreGrupo || '').trim();
  if (g) return g;
  return etiquetaAgrupacionMacro(d);
}

function contarPorClienteComercialPuesto(items, nombreGrupo = '') {
  return contarPorClientePuesto(
    items,
    d => clientePivotMacro(d, grupoPivotParaFila(d, nombreGrupo)),
    d => resolverPlazaReporte(d, nombreGrupo)
  ).map(r => ({
    cliente: r.cliente,
    ubicacion: r.puesto,
    cantidad: r.cantidad
  }));
}

/** Conteo por propietario + puesto (útil para crudas/resúmenes operativos internos). */
function contarPorPropietarioUbicacion(items) {
  return contarPorClientePuesto(
    items,
    d => String(d?.propietario || '').trim() || 'Sin asignar',
    d => resolverPlazaReporte(d)
  ).map(r => ({
    cliente: r.cliente,
    ubicacion: r.puesto,
    cantidad: r.cantidad
  }));
}

/**
 * Bloque LISTA LIBRILLOS + fecha: CLIENTE/PLAZA × CANTIDAD y total general (plaza = sucursal).
 */
function htmlListaLibrillosResumenBloque(items, nombreGrupo, fechaISO) {
  const rows = contarPorClienteComercialPuesto(items || [], nombreGrupo);
  if (!rows.length) return '';
  const total = rows.reduce((s, r) => s + r.cantidad, 0);
  const color = 'var(--rojo)';
  const titulo = `LISTA LIBRILLOS ${String(nombreGrupo || '').toUpperCase()}`;
  const audit = htmlAuditoriaClientePlaza(items || [], { nombreGrupo });
  return `
    <div class="rep-resumen-bloque">
      <div class="rep-pivot-audit-grid">
        <div class="tw rep-table-wrap rep-pivot-audit-main">
          <table class="dt rep-resumen-pivot">
            <thead>
              <tr>
                <th colspan="2" class="rep-resumen-th-titulo">${escapeHtml(titulo)} · ${escapeHtml(formatFechaCorta(fechaISO))}</th>
              </tr>
              <tr>
                <th colspan="2" class="rep-resumen-th-cierre">Cierre de turno: ${escapeHtml(labelFecha(fechaISO))}</th>
              </tr>
              <tr>
                <th class="rep-resumen-th-cols">CLIENTE / PLAZA</th>
                <th class="rep-resumen-th-cols rep-resumen-th-num">CANTIDAD</th>
              </tr>
            </thead>
            <tbody>
              ${htmlPivotPropietarioPlaza(rows, color)}
              <tr class="rep-resumen-total-gen">
                <td>Total general</td>
                <td class="rep-resumen-td-num">${total}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${audit}
      </div>
    </div>`;
}

/**
 * Export HTML → Excel: dos tablas independientes (auditoría | LISTA LIBRILLOS), sin filas de relleno.
 * La vista previa en pantalla no usa esta función (sigue `htmlListaLibrillosResumenBloque`).
 */
function htmlListaLibrillosResumenBloqueExport(items, nombreGrupo, fechaISO) {
  const rows = contarPorClienteComercialPuesto(items || [], nombreGrupo);
  if (!rows.length) return '';
  const total = rows.reduce((s, r) => s + r.cantidad, 0);
  const titulo = `LISTA LIBRILLOS ${String(nombreGrupo || '').toUpperCase()}`;
  /** Rejilla suave como plantilla de referencia (no negra/gruesa). */
  const grid = '1px solid #c7d1cc';
  const gridMso = 'mso-border-alt:.5pt solid #c7d1cc';
  const cellBd = `border-top:${grid};border-right:${grid};border-bottom:${grid};border-left:${grid};${gridMso}`;
  /** Marco exterior suave, cerrado en los 4 lados. */
  const outerTable = 'border-collapse:collapse;border:1px solid #c7d1cc';
  const feCorta = formatFechaCorta(fechaISO);
  /** Atributos HTML que Excel aplica mejor al abrir .xls desde HTML. */
  const tblAttr = 'border="1" cellspacing="0" cellpadding="0"';

  const listSorted = [...(items || [])]
    .filter(Boolean)
    .sort((a, b) =>
      String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
    );

  const leftRows = [];
  leftRows.push({
    k: 'head',
    c: ['Identificación', 'Empresa propietaria', 'Vísceras blancas'].map((x) => escapeHtml(x)),
  });
  listSorted.forEach((d, idx) => {
    const propU = String(d?.propietario || '').trim();
    leftRows.push({
      k: 'data',
      zebra: idx % 2,
      c: [
        escapeHtml(d.id_producto || '—'),
        escapeHtml(propU ? propU.toUpperCase() : 'SIN ASIGNAR'),
        escapeHtml(resolverPlazaReporte(d, nombreGrupo)),
      ],
    });
  });

  const rightRows = [];
  rightRows.push({ k: 'top', g: escapeHtml(titulo), h: escapeHtml(feCorta) });
  rightRows.push({ k: 'purp', g: 'CLIENTE / PLAZA', h: 'CANTIDAD' });
  const byProp = new Map();
  rows.forEach((r) => {
    if (!byProp.has(r.cliente)) byProp.set(r.cliente, []);
    byProp.get(r.cliente).push(r);
  });
  const propsOrden = [...byProp.keys()].sort((a, b) => String(a).localeCompare(String(b)));
  propsOrden.forEach((prop) => {
    const sub = byProp.get(prop).sort((a, b) => String(a.ubicacion).localeCompare(String(b.ubicacion)));
    const totalProp = sub.reduce((s, x) => s + x.cantidad, 0);
    rightRows.push({ k: 'grp', g: escapeHtml(String(prop).toUpperCase()), h: String(totalProp) });
    sub.forEach(({ ubicacion, cantidad }) => {
      rightRows.push({ k: 'ch', g: escapeHtml(ubicacion), h: String(cantidad) });
    });
  });
  rightRows.push({ k: 'tot', g: 'Total general', h: String(total) });

  const blankLeft = `<td style="${cellBd};background:#fafafa">&nbsp;</td><td style="${cellBd};background:#fafafa">&nbsp;</td><td style="${cellBd};background:#fafafa">&nbsp;</td>`;
  const blankRight = `<td style="${cellBd};background:#fafafa">&nbsp;</td><td style="${cellBd};background:#fafafa">&nbsp;</td>`;
  const spacer = `<td style="border:none;background:transparent;width:10px;font-size:1px;line-height:1px">&nbsp;</td><td style="border:none;background:transparent;width:10px;font-size:1px;line-height:1px">&nbsp;</td><td style="border:none;background:transparent;width:10px;font-size:1px;line-height:1px">&nbsp;</td>`;

  const renderLeftCells = (L) => {
    if (!L) return blankLeft;
    if (L.k === 'head') {
      return L.c
        .map((cell) => `<td style="${cellBd};padding:8px 10px;background:#c8e6c9;color:#111;font-weight:800;text-align:center;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact">${cell}</td>`)
        .join('');
    }
    const bg = L.zebra ? '#f5f5f5' : '#ffffff';
    return `<td style="${cellBd};padding:6px 8px;background:${bg};font-family:Arial,sans-serif;font-weight:700;text-align:center;color:#c0392b;-webkit-print-color-adjust:exact;print-color-adjust:exact">${L.c[0]}</td>
<td style="${cellBd};padding:6px 8px;background:${bg};font-weight:800;font-size:11px;text-align:center;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact">${L.c[1]}</td>
<td style="${cellBd};padding:6px 8px;background:${bg};font-size:11px;text-align:center;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact">${L.c[2]}</td>`;
  };

  const renderRightCells = (R) => {
    if (!R) return blankRight;
    if (R.k === 'top') {
      return `<td style="${cellBd};padding:10px 12px;background:#c8e6c9;color:#111;font-weight:900;font-size:12px;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.g}</td>
<td style="${cellBd};padding:10px 12px;background:#c8e6c9;color:#111;font-weight:900;font-size:12px;text-align:right;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.h}</td>`;
    }
    if (R.k === 'purp') {
      return `<td style="${cellBd};padding:9px 10px;background:#9575cd;color:#fff;font-weight:800;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.g}</td>
<td style="${cellBd};padding:9px 10px;background:#9575cd;color:#fff;font-weight:800;text-align:right;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.h}</td>`;
    }
    if (R.k === 'grp') {
      return `<td style="${cellBd};padding:8px 10px;background:#ffb74d;font-weight:800;color:#111;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.g}</td>
<td style="${cellBd};padding:8px 10px;background:#ffb74d;text-align:right;font-weight:800;color:#c0392b;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.h}</td>`;
    }
    if (R.k === 'ch') {
      const bgCh = '#ffffff';
      return `<td style="${cellBd};padding:5px 8px 5px 22px;background:${bgCh};font-size:11px;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.g}</td>
<td style="${cellBd};padding:5px 8px;background:${bgCh};text-align:right;font-weight:600;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.h}</td>`;
    }
    return `<td style="${cellBd};padding:9px 10px;background:#e91e63;color:#fff;font-weight:900;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.g}</td>
<td style="${cellBd};padding:9px 10px;background:#e91e63;text-align:right;font-weight:900;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact">${R.h}</td>`;
  };

  const maxRows = Math.max(leftRows.length, rightRows.length);
  const gridRows = Array.from({ length: maxRows }, (_, i) => {
    const l = leftRows[i] || null;
    const r = rightRows[i] || null;
    return `<tr>${renderLeftCells(l)}${spacer}${renderRightCells(r)}</tr>`;
  }).join('');

  return `<div style="margin-bottom:24px;overflow-x:auto">
<table class="rep-lista-excel-grid" style="border-collapse:collapse;font-size:11px;table-layout:fixed;width:100%">
${gridRows}
</table>
</div>`;
}

/** Pivote jerárquico: total por propietario (fila resaltada), desglose por plaza. */
function htmlPivotPropietarioPlaza(rows, colorTotal, opts = {}) {
  if (!rows.length) return '';
  const inline = opts.exportInline === true;
  const byProp = new Map();
  rows.forEach(r => {
    const p = r.cliente;
    if (!byProp.has(p)) byProp.set(p, []);
    byProp.get(p).push(r);
  });
  const propsOrden = [...byProp.keys()].sort((a, b) => String(a).localeCompare(String(b)));
  let body = '';
  const border = '#bdbdbd';
  propsOrden.forEach(prop => {
    const sub = byProp.get(prop).sort((a, b) => String(a.ubicacion).localeCompare(String(b.ubicacion)));
    const totalProp = sub.reduce((s, x) => s + x.cantidad, 0);
    if (inline) {
      body += `<tr style="background:#fff9c4;-webkit-print-color-adjust:exact;print-color-adjust:exact">
        <td style="border:1px solid ${border};padding:8px 10px;font-weight:800"><span style="color:#616161;font-weight:700;margin-right:6px">−</span>${escapeHtml(prop)}</td>
        <td style="border:1px solid ${border};padding:8px 10px;text-align:right;font-weight:800;color:${colorTotal}">${totalProp}</td>
      </tr>`;
      sub.forEach(({ ubicacion, cantidad }) => {
        body += `<tr style="background:#e3f2fd;-webkit-print-color-adjust:exact;print-color-adjust:exact">
          <td style="border:1px solid ${border};padding:6px 8px 6px 28px;font-size:12px;color:#1a2b1e">${escapeHtml(ubicacion)}</td>
          <td style="border:1px solid ${border};padding:6px 8px;text-align:right;font-weight:600;color:#1a2b1e">${cantidad}</td>
        </tr>`;
      });
    } else {
      body += `<tr class="rep-resumen-row-parent">
        <td class="rep-resumen-td-prop"><span class="rep-resumen-tree" aria-hidden="true">−</span>${escapeHtml(prop)}</td>
        <td class="rep-resumen-td-qty-parent" style="color:${colorTotal}">${totalProp}</td>
      </tr>`;
      sub.forEach(({ ubicacion, cantidad }) => {
        body += `<tr class="rep-resumen-row-child">
          <td class="rep-resumen-td-ubi">${escapeHtml(ubicacion)}</td>
          <td class="rep-resumen-td-qty">${cantidad}</td>
        </tr>`;
      });
    }
  });
  return body;
}

function tablaMovimientoResumenDiaHTML(datos, fechaISO, salidas, opts = {}) {
  if (opts.omitTablaProcesados) return '';
  const desde = opts?.desde || fechaISO;
  const hasta = opts?.hasta || fechaISO;
  const modoTotalesSimple = !!opts?.modoTotalesSimple;
  const modo = opts.vistaReporte || 'ambos';
  const incluirDetalle = modo !== 'resumen';
  const incluirResumen = modo !== 'detalle';
  const dosCols = incluirDetalle && incluirResumen;

  const librIng = filtrarPorIngresoRango(datos.filter(esVistaHistorialLibrillos), desde, hasta);
  const crudIng = filtrarPorIngresoRango(datos.filter(esVistaHistorialCrudasSolo), desde, hasta);

  const any = librIng.length || crudIng.length;
  if (!any) return '';

  if (modoTotalesSimple) {
    const rows = contarPorPropietarioUbicacion(librIng);
    const totalGeneral = rows.reduce((a, b) => a + b.cantidad, 0);
    if (!rows.length) return '';
    return `
      <div class="mov-wrap" style="display:flex;flex-direction:column;gap:12px">
        <div class="mov-sec">
          <div class="mov-h">LISTA LIBRILLOS (procesados)</div>
          <div class="tw">
            <table class="dt mov-tabla-det" style="font-size:12px;border:1px solid var(--brd2);border-collapse:collapse;width:100%">
              <thead>
                <tr>
                  <th style="border:1px solid var(--brd2);padding:8px">Propietario</th>
                  <th style="border:1px solid var(--brd2);padding:8px">Plaza</th>
                  <th style="border:1px solid var(--brd2);padding:8px;text-align:right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((r) => `<tr>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(r.cliente || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(r.ubicacion || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px;text-align:right;font-weight:700">${r.cantidad}</td>
                </tr>`).join('')}
                <tr>
                  <td colspan="2" style="border:1px solid var(--brd2);padding:8px;font-weight:800">TOTAL GENERAL</td>
                  <td style="border:1px solid var(--brd2);padding:8px;text-align:right;font-weight:900;color:var(--rojo)">${totalGeneral}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  const pivotLib = contarPorClienteComercialPuesto(librIng);
  const pivotCrud = contarPorPropietarioUbicacion(crudIng);

  function bloquePivotLib() {
    if (!incluirResumen || !pivotLib.length) return '';
    const tot = pivotLib.reduce((a, b) => a + b.cantidad, 0);
    const audit = htmlAuditoriaClientePlaza(librIng, { nombreGrupo: '' });
    return `
          <div class="mov-pivot">
            <div class="mov-pivot-h">Resumen: cliente → plaza → cantidad</div>
            <div class="mov-pivot-audit-grid">
              <div class="mov-pivot-wrap mov-pivot-wrap-main">
                <table class="mov-pivot-table" style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #9e9e9e">
                  <thead>
                    <tr>
                      <th style="border:1px solid #7e57c2;padding:8px;background:#9575cd;color:#fff">Cliente / Ubicación</th>
                      <th style="border:1px solid #7e57c2;padding:8px;background:#9575cd;color:#fff;width:110px;text-align:right">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${htmlPivotPropietarioPlaza(pivotLib, 'var(--rojo)')}
                  </tbody>
                </table>
              </div>
              ${audit}
            </div>
            <div class="mov-pivot-total" style="margin-top:6px;font-weight:800;color:#8b0000;text-align:right">Total general: ${tot}</div>
          </div>`;
  }

  function bloquePivotCrud() {
    if (!incluirResumen || !pivotCrud.length) return '';
    const tot = pivotCrud.reduce((a, b) => a + b.cantidad, 0);
    return `
          <div class="mov-pivot">
            <div class="mov-pivot-h">Resumen: propietario → plaza → cantidad</div>
            <div class="mov-pivot-wrap">
              <table class="mov-pivot-table" style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #9e9e9e">
                <thead>
                  <tr>
                    <th style="border:1px solid #7e57c2;padding:8px;background:#9575cd;color:#fff">Propietario / Ubicación</th>
                    <th style="border:1px solid #7e57c2;padding:8px;background:#9575cd;color:#fff;width:110px;text-align:right">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  ${htmlPivotPropietarioPlaza(pivotCrud, 'var(--verde)')}
                </tbody>
              </table>
            </div>
            <div class="mov-pivot-total" style="margin-top:6px;font-weight:800;color:var(--verde);text-align:right">Total general: ${tot}</div>
          </div>`;
  }

  function htmlIdsLibrillos(items) {
    if (!items.length) return '';
    const sorted = [...items].sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
    const tablaHtml = `
          <table class="dt mov-tabla-det" style="font-size:12px;border:1px solid var(--brd2);border-collapse:collapse;width:100%">
            <thead>
              <tr>
                <th style="border:1px solid var(--brd2);padding:8px">ID Producto</th>
                <th style="border:1px solid var(--brd2);padding:8px">Propietario</th>
                <th style="border:1px solid var(--brd2);padding:8px">Ubicación</th>
                <th style="border:1px solid var(--brd2);padding:8px">Cliente destino</th>
                <th style="border:1px solid var(--brd2);padding:8px">Sucursal</th>
                <th style="border:1px solid var(--brd2);padding:8px">Empresa destino</th>
                <th style="border:1px solid var(--brd2);padding:8px">Entrada</th>
                <th style="border:1px solid var(--brd2);padding:8px">Salida</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(d => {
                const sal = salidaDisplayEnRango(d.id_producto, salidas, desde, hasta, d);
                return `<tr>
                  <td style="border:1px solid var(--brd2);padding:8px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.propietario || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(resolverPlazaReporte(d))}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.cliente_destino || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.sucursal || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.empresa_destino || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${formatFecha(d.fecha_ingreso_cava)}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${sal ? formatFecha(sal) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`;

    const inner = dosCols
      ? `${tablaHtml}${bloquePivotLib()}`
      : (incluirDetalle ? tablaHtml : bloquePivotLib());
    if (!inner.trim()) return '';
    return `
      <div class="mov-sec">
        <div class="mov-h">LISTA LIBRILLOS (procesados)</div>
        <div class="mov-grid${dosCols ? '' : ' mov-grid-uno'}">
          ${inner}
        </div>
      </div>
    `;
  }

  function htmlIdsCrudas(items) {
    if (!items.length) return '';
    const sorted = [...items].sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
    const tablaHtml = `
          <table class="dt mov-tabla-det" style="font-size:12px;border:1px solid var(--brd2);border-collapse:collapse;width:100%">
            <thead>
              <tr>
                <th style="border:1px solid var(--brd2);padding:8px">ID Producto</th>
                <th style="border:1px solid var(--brd2);padding:8px">Propietario</th>
                <th style="border:1px solid var(--brd2);padding:8px">Ubicación</th>
                <th style="border:1px solid var(--brd2);padding:8px">Sucursal</th>
                <th style="border:1px solid var(--brd2);padding:8px">Empresa destino</th>
                <th style="border:1px solid var(--brd2);padding:8px">Entrada</th>
                <th style="border:1px solid var(--brd2);padding:8px">Salida</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(d => {
                const sal = salidaDisplayEnRango(d.id_producto, salidas, desde, hasta, d);
                return `<tr>
                  <td style="border:1px solid var(--brd2);padding:8px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.propietario || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(resolverPlazaReporte(d))}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.sucursal || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.empresa_destino || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${formatFecha(d.fecha_ingreso_cava)}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${sal ? formatFecha(sal) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`;

    const inner = dosCols
      ? `${tablaHtml}${bloquePivotCrud()}`
      : (incluirDetalle ? tablaHtml : bloquePivotCrud());
    if (!inner.trim()) return '';
    return `
      <div class="mov-sec">
        <div class="mov-h">LISTA CRUDAS (procesados)</div>
        <div class="mov-grid${dosCols ? '' : ' mov-grid-uno'}">
          ${inner}
        </div>
      </div>
    `;
  }

  return `
    <div class="mov-wrap" style="display:flex;flex-direction:column;gap:18px">
      ${htmlIdsLibrillos(librIng)}
      ${htmlIdsCrudas(crudIng)}
      <style>
        .mov-sec{border:1px dashed rgba(0,0,0,.15);padding:10px;border-radius:8px}
        .mov-h{font-weight:900;color:#1a2b1e;background:rgba(0,0,0,.03);padding:8px 10px;border-radius:6px;margin-bottom:10px}
        .mov-grid{display:grid;grid-template-columns: 1fr 360px;gap:12px;align-items:start}
        .mov-grid-uno{grid-template-columns:1fr !important}
        .mov-grid-uno .mov-pivot{border-left:none;padding-left:0;max-width:720px}
        .mov-pivot-h{font-weight:900;margin-bottom:6px}
        .mov-pivot{border-left:3px solid rgba(0,0,0,.06);padding-left:10px}
        @media print{ .mov-grid{grid-template-columns: 1fr 340px} .mov-grid-uno{grid-template-columns:1fr !important} }
        @media(max-width:1100px){ .mov-grid{grid-template-columns: 1fr} .mov-pivot{border-left:none;padding-left:0} }
      </style>
    </div>
  `;
}

async function generarReporteGeneral() {
  await actualizarVistaTotales();
}

function htmlReporteAgrupaciones(datos, fechaISO, salidas, opts = {}) {
  const soloResumen = opts.soloResumen === true;
  const omitTotalesAside = opts.omitTotalesAside === true;
  const soloEtiqueta = opts.soloEtiqueta ? String(opts.soloEtiqueta) : null;
  let libs = [...filasListasAgrupacionComercial(datos, opts)].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
  if (soloEtiqueta) {
    const t = String(soloEtiqueta);
    libs = libs.filter(
      (d) => etiquetaAgrupacionMacro(d) === t || etiquetaAgrupacion(d) === t
    );
  }
  if (!libs.length) {
    return '<p style="color:var(--tx3);padding:12px">Sin librillos para esta fecha' +
      (soloEtiqueta ? ` en la agrupación «${escapeHtml(soloEtiqueta)}».` : '.') + '</p>';
  }

  const byGrupo = new Map();
  libs.forEach(d => {
    const g = etiquetaAgrupacionMacro(d);
    if (!byGrupo.has(g)) byGrupo.set(g, []);
    byGrupo.get(g).push(d);
  });
  const orden = ordenGruposMacro([...byGrupo.keys()]);

  let html = '';
  orden.forEach(grupo => {
    const items = byGrupo.get(grupo);
    html += htmlListaLibrillosResumenBloque(items, grupo, fechaISO);
    if (soloResumen) return;

    const conSalida = items.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas, d)).length;
    html += `<h3 class="rep-sec-title">${escapeHtml(grupo)} — ${items.length} unidad(es) · ${conSalida} con salida registrada <span style="font-size:12px;font-weight:500;color:var(--tx3)">(detalle)</span></h3>`;
    html += `<div class="tw rep-table-wrap"><table class="dt" style="font-size:12px"><thead><tr>
      <th>ID Producto</th><th>Propietario</th><th>Cliente destino</th><th>Sucursal / Plaza</th><th>Empresa destino</th><th>Ingreso Cava</th><th>Salida despacho</th>
    </tr></thead><tbody>`;
    items.forEach(d => {
      const sal = salidaRegistrada(d.id_producto, fechaISO, salidas, d);
      html += `<tr>
        <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
        <td>${escapeHtml(d.propietario) || '—'}</td>
        <td>${escapeHtml(d.cliente_destino) || '—'}</td>
        <td>${escapeHtml(resolverPlazaReporte(d))}</td>
        <td>${escapeHtml(d.empresa_destino) || '—'}</td>
        <td>${formatFecha(d.fecha_ingreso_cava)}</td>
        <td>${sal ? formatFecha(sal) : '—'}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  });
  if (soloResumen && orden.length && !omitTotalesAside) {
    const total = libs.length;
    const nSal = libs.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas, d)).length;
    const tituloTot = soloEtiqueta
      ? `Total agrupación «${escapeHtml(soloEtiqueta)}»`
      : 'Total librillos del día';
    const subTot = soloEtiqueta
      ? `${total} unidad(es) · ${nSal} con despacho registrado`
      : `${orden.length} agrupación(es) · ${nSal} con despacho registrado`;
    html += `<aside class="rep-global-total" aria-label="Totales">
      <div class="rep-global-total-n">${total}</div>
      <div class="rep-global-total-l">${tituloTot}</div>
      <div class="rep-global-total-sub">${subTot}</div>
    </aside>`;
  }
  return html;
}

function htmlReporteAgrupacionesExport(datos, fechaISO, salidas, opts = {}) {
  const soloResumen = opts.soloResumen === true;
  const omitTotalesAside = opts.omitTotalesAside === true;
  const soloEtiqueta = opts.soloEtiqueta ? String(opts.soloEtiqueta) : null;
  let libs = [...filasListasAgrupacionComercial(datos, opts)].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
  if (soloEtiqueta) {
    const t = String(soloEtiqueta);
    libs = libs.filter(
      (d) => etiquetaAgrupacionMacro(d) === t || etiquetaAgrupacion(d) === t
    );
  }
  if (!libs.length) {
    return '<p>Sin librillos para esta fecha' + (soloEtiqueta ? ` en «${escapeHtml(soloEtiqueta)}».` : '.') + '</p>';
  }

  const byGrupo = new Map();
  libs.forEach(d => {
    const g = etiquetaAgrupacionMacro(d);
    if (!byGrupo.has(g)) byGrupo.set(g, []);
    byGrupo.get(g).push(d);
  });
  const orden = ordenGruposMacro([...byGrupo.keys()]);

  let html = '';
  orden.forEach(grupo => {
    const items = byGrupo.get(grupo);
    html += htmlListaLibrillosResumenBloqueExport(items, grupo, fechaISO);
    if (soloResumen) return;

    const conSalida = items.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas, d)).length;
    html += `<h3 style="font-size:14px;color:#8b0000;margin:20px 0 10px;text-transform:uppercase">${escapeHtml(grupo)} — ${items.length} unidad(es) · ${conSalida} con salida (detalle)</h3>`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #bbb;margin-bottom:24px"><thead><tr style="background:#8b0000;color:#fff">
      <th style="padding:10px;border:1px solid #666">ID Producto</th>
      <th style="padding:10px;border:1px solid #666">Propietario</th>
      <th style="padding:10px;border:1px solid #666">Cliente destino</th>
      <th style="padding:10px;border:1px solid #666">Sucursal / Plaza</th>
      <th style="padding:10px;border:1px solid #666">Empresa</th>
      <th style="padding:10px;border:1px solid #666">Ingreso Cava</th>
      <th style="padding:10px;border:1px solid #666">Salida despacho</th>
    </tr></thead><tbody>`;
    items.forEach(d => {
      const sal = salidaRegistrada(d.id_producto, fechaISO, salidas, d);
      html += `<tr>
        <td style="padding:8px;border:1px solid #ccc;font-weight:700;color:#8b0000">${escapeHtml(d.id_producto)}</td>
        <td style="padding:8px;border:1px solid #ccc">${escapeHtml(d.propietario) || '—'}</td>
        <td style="padding:8px;border:1px solid #ccc">${escapeHtml(d.cliente_destino) || '—'}</td>
        <td style="padding:8px;border:1px solid #ccc">${escapeHtml(resolverPlazaReporte(d))}</td>
        <td style="padding:8px;border:1px solid #ccc">${escapeHtml(d.empresa_destino) || '—'}</td>
        <td style="padding:8px;border:1px solid #ccc">${formatFecha(d.fecha_ingreso_cava)}</td>
        <td style="padding:8px;border:1px solid #ccc">${sal ? formatFecha(sal) : '—'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  });
  if (soloResumen && orden.length && !omitTotalesAside) {
    const total = libs.length;
    const nSal = libs.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas, d)).length;
    const tituloTot = soloEtiqueta ? `Total «${escapeHtml(soloEtiqueta)}»` : 'Total librillos del día';
    const subTot = soloEtiqueta
      ? `${total} unidad(es) · ${nSal} con despacho`
      : `${orden.length} agrupación(es) · ${nSal} con despacho registrado`;
    html += `<div style="margin:28px 0;padding:20px;background:#ffe4ec;border:2px solid #f48fb1;border-radius:10px;text-align:center">
      <div style="font-size:36px;font-weight:900;color:#8b0000">${total}</div>
      <div style="font-weight:700;color:#333;margin-top:4px">${tituloTot}</div>
      <div style="font-size:13px;color:#666;margin-top:8px">${subTot}</div>
    </div>`;
  }
  return html;
}

function kpisAgrupacionesResumen(datos, fechaISO, salidas, kopts = {}) {
  let libs = datos.filter(esLibrilloParaReporteAgrupacion);
  if (kopts.soloEtiqueta) {
    const t = String(kopts.soloEtiqueta);
    libs = libs.filter(
      (d) => etiquetaAgrupacionMacro(d) === t || etiquetaAgrupacion(d) === t
    );
  }
  const total = libs.length;
  const conSalida = libs.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas, d)).length;
  const grupos = new Set(libs.map(d => etiquetaAgrupacionMacro(d))).size;
  const lblLib = kopts.soloEtiqueta ? 'En esta agrupación' : 'Librillos totales';
  const lblGr = kopts.soloEtiqueta ? 'Bloque' : 'Agrupaciones';
  const nGr = kopts.soloEtiqueta ? 1 : grupos;
  return `<div class="rep-kpis">
    <div class="rep-kpi"><div class="rep-kpi-n">${total}</div><div class="rep-kpi-l">${lblLib}</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${conSalida}</div><div class="rep-kpi-l">Con salida registrada</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${nGr}</div><div class="rep-kpi-l">${lblGr}</div></div>
  </div>`;
}

async function descargarReporteGeneral() {
  const fecha = document.getElementById('fecha-global')?.value || hoyISO();
  const [datos, resumenMacro] = await Promise.all([fetchPorFecha(fecha), fetchResumenMacro(fecha)]);
  if (!datos.length) {
    mostrarToast('Sin datos', 'err');
    return;
  }
  if (!resumenMacro || !resumenMacro.categorias || !resumenMacro.resumen_libros) {
    mostrarToast('Resumen macro no disponible. No se genera reporte para evitar datos inconsistentes.', 'err');
    return;
  }
  const salidas = await fetchSalidas();
  const logoMarcaHtml = await obtenerMarcaExportColbeefImgHtml();
  descargarHTML(`Totales_${fecha}`, generarHTMLReporte('Totales', labelFecha(fecha), fecha, datos, salidas, {
    desde: fecha,
    hasta: fecha,
    vistaReporte: 'resumen',
    incluirResumenLibrosChunchullas: true,
    resumenMacro,
    logoMarcaHtml,
  }));
}

function descargarHTML(nombre, html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
  mostrarToast('Reporte guardado', 'ok');
  enviarEventoAnalytics({
    eventName: 'export_html',
    viewName: _analyticsViewActual,
    meta: { archivo: `${nombre}.html` },
  });
}

/** Vista previa en Totales (#rep-preview) o en Reportes (#rep-preview-rep). */
function getRepPreviewEls(destino) {
  const rep = destino === 'reportes';
  return {
    prev: document.getElementById(rep ? 'rep-preview-rep' : 'rep-preview'),
    title: document.getElementById(rep ? 'rep-prev-title-rep' : 'rep-prev-title'),
    body: document.getElementById(rep ? 'rep-prev-body-rep' : 'rep-prev-body'),
  };
}

/** Cuerpo del reporte a imprimir / PDF según la vista activa o el panel con contenido. */
function repPreviewBodyActivo() {
  const br = document.getElementById('rep-prev-body-rep');
  const b = document.getElementById('rep-prev-body');
  const vr = document.getElementById('vista-reportes')?.classList.contains('active');
  const vt = document.getElementById('vista-totales')?.classList.contains('active');
  // Regla estricta: nunca mezclar previews entre vistas.
  if (vr) return br?.innerHTML?.trim() ? br : null;
  if (vt) return b?.innerHTML?.trim() ? b : null;
  // Fallback solo si ninguna vista está activa (caso excepcional).
  if (br?.innerHTML?.trim()) return br;
  if (b?.innerHTML?.trim()) return b;
  return null;
}

function repPreviewTitleActivo() {
  const body = repPreviewBodyActivo();
  if (!body) return null;
  return body.id === 'rep-prev-body-rep'
    ? document.getElementById('rep-prev-title-rep')
    : document.getElementById('rep-prev-title');
}

/** Estilos mínimos para que el Excel/HTML abierto en Excel se parezca a la vista «Resumen del día». */
function cssExportVistaTotales() {
  return `
.rep-bloque-resumen-lch{margin:12px 0;padding:14px 16px;background:#fafbfa;border:1px solid #c4cfc6;border-radius:12px}
.rep-bloque-resumen-h{font-size:16px;font-weight:800;margin:0 0 8px;color:#1a1a1a}
.rep-bloque-resumen-meta{font-size:12px;color:#555;margin:0 0 10px}
.resumen-dia-dos-tablas{display:flex;flex-direction:column;gap:14px;align-items:stretch;width:100%}
.resumen-dia-tabla-extras{flex:0 0 auto;max-width:520px}
.resumen-dia-table{width:100%;max-width:520px;border-collapse:collapse;font-size:11px}
.resumen-dia-table th,.resumen-dia-table td{border:1px solid #bbb;padding:8px 10px}
.resumen-dia-head td{background:#fff34f;font-weight:800}
.resumen-dia-asur-glo td{background:#e8b5b8}
.resumen-dia-asur-col td{background:#d6e7f5}
.resumen-dia-global td{background:#bcd6ee}
.resumen-dia-asur td{background:#ff2f2f;font-weight:700}
.resumen-dia-cat td{background:#dc7d1f;font-weight:700}
.resumen-dia-deriv td{background:#f2e19b;font-weight:700}
.resumen-dia-coc td{background:#efefef;font-weight:700}
.resumen-dia-total td{background:#fff;border-top:2px solid #222;font-weight:900}
.rep-resumen-bloque{margin-bottom:18px}
.rep-resumen-pivot{width:100%;max-width:520px;border-collapse:collapse;border:1px solid #303030;font-size:11px}
.rep-resumen-th-titulo{background:#0f5132;color:#fff;border:2px solid #062a1a;padding:12px 14px;text-align:left;font-weight:900;font-size:20px;letter-spacing:.02em}
.rep-resumen-th-cierre{background:#dcedc8;color:#1a2b1e;border:1px solid #9ccc65;padding:8px 10px;text-align:left;font-weight:700}
.rep-resumen-th-cols{background:#fff300;color:#111;border:1px solid #303030;padding:7px 10px;font-weight:800}
.rep-resumen-th-num{text-align:right!important;width:110px}
.rep-resumen-row-parent td{background:#fff9c4;border:1px solid #303030;padding:8px 10px;font-weight:800;font-size:16px}
.rep-resumen-row-child td{background:#e3f2fd;border:1px solid #303030;padding:6px 8px}
.rep-resumen-total-gen td{background:#ff66ff;border:1px solid #303030;padding:8px 10px;font-weight:900}
.rep-resumen-td-num{text-align:right}
.rep-global-total{margin:20px 0;padding:20px;background:#ffe4ec;border:2px solid #f48fb1;border-radius:10px;text-align:center}
.rep-global-total-n{font-size:32px;font-weight:900;color:#8b0000}
.mov-h{font-weight:900;color:#1a2b1e;background:#f0f0f0;padding:8px 10px;border-radius:6px;margin-bottom:8px}
.mov-tabla-det,.mov-pivot-table{border-collapse:collapse;width:100%;font-size:11px}
.mov-tabla-det th,.mov-tabla-det td,.mov-pivot-table th,.mov-pivot-table td{border:1px solid #bbb;padding:6px 8px}
.mov-pivot-h{font-weight:800;margin:8px 0 4px}
.rep-lista-excel-dual{width:100%;max-width:1100px}
.rep-lista-excel-dual>tbody>tr>td{vertical-align:top}
.rep-lista-excel-dual td table.rep-lista-excel-audit,
.rep-lista-excel-dual td table.rep-lista-excel-lista{border-collapse:collapse;border:2px solid #212121}
.rep-lista-excel-dual td table.rep-lista-excel-audit td,
.rep-lista-excel-dual td table.rep-lista-excel-lista td{border:1px solid #212121}
`;
}

function generarHTMLReporte(titulo, fechaLabel, fechaISO, datos, salidas, opts = {}) {
  const cuerpo = cuerpoReporteGeneralExport(datos, fechaISO, salidas, opts);
  const extraCss =
    opts.incluirResumenLibrosChunchullas === true || opts.soloListasLibrillosPorAgrupacion === true
      ? cssExportVistaTotales()
      : '';
  const desde = opts?.desde || fechaISO;
  const hasta = opts?.hasta || fechaISO;
  const esListaAgr = opts.soloListasLibrillosPorAgrupacion === true;

  /** Encabezado tipo captura: Colbeef + raya + título/fechas + período ISO + vista; Generado a la derecha. */
  if (esListaAgr) {
    const brandLista = `<span style="font-weight:900;color:#2e7d32;font-size:18px;letter-spacing:.02em;font-family:Arial Black,Arial,sans-serif">Colbeef</span>`;
    const headerLista = `<div class="rep-export-lista-head" style="margin-bottom:22px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap">
      <div style="flex:1;min-width:280px">
        ${brandLista}
        <div style="border-top:2px solid #8b0000;margin:10px 0 14px"></div>
        <div style="font-size:13px;color:#333;line-height:1.5;margin-bottom:8px"><strong>${escapeHtml(titulo)}</strong> · ${escapeHtml(fechaLabel)}</div>
        <div style="font-size:12px;color:#555;line-height:1.45">Período: ${escapeHtml(desde)} a ${escapeHtml(hasta)} · Vista tipo «lista por agrupación» (pivote + auditoría).</div>
      </div>
      <div style="font-size:12px;color:#666;text-align:right;white-space:nowrap;padding-top:2px">Generado: ${new Date().toLocaleString('es-CO')}</div>
    </div>
  </div>`;
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escapeHtml(titulo)}</title><style>
body{font-family:Arial,sans-serif;margin:32px;color:#1a1a1a}.kpis{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}.kpi{background:#f5f5f5;border:1px solid #ccc;border-radius:8px;padding:12px 16px;text-align:center;flex:1;min-width:120px}.kpi-n{font-size:24px;font-weight:700;color:#8b0000}.kpi-l{font-size:11px;color:#666;margin-top:3px}.footer{margin-top:24px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:12px}
${extraCss}
</style></head><body>
  ${headerLista}
  ${cuerpo}
  <div class="footer">Sistema de Control de Librillos — Colbeef · ${new Date().toLocaleDateString('es-CO')}</div></body></html>`;
  }

  const logoFrag =
    opts.logoMarcaHtml ||
    '<span style="font-weight:900;color:#8b0000;font-size:15px;letter-spacing:.04em">COLBEEF</span>';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escapeHtml(titulo)}</title><style>
body{font-family:Arial,sans-serif;margin:32px;color:#1a1a1a}.rep-export-dochead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #8b0000;font-size:12px;color:#666}.rep-export-dochead-main{display:flex;align-items:center;gap:10px;flex:1;min-width:220px}.rep-export-logo-img{height:26px;max-width:100px;width:auto;object-fit:contain;vertical-align:middle;border:0;display:inline-block}.kpis{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}.kpi{background:#f5f5f5;border:1px solid #ccc;border-radius:8px;padding:12px 16px;text-align:center;flex:1;min-width:120px}.kpi-n{font-size:24px;font-weight:700;color:#8b0000}.kpi-l{font-size:11px;color:#666;margin-top:3px}.footer{margin-top:24px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:12px}
${extraCss}
</style></head><body>
  <div class="rep-export-dochead">
    <div class="rep-export-dochead-main">${logoFrag}<div><strong>${escapeHtml(titulo)}</strong> · ${escapeHtml(fechaLabel)}</div></div>
    <div style="text-align:right;white-space:nowrap">Generado: ${new Date().toLocaleString('es-CO')}</div>
  </div>
  ${cuerpo}
  <div class="footer">Sistema de Control de Librillos — Colbeef · ${new Date().toLocaleDateString('es-CO')}</div></body></html>`;
}

function mostrarPreview(titulo, fechaLabel, fechaISO, datos, salidas, opts = {}) {
  const destino = opts.destino === 'reportes' ? 'reportes' : 'totales';
  const { prev, title: titleEl, body } = getRepPreviewEls(destino);
  if (!prev || !body) return;
  if (titleEl) titleEl.textContent = titulo;
  prev.style.display = 'block';
  const kpis = opts.ocultarKpis ? '' : kpisGeneral(datos, { desde: opts.desde, hasta: opts.hasta });
  const incluirCuadrosResumen =
    opts.incluirResumenLibrosChunchullas === true ||
    opts.incluirResumenLibrosChunchullasCrudas === true;
  const bloqueLch = incluirCuadrosResumen
    ? htmlResumenLibrosChunchullasCrudas(datos, {
        fechaReporte: fechaISO,
        resumenMacro: opts.resumenMacro,
        metaUniverso: opts.metaUniverso,
        soloLibrillos: opts?.destino === 'reportes',
      })
    : '';
  const cuerpo = cuerpoReporteGeneral(datos, fechaISO, salidas, opts);
  body.innerHTML = `
    <div class="rep-header"><div><div class="rep-co">COLBEEF</div><div class="rep-sub-title">${escapeHtml(titulo)}</div></div><div class="rep-meta"><div>${fechaLabel}</div><div>Generado: ${new Date().toLocaleString('es-CO')}</div></div></div>
    ${kpis}
    ${bloqueLch}
    ${cuerpo}
    <div style="margin-top:20px;font-size:11px;color:var(--tx3);text-align:center;border-top:1px solid var(--brd);padding-top:12px">Colbeef — Sistema de Control de Librillos · ${new Date().toLocaleDateString('es-CO')}</div>`;
  prev.scrollIntoView({ behavior: 'smooth' });
}

function imprimirReporte() {
  const el = repPreviewBodyActivo();
  if (!el || !el.innerHTML.trim()) {
    mostrarToast('Genera primero una vista previa del reporte', 'err');
    return;
  }
  imprimirPreviewEnVentana(el.innerHTML, repPreviewTitleActivo()?.textContent || 'Reporte');
  enviarEventoAnalytics({
    eventName: 'print_report',
    viewName: _analyticsViewActual,
    meta: { origen: repPreviewTitleActivo()?.textContent || 'Reporte' },
  });
}

function imprimirPreviewEnVentana(htmlBody, titulo = 'Reporte') {
  const w = window.open('', '_blank', 'width=1200,height=900');
  if (!w) {
    mostrarToast('No se pudo abrir ventana de impresión. Revisa el bloqueador de popups.', 'err');
    return;
  }
  const safeTitle = escapeHtml(String(titulo || 'Reporte'));
  const stylesHref = new URL('styles.css', window.location.href).href;
  w.document.open();
  w.document.write(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="${stylesHref}" />
  <style>
    @page { size: A4 portrait; margin: 7mm; }
    html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}
    .print-root{
      padding:0;
      display:flex;
      justify-content:center;
    }
    .print-scale{transform:none;width:100%}
    .print-scale{
      max-width:186mm;
      margin:0 auto;
    }
    .print-scale .prev-wrap{
      padding:6px!important;
      margin:0 auto!important;
      background:#fff!important;
      border:none!important;
      box-shadow:none!important;
    }
    .print-scale .rep-resumen-nota{display:none!important}
    .print-scale .tw,
    .print-scale .rep-table-wrap{
      overflow:visible!important;
      max-height:none!important;
      height:auto!important;
    }
    .print-scale .mov-audit-scroll{
      max-height:none!important;
      height:auto!important;
      overflow:visible!important;
    }
    .print-scale .mov-audit-table{
      width:100%!important;
    }
    .print-scale .rep-pivot-audit-grid{
      display:block!important;
    }
    .print-scale .rep-pivot-audit-main{
      width:100%!important;
      max-width:100%!important;
    }
    .print-scale .rep-resumen-pivot{
      width:100%!important;
      max-width:100%!important;
      font-size:10px!important;
    }
    .print-scale .rep-resumen-th-titulo{font-size:18px!important;padding:8px 10px!important}
    .print-scale .rep-resumen-th-cierre{font-size:12px!important;padding:6px 8px!important}
    .print-scale .rep-resumen-th-cols{font-size:13px!important;padding:6px 8px!important}
    .print-scale .rep-resumen-row-parent td{font-size:12px!important;padding:5px 7px!important}
    .print-scale .rep-resumen-row-child td{font-size:11px!important;padding:4px 6px!important}
    .print-scale .rep-resumen-total-gen td{font-size:14px!important;padding:6px 8px!important}
    .print-scale .rep-pivot-audit .dt{font-size:9px!important}
    .print-scale .rep-pivot-audit .dt th,
    .print-scale .rep-pivot-audit .dt td{padding:3px 5px!important;line-height:1.15!important}
    .print-scale .mov-tabla-det,
    .print-scale .mov-pivot-table{
      width:100%!important;
      font-size:10px!important;
    }
    .print-scale .rep-header{
      margin-bottom:8px!important;
      padding-bottom:6px!important;
    }
    table{border-collapse:collapse}
    @media print{
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .print-root{overflow:visible}
    }
  </style>
</head>
<body>
  <div class="print-root"><div class="print-scale">${htmlBody || ''}</div></div>
</body>
</html>`);
  w.document.close();
  w.focus();
  // Esperar a que el navegador pinte el contenido antes de abrir imprimir.
  setTimeout(() => {
    try {
      w.print();
    } catch {
      // ignore
    }
  }, 250);
}

async function descargarPDFReporte() {
  const el = repPreviewBodyActivo();
  if (!el || !el.innerHTML.trim()) {
    mostrarToast('Genera primero una vista previa del reporte', 'err');
    return;
  }
  const title = (repPreviewTitleActivo()?.textContent || 'reporte').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  let source = null;
  try {
    const h2p = await ensureHtml2PdfDisponible();
    if (typeof h2p !== 'function') throw new Error('html2pdf no disponible');
    source = crearNodoTemporalParaPdf(el);
    const opt = {
      margin: 7,
      filename: `Colbeef_${title}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: PDF_HTML2CANVAS_SCALE, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    };
    const job = h2p().set(opt).from(source).save();
    if (job && typeof job.then === 'function') {
      await Promise.race([
        job,
        new Promise((_, reject) => setTimeout(() => reject(new Error('PDF_TIMEOUT')), 45000)),
      ]);
    }
    mostrarToast('PDF generado', 'ok');
    enviarEventoAnalytics({
      eventName: 'export_pdf',
      viewName: _analyticsViewActual,
      meta: { archivo: opt.filename || `Colbeef_${title}.pdf` },
    });
  } catch {
    // Fallback: abrir impresión con diseño para "Guardar como PDF" del navegador.
    mostrarToast('Se abrió Imprimir. En destino selecciona "Guardar como PDF".', 'ok');
    try {
      imprimirReporte();
    } catch {
      // ignore
    }
  } finally {
    if (source) {
      try { source.remove(); } catch { /* ignore */ }
    }
  }
}

function crearNodoTemporalParaPdf(previewEl) {
  const host = document.createElement('div');
  host.className = 'pdf-export-root';
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = '794px';
  host.style.background = '#fff';
  host.style.zIndex = '-1';
  host.innerHTML = previewEl.innerHTML;
  const style = document.createElement('style');
  style.textContent = `
    .pdf-export-root .tw,
    .pdf-export-root .rep-table-wrap{overflow:visible!important;max-height:none!important;height:auto!important}
    .pdf-export-root .mov-audit-scroll{max-height:none!important;height:auto!important;overflow:visible!important}
    .pdf-export-root .mov-audit-table{width:100%!important}
    .pdf-export-root .rep-pivot-audit-grid{display:block!important}
    .pdf-export-root .rep-pivot-audit-main,
    .pdf-export-root .rep-resumen-pivot{width:100%!important;max-width:100%!important}
    .pdf-export-root .rep-resumen-nota{display:none!important}
    .pdf-export-root .rep-resumen-pivot{font-size:10px!important}
    .pdf-export-root .rep-resumen-row-parent td{font-size:12px!important;padding:5px 7px!important}
    .pdf-export-root .rep-resumen-row-child td{font-size:11px!important;padding:4px 6px!important}
    .pdf-export-root .rep-pivot-audit .dt{font-size:9px!important}
    .pdf-export-root .rep-pivot-audit .dt th,
    .pdf-export-root .rep-pivot-audit .dt td{padding:3px 5px!important;line-height:1.15!important}
  `;
  host.appendChild(style);
  document.body.appendChild(host);
  return host;
}

function ensureHtml2PdfDisponible() {
  const existing = (typeof html2pdf !== 'undefined' ? html2pdf : window.html2pdf);
  if (typeof existing === 'function') return Promise.resolve(existing);
  const urls = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
    'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js',
  ];
  return new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) return reject(new Error('html2pdf no cargado'));
      const s = document.createElement('script');
      s.src = urls[i++];
      s.async = true;
      s.onload = () => {
        const h2p = (typeof html2pdf !== 'undefined' ? html2pdf : window.html2pdf);
        if (typeof h2p === 'function') resolve(h2p);
        else next();
      };
      s.onerror = next;
      document.head.appendChild(s);
    };
    next();
  });
}

function formatFechaSolo(f) {
  if (!f) return '—';
  // Interpretar YYYY-MM-DD en America/Bogota para evitar cambios de día
  const d = new Date(`${f}T00:00:00-05:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO');
}

function sumarDiasISO(iso, dias) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00-05:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');
}

function textoSalidaEtiquetaCruda(registro) {
  const idProducto = registro?.id_producto;
  const s = salidaEfectivaTimestamp(idProducto, registro);
  if (s) return formatFecha(s);
  return 'Pendiente despacho';
}

/** Abre ventana de impresión con etiquetas (crudas): código, plaza, propietario, ingreso proceso, salida (al despachar). */
function abrirVentanaEtiquetasCrudas(crudas, opts = {}) {
  // Zebra ZD230 según configuración del usuario: 100 x 24 mm.
  const ZEBRA_LABEL_W_MM = 100;
  const ZEBRA_LABEL_H_MM = 24;
  // Fuente del logo suministrada por el usuario en esta sesión + fallback opcional local.
  const logoEtiquetaSrc =
    'file:///C:/Users/CAMPUSLANDS/.cursor/projects/c-laragon-www-colbeef/assets/c__Users_CAMPUSLANDS_AppData_Roaming_Cursor_User_workspaceStorage_6c0d8d21b0889b1b6f744157fa715904_images_image-f0207b74-5fdd-443c-ae30-5731fefecd6b.png';
  const logoEtiquetaFallback = `${window.location.origin}/logo-colbeef.png`;
  const plazaEtiquetaCruda = (d) => {
    const principal = limpiarPuestoTxt(ubicacionPlaza(d));
    if (principal && principal !== '—') return principal;
    const respaldo = limpiarPuestoTxt(puestoNormalizado(d));
    if (respaldo && respaldo !== '—') return respaldo;
    return 'SIN PLAZA';
  };

  const sorted = [...crudas].sort((a, b) => {
    const sa = String(plazaEtiquetaCruda(a) || 'ZZZ').localeCompare(String(plazaEtiquetaCruda(b) || 'ZZZ'));
    if (sa !== 0) return sa;
    return String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true });
  });

  const grupos = {};
  const labelsData = [];
  let cardCounter = 0;
  // Regla operativa CRUDAS: beneficio = fecha plan, vencimiento = plan + 1 día (reimpresión histórico usa opts).
  const fechaPlanCrudas =
    String(opts.fechaPlanEtiqueta || '').trim() ||
    document.getElementById('fecha-global')?.value ||
    hoyISO();
  const fechaVenceCrudas = sumarDiasISO(fechaPlanCrudas, 1) || fechaPlanCrudas;
  sorted.forEach(d => {
    const s = plazaEtiquetaCruda(d);
    if (!grupos[s]) grupos[s] = [];
    grupos[s].push(d);
  });

  const body = Object.entries(grupos)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sucursal, items]) => {
      const cards = items.map(d => {
        const cardId = `lbl-cruda-${++cardCounter}`;
        const codigo = String(d.id_producto || '—');
        const plaza = String(sucursal || '—');
        const plazaEtiqueta = plaza.toUpperCase();
        const fb = formatFechaSolo(fechaPlanCrudas);
        const fv = formatFechaSolo(fechaVenceCrudas);
        // Contenido legible al escanear (texto en líneas).
        const qrText = [
          'chunchulla cruda',
          `id:${codigo}`,
          `puesto: ${plazaEtiqueta}`,
          `fecha beneficio: ${fb}`,
          `fecha vencimiento: ${fv}`,
        ].join('\n');
        labelsData.push({ cardId, qrText });
        return `
          <div class="lbl-card" id="${cardId}">
            <div class="lbl-main">
              <div class="lbl-left">
                <div class="lbl-k">PUESTO</div>
                <div class="lbl-puesto">${escapeHtml(plazaEtiqueta)}</div>
                <div class="lbl-code">${escapeHtml(codigo)}</div>
              </div>
              <div class="lbl-center">
                <div class="lbl-qr-wrap">
                  <img class="lbl-qr-img" id="qr-${cardId}" alt="QR" />
                </div>
              </div>
              <div class="lbl-right">
                <div class="lbl-logo-wrap">
                  <img
                    class="lbl-logo-img"
                    src="${escapeHtml(logoEtiquetaSrc)}"
                    alt="Colbeef"
                    onerror="if(this.dataset.f!=='1'){this.dataset.f='1';this.src='${escapeHtml(logoEtiquetaFallback)}';return;}this.style.display='none';this.nextElementSibling.style.display='block';"
                  />
                  <div class="lbl-logo" style="display:none">Colbeef</div>
                </div>
                <div class="lbl-fechas">
                  <div><strong>F.B.:</strong> ${escapeHtml(fb)}</div>
                  <div><strong>F.V.:</strong> ${escapeHtml(fv)}</div>
                </div>
                <div class="lbl-meta">
                  <div class="lbl-mini">COLBEEF S.A.S</div>
                  <div class="lbl-mini lbl-mini-addr">Floridablanca - Santander</div>
                  <div class="lbl-mini lbl-mini-addr">Via Corredor Rio Frio Cll 210 N9-631</div>
                  <div class="lbl-mini lbl-mini-addr">Tel: (7) 6917777 · www.colbeef.com</div>
                </div>
              </div>
            </div>
          </div>`;
      }).join('');
      return `<section class="lbl-group"><h3>${escapeHtml(sucursal)} (${items.length})</h3><div class="lbl-grid">${cards}</div></section>`;
    }).join('');

  const fechaSel = escapeHtml(document.getElementById('fecha-global')?.value || '');
  const w = window.open('', '_blank', 'width=1100,height=900');
  if (!w) { mostrarToast('El navegador bloqueó la ventana de impresión.', 'err'); return; }
  w.document.write(`
    <html>
    <head>
      <title>Etiquetas Crudas</title>
      <style>
        body{font-family:Arial,sans-serif;padding:10px;color:#111}
        h1{margin:0 0 6px;font-size:16px}
        .sub{margin:0 0 10px;color:#5d6f63;font-size:11px;max-width:980px;line-height:1.3}
        .lbl-group{margin:0 0 10px}
        .lbl-group h3{margin:0 0 6px;font-size:12px;color:#2f5ea8}
        .lbl-grid{display:grid;grid-template-columns:1fr;gap:8px}
        .lbl-card{
          border:1px solid #0b1f3a;background:#fff;padding:1.2mm;box-sizing:border-box;
          width:100%;max-width:980px;min-height:86px;
          page-break-inside:avoid;break-inside:avoid;
        }
        .lbl-main{display:grid;grid-template-columns:1.34fr .52fr 1.14fr;gap:.9mm;align-items:stretch;height:100%;width:100%;min-width:0}
        .lbl-left{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;padding-left:2.2mm;overflow:hidden;min-width:0;height:100%}
        .lbl-k{font-size:12px;font-weight:900;letter-spacing:.65px;text-align:left}
        .lbl-puesto{font-size:25px;font-weight:900;line-height:.88;text-align:left;letter-spacing:.18px;margin-top:.8mm}
        .lbl-code{font-size:12px;font-weight:700;line-height:.95;text-align:left;letter-spacing:.1px;margin-top:1.1mm}
        .lbl-center{display:flex;align-items:center;justify-content:center;min-width:0}
        .lbl-qr-wrap{display:flex;align-items:center;justify-content:center;margin-left:20mm}
        .lbl-qr-img{width:56px;height:56px;border:1px solid #777}
        .lbl-right{display:flex;flex-direction:column;justify-content:center;align-items:flex-end;overflow:hidden;min-width:0;padding-right:1.1mm;height:100%}
        .lbl-logo-wrap{display:flex;justify-content:flex-end;align-items:flex-start;min-height:15px;width:100%}
        .lbl-logo-img{max-width:82px;max-height:13px;object-fit:contain}
        .lbl-logo{font-size:18px;font-weight:900;color:#0b8e48;line-height:.95;font-style:normal;text-align:right}
        .lbl-fechas{font-size:12.8px;line-height:1.05;text-align:right;margin-top:.3mm}
        .lbl-meta{margin-top:.45mm;width:100%}
        .lbl-mini{font-size:6.7px;font-weight:700;line-height:1;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%}
        .lbl-mini-addr{white-space:normal;overflow:visible;text-overflow:clip}
        @media print{
          @page{
            size:${ZEBRA_LABEL_W_MM}mm ${ZEBRA_LABEL_H_MM}mm;
            margin:0;
          }
          html,body{
            width:${ZEBRA_LABEL_W_MM}mm;
            min-width:${ZEBRA_LABEL_W_MM}mm;
            margin:0;
            padding:0;
            background:#fff;
            -webkit-print-color-adjust:exact;
            print-color-adjust:exact;
          }
          h1,.sub,.no-print{display:none!important}
          .lbl-group{margin:0}
          .lbl-group h3{display:none}
          .lbl-grid{
            display:block;
            gap:0;
          }
          .lbl-card{
            width:${ZEBRA_LABEL_W_MM}mm;
            min-width:${ZEBRA_LABEL_W_MM}mm;
            max-width:${ZEBRA_LABEL_W_MM}mm;
            height:${ZEBRA_LABEL_H_MM}mm;
            min-height:${ZEBRA_LABEL_H_MM}mm;
            max-height:${ZEBRA_LABEL_H_MM}mm;
            margin:0;
            padding:.7mm;
            border:0.35mm solid #0b1f3a;
            box-sizing:border-box;
            page-break-after:always;
            break-after:page;
            overflow:hidden;
          }
          .lbl-card:last-child{
            page-break-after:auto;
            break-after:auto;
          }
          .lbl-main{
            height:100%;
            width:100%;
            min-width:0;
            grid-template-columns:1.34fr .52fr 1.14fr;
            gap:.9mm;
          }
          .lbl-left{padding-left:1.4mm;min-width:0;height:100%;justify-content:space-between}
          .lbl-k{font-size:8pt; line-height:1}
          .lbl-puesto{font-size:16.2pt; line-height:.86; margin-top:.3mm}
          .lbl-code{font-size:10pt; line-height:.95; margin-top:.4mm}
          .lbl-center{display:flex;align-items:center;justify-content:center}
          .lbl-qr-img{width:11.8mm;height:11.8mm}
          .lbl-logo-img{max-width:18.2mm;max-height:3.7mm}
          .lbl-fechas{font-size:7.6pt; line-height:1.05; margin-top:.18mm}
          .lbl-meta{margin-top:.28mm}
          .lbl-mini{font-size:4.3pt; font-weight:700; line-height:.98}
          .lbl-right{padding-right:.85mm;min-width:0;height:100%;justify-content:center}
          .lbl-mini-addr{white-space:normal;overflow:visible;text-overflow:clip}
        }
      </style>
      <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
    </head>
    <body>
      <h1>Etiquetas — vísceras crudas</h1>
      <p class="sub">Fecha operación: ${fechaSel}. El QR de cada etiqueta es único por producto (código/ID).</p>
      ${body}
      <div class="no-print" style="margin-top:16px"><button id="btn-imprimir-etiquetas" onclick="window.print()" disabled>Imprimir</button></div>
      <script>
        (function () {
          const labels = ${JSON.stringify(labelsData)};
          function qrFallbackUrl(text, size){
            return 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size + '&data=' + encodeURIComponent(text);
          }
          function waitForQrLib(maxMs){
            return new Promise(function(resolve){
              const started = Date.now();
              (function check(){
                const QR = window.QRCode || window.qrcode || (window.QRCode && window.QRCode.default);
                if (QR) return resolve(QR);
                if (Date.now() - started > maxMs) return resolve(null);
                setTimeout(check, 120);
              })();
            });
          }
          function genOne(item) {
            return new Promise(function(resolve){
              const img = document.getElementById('qr-' + item.cardId);
              if (!img) return resolve();
              const QR = window.QRCode || window.qrcode;
              const qrText = item.qrText;
              if (!QR) {
                img.src = qrFallbackUrl(qrText, 256);
                return resolve();
              }
              const toDataURL = (typeof QR.toDataURL === 'function') ? QR.toDataURL : (QR.default && typeof QR.default.toDataURL === 'function' ? QR.default.toDataURL : null);
              if (toDataURL) {
                toDataURL(qrText, { errorCorrectionLevel: 'L', margin: 2, width: 256, scale: 8 }, function(err, url){
                  if (!err && url) img.src = url;
                  else img.src = qrFallbackUrl(qrText, 256);
                  resolve();
                });
                return;
              }
              const canvas = document.createElement('canvas');
              const toCanvas = (typeof QR.toCanvas === 'function') ? QR.toCanvas : (QR.default && typeof QR.default.toCanvas === 'function' ? QR.default.toCanvas : null);
              if (!toCanvas) {
                img.src = qrFallbackUrl(qrText, 256);
                return resolve();
              }
              toCanvas(canvas, qrText, { width: 256, margin: 2, errorCorrectionLevel: 'L' }, function(){
                try { img.src = canvas.toDataURL('image/png'); }
                catch (e) { img.src = qrFallbackUrl(qrText, 256); }
                resolve();
              });
            });
          }
          waitForQrLib(4000).then(function(){
            return Promise.all(labels.map(genOne));
          }).then(function(){
            const b = document.getElementById('btn-imprimir-etiquetas');
            if (b) b.disabled = false;
          });
        })();
      </script>
    </body>
    </html>
  `);
  w.document.close();
}

function imprimirEtiquetasCrudas() {
  const crudas = datosCrudasHist || [];
  if (!crudas.length) {
    mostrarToast('No hay crudas para imprimir en la fecha seleccionada.', 'err');
    return;
  }
  abrirVentanaEtiquetasCrudas(crudas);
  enviarEventoAnalytics({
    eventName: 'print_labels_crudas',
    viewName: _analyticsViewActual,
    meta: { modo: 'todas', total: crudas.length },
  });
}

/** Una sola cruda: mismo layout de etiquetas que el listado completo. */
function imprimirEtiquetasCrudasUnId(idProducto) {
  const id = String(idProducto ?? '').trim();
  if (!id) return;
  const d = (datosCrudasHist || []).find((x) => String(x.id_producto) === id);
  if (!d || !esVistaHistorialCrudasSolo(d)) {
    mostrarToast('No se encontró la cruda en la fecha actual. Actualiza e intenta de nuevo.', 'err');
    return;
  }
  abrirVentanaEtiquetasCrudas([d]);
  enviarEventoAnalytics({
    eventName: 'print_labels_crudas',
    viewName: _analyticsViewActual,
    meta: { modo: 'una', id_producto: id },
  });
}

function imprimirEtiquetasCrudasSeleccion() {
  if (!seleccionadosCrud.size) {
    mostrarToast('Selecciona crudas en Inventario (pestaña Crudas).', 'err');
    return;
  }
  const lista = datosCrudasHist.filter(d => seleccionadosCrud.has(d.id_producto));
  if (!lista.length) {
    mostrarToast('Las crudas seleccionadas ya no están en inventario. Actualiza.', 'err');
    return;
  }
  abrirVentanaEtiquetasCrudas(lista);
  enviarEventoAnalytics({
    eventName: 'print_labels_crudas',
    viewName: _analyticsViewActual,
    meta: { modo: 'seleccion', total: lista.length },
  });
}

function imprimirEtiquetasCrudasDespachadasHoy() {
  const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
  const salidasDiaOperativo = listaSalidasInventarioParaDia(fechaSel);
  const byId = new Map((datosGlobal || []).map(d => [String(d.id_producto), d]));
  const crudasDesp = salidasDiaOperativo
    .map(s => byId.get(String(s.id_producto)))
    .filter(Boolean)
    .filter(esVistaHistorialCrudasSolo);

  if (!crudasDesp.length) {
    mostrarToast('No hay crudas despachadas para imprimir en la fecha operativa seleccionada.', 'err');
    return;
  }
  abrirVentanaEtiquetasCrudas(crudasDesp);
  enviarEventoAnalytics({
    eventName: 'print_labels_crudas',
    viewName: _analyticsViewActual,
    meta: { modo: 'despachadas_hoy', total: crudasDesp.length, fecha: fechaSel },
  });
}

const REP_LIB_CANALES = [
  { key: 'derivados_carnicos', label: 'DERIVADOS CARNICOS', color: '#1e88e5' },
  { key: 'asurcarnes', label: 'ASURCARNES', color: '#fbc02d' },
  { key: 'asurcarnescol', label: 'ASURCARNES COL', color: '#8bc34a' },
  { key: 'cat', label: 'CAT', color: '#e53935' },
  { key: 'global_hides', label: 'GLOBAL HIDES', color: '#8e6ac8' },
  { key: 'asurcarnes_glo', label: 'ASURCARNES GLO', color: '#2e7d32' },
];
const REP_LIB_FACTURABLE = new Set([
  'derivados_carnicos',
  'global_hides',
  'asurcarnes',
  'asurcarnescol',
  'asurcarnes_glo',
]);
const REP_LIB_MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const repLibrillosState = {
  init: false,
  cacheAnio: new Map(),
  cacheFiltro: new Map(),
  lastRender: null,
  reqSeq: 0,
};

function repLibFechaIso(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function repLibFmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00-05:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('es-CO');
}

function repLibFilaBase(fecha) {
  const base = { fecha };
  REP_LIB_CANALES.forEach((c) => { base[c.key] = 0; });
  return base;
}

function repLibArmarMesesSelect() {
  const selMes = document.getElementById('rep-lib-mes');
  if (!selMes || selMes.options.length > 1) return;
  selMes.innerHTML = '<option value="">Todos</option>' + REP_LIB_MESES
    .map((m, idx) => `<option value="${idx + 1}">${m}</option>`)
    .join('');
}

function repLibMesDesdeSelect(selMes) {
  if (!selMes) return 0;
  const raw = String(selMes.value || '').trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 12) return n;
  const txt = String(selMes.options?.[selMes.selectedIndex]?.text || raw || '').trim().toUpperCase();
  const idx = REP_LIB_MESES.findIndex((m) => m === txt);
  return idx >= 0 ? idx + 1 : 0;
}

function repLibArmarAniosSelect() {
  const selAnio = document.getElementById('rep-lib-anio');
  if (!selAnio) return;
  const actual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 4);
  const y = Number(actual);
  selAnio.innerHTML = [y, y - 1, y - 2]
    .map((n) => `<option value="${n}">${n}</option>`)
    .join('');
}

async function repLibDatosPorAnio(anio) {
  const key = String(anio || '').trim();
  if (!/^\d{4}$/.test(key)) return [];
  if (repLibrillosState.cacheAnio.has(key)) return repLibrillosState.cacheAnio.get(key);
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const anioHoy = Number(hoy.slice(0, 4));
  if (Number(key) > anioHoy) return [];
  const desde = `${key}-01-01`;
  const hasta = Number(key) === anioHoy ? hoy : `${key}-12-31`;
  const lista = await fetchDatosRango(desde, hasta).catch(() => []);
  const dedupe = new Map();
  lista.forEach((r) => {
    const k = `${String(r?.id_producto || '')}|${String(r?.fecha || '')}`;
    if (!dedupe.has(k)) dedupe.set(k, r);
  });
  const out = [...dedupe.values()];
  repLibrillosState.cacheAnio.set(key, out);
  return out;
}

async function repLibDatosPorFiltro(anio, mes) {
  const y = String(anio || '').trim();
  const m = Number(mes || 0);
  if (!/^\d{4}$/.test(y)) return [];
  if (!m) return repLibDatosPorAnio(y);

  const key = `${y}|${m}`;
  if (repLibrillosState.cacheFiltro.has(key)) return repLibrillosState.cacheFiltro.get(key);

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const anioHoy = Number(hoy.slice(0, 4));
  const mesHoy = Number(hoy.slice(5, 7));
  if (Number(y) > anioHoy || (Number(y) === anioHoy && m > mesHoy)) return [];

  const desdeMes = `${y}-${String(m).padStart(2, '0')}-01`;
  const finMes = Number(y) === anioHoy && m === mesHoy
    ? hoy
    : `${y}-${String(m).padStart(2, '0')}-${String(new Date(Number(y), m, 0).getDate()).padStart(2, '0')}`;
  const corteAnterior = new Date(Number(y), m - 1, 0).toLocaleDateString('en-CA');

  const [datosMes, datosCorteAnterior] = await Promise.all([
    fetchDatosRango(desdeMes, finMes).catch(() => []),
    fetchDatosRango(corteAnterior, corteAnterior).catch(() => []),
  ]);

  const dedupe = new Map();
  [...datosMes, ...datosCorteAnterior].forEach((r) => {
    const k = `${String(r?.id_producto || '')}|${String(r?.fecha || '')}`;
    if (!dedupe.has(k)) dedupe.set(k, r);
  });
  const out = [...dedupe.values()];
  repLibrillosState.cacheFiltro.set(key, out);
  return out;
}

function repLibPintarTabla(filas, totales) {
  const tbody = document.getElementById('rep-lib-tbody');
  if (!tbody) return;
  if (!filas.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Sin datos para los filtros seleccionados.</td></tr>';
  } else {
    tbody.innerHTML = filas.map((f) => `
      <tr>
        <td>${repLibFmtFecha(f.fecha)}</td>
        <td>${fmtNum(f.derivados_carnicos)}</td>
        <td>${fmtNum(f.asurcarnes)}</td>
        <td>${fmtNum(f.asurcarnescol)}</td>
        <td>${fmtNum(f.cat)}</td>
        <td>${fmtNum(f.global_hides)}</td>
        <td>${fmtNum(f.asurcarnes_glo)}</td>
      </tr>
    `).join('');
  }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmtNum(v); };
  set('rep-lib-total-derivados', totales.derivados_carnicos);
  set('rep-lib-total-asurcarnes', totales.asurcarnes);
  set('rep-lib-total-asurcarnes-col', totales.asurcarnescol);
  set('rep-lib-total-cat', totales.cat);
  set('rep-lib-total-global-hides', totales.global_hides);
  set('rep-lib-total-asurcarnes-glo', totales.asurcarnes_glo);
}

function repLibPintarChart(filas) {
  const el = document.getElementById('rep-lib-chart');
  const legend = document.getElementById('rep-lib-legend');
  if (!el || !legend) return;
  const porMes = new Map();
  filas.forEach((f) => {
    const mes = Number(String(f.fecha).slice(5, 7));
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) return;
    if (!porMes.has(mes)) porMes.set(mes, repLibFilaBase(`m-${mes}`));
    const acc = porMes.get(mes);
    REP_LIB_CANALES.forEach((c) => { acc[c.key] += Number(f[c.key] || 0); });
  });
  const meses = [...porMes.entries()].sort((a, b) => a[0] - b[0]).map(([m, v]) => ({ mes: m, ...v }));
  if (!meses.length) {
    el.innerHTML = '<div class="chart-empty">Sin datos para graficar.</div>';
    legend.innerHTML = '';
    return;
  }
  const max = Math.max(1, ...meses.flatMap((r) => REP_LIB_CANALES.map((c) => Number(r[c.key] || 0))));
  el.innerHTML = meses.map((m) => `
    <div class="rep-lib-group">
      <div class="rep-lib-bars">
        ${REP_LIB_CANALES.map((c) => {
          const val = Number(m[c.key] || 0);
          const h = Math.max(2, Math.round((val / max) * 190));
          return `
            <div class="rep-lib-bar-wrap">
              <span class="rep-lib-bar-value">${fmtNum(val)}</span>
              <span class="rep-lib-bar" style="height:${h}px;background:${c.color}" title="${c.label}: ${fmtNum(val)}"></span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="rep-lib-month">${REP_LIB_MESES[m.mes - 1]}</div>
    </div>
  `).join('');
  legend.innerHTML = REP_LIB_CANALES
    .map((c) => `<span class="rep-lib-legend-item"><span class="rep-lib-legend-swatch" style="background:${c.color}"></span>${c.label}</span>`)
    .join('');
}

function repLibCalcularFacturacion(lista, anio, mes) {
  const out = {
    periodoTexto: 'Selecciona un mes para calcular facturación.',
    detalle: [],
    totalMes: 0,
    totalCorteAnterior: 0,
    totalFacturar: 0,
  };
  if (!mes) return out;
  const detalle = new Map();
  let totalMes = 0;
  let totalCorteAnterior = 0;
  const y = Number(anio);
  const m = Number(mes);
  const fechaCortePrev = new Date(y, m - 1, 0).toLocaleDateString('en-CA');
  const fechaFinMes = new Date(y, m, 0).toLocaleDateString('en-CA');
  (lista || []).forEach((r) => {
    const f = repLibFechaIso(r?.fecha);
    if (!f) return;
    const cod = codigoAgrupacionMacro(r);
    if (!REP_LIB_FACTURABLE.has(cod)) return;
    const yy = Number(f.slice(0, 4));
    const mm = Number(f.slice(5, 7));
    if (yy === y && mm === m) {
      detalle.set(cod, (detalle.get(cod) || 0) + 1);
      totalMes += 1;
    }
    if (f === fechaCortePrev) {
      totalCorteAnterior += 1;
    }
  });
  out.periodoTexto = `Se realiza factura de comisión de librillos del ${repLibFmtFecha(fechaCortePrev)} al ${repLibFmtFecha(fechaFinMes)}.`;
  const asurCombo =
    Number(detalle.get('asurcarnes') || 0) +
    Number(detalle.get('asurcarnescol') || 0) +
    Number(detalle.get('asurcarnes_glo') || 0);
  out.detalle = [
    { codigo: 'derivados_carnicos', total: Number(detalle.get('derivados_carnicos') || 0) },
    { codigo: 'global_hides', total: Number(detalle.get('global_hides') || 0) },
    { codigo: 'asur_combo', total: asurCombo },
  ].filter((x) => Number(x.total || 0) > 0);
  out.totalMes = totalMes;
  out.totalCorteAnterior = totalCorteAnterior;
  out.totalFacturar = totalMes + totalCorteAnterior;
  return out;
}

function repLibPintarFacturacion(data) {
  const txt = document.getElementById('rep-lib-fact-text');
  const tbody = document.getElementById('rep-lib-fact-tbody');
  if (!txt || !tbody) return;
  txt.textContent = String(data?.periodoTexto || '');
  const etiqueta = (cod) => {
    if (cod === 'asur_combo') return 'ASURCARNES -COL-GLO';
    if (cod === 'asurcarnes_glo') return 'ASURCARNES -COL-GLO';
    return String(ETIQUETA_MACRO_EXCEL[cod] || cod || '').replace(' SAS', '');
  };
  const rowsDetalle = (data?.detalle || []).map((d) => `
    <tr>
      <td class="rep-lib-fact-label">${escapeHtml(etiqueta(d.codigo))}</td>
      <td class="rep-lib-fact-value">${fmtNum(d.total)}</td>
    </tr>
  `).join('');
  tbody.innerHTML = `
    ${rowsDetalle || '<tr><td class="rep-lib-fact-label">SIN REGISTROS FACTURABLES</td><td class="rep-lib-fact-value">0</td></tr>'}
    <tr class="rep-lib-fact-total">
      <td class="rep-lib-fact-label">TOTAL ${escapeHtml(data?.mesNombre || '')}</td>
      <td class="rep-lib-fact-value">${fmtNum(data?.totalMes || 0)}</td>
    </tr>
    <tr>
      <td class="rep-lib-fact-label">TOTAL ${escapeHtml(data?.corteAnteriorLabel || '')}</td>
      <td class="rep-lib-fact-value">${fmtNum(data?.totalCorteAnterior || 0)}</td>
    </tr>
    <tr class="rep-lib-fact-total">
      <td class="rep-lib-fact-label">TOTAL A FACTURAR</td>
      <td class="rep-lib-fact-value">${fmtNum(data?.totalFacturar || 0)}</td>
    </tr>
  `;
}

function repLibNombreArchivo(ext) {
  const s = repLibrillosState.lastRender || {};
  const anio = String(s.anio || 'reporte');
  const mes = Number(s.mes || 0);
  const mesTxt = mes ? String(mes).padStart(2, '0') : 'todos';
  return `reporte_librillos_${anio}_${mesTxt}.${ext}`;
}

function descargarReporteLibrillosPDF() {
  const st = repLibrillosState.lastRender;
  const cargando = document.getElementById('rep-lib-inline-loader')?.classList.contains('show');
  if (cargando) {
    mostrarToast('El reporte aún está cargando. Intenta de nuevo en unos segundos.', 'err');
    return;
  }
  if (!st || !Array.isArray(st.filas) || !st.filas.length) {
    mostrarToast('Primero genera el reporte para descargar.', 'err');
    return;
  }
  const wrap = document.createElement('div');
  wrap.id = 'rep-lib-pdf-clone';
  wrap.style.padding = '16px';
  wrap.style.fontFamily = "'Barlow', Arial, sans-serif";
  wrap.style.background = '#ffffff';
  wrap.style.width = '1280px';
  wrap.style.maxWidth = '1280px';
  wrap.style.position = 'fixed';
  wrap.style.left = '0';
  wrap.style.top = '0';
  wrap.style.opacity = '0.01';
  wrap.style.pointerEvents = 'none';
  wrap.style.zIndex = '-1';

  const chartHtml = document.getElementById('rep-lib-chart')?.innerHTML || '';
  const legendHtml = document.getElementById('rep-lib-legend')?.innerHTML || '';
  const fact = st.facturacion || {};
  const factRows = Array.isArray(fact.detalle) ? fact.detalle : [];
  const factLabel = (cod) => {
    if (cod === 'asur_combo') return 'ASURCARNES -COL-GLO';
    if (cod === 'asurcarnes_glo') return 'ASURCARNES -COL-GLO';
    return String(ETIQUETA_MACRO_EXCEL[cod] || cod || '').replace(' SAS', '');
  };

  const meta = document.createElement('div');
  meta.style.fontSize = '12px';
  meta.style.color = '#4b5b50';
  meta.style.margin = '0 0 10px 2px';
  meta.textContent = `Año: ${String(st.anio || '—')} · Mes: ${st.mes ? REP_LIB_MESES[Number(st.mes) - 1] : 'Todos'} · Generado: ${new Date().toLocaleString('es-CO')}`;
  wrap.appendChild(meta);

  wrap.innerHTML += `
    <div class="panel rep-lib-header" style="margin-bottom:12px">
      <div class="rep-lib-brand">
        <div class="rep-lib-logo">Colbeef</div>
        <h2 class="rep-lib-title">REPORTE DE LIBRILLOS</h2>
      </div>
      <div class="rep-lib-kpis">
        <div class="rep-lib-kpi rep-lib-kpi-total">
          <span class="rep-lib-kpi-label">TOTAL DE LIBROS</span>
          <strong>${fmtNum(st.totalLibros || 0)}</strong>
        </div>
        <div class="rep-lib-kpi rep-lib-kpi-facturar">
          <span class="rep-lib-kpi-label">CANTIDAD DE LIBROS A FACTURAR</span>
          <strong>${fmtNum(st.totalFacturar || 0)}</strong>
        </div>
      </div>
    </div>
    <div class="panel" style="margin-bottom:12px">
      <div class="tw">
        <table class="dt rep-lib-tabla">
          <thead>
            <tr>
              <th>FECHA DE BENEFICIO</th>
              <th>DERIVADOS CARNICOS</th>
              <th>ASURCARNES</th>
              <th>ASURCARNES COL</th>
              <th>CAT</th>
              <th>GLOBAL HIDES</th>
              <th>ASURCARNES GLO</th>
            </tr>
          </thead>
          <tbody>
            ${st.filas.map((f) => `
              <tr>
                <td>${repLibFmtFecha(f.fecha)}</td>
                <td>${fmtNum(f.derivados_carnicos)}</td>
                <td>${fmtNum(f.asurcarnes)}</td>
                <td>${fmtNum(f.asurcarnescol)}</td>
                <td>${fmtNum(f.cat)}</td>
                <td>${fmtNum(f.global_hides)}</td>
                <td>${fmtNum(f.asurcarnes_glo)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th>${fmtNum(st.totales?.derivados_carnicos || 0)}</th>
              <th>${fmtNum(st.totales?.asurcarnes || 0)}</th>
              <th>${fmtNum(st.totales?.asurcarnescol || 0)}</th>
              <th>${fmtNum(st.totales?.cat || 0)}</th>
              <th>${fmtNum(st.totales?.global_hides || 0)}</th>
              <th>${fmtNum(st.totales?.asurcarnes_glo || 0)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    <div class="panel rep-lib-fact-panel" style="margin-bottom:12px">
      <div class="rep-lib-fact-text">${escapeHtml(String(fact.periodoTexto || ''))}</div>
      <div class="tw">
        <table class="dt rep-lib-fact-table">
          <tbody>
            ${factRows.map((d) => `
              <tr>
                <td class="rep-lib-fact-label">${escapeHtml(factLabel(d.codigo))}</td>
                <td class="rep-lib-fact-value">${fmtNum(d.total)}</td>
              </tr>
            `).join('')}
            <tr class="rep-lib-fact-total">
              <td class="rep-lib-fact-label">TOTAL ${escapeHtml(String(fact.mesNombre || 'MES'))}</td>
              <td class="rep-lib-fact-value">${fmtNum(fact.totalMes || 0)}</td>
            </tr>
            <tr>
              <td class="rep-lib-fact-label">TOTAL ${escapeHtml(String(fact.corteAnteriorLabel || ''))}</td>
              <td class="rep-lib-fact-value">${fmtNum(fact.totalCorteAnterior || 0)}</td>
            </tr>
            <tr class="rep-lib-fact-total">
              <td class="rep-lib-fact-label">TOTAL A FACTURAR</td>
              <td class="rep-lib-fact-value">${fmtNum(fact.totalFacturar || 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="rep-lib-fact-note">NOTA: CAT Y COCIDOS NO SE FACTURAN</div>
    </div>
    <div class="panel rep-lib-chart-panel">
      <div class="ph"><span class="pt">Cantidad de librillos por mes y canal</span></div>
      <div class="rep-lib-chart" style="min-height:240px">${chartHtml}</div>
      <div class="rep-lib-legend">${legendHtml}</div>
    </div>
  `;

  document.body.appendChild(wrap);
  const opt = {
    margin: [8, 8, 8, 8],
    filename: repLibNombreArchivo('pdf'),
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: PDF_HTML2CANVAS_SCALE, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
  };
  html2pdf()
    .set(opt)
    .from(wrap)
    .save()
    .finally(() => {
      wrap.remove();
    });
}

async function cargarReporteLibrillosVista(forzar = false) {
  const reqId = ++repLibrillosState.reqSeq;
  const setLoading = (on) => {
    const ld = document.getElementById('rep-lib-inline-loader');
    if (!ld) return;
    ld.classList.toggle('show', !!on);
    ld.setAttribute('aria-hidden', on ? 'false' : 'true');
  };
  repLibArmarMesesSelect();
  if (!repLibrillosState.init) {
    repLibArmarAniosSelect();
    const btn = document.getElementById('rep-lib-refrescar');
    const selAnio = document.getElementById('rep-lib-anio');
    const selMes = document.getElementById('rep-lib-mes');
    const btnPdf = document.getElementById('rep-lib-descargar-pdf');
    btn?.addEventListener('click', () => { void cargarReporteLibrillosVista(true); });
    selAnio?.addEventListener('change', () => { void cargarReporteLibrillosVista(false); });
    selMes?.addEventListener('change', () => { void cargarReporteLibrillosVista(false); });
    btnPdf?.addEventListener('click', descargarReporteLibrillosPDF);
    repLibrillosState.init = true;
  }
  const selAnio = document.getElementById('rep-lib-anio');
  const selMes = document.getElementById('rep-lib-mes');
  const tbody = document.getElementById('rep-lib-tbody');
  if (!selAnio) return;
  const mes = repLibMesDesdeSelect(selMes);
  if (forzar) {
    const cacheKeyAnio = String(selAnio.value || '');
    const cacheKeyFiltro = `${cacheKeyAnio}|${mes}`;
    repLibrillosState.cacheAnio.delete(cacheKeyAnio);
    repLibrillosState.cacheFiltro.delete(cacheKeyFiltro);
    cacheRangoFront.clear();
  }
  const anio = String(selAnio.value || '').trim();
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty">Cargando reporte...</td></tr>';
  setLoading(true);
  const t0 = Date.now();
  try {
    const lista = await repLibDatosPorFiltro(anio, mes);
    if (reqId !== repLibrillosState.reqSeq) return;
    const filtrada = lista.filter((r) => {
      const f = repLibFechaIso(r?.fecha);
      if (!f) return false;
      if (mes) return Number(f.slice(5, 7)) === mes;
      return true;
    });
    const map = new Map();
    filtrada.forEach((r) => {
      const fecha = repLibFechaIso(r.fecha);
      if (!fecha) return;
      const codigo = codigoAgrupacionMacro(r);
      if (!REP_LIB_CANALES.find((c) => c.key === codigo)) return;
      if (!map.has(fecha)) map.set(fecha, repLibFilaBase(fecha));
      const acc = map.get(fecha);
      acc[codigo] += 1;
    });
    const filas = [...map.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const totales = repLibFilaBase('tot');
    filas.forEach((f) => REP_LIB_CANALES.forEach((c) => { totales[c.key] += Number(f[c.key] || 0); }));
    const totalLibros = REP_LIB_CANALES.reduce((s, c) => s + Number(totales[c.key] || 0), 0);
    const fact = repLibCalcularFacturacion(filtrada, anio, mes);
    fact.mesNombre = mes ? REP_LIB_MESES[Number(mes) - 1] : 'MES';
    const dPrev = new Date(Number(anio), Number(mes || 1) - 1, 0);
    fact.corteAnteriorLabel = `${dPrev.getDate()} ${REP_LIB_MESES[dPrev.getMonth()]}`;
    const totalFacturar = Number(fact.totalFacturar || 0);
    const k1 = document.getElementById('rep-lib-total-libros');
    const k2 = document.getElementById('rep-lib-total-facturar');
    if (k1) k1.textContent = fmtNum(totalLibros);
    if (k2) k2.textContent = fmtNum(totalFacturar);
    repLibPintarFacturacion(fact);
    repLibrillosState.lastRender = {
      filas,
      totales,
      totalLibros,
      totalFacturar,
      anio,
      mes: mes || null,
      facturacion: fact,
    };
    repLibPintarTabla(filas, totales);
    if (reqId !== repLibrillosState.reqSeq) return;
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    if (reqId !== repLibrillosState.reqSeq) return;
    repLibPintarChart(filas);
    const ms = Math.max(0, Date.now() - t0);
    enviarEventoAnalytics({
      eventName: 'reporte_librillos_cargar',
      viewName: 'rep-librillos',
      durationMs: ms,
      meta: {
        anio,
        mes: mes || null,
        forzar: !!forzar,
        filasDia: filas.length,
        registros: lista.length,
      },
    });
  } finally {
    if (reqId === repLibrillosState.reqSeq) setLoading(false);
  }
}

// ── INICIAR ───────────────────────────────────────────────────────────────────
iniciarAnalyticsUso();
document.getElementById('pg-sub').textContent = labelFecha(fechaDefectoOperacion);
actualizarColumnasRol();
void Promise.all([cargarAliasPlazas(), cargarConfigClienteResumen(), cargarConfigUi()]).then(() => {
  initListenerUsuarioDesdeInventario();
  if (document.getElementById('vista-reportes')?.classList.contains('active')) {
    const prev = document.getElementById('rep-prev-body-rep');
    if (prev && prev.innerHTML.trim()) {
      void generarReporteCliente();
    }
  }
});
renderBotonSonido();
actualizarLabelCorteTurno();
void cargarConfigOperacion();
window.addEventListener('pointerdown', unlockAudio, { once: true });
aplicarVistaDesdeQueryString();
cargarDatos();
iniciarAutoRefreshGlobal();
iniciarWatchObservaciones();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  clearTimeout(_visCatchupTimer);
  _visCatchupTimer = setTimeout(() => {
    void refrescarGlobal();
    void refrescarSiCambioObservacion();
  }, 350);
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) cerrarMenuMovil();
});

// Si el navegador restaura estado (bfcache), re-forzar la fecha operativa por defecto
window.addEventListener('pageshow', () => {
  const defecto = fechaOperativaDefectoISO();
  const el = document.getElementById('fecha-global');
  if (el && el.value !== defecto) {
    el.value = defecto;
    el.defaultValue = defecto;
    el.setAttribute('value', defecto);
    cambiarFecha();
  }
});

window.addEventListener('pagehide', () => {
  cerrarAnalyticsUso();
});