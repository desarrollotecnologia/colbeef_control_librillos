/**
 * Resumen macho/hembra del plan de faena planillado (solo lo planillado ese día).
 */
import { pool } from '../../config/db.js';
import { INCLUIR_SACRIFICIO_EMERGENCIA } from '../../config/sacrificio-emergencia.js';

/** Clasificación de sexo (misma lógica que consulta operativa del usuario). */
export function clasificarSexoProducto(sexoRaw) {
  const s = String(sexoRaw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return 'sin_sexo';
  if (['hembra', 'f', 'h', 'vaca'].includes(s)) return 'hembra';
  if (['macho', 'm', 'novillo', 'toro'].includes(s)) return 'macho';
  return 'sin_sexo';
}

/** Etiqueta legible para UI (Macho / Hembra / texto crudo / null). */
export function etiquetaSexoProducto(sexoRaw) {
  const c = clasificarSexoProducto(sexoRaw);
  if (c === 'macho') return 'Macho';
  if (c === 'hembra') return 'Hembra';
  const t = String(sexoRaw ?? '').trim();
  return t || null;
}

/**
 * @param {string} fechaISO YYYY-MM-DD
 * @returns {Promise<object>}
 */
export async function obtenerResumenSexoPorFecha(fechaISO) {
  const fecha = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('fecha debe ser YYYY-MM-DD');
  }

  const sql = `
    WITH plan_ids AS (
      SELECT DISTINCT pfp.id_producto::text AS id_producto
      FROM trazabilidad_proceso.plan_faena pf
      JOIN trazabilidad_proceso.plan_faena_producto pfp
        ON pfp.id_plan_faena = pf.id
      WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = $1::date
        AND pfp.fecha_fin_vigencia = pf.fecha_plan
    ),
    insens_dia_plan AS (
      SELECT DISTINCT i.id_producto::text AS id_producto
      FROM trazabilidad_proceso.insensibilizacion i
      INNER JOIN plan_ids p ON p.id_producto = i.id_producto::text
      WHERE i.fecha_registro = $1::date
    )
    SELECT
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(p.sexo, '')) IN ('hembra', 'f', 'h', 'vaca')
      )::int AS hembras,
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(p.sexo, '')) IN ('macho', 'm', 'novillo', 'toro')
      )::int AS machos,
      COUNT(*)::int AS total,
      (SELECT COUNT(*)::int FROM plan_ids) AS total_plan_faena,
      (SELECT COUNT(*)::int FROM insens_dia_plan) AS total_insensibilizados,
      (
        SELECT COUNT(*)::int
        FROM plan_ids d
        LEFT JOIN trazabilidad_proceso.producto p ON p.id::text = d.id_producto
        WHERE p.id IS NULL OR TRIM(COALESCE(p.sexo, '')) = ''
           OR LOWER(COALESCE(p.sexo, '')) NOT IN (
             'hembra', 'f', 'h', 'vaca', 'macho', 'm', 'novillo', 'toro'
           )
      ) AS sin_sexo
    FROM plan_ids d
    LEFT JOIN trazabilidad_proceso.producto p ON p.id::text = d.id_producto
  `;

  const res = await pool.query(sql, [fecha]);
  const row = res.rows?.[0] || {};

  const hembras = Number(row.hembras || 0);
  const machos = Number(row.machos || 0);
  const total = Number(row.total || 0);
  const sin_sexo = Number(row.sin_sexo || 0);

  return {
    fecha,
    machos,
    hembras,
    sin_sexo,
    total,
    total_plan_faena: Number(row.total_plan_faena || 0),
    total_insensibilizados: Number(row.total_insensibilizados || 0),
    emergencia_agregadas: 0,
    incluir_sacrificio_emergencia: INCLUIR_SACRIFICIO_EMERGENCIA,
    generado_en: new Date().toISOString(),
  };
}
