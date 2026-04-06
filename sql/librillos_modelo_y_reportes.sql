-- ═══════════════════════════════════════════════════════════════════════════
-- Modelo de datos: librillos (1 fila = 1 unidad; cantidades = COUNT)
-- PostgreSQL — listo para adaptar a Colbeef o despliegue nuevo
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Opción A: tabla dedicada (importación Excel / API / ETL) ────────────────
CREATE TABLE IF NOT EXISTS librillos (
  id                BIGSERIAL PRIMARY KEY,
  id_librillo       VARCHAR(64) NOT NULL,           -- identificación visible (ej. 2603-04551)
  id_librillo_unico VARCHAR(64) GENERATED ALWAYS AS (trim(upper(id_librillo))) STORED,
  empresa_propietaria TEXT NOT NULL,                -- "cliente" / propietario
  ubicacion         TEXT NOT NULL,                  -- CAVA, MXM, 01009, etc.
  fecha_registro    DATE NOT NULL,                  -- día operativo del registro (o fecha del Excel)
  fecha_creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
  origen            VARCHAR(32) DEFAULT 'excel',   -- excel | api | trazabilidad
  CONSTRAINT uq_librillo_dia UNIQUE (id_librillo_unico, fecha_registro)
);

CREATE INDEX IF NOT EXISTS idx_lib_fecha ON librillos (fecha_registro);
CREATE INDEX IF NOT EXISTS idx_lib_prop_fecha ON librillos (empresa_propietaria, fecha_registro);
CREATE INDEX IF NOT EXISTS idx_lib_ubic_fecha ON librillos (ubicacion, fecha_registro);
CREATE INDEX IF NOT EXISTS idx_lib_prop_ubic_fecha ON librillos (empresa_propietaria, ubicacion, fecha_registro);

COMMENT ON TABLE librillos IS 'Una fila = un librillo. Totales = COUNT(*)';


-- ── Opción B (Colbeef actual): vista lógica sobre datos ya existentes ─────
-- Sustituye :fecha por el parámetro del día operativo (ej. corte 12:00 en app).
/*
CREATE OR REPLACE VIEW vw_librillos_dia AS
SELECT
  id_producto::text AS id_librillo,
  nombre_propietario AS empresa_propietaria,
  COALESCE(NULLIF(trim(destino), ''), NULLIF(trim(sucursal), ''), '—') AS ubicacion,
  DATE(fecha_ingreso_cava) AS fecha_registro   -- o la columna fecha operativa que usen
FROM trazabilidad_proceso.vw_pbi01
WHERE id_tipo_parte_producto = 13;             -- ejemplo: solo librillos
*/


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Reporte por fecha: pivote propietario → ubicación (como Excel G–H)
-- ═══════════════════════════════════════════════════════════════════════════
-- Parámetro: :d (DATE)

SELECT
  empresa_propietaria,
  ubicacion,
  COUNT(*)::bigint AS cantidad
FROM librillos
WHERE fecha_registro = :d::date
GROUP BY empresa_propietaria, ubicacion
ORDER BY empresa_propietaria, ubicacion;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Total por cliente (propietario) en una fecha
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  empresa_propietaria,
  COUNT(*)::bigint AS total_cliente
FROM librillos
WHERE fecha_registro = :d::date
GROUP BY empresa_propietaria
ORDER BY empresa_propietaria;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Total por ubicación en una fecha (todas las empresas)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  ubicacion,
  COUNT(*)::bigint AS total_ubicacion
FROM librillos
WHERE fecha_registro = :d::date
GROUP BY ubicacion
ORDER BY ubicacion;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Total general del día
-- ═══════════════════════════════════════════════════════════════════════════

SELECT COUNT(*)::bigint AS total_general
FROM librillos
WHERE fecha_registro = :d::date;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Reporte unificado: cliente con subtotales por ubicación + total cliente
--    (una query; el front puede “anidar” por empresa_propietaria)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  empresa_propietaria,
  ubicacion,
  COUNT(*)::bigint AS cantidad
FROM librillos
WHERE fecha_registro = :d::date
GROUP BY GROUPING SETS (
  (empresa_propietaria, ubicacion),
  (empresa_propietaria)
)
ORDER BY empresa_propietaria,
  CASE WHEN ubicacion IS NULL THEN 1 ELSE 0 END,
  ubicacion NULLS LAST;

-- Nota: filas con ubicacion NULL = subtotal por empresa_propietaria en ROLLUP/variantes.
-- Alternativa más explícita con UNION ALL en aplicación o dos queries (detalle + totales).


-- ═══════════════════════════════════════════════════════════════════════════
-- 6) ROLLUP: detalle + subtotales por cliente + total general (una sola tabla)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  empresa_propietaria,
  ubicacion,
  COUNT(*)::bigint AS cantidad
FROM librillos
WHERE fecha_registro = :d::date
GROUP BY ROLLUP (empresa_propietaria, ubicacion)
HAVING NOT (empresa_propietaria IS NULL AND ubicacion IS NOT NULL)
ORDER BY
  empresa_propietaria NULLS LAST,
  ubicacion NULLS LAST;

-- Interpretación:
-- - Filas con ambos no NULL: detalle
-- - ubicacion NULL y empresa_propietaria no NULL: total por cliente
-- - ambos NULL: total general


-- ═══════════════════════════════════════════════════════════════════════════
-- 7) Reporte por cliente y rango de fechas
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  fecha_registro,
  ubicacion,
  COUNT(*)::bigint AS cantidad
FROM librillos
WHERE empresa_propietaria = :cliente
  AND fecha_registro BETWEEN :desde::date AND :hasta::date
GROUP BY fecha_registro, ubicacion
ORDER BY fecha_registro DESC, ubicacion;


-- ═══════════════════════════════════════════════════════════════════════════
-- Buenas prácticas (PostgreSQL)
-- ═══════════════════════════════════════════════════════════════════════════
-- • Índices: (fecha_registro), (fecha_registro, empresa_propietaria), compuesto
--   (fecha_registro, empresa_propietaria, ubicacion) si los reportes son siempre así.
-- • Particionar por RANGE (fecha_registro) mensual si superan decenas de millones de filas.
-- • ANALYZE librillos tras cargas masivas.
-- • Evitar COUNT(DISTINCT id) si id es único por fila: COUNT(*) basta.
-- • Para dashboards en tiempo real, considerar MV refrescada cada N minutos por fecha.
