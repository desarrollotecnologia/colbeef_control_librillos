/**
 * Corrección tipográfica de observaciones comerciales.
 * Unifica typos de «RETIRAR LIBRILLOS» y destinos (Asurcarnes, CAT, etc.)
 * antes de parsear / clasificar, para no mandar retiros mal escritos a cocidos.
 */

/** Retiro con typos: RRETIRAR, RETRAR, LIBILLO, LIBRILOS, LIBRILLO, etc. */
export const RX_RETIRO_LIBRILLOS_FUZZY =
  /\br{1,3}e?t+i?r+a+r*\s+l+i+b+r?i?l+l?o*s?\b/gi;

/** Misma familia sin flag global (tests / .test). */
export const RX_RETIRO_LIBRILLOS_FUZZY_TEST =
  /\br{1,3}e?t+i?r+a+r*\s+l+i+b+r?i?l+l?o*s?\b/i;

/** Captura destino tras instrucción de retiro (tolerante a typos). */
export const RX_RETIRO_LIBRILLOS_CAPTURE =
  /\br{1,3}e?t+i?r+a+r*\s+l+i+b+r?i?l+l?o*s?\b\s*[:\-]?\s*(?:para\s+)?([A-Z0-9a-z .,_/&\-ÁÉÍÓÚÑáéíóúñ]+?)(?=\s*[\n\r\)]|\s*$)/gi;

/** Quita el bloque de retiro del texto limpio. */
export const RX_RETIRO_LIBRILLOS_STRIP =
  /\br{1,3}e?t+i?r+a+r*\s+l+i+b+r?i?l+l?o*s?\b\s*[:\-]?\s*(?:para\s+)?[^\n\r\)]*/gi;

export function normalizarBasicoObs(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Corrige la instrucción de retiro a la forma canónica «retirar librillos».
 */
export function corregirInstruccionRetiroLibrillos(texto) {
  const src = String(texto || '');
  if (!src.trim()) return src;
  return src.replace(RX_RETIRO_LIBRILLOS_FUZZY, 'RETIRAR LIBRILLOS');
}

/**
 * Corrige destinos comerciales frecuentes (typos / espacios / pegados).
 * Orden: subgrupos Asurcarnes antes del genérico.
 */
export function corregirDestinosComerciales(texto) {
  let t = String(texto || '');
  if (!t.trim()) return t;

  const reps = [
    // Asurcarnes COL / GLO primero
    [/\basu+r?\s*c+a+r+n+e+s?\s*col(?:ombia)?\b/gi, 'ASURCARNESCOL'],
    [/\basurcarnes\s*col(?:ombia)?\b/gi, 'ASURCARNESCOL'],
    [/\basu+r?\s*c+a+r+n+e+s?\s*glo\b/gi, 'ASURCARNES GLO'],
    [/\basurcarnesglo\b/gi, 'ASURCARNES GLO'],
    [/\basurcarnesolo\b/gi, 'ASURCARNES GLO'],
    // Asurcarnes genérico (asucarnes, asurcarne, asurrcarnes, asur carnes…)
    [/\basu+r?\s*c+a+r+n+e+s?\b/gi, 'ASURCARNES'],
    // Derivados
    [/\bderivad+o+s?\s+carnic+o+s?\b/gi, 'DERIVADOS CARNICOS'],
    [/\bderivad+o+s?\b/gi, 'DERIVADOS'],
    [/\bcarviscol\b/gi, 'CARVISCOL'],
    [/\bcarvicol\b/gi, 'CARVISCOL'],
    // Global Hides / Salomon (salomo, salomón…)
    [/\bglobal\s*hides?\b/gi, 'GLOBAL HIDES'],
    [/\bsalom[oó]n?\b/gi, 'SALOMON'],
    // CATTLEMENT se deja como cliente; CAT solo token corto
    [/\bcattlement\b/gi, 'CATTLEMENT'],
  ];

  for (const [rx, rep] of reps) {
    t = t.replace(rx, rep);
  }
  return t;
}

/**
 * Pipeline completo: tipografía de retiro + destinos.
 * Usar antes de parsear y clasificar.
 */
export function normalizarObservacionComercial(texto) {
  const raw = String(texto || '');
  if (!raw.trim()) return '';
  let out = corregirInstruccionRetiroLibrillos(raw);
  out = corregirDestinosComerciales(out);
  return out.replace(/\s+/g, ' ').trim();
}

export function textoIndicaRetiroLibrillosTolerante(s) {
  const t = normalizarBasicoObs(s);
  if (!t) return false;
  if (RX_RETIRO_LIBRILLOS_FUZZY_TEST.test(t)) return true;
  // Tras corrección canónica
  const corr = normalizarBasicoObs(corregirInstruccionRetiroLibrillos(s));
  return (
    /\bretirar\s+librillos\b/.test(corr) ||
    /\bretirar\s+librilo\b/.test(corr) ||
    /\bretira\s+librillos\b/.test(corr)
  );
}

/**
 * Distancia de edición (Levenshtein) para alias largos.
 */
export function distanciaEdicion(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  const n = s.length;
  const m = t.length;
  if (!n) return m;
  if (!m) return n;
  const row = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = row[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[m];
}

/**
 * ¿El texto (destino o fragmento) se parece a un alias conocido?
 * Solo alias ≥ 5 caracteres, distancia ≤ 2.
 */
export function aliasCercano(textoNorm, aliasNorm) {
  const a = String(textoNorm || '').trim();
  const b = String(aliasNorm || '').trim();
  if (!a || !b || b.length < 5) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // Comparar token principal (última palabra o todo si es corto)
  const tokens = a.split(/\s+/).filter(Boolean);
  const candidatos = tokens.length ? [a, tokens[tokens.length - 1], tokens[0]] : [a];
  const maxDist = b.length >= 10 ? 2 : 1;
  return candidatos.some((c) => {
    if (Math.abs(c.length - b.length) > maxDist) return false;
    return distanciaEdicion(c, b) <= maxDist;
  });
}
