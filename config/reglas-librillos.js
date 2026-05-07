/**
 * Reglas de negocio — Librillos (fuente de verdad en código, sin depender del Excel).
 *
 * Clasificación por ítem (`agrupacion_codigo`): ver `services/agrupaciones.service.js`
 * y `config/agrupaciones-librillos.json` (orden de reglas y aliases).
 *
 * Resumen del día (`obtenerResumenMacroPorFecha`):
 * - Por defecto se cuentan todos los registros del universo del día (incl. pendientes de parte).
 * - Opcional (`LIBRILLOS_TEXTO_INGRESO_CLASIFICACION`): concatenar observaciones de
 *   `informacion_ingreso` + `informacion_ingreso_detalle` por `id_producto` al fusionar con parte/plan.
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

/**
 * Modo recomendado para cierres consistentes entre fechas:
 * true  -> el resumen cuenta solo ítems con parte del día (pendiente=false)
 * false -> el resumen cuenta todo el universo del día (incl. pendientes)
 */
export const RESUMEN_SOLO_PARTE_DIA = envBool(
  'RESUMEN_SOLO_PARTE_DIA',
  false
);

/**
 * Concatenar texto de información de ingreso (cabecera + detalle) al fusionar observación.
 * Por defecto desactivado: activar cuando existan las tablas y columnas estándar (ver librillos.service).
 */
export const LIBRILLOS_TEXTO_INGRESO_CLASIFICACION = envBool(
  'LIBRILLOS_TEXTO_INGRESO_CLASIFICACION',
  false
);
