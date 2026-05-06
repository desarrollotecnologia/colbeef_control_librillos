/**
 * Reglas de negocio — Librillos (fuente de verdad en código, sin depender del Excel).
 *
 * Clasificación por ítem (`agrupacion_codigo`): ver `services/agrupaciones.service.js`
 * y `config/agrupaciones-librillos.json` (orden de reglas y aliases).
 *
 * Resumen del día (`obtenerResumenMacroPorFecha`):
 * - Se cuentan todos los registros del universo del día (incl. pendientes de parte).
 * - `chunchullas_crudas`: filas cuya observación contiene la marca CRUDAS (adicional).
 * - Por categoría: se incrementa según `agrupacion_codigo` de cada fila.
 *
 * Excepción opcional (solo resumen, no cambia `agrupacion` del ítem en `/api/librillos`):
 * - Si RESUMEN_RECODIFICAR_ASUR_PENDIENTE_A_COCIDOS=1 y el ítem está pendiente de
 *   registro de parte ese día y su código es `asurcarnes`, en el resumen se cuenta
 *   como `cocidos` (útil solo si operación quiere imitar un cierre manual antiguo).
 */

function envBool(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') return defaultValue;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'si', 'sí'].includes(s)) return true;
  if (['0', 'false', 'no'].includes(s)) return false;
  return defaultValue;
}

/** Por defecto false: el resumen respeta la misma agrupación que el detalle. */
export const RESUMEN_RECODIFICAR_ASUR_PENDIENTE_A_COCIDOS = envBool(
  'RESUMEN_RECODIFICAR_ASUR_PENDIENTE_A_COCIDOS',
  false
);
