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
export function textoIndicaRetiroLibrillos(s) {
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
 * @param {string} textoPlan — texto del plan de faena (columnas PFP o Excel local)
 * @param {string} obsParte — observaciones del parte Colbeef del día
 * @param {string} [textoRetiro] — retiro desde archivo local (opcional); no debe reemplazar al plan
 * @returns {{ obsFuente: string, observacion_fuente: string }}
 */
export function fusionarObservacionClasificacion(textoPlan, obsParte, textoRetiro = '') {
  const tp = String(textoPlan || '')
    .replace(/\s+/g, ' ')
    .trim();
  const op = String(obsParte || '')
    .replace(/\s+/g, ' ')
    .trim();
  const tr = String(textoRetiro || '')
    .replace(/\s+/g, ' ')
    .trim();
  const mode = prioridadObsPlanVsParte();

  let obsFuente = '';
  let observacion_fuente = 'a_parte_producto';

  if (mode === 'merge') {
    const merged = [tp, op].filter(Boolean).join(' ');
    obsFuente = merged;
    observacion_fuente = 'a_parte_producto';
    if (tp && op) observacion_fuente = 'plan_faena+parte';
    else if (tp) observacion_fuente = 'plan_faena';
  } else if (mode === 'parte_first') {
    if (op) {
      obsFuente = op;
      observacion_fuente = 'a_parte_producto';
    } else if (tp) {
      obsFuente = tp;
      observacion_fuente = 'plan_faena';
    }
  } else {
    // plan_first: si el plan trae texto logístico sin retiro pero el parte sí lo tiene,
    // clasificar con el parte (evita cocidos masivos cuando PLAN_FAENA_PFP_TEXT_COLUMNS rellena tp).
    if (tp && !textoIndicaRetiroLibrillos(tp) && textoIndicaRetiroLibrillos(op)) {
      obsFuente = op;
      observacion_fuente = 'a_parte_producto';
    } else if (tp) {
      obsFuente = tp;
      observacion_fuente = 'plan_faena';
    } else if (op) {
      obsFuente = op;
      observacion_fuente = 'a_parte_producto';
    }
  }

  // Retiro local solo si plan+parte no trajeron instrucción RETIRAR LIBRILLOS
  if (tr) {
    if (textoIndicaRetiroLibrillos(obsFuente)) {
      return { obsFuente, observacion_fuente };
    }
    if (textoIndicaRetiroLibrillos(tr) || !obsFuente.trim()) {
      return { obsFuente: tr, observacion_fuente: 'retiro_archivo' };
    }
  }

  return { obsFuente, observacion_fuente };
}
