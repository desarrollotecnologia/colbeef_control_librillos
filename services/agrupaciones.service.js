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
    /\bretirar\s+librill?os?\b\s*[:\-]?\s*(?:para\s+)?([^\n\r)]+)/i
  );
  return String(m?.[1] || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*$/, '')
    .trim();
}

/**
 * Reglas de negocio (texto completo observación / «Vísceras Blancas»), alineadas al resumen Excel:
 * 1) La marca CRUDAS se cuenta aparte (bandera), NO reemplaza la categoría comercial.
 * 2) Sub-marcas ASUR por palabras clave (CARNESCOL, GLO, ASURCARNES, CAT, DERIVADOS, GLOBAL HIDES).
 * 3) Alias del JSON sobre el texto completo (nombres persona / empresas aunque el parse de cliente falle).
 * 4) Sin RETIRAR LIBRILLOS → cocidos salvo alias ya resuelto arriba.
 * 5) Con RETIRAR → fallback por cliente_destino parseado.
 */
/** Regla operativa: no queda «sin destino» en planta; lo no clasificado va a comercial por defecto. */
function fallbackComercial(cfg) {
  return {
    codigo: cfg.fallback_comercial?.codigo || 'asurcarnes',
    etiqueta: cfg.fallback_comercial?.etiqueta || 'Asurcarnes',
  };
}

export function agrupacionDesdeObservacionCompleta(obsRaw, clienteDestinoFallback = '') {
  const cfg = cargarConfig();
  const t = normalizarClienteDestino(obsRaw);
  if (!t) {
    return fallbackComercial(cfg);
  }

  const retLibr =
    /\bretirar\s+librillos\b/.test(t) ||
    /\bretirar\s+librilo\b/.test(t) ||
    /\bretirar\s+librill\b/.test(t);

  // Prioridad "tipo macro": primero subgrupos/especiales y destinos nominales,
  // luego bucket general ASURCARNES.
  if (t.includes('asurcarnescol') || (retLibr && t.includes('asurcarnes col'))) {
    return { codigo: 'asurcarnescol', etiqueta: 'Asurcarnescol' };
  }
  if (
    t.includes('asurcarnes glo') ||
    t.includes('asurcarnesglo') ||
    t.includes('asurcarnesolo')
  ) {
    return { codigo: 'asurcarnes_glo', etiqueta: 'Asurcarnes GLO' };
  }

  if (retLibr && /retirar\s+librillos\s*[:\-]?\s*cat\b/.test(t)) {
    return { codigo: 'cat', etiqueta: 'CAT' };
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
    return { codigo: 'derivados_carnicos', etiqueta: 'Derivados cárnicos' };
  }

  if (
    t.includes('global hides') ||
    t.includes('salomon') ||
    (retLibr && /\bhides\b/.test(t))
  ) {
    return { codigo: 'global_hides', etiqueta: 'Global Hides' };
  }

  // Equivalente a lógica macro: si no hay instrucción RETIRAR LIBRILLOS,
  // no se fuerza cliente comercial por alias; se considera cocido.
  if (!retLibr) {
    return { codigo: 'cocidos', etiqueta: 'Cocidos' };
  }

  const porAliasEnTexto = resolverGrupoPorAliases(t, cfg);
  if (porAliasEnTexto) {
    return porAliasEnTexto;
  }

  // Safety net: cuando el parse previo de cliente falla, intenta extraer destino desde la observación.
  const destinoEnObs = normalizarClienteDestino(extraerDestinoDesdeObservacionNormalizada(t));
  if (destinoEnObs) {
    const porDestinoObs = resolverGrupoPorAliases(destinoEnObs, cfg);
    if (porDestinoObs) return porDestinoObs;
    if (/\basurcarnes\b/.test(destinoEnObs)) return { codigo: 'asurcarnes', etiqueta: 'Asurcarnes' };
    if (/\bcat\b/.test(destinoEnObs)) return { codigo: 'cat', etiqueta: 'CAT' };
    if (/\bderivados?\b/.test(destinoEnObs)) return { codigo: 'derivados_carnicos', etiqueta: 'Derivados cárnicos' };
    if (/\bglobal hides\b|\bsalomon\b|\bhides\b/.test(destinoEnObs)) {
      return { codigo: 'global_hides', etiqueta: 'Global Hides' };
    }
  }

  // Regla equivalente al resumen de INICIO (COUNTIF "*ASU*" menos subgrupos):
  // si sigue siendo retiro y menciona ASU, cae en ASURCARNES.
  if (/\basu\b|\basurcarnes\b/.test(t)) {
    return { codigo: 'asurcarnes', etiqueta: 'Asurcarnes' };
  }

  const porCliente = agrupacionDesdeClienteDestino(clienteDestinoFallback, cfg);
  const cod = String(porCliente?.codigo || '');
  if (cod === 'otros' || cod === 'sin_destino') {
    return fallbackComercial(cfg);
  }
  return porCliente;
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
