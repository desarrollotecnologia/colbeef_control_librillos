/**
 * Resumen macho/hembra del plan de faena (+ emergencias insensibilizadas el mismo día).
 */
import { pool } from '../../config/db.js';
import {
  INCLUIR_SACRIFICIO_EMERGENCIA,
  SACRIFICIO_EMERGENCIA_PUESTO_ILIKE,
  SACRIFICIO_EMERGENCIA_PUESTO_TABLA,
  columnasNombrePuestoTrabajo,
} from '../../config/sacrificio-emergencia.js';

function parseTablaPgCalificada(cualificada) {
  const s = String(cualificada || '').trim();
  const m = s.match(/^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/i);
  if (!m) return null;
  return { schema: m[1].toLowerCase(), table: m[2].toLowerCase() };
}

function sqlCteEmergenciaIds() {
  if (!INCLUIR_SACRIFICIO_EMERGENCIA) return null;
  const tbl = parseTablaPgCalificada(SACRIFICIO_EMERGENCIA_PUESTO_TABLA);
  const cols = columnasNombrePuestoTrabajo();
  if (!tbl || !cols.length) return null;
  const condPuesto = cols
    .map((c) => `COALESCE(pt.${c}, '') ILIKE $2`)
    .join(' OR ');
  return `
    emerg_ids AS (
      SELECT DISTINCT i.id_producto::text AS id_producto
      FROM trazabilidad_proceso.insensibilizacion i
      INNER JOIN ${tbl.schema}.${tbl.table} pt ON pt.id = i.id_puesto_trabajo
      WHERE i.fecha_registro = $1::date
        AND (${condPuesto})
    )`;
}

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

  const cteEmerg = sqlCteEmergenciaIds();
  const unionEmerg = cteEmerg
    ? `UNION SELECT id_producto FROM emerg_ids`
    : '';

  const sql = `
    WITH plan_ids AS (
      SELECT DISTINCT pfp.id_producto::text AS id_producto
      FROM trazabilidad_proceso.plan_faena pf
      JOIN trazabilidad_proceso.plan_faena_producto pfp
        ON pfp.id_plan_faena = pf.id
      WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = $1::date
        AND pfp.fecha_fin_vigencia = pf.fecha_plan
        AND NOT EXISTS (
          SELECT 1
          FROM trazabilidad_proceso.insensibilizacion i
          WHERE i.id_producto::text = pfp.id_producto::text
            AND i.fecha_registro < $1::date
        )
    ),
    plan_ids_planillado AS (
      SELECT DISTINCT pfp.id_producto::text AS id_producto
      FROM trazabilidad_proceso.plan_faena pf
      JOIN trazabilidad_proceso.plan_faena_producto pfp
        ON pfp.id_plan_faena = pf.id
      WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = $1::date
        AND pfp.fecha_fin_vigencia = pf.fecha_plan
    ),
    ${cteEmerg ? `${cteEmerg},` : ''}
    ids_dia AS (
      SELECT id_producto FROM plan_ids
      ${unionEmerg}
    ),
    insens_dia AS (
      SELECT DISTINCT id_producto::text AS id_producto
      FROM trazabilidad_proceso.insensibilizacion
      WHERE fecha_registro = $1::date
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
      (SELECT COUNT(*)::int FROM plan_ids_planillado) AS total_plan_faena_planillado,
      (SELECT COUNT(*)::int FROM insens_dia) AS total_insensibilizados,
      (
        SELECT COUNT(*)::int
        FROM ids_dia d
        LEFT JOIN trazabilidad_proceso.producto p ON p.id::text = d.id_producto
        WHERE p.id IS NULL OR TRIM(COALESCE(p.sexo, '')) = ''
           OR LOWER(COALESCE(p.sexo, '')) NOT IN (
             'hembra', 'f', 'h', 'vaca', 'macho', 'm', 'novillo', 'toro'
           )
      ) AS sin_sexo
      ${
        cteEmerg
          ? `, (
        SELECT COUNT(*)::int
        FROM emerg_ids e
        WHERE NOT EXISTS (
          SELECT 1 FROM plan_ids p WHERE p.id_producto = e.id_producto
        )
      ) AS emergencia_agregadas`
          : ', 0::int AS emergencia_agregadas'
      }
    FROM ids_dia d
    LEFT JOIN trazabilidad_proceso.producto p ON p.id::text = d.id_producto
  `;

  const params = cteEmerg ? [fecha, SACRIFICIO_EMERGENCIA_PUESTO_ILIKE] : [fecha];
  const res = await pool.query(sql, params);
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
    total_plan_faena_planillado: Number(row.total_plan_faena_planillado || 0),
    total_insensibilizados: Number(row.total_insensibilizados || 0),
    emergencia_agregadas: Number(row.emergencia_agregadas || 0),
    incluir_sacrificio_emergencia: INCLUIR_SACRIFICIO_EMERGENCIA,
    generado_en: new Date().toISOString(),
  };
}
