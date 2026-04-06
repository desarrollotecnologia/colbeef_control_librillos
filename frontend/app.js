const API_URL      = '/api/librillos';
const SALIDAS_URL  = '/api/salidas';

// Sin login/roles: comportamiento único
const USUARIO_ACTUAL = 'usuario';

// ── DATOS ─────────────────────────────────────────────────────────────────────
let datosGlobal   = [];   // API: solo retiro librillos + crudas
let datosLibrillos = [];  // RETIRAR LIBRILLOS (historial librillos)
let datosCrudasHist = []; // observación solo CRUDAS/CRUDA
let datosClientes  = [];
let salidasRegistradas = [];
let inventarioSubtab = 'lib'; // 'lib' | 'crud'
let _autoInvTimer = null;
let _autoInvSnapshot = '';
let _autoGlobalTimer = null;
let _autoObsTimer = null;
let _autoObsSnapshot = '';
let _obsTextoMapPrev = new Map();
let historialCambiosObs = [];
let _toastOnClick = null;
let historialSoloPendientes = false;
const gruposHistorialColapsados = new Set();
let tablaCompacta = false;

// ── NOTIFICACIONES (sonido) ────────────────────────────────────────────────────
let _audioUnlocked = false;
const LS_SONIDO = 'colbeef_sonido_notif';
function sonidoHabilitado() {
  const v = localStorage.getItem(LS_SONIDO);
  return v === null ? true : v === '1';
}
function renderBotonSonido() {
  const b = document.getElementById('btn-sound');
  if (!b) return;
  const on = sonidoHabilitado();
  b.textContent = `Sonido: ${on ? 'ON' : 'OFF'}`;
  b.classList.toggle('off', !on);
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
  ['th-acciones-inv', 'th-acciones-desp', 'th-acciones-inv-crud', 'th-acciones-desp-crud'].forEach(id => {
    const th = document.getElementById(id);
    if (th) th.style.display = 'table-cell';
  });
}

// ── FECHAS ────────────────────────────────────────────────────────────────────
function hoyISO() {
  return diaOperacionISOFromTimestamp(new Date().toISOString());
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
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
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

const hoy = hoyISO();
// Forzar fecha global a "hoy" (el navegador a veces restaura un valor previo)
const fechaGlobalEl = document.getElementById('fecha-global');
if (fechaGlobalEl) {
  fechaGlobalEl.value = hoy;
  fechaGlobalEl.defaultValue = hoy;
  fechaGlobalEl.setAttribute('value', hoy);
}
const fechaRepGenEl = document.getElementById('fecha-rep-gen');
if (fechaRepGenEl) fechaRepGenEl.value = hoy;
const fechaRepGenDesdeEl = document.getElementById('fecha-rep-gen-desde');
const fechaRepGenHastaEl = document.getElementById('fecha-rep-gen-hasta');
if (fechaRepGenDesdeEl) fechaRepGenDesdeEl.value = hoy;
if (fechaRepGenHastaEl) fechaRepGenHastaEl.value = hoy;
const fechaRepCliDesdeEl = document.getElementById('fecha-rep-cli-desde');
const fechaRepCliHastaEl = document.getElementById('fecha-rep-cli-hasta');
if (fechaRepCliDesdeEl) fechaRepCliDesdeEl.value = hoy;
if (fechaRepCliHastaEl) fechaRepCliHastaEl.value = hoy;
const fechaRepAgrupEl = document.getElementById('fecha-rep-agrup');
if (fechaRepAgrupEl) {
  fechaRepAgrupEl.value = hoy;
  fechaRepAgrupEl.defaultValue = hoy;
}
const fechaRepUnaAgrupEl = document.getElementById('fecha-rep-una-agrup');
if (fechaRepUnaAgrupEl) {
  fechaRepUnaAgrupEl.value = hoy;
  fechaRepUnaAgrupEl.defaultValue = hoy;
}
// ── NAVEGACIÓN ────────────────────────────────────────────────────────────────
function irVista(nombre, btn) {
  document.querySelectorAll('.vista').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const vista = document.getElementById('vista-' + nombre);
  if (!vista) return;
  vista.classList.add('active');
  if (btn) btn.classList.add('active');
  const titulos = { historial:'Historial', inventario:'Inventario', clientes:'Clientes', reportes:'Reportes' };
  document.getElementById('pg-title').textContent = titulos[nombre] || nombre;
  document.getElementById('pg-sub').textContent = ['historial','inventario'].includes(nombre) ? labelFecha(document.getElementById('fecha-global').value) : '';
  const fg = document.getElementById('fecha-global');
  const ba = document.getElementById('btn-actualizar');
  const kpiTop = document.querySelector('.kpi-top');
  if (fg) fg.style.display = '';
  if (ba) ba.style.display = '';
  if (kpiTop) kpiTop.style.display = '';
  if (nombre === 'inventario') renderInventario();
  if (nombre === 'reportes') {
    renderTablaAgrupacionesReportes(datosGlobal);
    renderResumenControlDia(datosGlobal);
  }
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
}

// ── FETCH ─────────────────────────────────────────────────────────────────────
async function fetchPorFecha(fecha) {
  const url = fecha ? `${API_URL}?fecha=${fecha}` : API_URL;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchSalidas() {
  try {
    const res = await fetch(SALIDAS_URL);
    if (!res.ok) return [];
    const data = await res.json();
    return normalizarListaSalidas(data);
  } catch {
    return [];
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

async function fetchObservacionesPorFecha(fecha) {
  try {
    const res = await fetch(`${API_URL}/observaciones?fecha=${encodeURIComponent(fecha)}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function snapshotPendientes(datos, salidas) {
  const idsDesp = new Set((salidas || []).map(s => normalizarIdProducto(s.id_producto)));
  const lib = (datos || [])
    .filter(esVistaHistorialLibrillos)
    .filter(d => !idsDesp.has(normalizarIdProducto(d.id_producto)))
    .map(d => `L:${d.id_producto}||${String(d.observacion || '').trim()}||${d.cliente_destino || ''}`)
    .sort()
    .join('##');
  const crud = (datos || [])
    .filter(esVistaHistorialCrudasSolo)
    .filter(d => !idsDesp.has(normalizarIdProducto(d.id_producto)))
    .map(d => `C:${d.id_producto}||${String(d.observacion || '').trim()}`)
    .sort()
    .join('##');
  return `${lib}##${crud}`;
}

async function refrescarInventarioSiCambio() {
  const inventarioActiva = document.getElementById('vista-inventario')?.classList.contains('active');
  if (!inventarioActiva || document.hidden) return;
  const fecha = document.getElementById('fecha-global')?.value || hoyISO();
  try {
    const [datosFresh, salidasFresh] = await Promise.all([
      fetchPorFecha(fecha),
      fetchSalidas(),
    ]);
    const snapNuevo = snapshotPendientes(datosFresh, salidasFresh);
    if (_autoInvSnapshot && snapNuevo !== _autoInvSnapshot) {
      datosGlobal = datosFresh;
      datosClientes = datosFresh;
      salidasRegistradas = salidasFresh;
      separarDatos(datosFresh);
      seleccionados.clear();
      seleccionadosCrud.clear();
      renderInventario();
      actualizarPanelCuadre();
      mostrarToast('Inventario actualizado por cambios recientes en observación/salida.', 'ok');
    }
    _autoInvSnapshot = snapNuevo;
  } catch {
    // silencioso
  }
}

function iniciarAutoRefreshInventario() {
  if (_autoInvTimer) return;
  _autoInvTimer = setInterval(refrescarInventarioSiCambio, 30000);
}

async function refrescarGlobal() {
  if (document.hidden) return;
  const fecha = document.getElementById('fecha-global')?.value || hoyISO();
  try {
    const [datos, salidas] = await Promise.all([
      fetchPorFecha(fecha),
      fetchSalidas(),
    ]);
    datosGlobal = datos;
    datosClientes = datos;
    salidasRegistradas = salidas;
    separarDatos(datos);
    actualizarEstado(true);
    actualizarKPIsTop();
    renderHistorialLib(datosLibrillos);
    renderHistorialCrudas(datosCrudasHist);
    renderTablaClientes(datosClientes);
    renderInventario();
    renderTablaAgrupacionesReportes(datosGlobal);
    renderResumenControlDia(datosGlobal);
    actualizarPanelCuadre();
    poblarSelectReporteCliente(datos);
  } catch {
    // silencioso: conservar último estado visible
  }
}

function iniciarAutoRefreshGlobal() {
  if (_autoGlobalTimer) return;
  _autoGlobalTimer = setInterval(refrescarGlobal, 30000);
}

function poblarSelectReporteCliente(lista = datosGlobal) {
  const sel = document.getElementById('sel-rep-cliente');
  if (!sel) return;
  const prev = sel.value || '';
  const clientes = [...new Set((lista || []).map(d => String(d.cliente_destino || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  sel.innerHTML = '<option value="">Todos los clientes</option>' +
    clientes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (prev && clientes.includes(prev)) sel.value = prev;
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
  const fechas = rangoFechasISO(desde, hasta);
  const chunks = await Promise.all(fechas.map(f => fetchPorFecha(f).catch(() => [])));
  const all = chunks.flat();
  const m = new Map();
  all.forEach(d => {
    const k = `${String(d.id_producto || '')}|${String(d.fecha || '')}`;
    if (!m.has(k)) m.set(k, d);
  });
  return [...m.values()];
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
    otros: 'Otros',
    sin_destino: 'Sin destino (retiro)',
  };

  const m = new Map();
  orden.forEach(k => m.set(k, { codigo: k, etiqueta: etiquetas[k], total: 0 }));

  (lista || []).forEach(d => {
    if (!esVistaHistorialLibrillos(d)) return;
    const c = String(d?.agrupacion_codigo || 'otros').trim() || 'otros';
    if (!m.has(c)) m.set(c, { codigo: c, etiqueta: String(d?.agrupacion || c), total: 0 });
    m.get(c).total += 1;
  });

  const base = orden.map(k => m.get(k)).filter(Boolean);
  const extras = [...m.values()]
    .filter(x => !orden.includes(x.codigo))
    .sort((a, b) => String(a.etiqueta || '').localeCompare(String(b.etiqueta || ''), 'es'));
  return [...base, ...extras].filter(x => x.total > 0);
}

function renderTablaAgrupacionesReportes(lista = datosGlobal) {
  const tb = document.getElementById('tbody-rep-agrup');
  const lbl = document.getElementById('rep-agrup-total');
  if (!tb) return;
  const rows = resumenAgrupacionesClienteDestino(lista);
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  if (lbl) lbl.textContent = `${total} librillos`;
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="2" class="empty">Sin datos para agrupaciones</td></tr>';
    return;
  }
  tb.innerHTML = rows.map(r => `<tr>
      <td>${escapeHtml(r.etiqueta || r.codigo || '—')}</td>
      <td style="font-weight:700">${Number(r.total || 0)}</td>
    </tr>`).join('');
}

function renderResumenControlDia(lista = datosGlobal) {
  const tb = document.getElementById('tbody-rep-control-dia');
  const lbl = document.getElementById('rep-control-dia-total');
  if (!tb) return;

  const rowsAgr = resumenAgrupacionesClienteDestino(lista);
  const mapAgr = new Map(rowsAgr.map(r => [String(r.codigo || ''), Number(r.total || 0)]));
  const totalCrudas = (lista || []).filter(esVistaHistorialCrudasSolo).length;
  const totalCocidos = (lista || []).filter(d => {
    const c = clasificarRegistro(d || {});
    return c.viscera && !c.visceraCruda && !c.tieneRetiro;
  }).length;

  const vAsurGlo = mapAgr.get('asurcarnes_glo') || 0;
  const vAsurCol = mapAgr.get('asurcarnescol') || 0;
  const vGlobal = mapAgr.get('global_hides') || 0;
  const vAsur = mapAgr.get('asurcarnes') || 0;
  const vCat = mapAgr.get('cat') || 0;
  const vDeriv = mapAgr.get('derivados_carnicos') || 0;
  const vOtros = mapAgr.get('otros') || 0;
  const vSinDestino = mapAgr.get('sin_destino') || 0;

  const totalLibros = rowsAgr.reduce((s, r) => s + Number(r.total || 0), 0);
  const totalGeneral = totalLibros + totalCocidos;
  if (lbl) lbl.textContent = `Total: ${totalGeneral}`;

  tb.innerHTML = `
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
}

function salidaUltimaEnRango(idProducto, salidas, desde, hasta) {
  const rows = (salidas || [])
    .filter(s => s.id_producto === idProducto && s.fecha_salida)
    .filter(s => {
      const dia = diaOperacionISOFromTimestamp(s.fecha_salida);
      return dia && dia >= desde && dia <= hasta;
    })
    .sort((a, b) => new Date(b.fecha_salida) - new Date(a.fecha_salida));
  return rows[0]?.fecha_salida || null;
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

async function obtenerContextoReporteCliente() {
  const desde = document.getElementById('fecha-rep-cli-desde')?.value;
  const hasta = document.getElementById('fecha-rep-cli-hasta')?.value;
  const clienteDestino = document.getElementById('sel-rep-cliente')?.value || '';
  if (!validarRangoReportes(desde, hasta)) return null;
  const datos = await fetchDatosRango(desde, hasta);
  const filtrados = clienteDestino ? datos.filter(d => String(d.cliente_destino || '').trim() === clienteDestino) : datos;
  if (!filtrados.length) {
    mostrarToast('Sin datos para ese cliente/rango', 'err');
    return null;
  }
  const salidas = await fetchSalidas();
  const titulo = clienteDestino ? `Reporte por Cliente Destino: ${clienteDestino}` : 'Reporte por Cliente Destino';
  const etiqueta = `${labelFecha(desde)} a ${labelFecha(hasta)}`;
  return { desde, hasta, clienteDestino, filtrados, salidas, titulo, etiqueta };
}

async function generarReporteCliente() {
  const ctx = await obtenerContextoReporteCliente();
  if (!ctx) return false;
  mostrarPreview(ctx.titulo, ctx.etiqueta, ctx.hasta, ctx.filtrados, ctx.salidas, { desde: ctx.desde, hasta: ctx.hasta });
  return true;
}

async function generarReporteGeneralRango() {
  const desde = document.getElementById('fecha-rep-gen-desde')?.value;
  const hasta = document.getElementById('fecha-rep-gen-hasta')?.value;
  if (!validarRangoReportes(desde, hasta)) return;
  const datos = await fetchDatosRango(desde, hasta);
  if (!datos.length) {
    mostrarToast('Sin datos para ese rango', 'err');
    return;
  }
  const salidas = await fetchSalidas();
  const etiqueta = `${labelFecha(desde)} a ${labelFecha(hasta)}`;
  mostrarPreview('Reporte General', etiqueta, hasta, datos, salidas, { desde, hasta });
}

async function descargarPDFReporteCliente() {
  const ok = await generarReporteCliente();
  if (ok) descargarPDFReporte();
}

function descargarExcel(nombre, html) {
  const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.xls`;
  a.click();
  URL.revokeObjectURL(a.href);
  mostrarToast('Excel generado', 'ok');
}

async function descargarExcelReporteCliente() {
  const ctx = await obtenerContextoReporteCliente();
  if (!ctx) return;
  const rows = [...ctx.filtrados].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  const body = rows.map(d => {
    const salida = salidaUltimaEnRango(d.id_producto, ctx.salidas, ctx.desde, ctx.hasta);
    return `<tr>
      <td>${escapeHtml(d.id_producto || '—')}</td>
      <td>${escapeHtml(tipoOperacionTexto(d))}</td>
      <td>${escapeHtml(d.propietario || '—')}</td>
      <td>${escapeHtml(d.cliente_destino || '—')}</td>
      <td>${escapeHtml(d.sucursal || ubicacionPlaza(d) || '—')}</td>
      <td>${escapeHtml(d.empresa_destino || '—')}</td>
      <td>${escapeHtml(etiquetaAgrupacion(d))}</td>
      <td>${escapeHtml(d.observacion || '—')}</td>
      <td>${escapeHtml(formatFecha(d.fecha_ingreso_cava))}</td>
      <td>${escapeHtml(salida ? formatFecha(salida) : '—')}</td>
    </tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
    <table border="1">
      <tr><th colspan="10">COLBEEF - ${escapeHtml(ctx.titulo)}</th></tr>
      <tr><th colspan="10">Rango: ${escapeHtml(ctx.desde)} a ${escapeHtml(ctx.hasta)}</th></tr>
      <tr>
        <th>ID Lote</th><th>Tipo</th><th>Propietario</th><th>Cliente Comercial</th>
        <th>Sucursal</th><th>Empresa Destino</th><th>Agrupacion</th><th>Observacion</th>
        <th>Ingreso Cava</th><th>Salida</th>
      </tr>
      ${body}
    </table>
  </body></html>`;
  const nombre = `Reporte_Cliente_Destino_${ctx.clienteDestino ? ctx.clienteDestino.replace(/\s+/g, '_') : 'Todos'}_${ctx.desde}_a_${ctx.hasta}`;
  descargarExcel(nombre, html);
}

async function descargarPDFReporteGeneralRango() {
  await generarReporteGeneralRango();
  descargarPDFReporte();
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
    const antes = p ? String(p.observacion || '').trim() : '';
    const despues = n ? String(n.observacion || '').trim() : '';

    // Caso 1: sigue en la vista, pero cambió observación.
    if (p && n && antes !== despues) {
      cambios.push({ id, tipo: tipoRegistroNotificacion(n), antes, despues });
      return;
    }
    // Caso 2: salió de la vista actual por cambio de observación (no cuenta en librillo/cruda).
    if (p && !n) {
      const obsNueva = String(obsMapNow.get(id) || '').trim();
      const obsAnterior = String(obsMapPrev.get(id) || antes || '').trim();
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
      const obsAnterior = String(obsMapPrev.get(id) || '').trim();
      cambios.push({
        id,
        tipo: tipoRegistroNotificacion(n),
        antes: obsAnterior || '[No estaba en vista]',
        despues,
      });
    }
  });
  return cambios;
}

function mensajeCambiosObservacion(cambios) {
  if (!cambios.length) return 'Cambio detectado en observación. Datos actualizados.';
  if (cambios.length === 1) {
    const c = cambios[0];
    const a = c.antes || '—';
    const d = c.despues || '—';
    return `${c.tipo} ${c.id}: observación "${a}" -> "${d}"`;
  }
  const top = cambios
    .slice(0, 3)
    .map(c => `${c.tipo} ${c.id}`)
    .join(', ');
  const extra = cambios.length > 3 ? ` y ${cambios.length - 3} más` : '';
  return `Cambios en observación: ${top}${extra}`;
}

function registrarCambiosObservacion(cambios) {
  if (!cambios?.length) return;
  const ahora = new Date().toISOString();
  const nuevos = cambios.map(c => ({ ...c, detectado_en: ahora }));
  historialCambiosObs = [...nuevos, ...historialCambiosObs].slice(0, 300);
  return nuevos;
}

function abrirModalCambiosObs(cambios = null) {
  const modal = document.getElementById('modal-cambios-obs');
  const tbody = document.getElementById('tbody-cambios-obs');
  if (!modal || !tbody) return;
  const lista = Array.isArray(cambios) && cambios.length ? cambios : historialCambiosObs;
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Sin cambios detectados</td></tr>';
    modal.classList.add('open');
    return;
  }
  tbody.innerHTML = lista.map(c => {
    const hora = c.detectado_en ? formatFecha(c.detectado_en) : '—';
    const antes = c.antes && c.antes.trim() ? c.antes : '—';
    const despues = c.despues && c.despues.trim() ? c.despues : '—';
    return `<tr>
      <td style="font-size:12px">${escapeHtml(hora)}</td>
      <td>${escapeHtml(c.tipo || 'REGISTRO')}</td>
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(c.id || '—')}</td>
      <td style="font-size:12px">${escapeHtml(antes)}</td>
      <td style="font-size:12px">${escapeHtml(despues)}</td>
    </tr>`;
  }).join('');
  modal.classList.add('open');
}

function cerrarModalCambiosObs() {
  document.getElementById('modal-cambios-obs')?.classList.remove('open');
}

function irHistorialYMostrarCambios(cambios) {
  const btnHistorial = document.querySelector('.nav-item[onclick*="historial"]');
  irVista('historial', btnHistorial || null);
  abrirModalCambiosObs(cambios);
}

async function refrescarSiCambioObservacion() {
  if (document.hidden) return;
  const fecha = document.getElementById('fecha-global')?.value || hoyISO();
  try {
    const [datosFresh, obsDia] = await Promise.all([
      fetchPorFecha(fecha),
      fetchObservacionesPorFecha(fecha),
    ]);
    const obsMapNow = new Map((obsDia || []).map(x => [String(x.id_producto), String(x.observacion_actual || '').trim()]));
    const snapNuevo = snapshotObservaciones(datosFresh);
    if (_autoObsSnapshot && snapNuevo !== _autoObsSnapshot) {
      const cambios = obtenerCambiosObservacion(datosGlobal, datosFresh, _obsTextoMapPrev, obsMapNow);
      const salidasFresh = await fetchSalidas();
      datosGlobal = datosFresh;
      datosClientes = datosFresh;
      salidasRegistradas = salidasFresh;
      separarDatos(datosFresh);
      renderHistorialLib(datosLibrillos);
      renderHistorialCrudas(datosCrudasHist);
      renderTablaClientes(datosClientes);
      renderInventario();
      actualizarKPIsTop();
      actualizarPanelCuadre();
      beepNotif();
      const cambiosRegistrados = registrarCambiosObservacion(cambios) || [];
      mostrarToast(`${mensajeCambiosObservacion(cambiosRegistrados)} · Clic para ver detalle`, 'ok', {
        durationMs: 20000,
        onClick: () => irHistorialYMostrarCambios(cambiosRegistrados),
      });
    }
    _autoObsSnapshot = snapNuevo;
    _obsTextoMapPrev = obsMapNow;
  } catch {
    // silencioso
  }
}

function iniciarWatchObservaciones() {
  if (_autoObsTimer) return;
  _autoObsTimer = setInterval(refrescarSiCambioObservacion, 10000);
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
  datosLibrillos = datos.filter(esVistaHistorialLibrillos);
  datosCrudasHist = datos.filter(esVistaHistorialCrudasSolo);
  poblarFiltroAgrupaciones();
}

// ── CAMBIAR FECHA ─────────────────────────────────────────────────────────────
async function cambiarFecha() {
  const fecha = document.getElementById('fecha-global').value;
  document.getElementById('pg-sub').textContent = labelFecha(fecha);
  try {
    const [datos, salidas] = await Promise.all([
      fetchPorFecha(fecha),
      fetch(SALIDAS_URL).then(r => r.json()).catch(() => []),
    ]);
    datosGlobal = datos;
    datosClientes = datos;
    salidasRegistradas = normalizarListaSalidas(salidas);
    separarDatos(datosGlobal);
    actualizarEstado(true);
    actualizarKPIsTop();
    renderHistorialLib(datosLibrillos);
    renderHistorialCrudas(datosCrudasHist);
    renderTablaClientes(datosClientes);
    renderInventario();
    renderTablaAgrupacionesReportes(datosGlobal);
    renderResumenControlDia(datosGlobal);
    actualizarPanelCuadre();
    poblarSelectReporteCliente(datosGlobal);
  } catch(e) { actualizarEstado(false); }
}

// ── CARGAR DATOS ──────────────────────────────────────────────────────────────
async function cargarDatos() {
  try {
    const fecha = document.getElementById('fecha-global').value;
    const [datos, salidas] = await Promise.all([
      fetchPorFecha(fecha),
      fetch(SALIDAS_URL).then(r => r.json()).catch(() => []),
    ]);
    datosGlobal    = datos;
    datosClientes  = datos;
    salidasRegistradas = normalizarListaSalidas(salidas);
    separarDatos(datos);
    actualizarEstado(true);
    actualizarKPIsTop();
    renderHistorialLib(datosLibrillos);
    renderHistorialCrudas(datosCrudasHist);
    renderTablaClientes(datosClientes);
    renderInventario();
    renderTablaAgrupacionesReportes(datosGlobal);
    renderResumenControlDia(datosGlobal);
    actualizarPanelCuadre();
    poblarSelectReporteCliente(datos);
  } catch(e) {
    console.error('Error:', e);
    actualizarEstado(false);
  }
}

function actualizarEstado(ok) {
  document.getElementById('conn-dot').className = 'conn-dot ' + (ok ? 'ok' : 'err');
  document.getElementById('conn-txt').textContent = ok ? 'Conectado' : 'Sin conexión';
  document.getElementById('last-upd').textContent = 'Act: ' + new Date().toLocaleTimeString('es-CO');
}

/** Cuadre del día: API validación (trazabilidad + pendientes de despacho). */
async function actualizarPanelCuadre() {
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

// ── KPIs TOP GLOBALES ─────────────────────────────────────────────────────────
function actualizarKPIsTop() {
  const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
  const salidasDia = salidasRegistradas.filter(s =>
    diaOperacionISOFromTimestamp(s.fecha_salida) === fechaSel
  );
  const idsLibDesp = new Set();
  const idsCrudDesp = new Set();
  salidasDia.forEach(s => {
    const d = datosGlobal.find(x => x.id_producto === s.id_producto);
    if (!d) return;
    if (esVistaHistorialLibrillos(d)) idsLibDesp.add(s.id_producto);
    if (esVistaHistorialCrudasSolo(d)) idsCrudDesp.add(s.id_producto);
  });
  const libSalieron = idsLibDesp.size;

  const crudSalieron = idsCrudDesp.size;
  const total = libSalieron + crudSalieron;

  const elLib = document.getElementById('kt-librillos');
  const elCrud = document.getElementById('kt-crudas');
  const elTot = document.getElementById('kt-total');
  if (elLib) elLib.textContent = libSalieron;
  if (elCrud) elCrud.textContent = crudSalieron;
  if (elTot) elTot.textContent = total;
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
  const salidasDia = salidasRegistradas.filter(s => diaOperacionISOFromTimestamp(s.fecha_salida) === fechaSel);
  const byId = new Map((datosGlobal || []).map(d => [String(d.id_producto), d]));

  const libs = (datosGlobal || []).filter(esLibrilloParaReporteAgrupacion);
  const topAgrup = topConteoPor(libs, d => etiquetaAgrupacion(d), 8);

  const libsDesp = salidasDia
    .map(s => byId.get(String(s.id_producto)))
    .filter(Boolean)
    .filter(esVistaHistorialLibrillos);
  const crudDesp = salidasDia
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

function poblarFiltroAgrupaciones() {
  const sel = document.getElementById('filtro-agrup-hlib');
  if (!sel) return;
  const prev = sel.value;
  const set = new Set();
  (datosLibrillos || []).filter(esVistaHistorialLibrillos).forEach(d => {
    set.add(etiquetaAgrupacion(d));
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

function clasificarRegistro(d) {
  const obsRaw = String(d?.observacion || '').trim();
  const obs = normalizarObs(obsRaw);
  const vacia = obs === '';
  const tieneRetiro = !!(d?.cliente_destino && String(d.cliente_destino).trim()) || /RETIRAR\s+LIBRILLOS\b/.test(obs);
  const tieneCrudas = /\bCRUDAS?\b/.test(obs);
  const tieneAcond = /\bACONDICIONAMIENTO\b/.test(obs);

  // Reglas de clasificación por observación (vistas historial):
  // - Un registro puede aplicar a LIBRILLO y/o VISCERA.
  // - El usuario lo verá en su tabla correspondiente (sin mostrar “MIXTO” en badges).
  const casoVacia = vacia;
  const casoSoloCrudas = tieneCrudas && !tieneRetiro;       // víscera cruda
  const casoSoloRetiro = tieneRetiro && !tieneCrudas;       // librillo crudo
  const casoCrudasMasRetiro = tieneCrudas && tieneRetiro;    // librillo crudo + víscera cruda
  const casoAcond = tieneAcond && !tieneRetiro;              // víscera completa

  const librillo = casoSoloRetiro || casoCrudasMasRetiro;
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

/** Historial — Crudas: observación únicamente CRUDAS/CRUDA (sin retiro de librillos). */
function esVistaHistorialCrudasSolo(d) {
  const c = clasificarRegistro(d);
  if (c.tieneRetiro) return false;
  const obs = normalizarObs(String(d?.observacion || ''));
  return /\bCRUDAS?\b/.test(obs);
}

/**
 * Librillos que entran en reportes por agrupación (resumen): retiro con cliente parseado,
 * agrupación distinta de Otros / Sin destino, y fila en vw_pbi01 (propietario + plaza).
 */
function esLibrilloParaReporteAgrupacion(d) {
  if (!esVistaHistorialLibrillos(d)) return false;
  if (!d.cliente_destino || !String(d.cliente_destino).trim()) return false;
  const cod = String(d.agrupacion_codigo || '');
  if (cod === 'sin_destino' || cod === 'otros') return false;
  if (d.enriquecido !== true) return false;
  return true;
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

function estilosFilaCliente(cliente) {
  const n = cliente || '—';
  const cc = colorPorClave(n);
  const cbg = fondoPorClave(n);
  const cbgH = fondoHoverPorClave(n);
  return `--cc:${cc};--cbg:${cbg};--cbg-h:${cbgH};`;
}

/** Agrupa registros en subarrays según clave */
function agruparPor(arr, keyFn) {
  const m = {};
  arr.forEach(d => {
    const k = keyFn(d);
    if (!m[k]) m[k] = [];
    m[k].push(d);
  });
  return Object.values(m);
}

/** Misma agrupación con IDs ordenados (estable en tablas) */
function agruparPorOrdenado(arr, keyFn) {
  return agruparPor(arr, keyFn).map(g =>
    [...g].sort((a, b) => {
      const ida = a.id_producto ?? a.d?.id_producto ?? '';
      const idb = b.id_producto ?? b.d?.id_producto ?? '';
      return String(ida).localeCompare(String(idb), undefined, { numeric: true });
    })
  );
}

/** IDs en una celda: 1 tag o primer ID + “+N” con modal (mismos registros que la fila) */
function celdaIdsAgrupados(propietario, rowItems, ctx = 'auto') {
  if (!rowItems || !rowItems.length) return '—';
  const ordenados = [...rowItems].sort((a, b) => {
    const ida = a.id_producto ?? '';
    const idb = b.id_producto ?? '';
    return String(ida).localeCompare(String(idb), undefined, { numeric: true });
  });
  const escProp = (propietario || '').replace(/'/g, "\\'");
  const ids = ordenados.map(d => d.id_producto).filter(Boolean);
  const payload = JSON.stringify(ordenados).replace(/"/g, '&quot;');
  // Siempre permitir ver el detalle completo al hacer click
  if (ids.length === 1) {
    return `<span class="id-link" onclick='abrirModal("${escProp}",${payload},"${ctx}")'>${ids[0]}</span>`;
  }
  return `<span class="id-link" onclick='abrirModal("${escProp}",${payload},"${ctx}")'>${ids[0]}</span> <span class="id-more" onclick='abrirModal("${escProp}",${payload},"${ctx}")'>+${ids.length - 1}</span>`;
}

function animar(id, final) {
  const el = document.getElementById(id);
  if (!el) return;
  let n = 0;
  const step = Math.max(1, Math.ceil(final / 25));
  const t = setInterval(() => { n = Math.min(n + step, final); el.textContent = n; if (n >= final) clearInterval(t); }, 30);
}

// ── HISTORIAL LIBRILLOS ───────────────────────────────────────────────────────
function renderHistorialLib(lista) {
  const tbody = document.getElementById('tbody-hlib');
  const idsDesp = new Set((salidasRegistradas || []).map(s => String(s.id_producto)));
  const filtrada = (lista || []).filter(esVistaHistorialLibrillos).filter(d =>
    !historialSoloPendientes || !idsDesp.has(String(d.id_producto))
  );
  document.getElementById('hlib-count').textContent = filtrada.length + ' registros';
  document.getElementById('hlib-total-label').innerHTML = `Total: <strong style="color:var(--rojo)">${filtrada.length}</strong> librillos`;

  if (!filtrada.length) { tbody.innerHTML = '<tr><td colspan="11" class="empty">Sin librillos crudos para esta fecha</td></tr>'; return; }

  const sorted = [...filtrada].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  tbody.innerHTML = sorted.map(d => {
    const sal = salidaUltimaGrupo([d]);
    const prop = d.propietario || 'Sin asignar';
    return `<tr class="client-row" style="${estilosFilaCliente(d.cliente_destino || '—')}">
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto || '—')}</td>
      <td style="font-weight:600">${escapeHtml(prop)}</td>
      <td>${clienteChipHtml(d.cliente_destino || '—')}</td>
      <td><span class="b b-agru">${escapeHtml(etiquetaAgrupacion(d))}</span></td>
      <td>${badgeObs(d.observacion, d, 'librillo')}</td>
      <td>${escapeHtml(ubicacionPlaza(d))}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td style="font-size:12px">${sal ? formatFecha(sal) : '—'}</td>
      <td><span style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--rojo)">1</span></td>
    </tr>`;
  }).join('');
}

function filtrarHistorialLib() {
  const txt = document.getElementById('srch-hlib').value.toLowerCase();
  const agrSel = (document.getElementById('filtro-agrup-hlib') && document.getElementById('filtro-agrup-hlib').value) || '';
  renderHistorialLib(datosLibrillos.filter(d => {
    if (!esVistaHistorialLibrillos(d)) return false;
    const matchTxt = !txt || (
      (d.propietario||'').toLowerCase().includes(txt) ||
      (d.cliente_destino||'').toLowerCase().includes(txt) ||
      (d.observacion||'').toLowerCase().includes(txt) ||
      (d.sucursal||'').toLowerCase().includes(txt) ||
      (d.empresa_destino||'').toLowerCase().includes(txt) ||
      (etiquetaAgrupacion(d)).toLowerCase().includes(txt)
    );
    const matchAgr = !agrSel || etiquetaAgrupacion(d) === agrSel;
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
  if (tEl) tEl.innerHTML = `Total: <strong style="color:var(--verde)">${n}</strong> crudas`;

  if (!n) { tbody.innerHTML = '<tr><td colspan="9" class="empty">Sin crudas para esta fecha</td></tr>'; return; }

  const sorted = [...(lista || [])].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
  );
  tbody.innerHTML = sorted.map(d => {
    const sal = salidaUltimaGrupo([d]);
    return `<tr>
      <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto || '—')}</td>
      <td style="font-weight:600">${escapeHtml(d.propietario || 'Sin asignar')}</td>
      <td>${badgeObs(d.observacion, d, 'viscera')}</td>
      <td>${escapeHtml(ubicacionPlaza(d))}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td style="font-size:12px">${sal ? formatFecha(sal) : '—'}</td>
      <td><span style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--verde)">1</span></td>
    </tr>`;
  }).join('');
}

function filtrarHistorialCrud() {
  const txt = document.getElementById('srch-hcrud').value.toLowerCase();
  renderHistorialCrudas(datosCrudasHist.filter(d =>
    (d.propietario||'').toLowerCase().includes(txt) ||
    (d.destino||'').toLowerCase().includes(txt) ||
    (d.sucursal||'').toLowerCase().includes(txt) ||
    (d.empresa_destino||'').toLowerCase().includes(txt)
  ));
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
  const idsDesp = new Set((salidasRegistradas || []).map(s => String(s.id_producto)));
  let pendientes = (datosLibrillos || []).filter(d => !idsDesp.has(String(d.id_producto)));
  const el = document.getElementById('srch-inv');
  const txt = (el && el.value.toLowerCase().trim()) || '';
  if (txt) {
    pendientes = pendientes.filter(d =>
      (d.propietario || '').toLowerCase().includes(txt) ||
      (d.cliente_destino || '').toLowerCase().includes(txt) ||
      (d.sucursal || '').toLowerCase().includes(txt) ||
      (d.empresa_destino || '').toLowerCase().includes(txt) ||
      (etiquetaAgrupacion(d)).toLowerCase().includes(txt)
    );
  }
  return pendientes;
}

function obtenerPendientesInventarioCrud() {
  const idsDesp = new Set((salidasRegistradas || []).map(s => String(s.id_producto)));
  let pendientes = (datosCrudasHist || []).filter(d => !idsDesp.has(String(d.id_producto)));
  const el = document.getElementById('srch-inv-crud');
  const txt = (el && el.value.toLowerCase().trim()) || '';
  if (txt) {
    pendientes = pendientes.filter(d =>
      (d.propietario || '').toLowerCase().includes(txt) ||
      (d.sucursal || '').toLowerCase().includes(txt) ||
      (d.empresa_destino || '').toLowerCase().includes(txt)
    );
  }
  return pendientes;
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
      <td><span class="b b-agru">${escapeHtml(etiquetaAgrupacion(d))}</span></td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
      <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
      <td>${badgeObs(d.observacion, d, 'librillo')}</td>
      <td style="font-size:12px">${formatFecha(d.fecha_ingreso_cava)}</td>
      <td><span class="b b-cava">Pendiente</span></td>
      <td></td>
    </tr>`;
  }).join('');
}

function htmlFilasDespachadosHoy(despachados, modo) {
  const esCrud = modo === 'crud';
  const filtro = esCrud ? esVistaHistorialCrudasSolo : esVistaHistorialLibrillos;
  const rows = despachados
    .map(s => {
      const d = datosGlobal.find(x => x.id_producto === s.id_producto) || {};
      return { s, d };
    })
    .filter(({ d }) => filtro(d))
    .sort((a, b) => String(a.s.id_producto || '').localeCompare(String(b.s.id_producto || ''), undefined, { numeric: true }));

  const colSpan = esCrud ? 7 : 8;
  if (!rows.length) return `<tr><td colspan="${colSpan}" class="empty">Sin despachos registrados hoy</td></tr>`;

  return rows.map(({ s, d }) => {
    const prop = d.propietario || 'Sin asignar';
    const cli = d.cliente_destino || '—';
    const escF = String(s.fecha_salida || '').replace(/'/g, "\\'");
    const estilo = estilosFilaCliente(esCrud ? prop : cli);
    if (esCrud) {
      return `<tr class="client-row" style="${estilo}">
        <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(s.id_producto)}</td>
        <td style="font-size:12px">${escapeHtml(prop)}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.sucursal || '—')}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(d.empresa_destino || '—')}</td>
        <td style="font-size:12px">${formatFecha(s.fecha_salida)}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(s.registrado_por || '—')}</td>
        <td><button type="button" class="btn-edit-salida" title="Editar salida" onclick="abrirModalEditSalida('${s.id}','${s.id_producto}','${escF}')">Editar</button></td>
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
      <td><button type="button" class="btn-edit-salida" title="Editar salida" onclick="abrirModalEditSalida('${s.id}','${s.id_producto}','${escF}')">Editar</button></td>
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
      <td></td>
    </tr>`;
  }).join('');
}

function renderInventario() {
  const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
  const despachados = salidasRegistradas.filter(s =>
    diaOperacionISOFromTimestamp(s.fecha_salida) === fechaSel
  );

  const pendLib = obtenerPendientesInventario();
  const txtLib = (document.getElementById('srch-inv') && document.getElementById('srch-inv').value.toLowerCase().trim()) || '';
  const tbody = document.getElementById('tbody-inv');
  const tbodyDesp = document.getElementById('tbody-desp');
  if (tbody) {
    document.getElementById('inv-count').textContent = pendLib.length + ' pendientes';
    document.getElementById('inv-total-label').textContent = txtLib
      ? pendLib.length + ' coincidencias'
      : pendLib.length + ' pendientes de despacho';
    const vacioPend = txtLib ? 'Sin resultados' : 'Todos los librillos han sido despachados';
    tbody.innerHTML = htmlFilasPendientesInv(pendLib, vacioPend);
  }
  if (tbodyDesp) {
    const nLibDesp = despachados.filter(s => esVistaHistorialLibrillos(datosGlobal.find(x => x.id_producto === s.id_producto) || {})).length;
    document.getElementById('desp-count').textContent = nLibDesp + ' despachos';
    tbodyDesp.innerHTML = htmlFilasDespachadosHoy(despachados, 'lib');
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
    const vacioCr = txtCr ? 'Sin resultados' : 'Todas las crudas han sido despachadas';
    tbodyC.innerHTML = htmlFilasPendientesInvCrud(pendCr, vacioCr);
  }
  if (tbodyDespC) {
    const nCrDesp = despachados.filter(s => esVistaHistorialCrudasSolo(datosGlobal.find(x => x.id_producto === s.id_producto) || {})).length;
    document.getElementById('desp-crud-count').textContent = nCrDesp + ' despachos';
    tbodyDespC.innerHTML = htmlFilasDespachadosHoy(despachados, 'crud');
  }

  actualizarKPIsTop();
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
  const idsDesp = new Set((salidasFresh || []).map(s => String(s.id_producto)));
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
    if (!id || idsDesp.has(id)) return;
    if (!esVistaHistorialLibrillos(d) && !esVistaHistorialCrudasSolo(d)) return;
    const ident = String(d.identificacion || '').trim();
    if (ident && idents.has(ident)) set.add(id);
  });
  return [...set];
}

async function despacharSeleccionadosCrud() {
  if (seleccionadosCrud.size === 0) { mostrarToast('Selecciona al menos una cruda', 'err'); return; }

  const ids = Array.from(seleccionadosCrud).map(String);
  try {
    const fecha = document.getElementById('fecha-global')?.value || hoyISO();
    const [datosFresh, salidasFresh] = await Promise.all([fetchPorFecha(fecha), fetchSalidas()]);
    const idsDespFresh = new Set((salidasFresh || []).map(s => String(s.id_producto)));
    const pendientesFresh = (datosFresh || []).filter(esVistaHistorialCrudasSolo).filter(d => !idsDespFresh.has(String(d.id_producto)));
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
      body: JSON.stringify({ ids_productos: idsConRelacionados, rol: USUARIO_ACTUAL }),
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
}

async function despacharSeleccionados() {
  if (seleccionados.size === 0) { mostrarToast('Selecciona al menos un librillo', 'err'); return; }

  const ids = Array.from(seleccionados).map(String);
  try {
    // Usa estado fresco de BD para despachar lo que siga pendiente sin bloquear por cambios menores.
    const fecha = document.getElementById('fecha-global')?.value || hoyISO();
    const [datosFresh, salidasFresh] = await Promise.all([fetchPorFecha(fecha), fetchSalidas()]);
    const idsDespFresh = new Set((salidasFresh || []).map(s => String(s.id_producto)));
    const pendientesFresh = (datosFresh || []).filter(esVistaHistorialLibrillos).filter(d => !idsDespFresh.has(String(d.id_producto)));
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
      body: JSON.stringify({ ids_productos: idsConRelacionados, rol: USUARIO_ACTUAL }),
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
      body: JSON.stringify({ fecha_salida: new Date(nuevaFecha).toISOString(), rol: 'admin' }),
    });
    const data = await res.json();
    if (data.error) { alert('Error: ' + data.error); return; }
    salidasRegistradas = normalizarListaSalidas(await fetch(SALIDAS_URL).then(r => r.json()));
    cerrarModalEditSalida();
    renderInventario();
    actualizarKPIsTop();
    actualizarPanelCuadre();
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

// Eliminación deshabilitada (solo existía para admin)

// ── CLIENTES ──────────────────────────────────────────────────────────────────
function renderTablaClientes(lista) {
  const tbody = document.getElementById('tbody-cli');
  const tbodyCrud = document.getElementById('tbody-cli-crud');
  const titulo = document.getElementById('cli-title');
  const subC = document.getElementById('subtab-cli-crudas');

  let active = 'librillos';
  if (subC && subC.style.display !== 'none') active = 'crudas';

  const datos = Array.isArray(lista) ? lista : [];
  const librillos = datos.filter(esVistaHistorialLibrillos);
  const crudas = datos.filter(esVistaHistorialCrudasSolo);

  if (active === 'crudas') {
    if (titulo) titulo.textContent = 'Información — Crudas';
    document.getElementById('cli-count').textContent = crudas.length + ' registros';
    document.getElementById('cli-total-label').textContent = crudas.length + ' registros';
    if (!crudas.length) {
      if (tbodyCrud) tbodyCrud.innerHTML = '<tr><td colspan="9" class="empty">Sin registros</td></tr>';
      return;
    }
    const grupos = {};
    crudas.forEach(d => { const p = d.propietario || 'Sin asignar'; if (!grupos[p]) grupos[p] = []; grupos[p].push(d); });
    let html = '';
    Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0])).forEach(([prop, items]) => {
      const sub = agruparPorOrdenado(items, d => `${ubicacionPlaza(d)}||${d.empresa_destino || '—'}`);
      let primera = true;
      sub.forEach(sg => {
        const rep = sg[0];
        const salGrupo = salidaUltimaGrupo(sg);
        html += `<tr>
          <td style="font-weight:600">${primera ? escapeHtml(prop) : ''}</td>
          <td style="font-size:12px">${celdaIdsAgrupados(prop, sg, 'viscera')}</td>
          <td>${badgeObs(rep.observacion, rep, 'viscera')}</td>
          <td>${escapeHtml(ubicacionPlaza(rep))}</td>
          <td style="font-size:12px;color:var(--tx2)">${escapeHtml(rep.sucursal || '—')}</td>
          <td style="font-size:12px;color:var(--tx2)">${escapeHtml(rep.empresa_destino || '—')}</td>
          <td style="font-size:12px">${formatFecha(rep.fecha_ingreso_cava)}</td>
          <td style="font-size:12px">${salGrupo ? formatFecha(salGrupo) : '—'}</td>
          <td><span style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--verde)">${sg.length}</span></td>
        </tr>`;
        primera = false;
      });
      if (sub.length > 1) {
        html += `<tr style="background:var(--verde2)"><td colspan="8" style="font-size:12px;color:var(--tx2);padding-left:16px">Total ${escapeHtml(prop)}</td><td style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;color:var(--verde)">${items.length}</td></tr>`;
      }
    });
    if (tbodyCrud) tbodyCrud.innerHTML = html;
    return;
  }

  if (titulo) titulo.textContent = 'Información — Librillos';
  document.getElementById('cli-count').textContent = librillos.length + ' registros';
  document.getElementById('cli-total-label').textContent = librillos.length + ' registros';
  if (!librillos.length) { tbody.innerHTML = '<tr><td colspan="10" class="empty">Sin registros</td></tr>'; return; }

  const grupos = {};
  librillos.forEach(d => { const p = d.propietario || 'Sin asignar'; if (!grupos[p]) grupos[p] = []; grupos[p].push(d); });

  let html = '';
  Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0])).forEach(([prop, items]) => {
    html += `<tr style="background:rgba(192,57,43,0.07)">
      <td colspan="10" style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;color:var(--rojo);padding:10px 16px">
        ${escapeHtml(prop)} <span style="font-size:12px;color:var(--tx2);font-family:'Barlow',sans-serif;font-weight:400">— ${items.length} librillo${items.length !== 1 ? 's' : ''}</span>
      </td></tr>`;

    const subCru = agruparPorOrdenado(items, d => `${d.cliente_destino || '—'}||${(d.observacion || '').trim()}`);
    let primera = true;

    subCru.forEach(sg => {
      const rep = sg[0];
      html += `<tr class="client-row" style="${estilosFilaCliente(resolverCliente(rep))}">
        <td style="color:var(--tx2);font-size:12px">${primera ? escapeHtml(prop) : ''}</td>
        <td>${clienteChipHtml(resolverCliente(rep))}</td>
        <td><span class="b b-agru">${escapeHtml(etiquetaAgrupacion(rep))}</span></td>
        <td>${celdaIdsAgrupados(prop, sg, 'librillo')}</td>
        <td>${badgeObs(rep.observacion, rep, 'librillo')}</td>
        <td>${escapeHtml(ubicacionPlaza(rep))}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(rep.sucursal || '—')}</td>
        <td style="font-size:12px;color:var(--tx2)">${escapeHtml(rep.empresa_destino || '—')}</td>
        <td style="font-size:12px">${formatFecha(rep.fecha_ingreso_cava)}</td>
        <td style="font-size:12px">${formatFecha(rep.fecha_salida_cava)}</td>
      </tr>`;
      primera = false;
    });
  });
  tbody.innerHTML = html;
}

function cambiarSubtabClientes(tab) {
  const bL = document.getElementById('stab-cli-librillos');
  const bC = document.getElementById('stab-cli-crudas');
  const sL = document.getElementById('subtab-cli-librillos');
  const sC = document.getElementById('subtab-cli-crudas');
  if (bL) bL.classList.toggle('active', tab === 'librillos');
  if (bC) bC.classList.toggle('active', tab === 'crudas');
  if (sL) sL.style.display = tab === 'librillos' ? 'block' : 'none';
  if (sC) sC.style.display = tab === 'crudas' ? 'block' : 'none';
  renderTablaClientes(datosClientes);
}

function filtrarCli() {
  const txt = document.getElementById('srch-cli').value.toLowerCase();
  renderTablaClientes(datosClientes.filter(d =>
    (d.propietario||'').toLowerCase().includes(txt) ||
    (d.cliente_destino||'').toLowerCase().includes(txt) ||
    (d.observacion||'').toLowerCase().includes(txt) ||
    (d.sucursal||'').toLowerCase().includes(txt) ||
    (d.empresa_destino||'').toLowerCase().includes(txt) ||
    (etiquetaAgrupacion(d)).toLowerCase().includes(txt)
  ));
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

function salidaRegistrada(idProducto, fechaDia, salidas) {
  if (!fechaDia || !salidas || !salidas.length) return null;
  const row = salidas.find(
    x =>
      x.id_producto === idProducto &&
      x.fecha_salida &&
      diaOperacionISOFromTimestamp(x.fecha_salida) === fechaDia
  );
  return row ? row.fecha_salida : null;
}

function salidaUltimaRegistrada(idProducto) {
  const rows = (salidasRegistradas || []).filter(s => s.id_producto === idProducto && s.fecha_salida);
  if (!rows.length) return null;
  rows.sort((a, b) => new Date(b.fecha_salida) - new Date(a.fecha_salida));
  return rows[0].fecha_salida;
}

function salidaUltimaGrupo(items) {
  const fechas = (items || [])
    .map(d => salidaUltimaRegistrada(d.id_producto))
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
    const sal = salidaRegistrada(d.id_producto, fechaISO, salidas);
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
    const sal = salidaRegistrada(d.id_producto, fechaISO, salidas);
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

function kpisGeneral(datos) {
  const librillos = (datos || []).filter(esVistaHistorialLibrillos);
  const crudas = (datos || []).filter(esVistaHistorialCrudasSolo);
  const clis = new Set(librillos.map(d => d.cliente_destino).filter(Boolean));
  const propsCrud = new Set(crudas.map(d => d.propietario).filter(Boolean));
  return `<div class="rep-kpis">
    <div class="rep-kpi"><div class="rep-kpi-n">${librillos.length}</div><div class="rep-kpi-l">Librillos</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${crudas.length}</div><div class="rep-kpi-l">Crudas</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${clis.size}</div><div class="rep-kpi-l">Clientes destino</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${propsCrud.size}</div><div class="rep-kpi-l">Propietarios (crudas)</div></div>
  </div>`;
}

function cuerpoReporteGeneral(datos, fechaISO, salidas, opts = {}) {
  const t = tablaMovimientoResumenDiaHTML(datos, fechaISO, salidas, opts);
  return t || '<p style="color:var(--tx3);padding:12px">Sin datos</p>';
}

function cuerpoReporteGeneralExport(datos, fechaISO, salidas, opts = {}) {
  const t = tablaMovimientoResumenDiaHTMLExport(datos, fechaISO, salidas, opts);
  return t || '<p>Sin datos</p>';
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

/** Plaza / ubicación: prioriza `sucursal`; fallback `destino`. */
function ubicacionPlaza(d) {
  const suc = d && d.sucursal != null && String(d.sucursal).trim();
  if (suc) return suc;
  const dest = d && d.destino != null && String(d.destino).trim();
  return dest || '—';
}

/**
 * Conteo por propietario + plaza (1 fila de trazabilidad = 1 unidad).
 */
function contarPorPropietarioUbicacion(items) {
  return contarPorClientePuesto(items, d => d.propietario || 'Sin asignar', d => ubicacionPlaza(d)).map(r => ({
    propietario: r.cliente,
    ubicacion: r.puesto,
    cantidad: r.cantidad
  }));
}

/**
 * Bloque LISTA LIBRILLOS + fecha: CLIENTE/PLAZA × CANTIDAD y total general (ubicación = destino o sucursal).
 */
function htmlListaLibrillosResumenBloque(items, nombreGrupo, fechaISO) {
  const rows = contarPorPropietarioUbicacion(items || []);
  if (!rows.length) return '';
  const total = rows.reduce((s, r) => s + r.cantidad, 0);
  const color = 'var(--rojo)';
  const titulo = `LISTA LIBRILLOS ${String(nombreGrupo || '').toUpperCase()}`;
  return `
    <div class="rep-resumen-bloque">
      <div class="rep-resumen-titlebar">
        <span class="rep-resumen-bloque-tit">${escapeHtml(titulo)}</span>
        <span class="rep-resumen-bloque-fecha">${escapeHtml(formatFechaCorta(fechaISO))}</span>
      </div>
      <div class="tw rep-table-wrap">
        <table class="dt rep-resumen-pivot">
          <thead class="rep-resumen-thead"><tr>
            <th>CLIENTE / PLAZA</th>
            <th class="rep-resumen-th-num">CANTIDAD</th>
          </tr></thead>
          <tbody>
            ${htmlPivotPropietarioPlaza(rows, color)}
            <tr class="rep-resumen-total-gen">
              <td>Total general</td>
              <td class="rep-resumen-td-num">${total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="rep-resumen-nota">Fila amarilla = <strong>propietario</strong> (<code>nombre_propietario</code> en vw_pbi01). Fila azul = <strong>plaza</strong>: primero <code>destino</code>, si está vacío <code>sucursal</code>. Solo entran retiros con <strong>cliente destino parseado</strong>, agrupación distinta de Otros/Sin destino, y <strong>fila en vw_pbi01</strong> para el turno.</p>
    </div>`;
}

function htmlListaLibrillosResumenBloqueExport(items, nombreGrupo, fechaISO) {
  const rows = contarPorPropietarioUbicacion(items || []);
  if (!rows.length) return '';
  const total = rows.reduce((s, r) => s + r.cantidad, 0);
  const titulo = `LISTA LIBRILLOS ${String(nombreGrupo || '').toUpperCase()}`;
  const bodyPivot = htmlPivotPropietarioPlaza(rows, '#c0392b', { exportInline: true });
  return `
    <div style="margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:10px;margin-bottom:10px;padding:10px 12px;background:linear-gradient(90deg,#a5d6a7,#e8f5e9);border-radius:6px;border-left:4px solid #2e7d32">
        <span style="font-weight:900;color:#1a2b1e">${escapeHtml(titulo)}</span>
        <span style="font-weight:700;color:#37474f">${escapeHtml(formatFechaCorta(fechaISO))}</span>
      </div>
      <table style="width:100%;max-width:520px;border-collapse:collapse;font-size:12px;border:1px solid #9e9e9e">
        <thead><tr style="background:#9575cd;color:#fff">
          <th style="padding:10px;border:1px solid #7e57c2;text-align:left">CLIENTE / PLAZA</th>
          <th style="padding:10px;border:1px solid #7e57c2;text-align:right;width:100px">CANTIDAD</th>
        </tr></thead>
        <tbody>${bodyPivot}
        <tr style="background:#ffb6c1;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact">
          <td style="padding:10px;border:1px solid #bbb">Total general</td>
          <td style="padding:10px;border:1px solid #bbb;text-align:right">${total}</td>
        </tr>
        </tbody>
      </table>
    </div>`;
}

/** Pivote jerárquico: total por propietario (fila resaltada), desglose por plaza. */
function htmlPivotPropietarioPlaza(rows, colorTotal, opts = {}) {
  if (!rows.length) return '';
  const inline = opts.exportInline === true;
  const byProp = new Map();
  rows.forEach(r => {
    const p = r.propietario;
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
  const desde = opts?.desde || fechaISO;
  const hasta = opts?.hasta || fechaISO;
  const librIng = filtrarPorIngresoRango(datos.filter(esVistaHistorialLibrillos), desde, hasta);
  const crudIng = filtrarPorIngresoRango(datos.filter(esVistaHistorialCrudasSolo), desde, hasta);

  const any = librIng.length || crudIng.length;
  if (!any) return '';

  const pivotLib = contarPorPropietarioUbicacion(librIng);
  const pivotCrud = contarPorPropietarioUbicacion(crudIng);

  function htmlIdsLibrillos(items) {
    if (!items.length) return '';
    const sorted = [...items].sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
    return `
      <div class="mov-sec">
        <div class="mov-h">${'LISTA LIBRILLOS (procesados)'} </div>
        <div class="mov-grid">
          <table class="dt" style="font-size:12px;border:1px solid var(--brd2);border-collapse:collapse">
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
                const sal = salidaUltimaEnRango(d.id_producto, salidas, desde, hasta);
                return `<tr>
                  <td style="border:1px solid var(--brd2);padding:8px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.propietario || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(ubicacionPlaza(d))}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.cliente_destino || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.sucursal || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.empresa_destino || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${formatFecha(d.fecha_ingreso_cava)}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${sal ? formatFecha(sal) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>

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
                  ${htmlPivotPropietarioPlaza(pivotLib, 'var(--rojo)')}
                </tbody>
              </table>
            </div>
            <div class="mov-pivot-total" style="margin-top:6px;font-weight:800;color:#8b0000;text-align:right">Total general: ${pivotLib.reduce((a, b) => a + b.cantidad, 0)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function htmlIdsCrudas(items) {
    if (!items.length) return '';
    const sorted = [...items].sort((a, b) => String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
    return `
      <div class="mov-sec">
        <div class="mov-h">LISTA CRUDAS (procesados)</div>
        <div class="mov-grid">
          <table class="dt" style="font-size:12px;border:1px solid var(--brd2);border-collapse:collapse">
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
                const sal = salidaUltimaEnRango(d.id_producto, salidas, desde, hasta);
                return `<tr>
                  <td style="border:1px solid var(--brd2);padding:8px;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.propietario || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(ubicacionPlaza(d))}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.sucursal || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${escapeHtml(d.empresa_destino || '—')}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${formatFecha(d.fecha_ingreso_cava)}</td>
                  <td style="border:1px solid var(--brd2);padding:8px">${sal ? formatFecha(sal) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>

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
            <div class="mov-pivot-total" style="margin-top:6px;font-weight:800;color:var(--verde);text-align:right">Total general: ${pivotCrud.reduce((a, b) => a + b.cantidad, 0)}</div>
          </div>
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
        .mov-pivot-h{font-weight:900;margin-bottom:6px}
        .mov-pivot{border-left:3px solid rgba(0,0,0,.06);padding-left:10px}
        @media print{ .mov-grid{grid-template-columns: 1fr 340px} }
        @media(max-width:1100px){ .mov-grid{grid-template-columns: 1fr} .mov-pivot{border-left:none;padding-left:0} }
      </style>
    </div>
  `;
}

function tablaMovimientoResumenDiaHTMLExport(datos, fechaISO, salidas, opts = {}) {
  // Export HTML: propietario → plaza; 1 fila de datos = 1 unidad.
  const desde = opts?.desde || fechaISO;
  const hasta = opts?.hasta || fechaISO;
  const librIng = filtrarPorIngresoRango(datos.filter(esVistaHistorialLibrillos), desde, hasta);
  const crudIng = filtrarPorIngresoRango(datos.filter(esVistaHistorialCrudasSolo), desde, hasta);
  const pivotLib = contarPorPropietarioUbicacion(librIng);
  const pivotCrud = contarPorPropietarioUbicacion(crudIng);

  const totalLib = pivotLib.reduce((a, b) => a + b.cantidad, 0);
  const totalCrud = pivotCrud.reduce((a, b) => a + b.cantidad, 0);

  function pivotTableJerarquico(rows, color) {
    if (!rows.length) return '';
    return `<table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #9e9e9e;margin:10px 0">
      <thead><tr style="background:#9575cd;color:#fff">
        <th style="padding:10px;border:1px solid #7e57c2;text-align:left">Propietario / Ubicación</th>
        <th style="padding:10px;border:1px solid #7e57c2;text-align:right;width:110px">Cantidad</th>
      </tr></thead><tbody>
      ${htmlPivotPropietarioPlaza(rows, color, { exportInline: true })}
      </tbody></table>`;
  }

  return `
    <div>
      <div style="font-weight:900;color:#8b0000;margin-top:10px">Movimiento (procesados) — ${desde} a ${hasta}</div>
      <p style="font-size:12px;color:#666;margin:8px 0">Cada fila del detalle = 1 unidad. Cantidades = conteo por propietario y ubicación (destino o sucursal).</p>
      <div style="margin-top:8px">Total Librillos: <strong>${totalLib}</strong> · Total Crudas: <strong>${totalCrud}</strong></div>

      <h3 style="color:#8b0000;margin-top:18px">Librillos (crudos)</h3>
      ${pivotTableJerarquico(pivotLib, '#8b0000')}

      <h3 style="color:#1a7a42;margin-top:18px">Crudas</h3>
      ${pivotTableJerarquico(pivotCrud, '#1a7a42')}
    </div>
  `;
}

async function generarReporteGeneral() {
  const fecha = document.getElementById('fecha-rep-gen')?.value;
  if (!fecha) {
    await generarReporteGeneralRango();
    return;
  }
  if (!fecha) { mostrarToast('Selecciona una fecha', 'err'); return; }
  const datos = await fetchPorFecha(fecha);
  if (!datos.length) { mostrarToast('No hay datos para esa fecha', 'err'); return; }
  const salidas = await fetchSalidas();
  mostrarPreview('Reporte General', labelFecha(fecha), fecha, datos, salidas);
}

function htmlReporteAgrupaciones(datos, fechaISO, salidas, opts = {}) {
  const soloResumen = opts.soloResumen === true;
  const soloEtiqueta = opts.soloEtiqueta ? String(opts.soloEtiqueta) : null;
  let libs = [...datos.filter(esLibrilloParaReporteAgrupacion)].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
  if (soloEtiqueta) {
    libs = libs.filter(d => etiquetaAgrupacion(d) === soloEtiqueta);
  }
  if (!libs.length) {
    return '<p style="color:var(--tx3);padding:12px">Sin librillos para esta fecha' +
      (soloEtiqueta ? ` en la agrupación «${escapeHtml(soloEtiqueta)}».` : '.') + '</p>';
  }

  const byGrupo = new Map();
  libs.forEach(d => {
    const g = etiquetaAgrupacion(d);
    if (!byGrupo.has(g)) byGrupo.set(g, []);
    byGrupo.get(g).push(d);
  });
  const orden = [...byGrupo.keys()].sort((a, b) => a.localeCompare(b, 'es'));

  let html = '';
  orden.forEach(grupo => {
    const items = byGrupo.get(grupo);
    html += htmlListaLibrillosResumenBloque(items, grupo, fechaISO);
    if (soloResumen) return;

    const conSalida = items.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas)).length;
    html += `<h3 class="rep-sec-title">${escapeHtml(grupo)} — ${items.length} unidad(es) · ${conSalida} con salida registrada <span style="font-size:12px;font-weight:500;color:var(--tx3)">(detalle)</span></h3>`;
    html += `<div class="tw rep-table-wrap"><table class="dt" style="font-size:12px"><thead><tr>
      <th>ID Producto</th><th>Propietario</th><th>Cliente destino</th><th>Sucursal / Plaza</th><th>Empresa destino</th><th>Ingreso Cava</th><th>Salida despacho</th>
    </tr></thead><tbody>`;
    items.forEach(d => {
      const sal = salidaRegistrada(d.id_producto, fechaISO, salidas);
      html += `<tr>
        <td style="font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--rojo)">${escapeHtml(d.id_producto)}</td>
        <td>${escapeHtml(d.propietario) || '—'}</td>
        <td>${escapeHtml(d.cliente_destino) || '—'}</td>
        <td>${escapeHtml(ubicacionPlaza(d))}</td>
        <td>${escapeHtml(d.empresa_destino) || '—'}</td>
        <td>${formatFecha(d.fecha_ingreso_cava)}</td>
        <td>${sal ? formatFecha(sal) : '—'}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  });
  if (soloResumen && orden.length) {
    const total = libs.length;
    const nSal = libs.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas)).length;
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
  const soloEtiqueta = opts.soloEtiqueta ? String(opts.soloEtiqueta) : null;
  let libs = [...datos.filter(esLibrilloParaReporteAgrupacion)].sort((a, b) =>
    String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true }));
  if (soloEtiqueta) {
    libs = libs.filter(d => etiquetaAgrupacion(d) === soloEtiqueta);
  }
  if (!libs.length) {
    return '<p>Sin librillos para esta fecha' + (soloEtiqueta ? ` en «${escapeHtml(soloEtiqueta)}».` : '.') + '</p>';
  }

  const byGrupo = new Map();
  libs.forEach(d => {
    const g = etiquetaAgrupacion(d);
    if (!byGrupo.has(g)) byGrupo.set(g, []);
    byGrupo.get(g).push(d);
  });
  const orden = [...byGrupo.keys()].sort((a, b) => a.localeCompare(b, 'es'));

  let html = '';
  orden.forEach(grupo => {
    const items = byGrupo.get(grupo);
    html += htmlListaLibrillosResumenBloqueExport(items, grupo, fechaISO);
    if (soloResumen) return;

    const conSalida = items.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas)).length;
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
      const sal = salidaRegistrada(d.id_producto, fechaISO, salidas);
      html += `<tr>
        <td style="padding:8px;border:1px solid #ccc;font-weight:700;color:#8b0000">${escapeHtml(d.id_producto)}</td>
        <td style="padding:8px;border:1px solid #ccc">${escapeHtml(d.propietario) || '—'}</td>
        <td style="padding:8px;border:1px solid #ccc">${escapeHtml(d.cliente_destino) || '—'}</td>
        <td style="padding:8px;border:1px solid #ccc">${escapeHtml(ubicacionPlaza(d))}</td>
        <td style="padding:8px;border:1px solid #ccc">${escapeHtml(d.empresa_destino) || '—'}</td>
        <td style="padding:8px;border:1px solid #ccc">${formatFecha(d.fecha_ingreso_cava)}</td>
        <td style="padding:8px;border:1px solid #ccc">${sal ? formatFecha(sal) : '—'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  });
  if (soloResumen && orden.length) {
    const total = libs.length;
    const nSal = libs.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas)).length;
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
    libs = libs.filter(d => etiquetaAgrupacion(d) === t);
  }
  const total = libs.length;
  const conSalida = libs.filter(d => salidaRegistrada(d.id_producto, fechaISO, salidas)).length;
  const grupos = new Set(libs.map(d => etiquetaAgrupacion(d))).size;
  const lblLib = kopts.soloEtiqueta ? 'En esta agrupación' : 'Librillos totales';
  const lblGr = kopts.soloEtiqueta ? 'Bloque' : 'Agrupaciones';
  const nGr = kopts.soloEtiqueta ? 1 : grupos;
  return `<div class="rep-kpis">
    <div class="rep-kpi"><div class="rep-kpi-n">${total}</div><div class="rep-kpi-l">${lblLib}</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${conSalida}</div><div class="rep-kpi-l">Con salida registrada</div></div>
    <div class="rep-kpi"><div class="rep-kpi-n">${nGr}</div><div class="rep-kpi-l">${lblGr}</div></div>
  </div>`;
}

function nombreArchivoAgrupacion(etiqueta) {
  return String(etiqueta || 'agrupacion')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'agrupacion';
}

async function cargarSelectAgrupacionesUna() {
  const fecha = document.getElementById('fecha-rep-una-agrup')?.value;
  const sel = document.getElementById('sel-reporte-una-agrup');
  if (!fecha) { mostrarToast('Selecciona una fecha', 'err'); return; }
  if (!sel) return;
  sel.innerHTML = '<option value="">Cargando…</option>';
  try {
    const datos = await fetchPorFecha(fecha);
    const libs = datos.filter(esLibrilloParaReporteAgrupacion);
    const set = new Set(libs.map(d => etiquetaAgrupacion(d)));
    const orden = [...set].sort((a, b) => a.localeCompare(b, 'es'));
    if (!orden.length) {
      sel.innerHTML = '<option value="">Sin datos para reporte por agrupación</option>';
      mostrarToast('No hay librillos con vista y cliente destino para este reporte', 'err');
      return;
    }
    sel.innerHTML = '<option value="">— Elige agrupación (según observación / destino) —</option>' +
      orden.map(e => {
        const v = String(e).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `<option value="${v}">${escapeHtml(e)}</option>`;
      }).join('');
    mostrarToast(`${orden.length} agrupación(es) cargadas`, 'ok');
  } catch {
    sel.innerHTML = '<option value="">Error al cargar</option>';
    mostrarToast('Error al cargar datos', 'err');
  }
}

/** Una sola agrupación; mode === 'detalle' incluye tabla por ID */
async function generarReporteUnaAgrupacion(mode) {
  const soloResumen = mode !== 'detalle';
  const fecha = document.getElementById('fecha-rep-una-agrup')?.value;
  const sel = document.getElementById('sel-reporte-una-agrup');
  const etiqueta = sel?.value;
  if (!fecha) { mostrarToast('Selecciona una fecha', 'err'); return; }
  if (!etiqueta) { mostrarToast('Carga el listado y elige una agrupación', 'err'); return; }
  const datos = await fetchPorFecha(fecha);
  const libs = datos.filter(esLibrilloParaReporteAgrupacion).filter(d => etiquetaAgrupacion(d) === etiqueta);
  if (!libs.length) { mostrarToast('Sin datos para esa agrupación y fecha', 'err'); return; }
  const salidas = await fetchSalidas();
  const prev = document.getElementById('rep-preview');
  const kopts = { soloEtiqueta: etiqueta };
  const ropts = { soloResumen, soloEtiqueta: etiqueta };
  document.getElementById('rep-prev-title').textContent = soloResumen
    ? `Agrupación: ${etiqueta}`
    : `Agrupación: ${etiqueta} (detalle)`;
  prev.style.display = 'block';
  const sub = soloResumen
    ? etiqueta
    : `${etiqueta} — con tabla por ID`;
  document.getElementById('rep-prev-body').innerHTML = `
    <div class="rep-agrup-layout">
    <div class="rep-header"><div><div class="rep-co">COLBEEF</div><div class="rep-sub-title">${escapeHtml(sub)}</div></div><div class="rep-meta"><div>${labelFecha(fecha)}</div><div>Generado: ${new Date().toLocaleString('es-CO')}</div></div></div>
    ${kpisAgrupacionesResumen(datos, fecha, salidas, kopts)}
    ${htmlReporteAgrupaciones(datos, fecha, salidas, ropts)}
    <div style="margin-top:20px;font-size:11px;color:var(--tx3);text-align:center;border-top:1px solid var(--brd);padding-top:12px">Colbeef — Control de movimientos · ${new Date().toLocaleDateString('es-CO')}</div>
    </div>`;
  prev.scrollIntoView({ behavior: 'smooth' });
}

async function descargarReporteUnaAgrupacion(mode) {
  const soloResumen = mode !== 'detalle';
  const fecha = document.getElementById('fecha-rep-una-agrup')?.value;
  const sel = document.getElementById('sel-reporte-una-agrup');
  const etiqueta = sel?.value;
  if (!fecha) { mostrarToast('Selecciona una fecha', 'err'); return; }
  if (!etiqueta) { mostrarToast('Carga el listado y elige una agrupación', 'err'); return; }
  const datos = await fetchPorFecha(fecha);
  const libs = datos.filter(esLibrilloParaReporteAgrupacion).filter(d => etiquetaAgrupacion(d) === etiqueta);
  if (!libs.length) { mostrarToast('Sin datos para esa agrupación', 'err'); return; }
  const salidas = await fetchSalidas();
  const ropts = { soloResumen, soloEtiqueta: etiqueta };
  const cuerpo = htmlReporteAgrupacionesExport(datos, fecha, salidas, ropts);
  const klibs = datos.filter(esLibrilloParaReporteAgrupacion).filter(d => etiquetaAgrupacion(d) === etiqueta);
  const total = klibs.length;
  const nSal = klibs.filter(d => salidaRegistrada(d.id_producto, fecha, salidas)).length;
  const kbox = 'background:#f5f5f5;border:1px solid #ccc;border-radius:8px;padding:12px 16px;text-align:center;min-width:120px';
  const kpis = `<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
    <div style="${kbox}"><div style="font-size:24px;font-weight:700;color:#8b0000">${total}</div><div style="font-size:11px;color:#666;margin-top:3px">Unidades (esta agrupación)</div></div>
    <div style="${kbox}"><div style="font-size:24px;font-weight:700;color:#8b0000">${nSal}</div><div style="font-size:11px;color:#666;margin-top:3px">Con salida registrada</div></div>
    <div style="${kbox}"><div style="font-size:24px;font-weight:700;color:#8b0000">1</div><div style="font-size:11px;color:#666;margin-top:3px">Agrupación</div></div>
  </div>`;
  const suf = soloResumen ? '_resumen' : '_detalle';
  const slug = nombreArchivoAgrupacion(etiqueta);
  const tituloDoc = `${etiqueta} · ${soloResumen ? 'resumen' : 'detalle'}`;
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escapeHtml(etiqueta)} — ${fecha}</title><style>
body{font-family:Arial,sans-serif;margin:32px;color:#1a1a1a}h1{color:#8b0000;font-size:28px}.meta{display:flex;justify-content:space-between;margin-bottom:20px;font-size:12px;color:#666;border-bottom:2px solid #8b0000;padding-bottom:12px}.footer{margin-top:24px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:12px}</style></head><body>
  <h1>COLBEEF — ${escapeHtml(etiqueta)}</h1><div class="meta"><div><strong>${escapeHtml(tituloDoc)}</strong> · ${escapeHtml(labelFecha(fecha))}</div><div>Generado: ${new Date().toLocaleString('es-CO')}</div></div>
  ${kpis}
  ${cuerpo}
  <div class="footer">Sistema de Control de Librillos — Colbeef</div></body></html>`;
  descargarHTML(`Reporte_${slug}_${fecha}${suf}`, html);
}

/** mode: omitido = solo cuadros resumen; 'detalle' = incluye tablas por ID */
async function generarReporteAgrupaciones(mode) {
  const soloResumen = mode !== 'detalle';
  const fecha = document.getElementById('fecha-rep-agrup')?.value;
  if (!fecha) { mostrarToast('Selecciona una fecha', 'err'); return; }
  const datos = await fetchPorFecha(fecha);
  const libs = datos.filter(esLibrilloParaReporteAgrupacion);
  if (!libs.length) { mostrarToast('No hay librillos para reporte por agrupación en esa fecha', 'err'); return; }
  const salidas = await fetchSalidas();
  const prev = document.getElementById('rep-preview');
  document.getElementById('rep-prev-title').textContent = soloResumen
    ? 'Reporte por agrupación'
    : 'Reporte por agrupación (con detalle)';
  prev.style.display = 'block';
  const sub = soloResumen
    ? 'Cuadros por agrupación y totales'
    : 'Cuadros resumen + tabla por producto';
  document.getElementById('rep-prev-body').innerHTML = `
    <div class="rep-agrup-layout">
    <div class="rep-header"><div><div class="rep-co">COLBEEF</div><div class="rep-sub-title">${escapeHtml(sub)}</div></div><div class="rep-meta"><div>${labelFecha(fecha)}</div><div>Generado: ${new Date().toLocaleString('es-CO')}</div></div></div>
    ${kpisAgrupacionesResumen(datos, fecha, salidas)}
    ${htmlReporteAgrupaciones(datos, fecha, salidas, { soloResumen })}
    <div style="margin-top:20px;font-size:11px;color:var(--tx3);text-align:center;border-top:1px solid var(--brd);padding-top:12px">Colbeef — Control de movimientos · ${new Date().toLocaleDateString('es-CO')}</div>
    </div>`;
  prev.scrollIntoView({ behavior: 'smooth' });
}

/** mode: omitido = resumen; 'detalle' = HTML con tablas completas */
async function descargarReporteAgrupaciones(mode) {
  const soloResumen = mode !== 'detalle';
  const fecha = document.getElementById('fecha-rep-agrup')?.value;
  if (!fecha) { mostrarToast('Selecciona una fecha', 'err'); return; }
  const datos = await fetchPorFecha(fecha);
  if (!datos.filter(esLibrilloParaReporteAgrupacion).length) { mostrarToast('Sin librillos para reporte por agrupación en esa fecha', 'err'); return; }
  const salidas = await fetchSalidas();
  const cuerpo = htmlReporteAgrupacionesExport(datos, fecha, salidas, { soloResumen: soloResumen });
  const libs = datos.filter(esLibrilloParaReporteAgrupacion);
  const total = libs.length;
  const nSal = libs.filter(d => salidaRegistrada(d.id_producto, fecha, salidas)).length;
  const nGrupos = new Set(libs.map(d => etiquetaAgrupacion(d))).size;
  const kbox = 'background:#f5f5f5;border:1px solid #ccc;border-radius:8px;padding:12px 16px;text-align:center;min-width:120px';
  const kpis = `<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
    <div style="${kbox}"><div style="font-size:24px;font-weight:700;color:#8b0000">${total}</div><div style="font-size:11px;color:#666;margin-top:3px">Librillos totales</div></div>
    <div style="${kbox}"><div style="font-size:24px;font-weight:700;color:#8b0000">${nSal}</div><div style="font-size:11px;color:#666;margin-top:3px">Con salida registrada</div></div>
    <div style="${kbox}"><div style="font-size:24px;font-weight:700;color:#8b0000">${nGrupos}</div><div style="font-size:11px;color:#666;margin-top:3px">Agrupaciones</div></div>
  </div>`;
  const suf = soloResumen ? '_resumen' : '';
  const tituloDoc = soloResumen ? 'Resumen por agrupación' : 'Movimientos por agrupación';
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte agrupaciones ${fecha}</title><style>
body{font-family:Arial,sans-serif;margin:32px;color:#1a1a1a}h1{color:#8b0000;font-size:28px}.meta{display:flex;justify-content:space-between;margin-bottom:20px;font-size:12px;color:#666;border-bottom:2px solid #8b0000;padding-bottom:12px}.footer{margin-top:24px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:12px}</style></head><body>
  <h1>COLBEEF — Agrupaciones</h1><div class="meta"><div><strong>${escapeHtml(tituloDoc)}</strong> · ${escapeHtml(labelFecha(fecha))}</div><div>Generado: ${new Date().toLocaleString('es-CO')}</div></div>
  ${kpis}
  ${cuerpo}
  <div class="footer">Sistema de Control de Librillos — Colbeef</div></body></html>`;
  descargarHTML(`Reporte_Agrupaciones_${fecha}${suf}`, html);
}

async function descargarReporteGeneral() {
  const fecha = document.getElementById('fecha-rep-gen')?.value;
  if (!fecha) {
    await descargarPDFReporteGeneralRango();
    return;
  }
  if (!fecha) { mostrarToast('Selecciona una fecha', 'err'); return; }
  const datos = await fetchPorFecha(fecha);
  if (!datos.length) { mostrarToast('Sin datos', 'err'); return; }
  const salidas = await fetchSalidas();
  descargarHTML(`Reporte_General_${fecha}`, generarHTMLReporte('Reporte General', labelFecha(fecha), fecha, datos, salidas));
}

function descargarHTML(nombre, html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
  mostrarToast('Reporte guardado', 'ok');
}

function generarHTMLReporte(titulo, fechaLabel, fechaISO, datos, salidas) {
  const cuerpo = cuerpoReporteGeneralExport(datos, fechaISO, salidas);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${escapeHtml(titulo)}</title><style>
body{font-family:Arial,sans-serif;margin:32px;color:#1a1a1a}h1{color:#8b0000;font-size:28px}.meta{display:flex;justify-content:space-between;margin-bottom:20px;font-size:12px;color:#666;border-bottom:2px solid #8b0000;padding-bottom:12px}.kpis{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}.kpi{background:#f5f5f5;border:1px solid #ccc;border-radius:8px;padding:12px 16px;text-align:center;flex:1;min-width:120px}.kpi-n{font-size:24px;font-weight:700;color:#8b0000}.kpi-l{font-size:11px;color:#666;margin-top:3px}.footer{margin-top:24px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:12px}</style></head><body>
  <h1>COLBEEF</h1><div class="meta"><div><strong>${escapeHtml(titulo)}</strong> · ${escapeHtml(fechaLabel)}</div><div>Generado: ${new Date().toLocaleString('es-CO')}</div></div>
  ${cuerpo}
  <div class="footer">Sistema de Control de Librillos — Colbeef · ${new Date().toLocaleDateString('es-CO')}</div></body></html>`;
}

function mostrarPreview(titulo, fechaLabel, fechaISO, datos, salidas, opts = {}) {
  const prev = document.getElementById('rep-preview');
  document.getElementById('rep-prev-title').textContent = titulo;
  prev.style.display = 'block';
  const kpis = kpisGeneral(datos);
  const cuerpo = cuerpoReporteGeneral(datos, fechaISO, salidas, opts);
  document.getElementById('rep-prev-body').innerHTML = `
    <div class="rep-header"><div><div class="rep-co">COLBEEF</div><div class="rep-sub-title">${escapeHtml(titulo)}</div></div><div class="rep-meta"><div>${fechaLabel}</div><div>Generado: ${new Date().toLocaleString('es-CO')}</div></div></div>
    ${kpis}
    ${cuerpo}
    <div style="margin-top:20px;font-size:11px;color:var(--tx3);text-align:center;border-top:1px solid var(--brd);padding-top:12px">Colbeef — Sistema de Control de Librillos · ${new Date().toLocaleDateString('es-CO')}</div>`;
  prev.scrollIntoView({ behavior: 'smooth' });
}

function imprimirReporte() {
  const el = document.getElementById('rep-prev-body');
  if (!el || !el.innerHTML.trim()) {
    mostrarToast('Genera primero una vista previa del reporte', 'err');
    return;
  }
  window.print();
}

function descargarPDFReporte() {
  const el = document.getElementById('rep-prev-body');
  if (!el || !el.innerHTML.trim()) {
    mostrarToast('Genera primero una vista previa del reporte', 'err');
    return;
  }
  const h2p = typeof html2pdf !== 'undefined' ? html2pdf : window.html2pdf;
  if (typeof h2p !== 'function') {
    mostrarToast('Usa Imprimir y elige «Guardar como PDF» en el navegador.', 'err');
    return;
  }
  const title = (document.getElementById('rep-prev-title').textContent || 'reporte').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const opt = {
    margin: 10,
    filename: `Colbeef_${title}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };
  const job = h2p().set(opt).from(el).save();
  if (job && typeof job.then === 'function') {
    job.then(() => mostrarToast('PDF generado', 'ok')).catch(() => mostrarToast('Error al generar PDF. Usa Imprimir.', 'err'));
  } else {
    mostrarToast('PDF generado', 'ok');
  }
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
  const s = salidaUltimaRegistrada(idProducto);
  if (s) return formatFecha(s);
  const ingreso = registro?.fecha_ingreso_cava;
  if (ingreso) {
    const d = new Date(ingreso);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + 1);
      return `${formatFecha(d.toISOString())} (auto +1 día)`;
    }
  }
  return 'Pendiente despacho';
}

/** Abre ventana de impresión con etiquetas (crudas): código, plaza, propietario, ingreso proceso, salida (al despachar). */
function abrirVentanaEtiquetasCrudas(crudas) {
  const sorted = [...crudas].sort((a, b) => {
    const sa = String(a.sucursal || 'ZZZ').localeCompare(String(b.sucursal || 'ZZZ'));
    if (sa !== 0) return sa;
    return String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true });
  });

  const grupos = {};
  const labelsData = [];
  let cardCounter = 0;
  sorted.forEach(d => {
    const s = (d.sucursal || 'SIN PLAZA').trim() || 'SIN PLAZA';
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
        const prop = String(d.propietario || '—').trim() || '—';
        const emp = String(d.empresa_destino || '—').trim() || '—';
        const ingreso = d.fecha_ingreso_cava ? formatFecha(d.fecha_ingreso_cava) : '—';
        const fb = d.fecha_ingreso_cava ? formatFechaSolo(diaOperacionISOFromTimestamp(d.fecha_ingreso_cava)) : '—';
        const fvIso = (() => {
          const s = salidaUltimaRegistrada(d.id_producto);
          if (s) return diaOperacionISOFromTimestamp(s);
          const fi = diaOperacionISOFromTimestamp(d.fecha_ingreso_cava);
          return fi ? sumarDiasISO(fi, 1) : null;
        })();
        const fv = fvIso ? formatFechaSolo(fvIso) : '—';
        const producto = 'chunchulla cruda';
        const qrText = [
          `Producto: ${producto}`,
          `Puesto: ${plaza}`,
          `Codigo: ${codigo}`,
        ].join('\n');
        labelsData.push({ cardId, qrText });
        return `
          <div class="lbl-card" id="${cardId}">
            <div class="lbl-row">
              <div class="lbl-left">
                <div class="lbl-k">PUESTO</div>
                <div class="lbl-code">${escapeHtml(codigo)}</div>
              </div>
              <div class="lbl-mid">
                <div class="lbl-puesto">${escapeHtml(plaza)}</div>
                <div class="lbl-qr-wrap">
                  <img class="lbl-qr-img" id="qr-${cardId}" alt="QR" />
                </div>
              </div>
              <div class="lbl-right">
                <div class="lbl-logo">Colbeef</div>
                <div class="lbl-fechas">
                  <div><strong>F.B.:</strong> ${escapeHtml(fb)}</div>
                  <div><strong>F.V.:</strong> ${escapeHtml(fv)}</div>
                </div>
                <div class="lbl-mini">COLBEEF S.A.S</div>
                <div class="lbl-mini">${escapeHtml(prop)}</div>
                <div class="lbl-mini">${escapeHtml(emp)}</div>
                <div class="lbl-mini">Ingreso: ${escapeHtml(ingreso)}</div>
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
          border:2px solid #0b1f3a;background:#fff;padding:8px 10px;box-sizing:border-box;
          width:100%;max-width:980px;min-height:190px;
          page-break-inside:avoid;break-inside:avoid;
        }
        .lbl-row{display:grid;grid-template-columns:1.2fr .8fr .95fr;gap:8px;align-items:stretch}
        .lbl-left{display:flex;flex-direction:column;justify-content:flex-start}
        .lbl-k{font-size:15px;font-weight:900;letter-spacing:.3px}
        .lbl-prod{margin-top:6px;font-size:44px;font-weight:900;line-height:1;letter-spacing:.3px}
        .lbl-code{margin-top:8px;font-size:56px;font-weight:900;line-height:1}
        .lbl-mid{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
        .lbl-puesto{font-size:64px;font-weight:900;line-height:1}
        .lbl-qr-wrap{display:flex;align-items:center;justify-content:center}
        .lbl-qr-img{width:110px;height:110px;border:1px solid #777}
        .lbl-right{display:flex;flex-direction:column;justify-content:flex-start}
        .lbl-logo{font-size:58px;font-weight:900;color:#0b8e48;line-height:.95;font-style:italic;text-align:right}
        .lbl-fechas{margin-top:8px;font-size:22px;line-height:1.3}
        .lbl-mini{margin-top:4px;font-size:11px;line-height:1.2;text-align:right}
        @media print{
          .no-print{display:none}
          .lbl-group h3{display:none}
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
                img.src = qrFallbackUrl(qrText, 110);
                return resolve();
              }
              const toDataURL = (typeof QR.toDataURL === 'function') ? QR.toDataURL : (QR.default && typeof QR.default.toDataURL === 'function' ? QR.default.toDataURL : null);
              if (toDataURL) {
                toDataURL(qrText, { errorCorrectionLevel: 'M', margin: 1, width: 112, scale: 6 }, function(err, url){
                  if (!err && url) img.src = url;
                  else img.src = qrFallbackUrl(qrText, 110);
                  resolve();
                });
                return;
              }
              const canvas = document.createElement('canvas');
              const toCanvas = (typeof QR.toCanvas === 'function') ? QR.toCanvas : (QR.default && typeof QR.default.toCanvas === 'function' ? QR.default.toCanvas : null);
              if (!toCanvas) {
                img.src = qrFallbackUrl(qrText, 110);
                return resolve();
              }
              toCanvas(canvas, qrText, { width: 112, margin: 1, errorCorrectionLevel: 'M' }, function(){
                try { img.src = canvas.toDataURL('image/png'); }
                catch (e) { img.src = qrFallbackUrl(qrText, 110); }
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
}

function imprimirEtiquetasCrudasDespachadasHoy() {
  const fechaSel = document.getElementById('fecha-global')?.value || hoyISO();
  const salidasDia = (salidasRegistradas || []).filter(
    s => diaOperacionISOFromTimestamp(s.fecha_salida) === fechaSel
  );
  const byId = new Map((datosGlobal || []).map(d => [String(d.id_producto), d]));
  const crudasDesp = salidasDia
    .map(s => byId.get(String(s.id_producto)))
    .filter(Boolean)
    .filter(esVistaHistorialCrudasSolo);

  if (!crudasDesp.length) {
    mostrarToast('No hay crudas despachadas para imprimir en la fecha seleccionada.', 'err');
    return;
  }
  abrirVentanaEtiquetasCrudas(crudasDesp);
}

// ── INICIAR ───────────────────────────────────────────────────────────────────
document.getElementById('pg-sub').textContent = labelFecha(hoy);
actualizarColumnasRol();
renderBotonSonido();
window.addEventListener('pointerdown', unlockAudio, { once: true });
cargarDatos();
iniciarAutoRefreshGlobal();
iniciarWatchObservaciones();
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) cerrarMenuMovil();
});

// Si el navegador restaura estado (bfcache), re-forzar la fecha de hoy
window.addEventListener('pageshow', () => {
  const h = hoyISO();
  const el = document.getElementById('fecha-global');
  if (el && el.value !== h) {
    el.value = h;
    el.defaultValue = h;
    el.setAttribute('value', h);
    cambiarFecha();
  }
});