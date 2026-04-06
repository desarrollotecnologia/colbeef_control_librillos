-- Colbeef — despachos / salidas de cava (reemplaza data/salidas.json en producción)
-- Ejecutar una vez en la misma base donde está a_parte_producto.
-- Migración desde JSON: node scripts/migrate-salidas-json-to-pg.mjs

CREATE SCHEMA IF NOT EXISTS colbeef;

CREATE TABLE IF NOT EXISTS colbeef.salidas_cava (
  id TEXT PRIMARY KEY,
  id_producto TEXT NOT NULL,
  fecha_salida TIMESTAMPTZ NOT NULL,
  registrado_por TEXT,
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  editado_por TEXT,
  fecha_edicion TIMESTAMPTZ,
  CONSTRAINT uq_salidas_cava_id_producto UNIQUE (id_producto)
);

CREATE INDEX IF NOT EXISTS idx_salidas_cava_fecha_salida
  ON colbeef.salidas_cava (fecha_salida);

COMMENT ON TABLE colbeef.salidas_cava IS 'Registro de salida/despacho por id_producto (un movimiento por librillo)';
