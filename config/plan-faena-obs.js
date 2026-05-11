/**
 * Texto de clasificación tipo «Visceras Blancas / Rojas» del plan de faena.
 * En muchos despliegues esas columnas aún no existen en a_plan_faena_producto:
 * entonces la lista queda vacía y el programa sigue usando solo parte_producto.observaciones.
 *
 * Cuando el DBA agregue columnas (o una vista), definir en .env p.ej.:
 *   PLAN_FAENA_PFP_TEXT_COLUMNS=visceras_blancas,visceras_rojas
 */

/** @returns {string[]} identificadores SQL seguros (solo [a-z_][a-z0-9_]*) */
export function columnasTextoPlanFaenaProducto() {
  const raw = String(process.env.PLAN_FAENA_PFP_TEXT_COLUMNS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => identificadorPgSeguro(s))
    .filter(Boolean);
}

function identificadorPgSeguro(s) {
  const x = String(s).trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x)) return null;
  return x.toLowerCase();
}

/** plan_first | merge | parte_first */
export function prioridadObsPlanVsParte() {
  const v = String(process.env.PLAN_FAENA_OBS_PRIORIDAD || 'plan_first')
    .trim()
    .toLowerCase();
  if (v === 'merge' || v === 'parte_first') return v;
  return 'plan_first';
}

/** Misma familia que `retLibr` en agrupaciones: detecta instrucción de retiro en texto libre. */
function textoIndicaRetiroLibrillos(s) {
  const t = String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  return (
    /\bretirar\s+librillos\b/.test(t) ||
    /\bretirar\s+librilo\b/.test(t) ||
    /\bretirar\s+librill\b/.test(t) ||
    /\bretira\s+librillos\b/.test(t) ||
    /\bretira\s+librilo\b/.test(t) ||
    /\bretira\s+librill\b/.test(t)
  );
}

/**
 * @param {string} textoPlan
 * @param {string} obsParte
 * @returns {{ obsFuente: string, observacion_fuente: 'plan_faena'|'a_parte_producto'|'plan_faena+parte' }}
 */
export function fusionarObservacionClasificacion(textoPlan, obsParte) {
  const tp = String(textoPlan || '')
    .replace(/\s+/g, ' ')
    .trim();
  const op = String(obsParte || '')
    .replace(/\s+/g, ' ')
    .trim();
  const mode = prioridadObsPlanVsParte();

  if (mode === 'merge') {
    const merged = [tp, op].filter(Boolean).join(' ');
    let fuente = 'a_parte_producto';
    if (tp && op) fuente = 'plan_faena+parte';
    else if (tp) fuente = 'plan_faena';
    return { obsFuente: merged, observacion_fuente: fuente };
  }

  if (mode === 'parte_first') {
    if (op) return { obsFuente: op, observacion_fuente: 'a_parte_producto' };
    if (tp) return { obsFuente: tp, observacion_fuente: 'plan_faena' };
    return { obsFuente: '', observacion_fuente: 'a_parte_producto' };
  }

  // plan_first: si el plan trae texto logístico sin retiro pero el parte sí lo tiene,
  // clasificar con el parte (evita cocidos masivos cuando PLAN_FAENA_PFP_TEXT_COLUMNS rellena tp).
  if (tp && !textoIndicaRetiroLibrillos(tp) && textoIndicaRetiroLibrillos(op)) {
    return { obsFuente: op, observacion_fuente: 'a_parte_producto' };
  }

  if (tp) return { obsFuente: tp, observacion_fuente: 'plan_faena' };
  if (op) return { obsFuente: op, observacion_fuente: 'a_parte_producto' };
  return { obsFuente: '', observacion_fuente: 'a_parte_producto' };
}
