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

  /**
   * `plan_first` (por defecto): antes se devolvía **solo** el texto del plan/retiro y se
   * ignoraba por completo `parte_producto.observaciones`. En operación real el retiro
   * (ASURCARNES COL, GLOBAL HIDES, etc.) vive en la parte; el plan suele traer otro texto
   * (vísceras / destino) → clasificación comercial y macro quedaban mal (mucho ASURCARNES / COCIDOS).
   * Si ambos existen, unir ambos textos para clasificar sin perder ninguna señal.
   */
  if (tp && op) {
    const a = tp.replace(/\s+/g, ' ').trim();
    const b = op.replace(/\s+/g, ' ').trim();
    if (a === b) return { obsFuente: a, observacion_fuente: 'plan_faena' };
    return {
      obsFuente: `${a} ${b}`.replace(/\s+/g, ' ').trim(),
      observacion_fuente: 'plan_faena+parte',
    };
  }
  if (tp) return { obsFuente: tp, observacion_fuente: 'plan_faena' };
  if (op) return { obsFuente: op, observacion_fuente: 'a_parte_producto' };
  return { obsFuente: '', observacion_fuente: 'a_parte_producto' };
}
