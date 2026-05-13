import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;

const base = {
  host:     process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  user:     process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  port:     process.env.POSTGRES_PORT,
  // Si la BD es remota (ej: Azure, AWS, Render) suele requerir SSL.
  // Esto lo habilita si el host no es localhost.
  ssl: false,
};

/** Límite de tiempo por consulta en la réplica (ej: 90s, 120s). Vacío = sin cambiar. */
const pgStatementTimeout = (process.env.PG_STATEMENT_TIMEOUT || '').trim();
const pgOptions = pgStatementTimeout ? `-c statement_timeout=${pgStatementTimeout}` : undefined;

const poolMaxMain = Math.min(20, Math.max(2, Number(process.env.PG_POOL_MAX) || 8));
const poolMaxVista = Math.min(15, Math.max(2, Number(process.env.PG_VISTA_POOL_MAX) || 5));

/** Host local: conexión rápida. Remoto: más margen para VPN/red lenta (evita "timeout exceeded when trying to connect"). */
const hostStr = String(process.env.POSTGRES_HOST || '');
const isLocalHost = /^(localhost|127\.0\.0\.1|::1)$/i.test(hostStr);
const defaultConnectMainMs = isLocalHost ? 8000 : 25000;
const defaultConnectVistaMs = isLocalHost ? 15000 : 45000;

const connectTimeoutMain =
  Number(process.env.PG_CONNECT_TIMEOUT_MS) > 0
    ? Number(process.env.PG_CONNECT_TIMEOUT_MS)
    : defaultConnectMainMs;
const connectTimeoutVista =
  Number(process.env.PG_VISTA_CONNECT_TIMEOUT_MS) > 0
    ? Number(process.env.PG_VISTA_CONNECT_TIMEOUT_MS)
    : defaultConnectVistaMs;

console.log(`🔌 Intentando conectar a BD: ${base.host}:${base.port} (Usuario: ${base.user})`);
if (pgStatementTimeout) {
  console.log(`⏱️ PG statement_timeout: ${pgStatementTimeout}`);
}
console.log(
  `📊 Pool principal max=${poolMaxMain} · Pool vista max=${poolMaxVista} · ` +
    `conexión TCP: ${connectTimeoutMain}ms / ${connectTimeoutVista}ms (principal/vista)`
);

// Pool para consultas rápidas (tabla a_parte_producto, stats)
export const pool = new Pool({
  ...base,
  connectionTimeoutMillis: connectTimeoutMain,
  idleTimeoutMillis: 30000,
  max: poolMaxMain,
  ...(pgOptions ? { options: pgOptions } : {}),
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el Pool de Conexiones:', err.message);
});

// Pool secundario (misma BD que `pool`). Hoy las consultas van con `pool` a tablas base (sin vw_pbi01).
// Se mantiene el export por compatibilidad con scripts o despliegues antiguos.
export const poolVista = new Pool({
  ...base,
  connectionTimeoutMillis: connectTimeoutVista,
  idleTimeoutMillis: 30000,
  max: poolMaxVista,
  ...(pgOptions ? { options: pgOptions } : {}),
});

// Evita caída del proceso cuando la réplica cancela consultas por recovery/conflicto.
poolVista.on('error', (err) => {
  const code = err && err.code ? ` [${err.code}]` : '';
  console.error(`⚠️ Error inesperado en poolVista${code}:`, err.message);
});