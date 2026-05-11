import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/agrupaciones-librillos.json');

let cached = null;

function cargarConfig() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    cached = JSON.parse(raw);
  } catch {
    cached = {
      grupos: [],
      fallback_comercial: { codigo: 'asurcarnes', etiqueta: 'Asurcarnes' },
      default: { codigo: 'asurcarnes', etiqueta: 'Asurcarnes' },
      sin_destino: { codigo: 'asurcarnes', etiqueta: 'Asurcarnes' },
    };
  }
  return cached;
}

/** Normaliza texto de cliente destino para comparar alias (sin acentos, minúsculas). */
export function normalizarClienteDestino(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coincidencia por alias en un string ya normalizado (observación completa o solo cliente).
 * Prioriza alias más largos; los de ≤4 caracteres solo coinciden en igualdad exacta.
 */
function resolverGrupoPorAliases(n, cfg) {
  if (!n) return null;
  const pares = [];
  for (const g of cfg.grupos || []) {
    for (const a of g.alias || []) {
      const na = normalizarClienteDestino(a);
      if (!na) continue;
      pares.push({
        alias: na,
        len: na.length,
        codigo: g.codigo,
        etiqueta: g.etiqueta,
      });
    }
  }
  pares.sort((a, b) => b.len - a.len);
  for (const p of pares) {
    if (p.len <= 4) {
      if (n === p.alias) return { codigo: p.codigo, etiqueta: p.etiqueta };
      continue;
    }
    if (n === p.alias || n.includes(p.alias)) {
      return { codigo: p.codigo, etiqueta: p.etiqueta };
    }
  }
  return null;
}

/** Extrae texto posterior a "RETIRAR LIBRILLOS" (observación ya normalizada a minúsculas). */
function extraerDestinoDesdeObservacionNormalizada(t) {
  if (!t) return '';
  const m = t.match(
    /\bretira(?:r)?\s+librill?os?\b\s*[:\-]?\s*(?:para\s+)?([^\n\r)]+)/i
  );
  return String(m?.[1] || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*$/, '')
    .trim();
}

/** Detecta instrucción de retiro (misma familia que clasificarAgrupacionConAuditoria). */
function textoTieneRetirarLibrillos(s) {
  const x = String(s || '');
  return (
    /\bretirar\s+librillos\b/i.test(x) ||
    /\bretirar\s+librilo\b/i.test(x) ||
    /\bretirar\s+librill\b/i.test(x) ||
    /\bretira\s+librillos\b/i.test(x) ||
    /\bretira\s+librilo\b/i.test(x) ||
    /\bretira\s+librill\b/i.test(x)
  );
}

/**
 * Normalización "estilo macro" previa a clasificar:
 * - quita prefijos de turno /LxM/, /VxS/, etc.
 * - si hay paréntesis, usa tramo antes de "(" para evitar ruido de cola operativa
 * - excepción: si «RETIRAR LIBRILLOS» solo aparece **dentro** del paréntesis (p. ej. plaza + /SxD/ + `( RETIRAR … )`),
 *   se usa el texto completo sin turno para no clasificar todo como cocido.
 * - comprime espacios
 */
export function normalizarObservacionMacro(obsRaw) {
  const src = String(obsRaw || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!src) return '';
  const sinTurno = src.replace(/\/[A-Z]X[A-Z]\//gi, ' ').replace(/\s+/g, ' ').trim();
  const idxParen = sinTurno.indexOf('(');
  const base = idxParen >= 0 ? sinTurno.slice(0, idxParen).trim() : sinTurno;
  let out = base;
  if (!textoTieneRetirarLibrillos(base) && textoTieneRetirarLibrillos(sinTurno)) {
    out = sinTurno;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Clasificación comercial por texto (`clasificarAgrupacionConAuditoria`), en orden:
 * 1) Observación vacía → fallback_comercial del JSON (típ. asurcarnes).
 * 2) ASURCARNESCOL / «asurcarnes col» con retiro.
 * 3) ASURCARNES GLO / variantes.
 * 4) RETIRA(R) LIBRILLOS … CAT → cat.
 * 5) Derivados cárnicos (palabras clave + Ruth Cacua, Cacua, Carmen, Larrota, Carviscol, etc.).
 * 6) Global Hides / Salomon / hides (con retiro si aplica).
 * 7) Sin «RETIRAR LIBRILLOS» (texto no vacío) → cocidos.
 * 8) Alias del JSON sobre el texto completo.
 * 9) Destino tras «RETIRAR LIBRILLOS» extraído de la observación.
 * 10) ASU / ASURCARNES en texto con retiro.
 * 11) cliente_destino (fallback) + aliases; si no aplica → fallback_comercial.
 *
 * La marca CRUDAS en observación no cambia esta categoría; en el resumen del día se cuenta aparte.
 */
/** Regla operativa: no queda «sin destino» en planta; lo no clasificado va a comercial por defecto. */
function fallbackComercial(cfg) {
  return {
    codigo: cfg.fallback_comercial?.codigo || 'asurcarnes',
    etiqueta: cfg.fallback_comercial?.etiqueta || 'Asurcarnes',
  };
}

export function agrupacionDesdeObservacionCompleta(obsRaw, clienteDestinoFallback = '') {
  return clasificarAgrupacionConAuditoria(obsRaw, clienteDestinoFallback);
}

/**
 * Variante con metadata de regla aplicada para auditoría.
 * Mantiene la misma salida de agrupación para no romper el flujo actual.
 */
export function clasificarAgrupacionConAuditoria(obsRaw, clienteDestinoFallback = '') {
  const cfg = cargarConfig();
  const obsNorm = normalizarObservacionMacro(obsRaw);
  const t = normalizarClienteDestino(obsNorm || obsRaw);
  if (!t) {
    return { ...fallbackComercial(cfg), regla: 'fallback_obs_vacia', observacion_normalizada: obsNorm };
  }

  const retLibr =
    /\bretirar\s+librillos\b/.test(t) ||
    /\bretirar\s+librilo\b/.test(t) ||
    /\bretirar\s+librill\b/.test(t) ||
    /\bretira\s+librillos\b/.test(t) ||
    /\bretira\s+librilo\b/.test(t) ||
    /\bretira\s+librill\b/.test(t);

  // Prioridad "tipo macro": primero subgrupos/especiales y destinos nominales,
  // luego bucket general ASURCARNES.
  if (t.includes('asurcarnescol') || (retLibr && t.includes('asurcarnes col'))) {
    return { codigo: 'asurcarnescol', etiqueta: 'Asurcarnescol', regla: 'match_asurcarnescol', observacion_normalizada: obsNorm };
  }
  if (
    t.includes('asurcarnes glo') ||
    t.includes('asurcarnesglo') ||
    t.includes('asurcarnesolo')
  ) {
    return { codigo: 'asurcarnes_glo', etiqueta: 'Asurcarnes GLO', regla: 'match_asurcarnes_glo', observacion_normalizada: obsNorm };
  }

  if (/retira(?:r)?\s+librillos\s*[:\-]?\s*cat\b/.test(t)) {
    return { codigo: 'cat', etiqueta: 'CAT', regla: 'match_cat_retirar', observacion_normalizada: obsNorm };
  }

  if (
    (retLibr && /\bderivados\b/.test(t)) ||
    /\bderivados\s+carnicos\b/.test(t) ||
    /\bcarviscol\b/.test(t) ||
    /\bruth\s+cacua\b/.test(t) ||
    (retLibr && /\brut\s+cacua\b/.test(t)) ||
    (retLibr && /\bcacua\b/.test(t)) ||
    (retLibr && /\bcarmen\b/.test(t)) ||
    (retLibr && /\blarrota\s*edin(ison|son)\b/.test(t)) ||
    /\bjuan(\s+carlos)?\s+rueda\b/.test(t)
  ) {
    return { codigo: 'derivados_carnicos', etiqueta: 'Derivados cárnicos', regla: 'match_derivados_keywords', observacion_normalizada: obsNorm };
  }

  if (
    t.includes('global hides') ||
    t.includes('salomon') ||
    (retLibr && /\bhides\b/.test(t))
  ) {
    return { codigo: 'global_hides', etiqueta: 'Global Hides', regla: 'match_global_hides_keywords', observacion_normalizada: obsNorm };
  }

  // Equivalente a lógica macro: si no hay instrucción RETIRAR LIBRILLOS,
  // no se fuerza cliente comercial por alias; se considera cocido.
  if (!retLibr) {
    return { codigo: 'cocidos', etiqueta: 'Cocidos', regla: 'sin_retirar_librillos', observacion_normalizada: obsNorm };
  }

  const porAliasEnTexto = resolverGrupoPorAliases(t, cfg);
  if (porAliasEnTexto) {
    return { ...porAliasEnTexto, regla: 'alias_texto_completo', observacion_normalizada: obsNorm };
  }

  // Safety net: cuando el parse previo de cliente falla, intenta extraer destino desde la observación.
  const destinoEnObs = normalizarClienteDestino(extraerDestinoDesdeObservacionNormalizada(t));
  if (destinoEnObs) {
    const porDestinoObs = resolverGrupoPorAliases(destinoEnObs, cfg);
    if (porDestinoObs) return { ...porDestinoObs, regla: 'alias_destino_extraido', observacion_normalizada: obsNorm };
    if (/\basurcarnes\b/.test(destinoEnObs)) return { codigo: 'asurcarnes', etiqueta: 'Asurcarnes', regla: 'destino_obs_asur', observacion_normalizada: obsNorm };
    if (/\bcat\b/.test(destinoEnObs)) return { codigo: 'cat', etiqueta: 'CAT', regla: 'destino_obs_cat', observacion_normalizada: obsNorm };
    if (/\bderivados?\b/.test(destinoEnObs)) return { codigo: 'derivados_carnicos', etiqueta: 'Derivados cárnicos', regla: 'destino_obs_derivados', observacion_normalizada: obsNorm };
    if (/\bglobal hides\b|\bsalomon\b|\bhides\b/.test(destinoEnObs)) {
      return { codigo: 'global_hides', etiqueta: 'Global Hides', regla: 'destino_obs_global_hides', observacion_normalizada: obsNorm };
    }
  }

  // Regla equivalente al resumen de INICIO (COUNTIF "*ASU*" menos subgrupos):
  // si sigue siendo retiro y menciona ASU, cae en ASURCARNES.
  if (/\basu\b|\basurcarnes\b/.test(t)) {
    return { codigo: 'asurcarnes', etiqueta: 'Asurcarnes', regla: 'fallback_asu_texto', observacion_normalizada: obsNorm };
  }

  const porCliente = agrupacionDesdeClienteDestino(clienteDestinoFallback, cfg);
  const cod = String(porCliente?.codigo || '');
  if (cod === 'otros' || cod === 'sin_destino') {
    return { ...fallbackComercial(cfg), regla: 'fallback_comercial_no_cliente', observacion_normalizada: obsNorm };
  }
  return { ...porCliente, regla: 'cliente_destino_fallback', observacion_normalizada: obsNorm };
}

/**
 * Resuelve agrupación comercial a partir del texto parseado como cliente destino.
 * @param {object} [cfgIn] — config ya cargada (evita doble lectura al combinar con completa).
 */
export function agrupacionDesdeClienteDestino(clienteDestino, cfgIn) {
  const cfg = cfgIn || cargarConfig();
  const fb = () => fallbackComercial(cfg);
  const n = normalizarClienteDestino(clienteDestino);
  if (!n) {
    return fb();
  }

  const hit = resolverGrupoPorAliases(n, cfg);
  if (hit) return hit;

  return fb();
}
