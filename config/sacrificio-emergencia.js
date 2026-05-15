/**
 * Sacrificio de emergencia: animales insensibilizados ese día en puesto de emergencia
 * aunque el plan de faena sea de otro día (o aún no estén en a_plan_faena_producto).
 */

/** 0 = no sumar emergencias al universo del listado. */
export const INCLUIR_SACRIFICIO_EMERGENCIA =
  process.env.INCLUIR_SACRIFICIO_EMERGENCIA === '0' ? false : true;

/** Patrón ILIKE sobre nombre del puesto (pg). */
export const SACRIFICIO_EMERGENCIA_PUESTO_ILIKE =
  String(process.env.SACRIFICIO_EMERGENCIA_PUESTO_ILIKE || '%sacrificio%emergencia%').trim() ||
  '%sacrificio%emergencia%';

/** Esquema.tabla del catálogo de puestos (join por insensibilizacion.id_puesto_trabajo). */
export const SACRIFICIO_EMERGENCIA_PUESTO_TABLA =
  String(process.env.SACRIFICIO_EMERGENCIA_PUESTO_TABLA || 'trazabilidad_proceso.puesto_trabajo').trim();

/** Columnas de texto del puesto a evaluar con ILIKE (separadas por coma). */
export function columnasNombrePuestoTrabajo() {
  const raw = String(
    process.env.SACRIFICIO_EMERGENCIA_PUESTO_COLUMNAS || 'nombre,descripcion'
  ).trim();
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
}
