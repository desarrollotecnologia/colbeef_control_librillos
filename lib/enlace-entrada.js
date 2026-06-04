import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../frontend/config-ui.json'
);

const PLACEHOLDER_USUARIO = '{usuario}';

let cache = { ts: 0, data: null };

export function leerConfigUi() {
  const now = Date.now();
  if (cache.data && now - cache.ts < 5000) return cache.data;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    cache = { ts: now, data: JSON.parse(raw) };
    return cache.data;
  } catch {
    return {};
  }
}

function nombreParamUsuario(bloque) {
  const p = String(bloque?.usuarioParam || 'usuario').trim();
  return p || 'usuario';
}

/**
 * @param {object} bloque — entradaDesdeInventario | entradaReporteLibrillos
 * @param {{ usuario?: string|null, usarPlaceholder?: boolean }} [opts]
 */
export function construirEnlaceDesdeBloque(bloque, opts = {}) {
  if (!bloque || typeof bloque !== 'object') return null;

  const base = String(bloque.baseUrl || 'http://localhost:8080').replace(/\/$/, '');
  const ruta = String(bloque.ruta || '').trim();
  const paramUsuario = nombreParamUsuario(bloque);
  const usuarioExplicito = opts.usuario != null ? String(opts.usuario).trim() : '';
  const usuarioFijo = String(bloque.usuario || '').trim();
  const usarPlaceholder = opts.usarPlaceholder === true;

  let u;
  if (ruta === '/reporte-librillos' || ruta === 'reporte-librillos') {
    u = new URL(`${base}/reporte-librillos`);
  } else {
    u = new URL(`${base}/`);
    if (bloque.vista) u.searchParams.set('vista', String(bloque.vista).trim());
    if (bloque.solo === true || String(bloque.solo).trim() === '1') u.searchParams.set('solo', '1');
  }

  if (bloque.anio) u.searchParams.set('anio', String(bloque.anio).trim());
  if (bloque.mes) u.searchParams.set('mes', String(bloque.mes).trim());

  const incluirUsuario = bloque.incluirUsuario !== false;
  if (!incluirUsuario) return u.toString();

  if (usuarioExplicito) {
    u.searchParams.set(paramUsuario, usuarioExplicito);
  } else if (usuarioFijo && !usarPlaceholder) {
    u.searchParams.set(paramUsuario, usuarioFijo);
  } else if (usarPlaceholder) {
    u.searchParams.set(paramUsuario, PLACEHOLDER_USUARIO);
  }

  return u.toString();
}

/** Plantilla para que el otro programa reemplace {usuario} por el login activo. */
export function plantillaEnlaceDesdeBloque(bloque) {
  return construirEnlaceDesdeBloque(bloque, { usarPlaceholder: true });
}

/** Enlace principal desde Inventarios → vista operativa (Etiqueta cruda por defecto). */
export function construirEnlaceEntradaPrograma(cfgIn, usuario = null) {
  const cfg = cfgIn || leerConfigUi();
  const bloque = cfg?.entradaDesdeInventario;
  if (!bloque || typeof bloque !== 'object') {
    const legado = String(cfg?.linkColbeefDesdeInventario || '').trim();
    if (!legado) return null;
    if (usuario) {
      try {
        const u = new URL(legado, 'http://localhost');
        u.searchParams.set('usuario', String(usuario).trim());
        return u.toString();
      } catch {
        return legado;
      }
    }
    return legado.includes(PLACEHOLDER_USUARIO)
      ? legado
      : legado.replace(/([?&]usuario=)[^&]*/i, `$1${PLACEHOLDER_USUARIO}`);
  }
  return construirEnlaceDesdeBloque(bloque, {
    usuario,
    usarPlaceholder: !usuario,
  });
}

/** Enlace solo Rep. Librillos (sin menú lateral). No lleva usuario. */
export function construirEnlaceReporteLibrillos(cfgIn) {
  const cfg = cfgIn || leerConfigUi();
  const bloque = {
    incluirUsuario: false,
    ...(cfg?.entradaReporteLibrillos || {}),
    baseUrl:
      cfg?.entradaReporteLibrillos?.baseUrl ||
      cfg?.entradaDesdeInventario?.baseUrl ||
      'http://localhost:8080',
    ruta: '/reporte-librillos',
  };
  return construirEnlaceDesdeBloque(bloque, {});
}

function metaEnlace(bloque, url, plantilla) {
  if (bloque?.incluirUsuario === false) {
    return {
      url,
      plantilla: url,
      incluir_usuario: false,
      instruccion: 'Abrir esta URL tal cual; no requiere parámetro de usuario.',
    };
  }
  const param = nombreParamUsuario(bloque || {});
  return {
    url,
    plantilla,
    usuario_param: param,
    incluir_usuario: true,
    instruccion:
      `El otro programa debe abrir la URL agregando ${param}=LOGIN del usuario activo, ` +
      `o sustituir ${PLACEHOLDER_USUARIO} en plantilla.`,
  };
}

/**
 * @param {{ destino?: string, usuario?: string|null }} [opts]
 * destino: programa | reporte-librillos | ambos (default ambos)
 */
export function obtenerEnlacesEntradaColbeef(opts = {}) {
  const cfg = leerConfigUi();
  const destino = String(opts.destino || 'ambos').trim().toLowerCase();
  const usuario = opts.usuario != null ? String(opts.usuario).trim() : null;

  const bloquePrograma = cfg?.entradaDesdeInventario || null;
  const bloqueReporte = {
    incluirUsuario: false,
    ...(cfg?.entradaReporteLibrillos || {}),
    baseUrl:
      cfg?.entradaReporteLibrillos?.baseUrl ||
      cfg?.entradaDesdeInventario?.baseUrl,
    ruta: '/reporte-librillos',
  };

  const out = {
    linkColbeefDesdeInventario: cfg?.linkColbeefDesdeInventario || null,
  };

  if (destino === 'programa' || destino === 'ambos' || destino === 'all') {
    const url = construirEnlaceEntradaPrograma(cfg, usuario || null);
    const plantilla = plantillaEnlaceDesdeBloque(bloquePrograma) || url;
    out.programa = {
      ...metaEnlace(bloquePrograma, url, plantilla),
      config: bloquePrograma,
    };
    out.url = url;
    out.plantilla = plantilla;
  }

  if (destino === 'reporte-librillos' || destino === 'reporte' || destino === 'ambos' || destino === 'all') {
    const url = construirEnlaceReporteLibrillos(cfg);
    out.reporte_librillos = {
      ...metaEnlace(bloqueReporte, url, url),
      config: bloqueReporte,
    };
    if (destino === 'reporte-librillos' || destino === 'reporte') {
      out.url = url;
      out.plantilla = url;
    }
  }

  return out;
}

/** Compatibilidad con endpoint anterior. */
export function obtenerEnlaceEntradaColbeef(usuario = null) {
  return obtenerEnlacesEntradaColbeef({ destino: 'programa', usuario });
}
