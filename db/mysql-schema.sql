-- =============================================================
-- COLBEEF CONTROL LIBRILLOS — Base de datos local MySQL
-- Motor: MySQL 8.0+  |  Charset: utf8mb4
-- =============================================================

CREATE DATABASE IF NOT EXISTS colbeef_librillos
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE colbeef_librillos;

-- ─────────────────────────────────────────────────────────────
-- 1. HISTÓRICO DE CAMBIOS
--    Reemplaza data/historico-cambios.json
--    Registra cada modificación hecha en planillaje y salidas.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS historico_cambios (
  id           VARCHAR(60)   NOT NULL,
  event_time   DATETIME(3)   NOT NULL,
  modulo       VARCHAR(60)   NOT NULL DEFAULT 'general',   -- planillaje | salidas
  accion       VARCHAR(60)   NOT NULL DEFAULT 'actualizar', -- actualizar_en_turno | crear_en_turno | remover_en_turno | registrar
  entidad      VARCHAR(80)   DEFAULT NULL,
  id_entidad   VARCHAR(80)   DEFAULT NULL,                  -- id_producto generalmente
  usuario      VARCHAR(120)  DEFAULT NULL,
  antes_json   JSON          DEFAULT NULL,
  despues_json JSON          DEFAULT NULL,
  meta_json    JSON          DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_hc_time        (event_time DESC),
  INDEX idx_hc_modulo_time (modulo, event_time DESC),
  INDEX idx_hc_id_entidad  (id_entidad),
  INDEX idx_hc_usuario     (usuario),
  INDEX idx_hc_accion      (accion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 2. SALIDAS DE CAVA
--    Reemplaza data/salidas.json y tabla colbeef.salidas_cava (PG)
--    Registra cuándo un producto sale físicamente de la cava.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salidas (
  id              VARCHAR(80)   NOT NULL,
  id_producto     VARCHAR(40)   NOT NULL,
  fecha_salida    DATETIME(3)   NOT NULL,
  registrado_por  VARCHAR(120)  NOT NULL DEFAULT 'usuario',
  fecha_registro  DATETIME(3)   NOT NULL,
  editado_por     VARCHAR(120)  DEFAULT NULL,
  fecha_edicion   DATETIME(3)   DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE  KEY uq_salidas_producto (id_producto),
  INDEX idx_salidas_fecha     (fecha_salida DESC),
  INDEX idx_salidas_registro  (fecha_registro DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 3. CIERRE DE PROCESO
--    Reemplaza data/cierre-proceso.json
--    Cabecera del cierre diario (una fila por fecha de proceso).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cierre_proceso (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  fecha_proceso  DATE          NOT NULL,
  cerrado_en     DATETIME(3)   DEFAULT NULL,
  usuario        VARCHAR(120)  DEFAULT NULL,
  notas          TEXT          DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cierre_fecha (fecha_proceso),
  INDEX idx_cierre_fecha (fecha_proceso DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 4. ITEMS DE CIERRE
--    Detalle normalizado: un registro por producto dentro del cierre.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cierre_proceso_item (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  id_cierre       INT UNSIGNED  NOT NULL,
  fecha_proceso   DATE          NOT NULL,            -- desnormalizado para queries rápidas
  id_producto     VARCHAR(40)   NOT NULL,
  sucursal        VARCHAR(60)   DEFAULT NULL,
  identificacion  VARCHAR(80)   DEFAULT NULL,
  observaciones   TEXT          DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cierre_item (id_cierre, id_producto),
  INDEX idx_ci_fecha      (fecha_proceso DESC),
  INDEX idx_ci_producto   (id_producto),
  INDEX idx_ci_sucursal   (sucursal),
  CONSTRAINT fk_cierre_item FOREIGN KEY (id_cierre)
    REFERENCES cierre_proceso (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 5. ANALYTICS / EVENTOS DE USO
--    Reemplaza data/analytics-events.json
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_eventos (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_time   DATETIME(3)     NOT NULL,
  session_id   VARCHAR(80)     NOT NULL,
  event_name   VARCHAR(80)     NOT NULL,
  view_name    VARCHAR(80)     DEFAULT NULL,
  user_name    VARCHAR(120)    DEFAULT NULL,
  duration_ms  INT             DEFAULT NULL,
  path         VARCHAR(200)    DEFAULT NULL,
  ip           VARCHAR(64)     DEFAULT NULL,
  user_agent   VARCHAR(300)    DEFAULT NULL,
  meta_json    JSON            DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_ae_time       (event_time DESC),
  INDEX idx_ae_session    (session_id),
  INDEX idx_ae_event      (event_name),
  INDEX idx_ae_user       (user_name),
  INDEX idx_ae_view       (view_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 6. REETIQUETADO DE DESPACHO  (crudas retenidas)
--    Registra qué productos necesitaron nueva etiqueta porque
--    su sucursal de despacho cambió respecto a la del plan.
--    Soporta: buscar pendientes de impresión, marcar como
--    reimpresas, auditar quién y cuándo lo hizo.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reetiquetado_despacho (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  fecha_plan         DATE          NOT NULL,
  fecha_despacho     DATE          NOT NULL,
  id_producto        VARCHAR(40)   NOT NULL,
  sucursal_original  VARCHAR(60)   DEFAULT NULL,   -- sucursal en plan de faena
  sucursal_despacho  VARCHAR(60)   DEFAULT NULL,   -- sucursal real al despachar
  identificacion     VARCHAR(80)   DEFAULT NULL,
  propietario        VARCHAR(200)  DEFAULT NULL,
  observaciones      TEXT          DEFAULT NULL,
  -- Estado de la impresión
  reimpresa          TINYINT(1)    NOT NULL DEFAULT 0,
  reimpresa_por      VARCHAR(120)  DEFAULT NULL,
  reimpresa_en       DATETIME(3)   DEFAULT NULL,
  -- Anulación (si el registro fue un error)
  anulada            TINYINT(1)    NOT NULL DEFAULT 0,
  anulada_por        VARCHAR(120)  DEFAULT NULL,
  anulada_en         DATETIME(3)   DEFAULT NULL,
  -- Trazabilidad
  registrado_por     VARCHAR(120)  DEFAULT NULL,
  registrado_en      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reet_plan_producto (fecha_plan, id_producto),
  INDEX idx_reet_despacho      (fecha_despacho DESC),
  INDEX idx_reet_plan          (fecha_plan DESC),
  INDEX idx_reet_producto      (id_producto),
  INDEX idx_reet_pendiente     (reimpresa, anulada, fecha_despacho DESC),
  INDEX idx_reet_sucursal_orig (sucursal_original),
  INDEX idx_reet_sucursal_desp (sucursal_despacho)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 7. SNAPSHOT SIRT (caché local de datos recibidos desde SIRT)
--    Permite comparar en MySQL sin depender de la conexión PG.
--    Se actualiza con cada poll del backend.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sirt_turno_snapshot (
  id_producto        VARCHAR(40)   NOT NULL,
  fecha_turno        DATE          NOT NULL,
  id_animal          VARCHAR(40)   DEFAULT NULL,
  sucursal           VARCHAR(80)   DEFAULT NULL,
  plaza              VARCHAR(80)   DEFAULT NULL,
  propietario        VARCHAR(200)  DEFAULT NULL,
  cliente_destino    VARCHAR(120)  DEFAULT NULL,
  empresa_destino    VARCHAR(120)  DEFAULT NULL,
  observacion        VARCHAR(500)  DEFAULT NULL,
  tipo_parte         VARCHAR(40)   DEFAULT NULL,
  numero_parte       VARCHAR(40)   DEFAULT NULL,
  en_plan_faena      TINYINT(1)    DEFAULT NULL,
  en_insensibilizacion TINYINT(1)  DEFAULT NULL,
  es_emergencia      TINYINT(1)    DEFAULT NULL,
  snapshot_ts        DATETIME(3)   NOT NULL,          -- cuándo se guardó este snapshot
  PRIMARY KEY (id_producto, fecha_turno),
  INDEX idx_snap_fecha     (fecha_turno DESC),
  INDEX idx_snap_sucursal  (sucursal),
  INDEX idx_snap_cliente   (cliente_destino),
  INDEX idx_snap_ts        (snapshot_ts DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 8. CONTROL DE VERSIÓN / MIGRACIONES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  version     VARCHAR(40)   NOT NULL,
  descripcion TEXT          DEFAULT NULL,
  aplicada_en DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_migration_version (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, descripcion)
VALUES ('1.0.0', 'Schema inicial: historico_cambios, salidas, cierre_proceso, cierre_proceso_item, analytics_eventos, reetiquetado_despacho, sirt_turno_snapshot');

-- ─────────────────────────────────────────────────────────────
-- USUARIO DE APLICACIÓN
-- ─────────────────────────────────────────────────────────────
CREATE USER IF NOT EXISTS 'colbeef_app'@'localhost' IDENTIFIED BY 'ColbeefLib2026!';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER
  ON colbeef_librillos.* TO 'colbeef_app'@'localhost';
FLUSH PRIVILEGES;

SELECT 'colbeef_librillos creada correctamente' AS resultado;
