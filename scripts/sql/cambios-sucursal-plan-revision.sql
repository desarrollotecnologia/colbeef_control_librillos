-- Revisión logística: plan de faena (día N) vs chequeo (día N+1)
-- Ajustar fechas: @fecha_plan y @fecha_revision (ej. 2026-05-13 / 2026-05-14).
-- Ejecutar cada bloque por separado en pgAdmin (no hace falta la tabla app_auditoria_cambios).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Plan del día: observación registrada el día del plan y el día de revisión
-- ═══════════════════════════════════════════════════════════════════════════
WITH plan_dia AS (
  SELECT DISTINCT pfp.id_producto::text AS id_producto
  FROM a_trazabilidad_proceso.a_plan_faena pf
  JOIN a_trazabilidad_proceso.a_plan_faena_producto pfp ON pfp.id_plan_faena = pf.id
  WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = DATE '2026-05-13'
),
obs_plan AS (
  SELECT DISTINCT ON (pp.id_producto)
    pp.id_producto::text AS id_producto,
    pp.observaciones
  FROM trazabilidad_proceso.parte_producto pp
  JOIN plan_dia pl ON pl.id_producto = pp.id_producto::text
  WHERE pp.id_tipo_parte_producto = 14
    AND DATE(timezone('America/Bogota', pp.fecha_registro)) = DATE '2026-05-13'
  ORDER BY pp.id_producto, pp.fecha_registro DESC NULLS LAST
),
obs_revision AS (
  SELECT DISTINCT ON (pp.id_producto)
    pp.id_producto::text AS id_producto,
    pp.observaciones
  FROM trazabilidad_proceso.parte_producto pp
  JOIN plan_dia pl ON pl.id_producto = pp.id_producto::text
  WHERE pp.id_tipo_parte_producto = 14
    AND DATE(timezone('America/Bogota', pp.fecha_registro)) = DATE '2026-05-14'
  ORDER BY pp.id_producto, pp.fecha_registro DESC NULLS LAST
)
SELECT
  pl.id_producto,
  op.observaciones AS obs_plan_13,
  orv.observaciones AS obs_revision_14,
  CASE
    WHEN COALESCE(TRIM(op.observaciones), '') IS DISTINCT FROM COALESCE(TRIM(orv.observaciones), '')
    THEN 'SI'
    ELSE 'no'
  END AS cambio_observacion
FROM plan_dia pl
LEFT JOIN obs_plan op ON op.id_producto = pl.id_producto
LEFT JOIN obs_revision orv ON orv.id_producto = pl.id_producto
ORDER BY pl.id_producto;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Solo códigos del plan donde CAMBIÓ la observación entre plan y revisión
-- ═══════════════════════════════════════════════════════════════════════════
WITH plan_dia AS (
  SELECT DISTINCT pfp.id_producto::text AS id_producto
  FROM a_trazabilidad_proceso.a_plan_faena pf
  JOIN a_trazabilidad_proceso.a_plan_faena_producto pfp ON pfp.id_plan_faena = pf.id
  WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = DATE '2026-05-13'
),
obs_plan AS (
  SELECT DISTINCT ON (pp.id_producto)
    pp.id_producto::text AS id_producto,
    pp.observaciones
  FROM trazabilidad_proceso.parte_producto pp
  JOIN plan_dia pl ON pl.id_producto = pp.id_producto::text
  WHERE pp.id_tipo_parte_producto = 14
    AND DATE(timezone('America/Bogota', pp.fecha_registro)) = DATE '2026-05-13'
  ORDER BY pp.id_producto, pp.fecha_registro DESC NULLS LAST
),
obs_revision AS (
  SELECT DISTINCT ON (pp.id_producto)
    pp.id_producto::text AS id_producto,
    pp.observaciones
  FROM trazabilidad_proceso.parte_producto pp
  JOIN plan_dia pl ON pl.id_producto = pp.id_producto::text
  WHERE pp.id_tipo_parte_producto = 14
    AND DATE(timezone('America/Bogota', pp.fecha_registro)) = DATE '2026-05-14'
  ORDER BY pp.id_producto, pp.fecha_registro DESC NULLS LAST
)
SELECT
  pl.id_producto,
  op.observaciones AS obs_antes,
  orv.observaciones AS obs_despues
FROM plan_dia pl
JOIN obs_plan op ON op.id_producto = pl.id_producto
JOIN obs_revision orv ON orv.id_producto = pl.id_producto
WHERE COALESCE(TRIM(op.observaciones), '') IS DISTINCT FROM COALESCE(TRIM(orv.observaciones), '')
ORDER BY pl.id_producto;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Sucursal (cadena raíz / local Colbeef) — mismo criterio que la app en listado
--    Compara el valor actual en BD; si no cambió en trazabilidad, no aparecerá aquí.
--    Para cruce exacto plan→revisión como en la app, use el endpoint (bloque 5).
-- ═══════════════════════════════════════════════════════════════════════════
WITH plan_dia AS (
  SELECT DISTINCT pfp.id_producto::text AS id_producto
  FROM a_trazabilidad_proceso.a_plan_faena pf
  JOIN a_trazabilidad_proceso.a_plan_faena_producto pfp ON pfp.id_plan_faena = pf.id
  WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = DATE '2026-05-13'
),
pp_vb_ult AS (
  SELECT DISTINCT ON (pp.id_producto::text)
    pp.id_producto::text AS id_producto,
    pp.id AS id_parte_producto
  FROM trazabilidad_proceso.parte_producto pp
  JOIN plan_dia pl ON pl.id_producto = pp.id_producto::text
  WHERE pp.id_tipo_parte_producto = 14
  ORDER BY pp.id_producto::text, pp.fecha_registro DESC, pp.id DESC
),
ppe_ult AS (
  SELECT DISTINCT ON (ppe.id_producto::text)
    ppe.id_producto::text AS id_producto,
    ppe.id AS id_parte_producto_empresa
  FROM trazabilidad_proceso.parte_producto_empresa ppe
  JOIN pp_vb_ult ppv
    ON ppv.id_producto = ppe.id_producto::text
   AND ppv.id_parte_producto = ppe.id_parte_producto
  ORDER BY ppe.id_producto::text, ppe.id DESC
),
ppel_ult AS (
  SELECT DISTINCT ON (ppel.id_parte_producto_empresa)
    ppel.id_parte_producto_empresa,
    ppel.id_local
  FROM trazabilidad_proceso.parte_producto_empresa_local ppel
  ORDER BY ppel.id_parte_producto_empresa, ppel.id DESC
)
SELECT
  pl.id_producto,
  s.nombre AS sucursal_actual,
  op.observaciones AS obs_ultima_plan_13,
  orv.observaciones AS obs_ultima_revision_14
FROM plan_dia pl
LEFT JOIN ppe_ult ppe ON ppe.id_producto = pl.id_producto
LEFT JOIN ppel_ult ppel ON ppel.id_parte_producto_empresa = ppe.id_parte_producto_empresa
LEFT JOIN organizaciones.sucursal s ON s.id = ppel.id_local
LEFT JOIN LATERAL (
  SELECT observaciones FROM trazabilidad_proceso.parte_producto pp
  WHERE pp.id_producto::text = pl.id_producto
    AND pp.id_tipo_parte_producto = 14
    AND DATE(timezone('America/Bogota', pp.fecha_registro)) = DATE '2026-05-13'
  ORDER BY pp.fecha_registro DESC NULLS LAST
  LIMIT 1
) op(observaciones) ON true
LEFT JOIN LATERAL (
  SELECT observaciones FROM trazabilidad_proceso.parte_producto pp
  WHERE pp.id_producto::text = pl.id_producto
    AND pp.id_tipo_parte_producto = 14
    AND DATE(timezone('America/Bogota', pp.fecha_registro)) = DATE '2026-05-14'
  ORDER BY pp.fecha_registro DESC NULLS LAST
  LIMIT 1
) orv(observaciones) ON true
ORDER BY pl.id_producto;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) OPCIONAL — Auditoría en PostgreSQL (solo si existe public.app_auditoria_cambios)
--    Si falla con "relation does not exist", la app guarda en data/historico-cambios.json
--    o cree la tabla: node scripts/apply-auditoria-schema.mjs
-- ═══════════════════════════════════════════════════════════════════════════
/*
WITH plan_dia AS (
  SELECT DISTINCT pfp.id_producto::text AS id_producto
  FROM a_trazabilidad_proceso.a_plan_faena pf
  JOIN a_trazabilidad_proceso.a_plan_faena_producto pfp ON pfp.id_plan_faena = pf.id
  WHERE DATE(timezone('America/Bogota', pf.fecha_plan)) = DATE '2026-05-13'
)
SELECT
  a.event_time AT TIME ZONE 'America/Bogota' AS momento_bogota,
  a.accion,
  a.usuario,
  COALESCE(a.id_entidad, a.despues->>'id_producto', a.antes->>'id_producto') AS id_producto,
  a.antes->>'observacion' AS obs_antes,
  a.despues->>'observacion' AS obs_despues,
  a.antes->>'sucursal' AS sucursal_antes,
  a.despues->>'sucursal' AS sucursal_despues
FROM public.app_auditoria_cambios a
JOIN plan_dia pl ON pl.id_producto = COALESCE(a.id_entidad, a.despues->>'id_producto', a.antes->>'id_producto')
WHERE a.modulo = 'planillaje'
  AND a.accion = 'actualizar_en_turno'
  AND DATE(a.event_time AT TIME ZONE 'America/Bogota') BETWEEN DATE '2026-05-13' AND DATE '2026-05-14'
ORDER BY a.event_time DESC;
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Misma lógica que "Cruce plan" en Histórico de cambios (recomendado)
-- ═══════════════════════════════════════════════════════════════════════════
-- GET /api/librillos/cambios-sucursal-revision?fecha_plan=2026-05-13&fecha_revision=2026-05-14
