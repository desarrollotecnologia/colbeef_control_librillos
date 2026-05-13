-- Histórico de cambios (planillaje / observaciones) — reemplaza o complementa data/historico-cambios.json
-- Aplicar en la misma base que el resto de la app (usuario con permiso DDL).
-- Uso: node scripts/apply-auditoria-schema.mjs
-- Migración datos: npm run migrate:auditoria

CREATE TABLE IF NOT EXISTS app_auditoria_cambios (
  id TEXT PRIMARY KEY,
  event_time TIMESTAMPTZ NOT NULL,
  modulo TEXT NOT NULL DEFAULT 'general',
  accion TEXT NOT NULL DEFAULT 'actualizar',
  entidad TEXT,
  id_entidad TEXT,
  usuario TEXT,
  antes JSONB,
  despues JSONB,
  meta JSONB
);

CREATE INDEX IF NOT EXISTS idx_app_auditoria_event_time
  ON app_auditoria_cambios (event_time DESC);

CREATE INDEX IF NOT EXISTS idx_app_auditoria_modulo_time
  ON app_auditoria_cambios (modulo, event_time DESC);

COMMENT ON TABLE app_auditoria_cambios IS 'Auditoría de cambios (p. ej. planillaje); la app usa BD si existe la tabla y AUDITORIA_USE_FILE no está en 1.';
