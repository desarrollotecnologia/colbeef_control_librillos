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

console.log(`🔌 Intentando conectar a BD: ${base.host}:${base.port} (Usuario: ${base.user})`);

// Pool para consultas rápidas (tabla a_parte_producto, stats)
export const pool = new Pool({
  ...base,
  // Timeout de 5 segundos para fallar si no conecta (en lugar de colgarse)
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el Pool de Conexiones:', err.message);
});

// Pool sin timeout para consultas a la vista vw_pbi01
export const poolVista = new Pool({
  ...base,
  connectionTimeoutMillis: 10000, // 10s para la vista
  idleTimeoutMillis: 30000,
  max: 10,
});

// Evita caída del proceso cuando la réplica cancela consultas por recovery/conflicto.
poolVista.on('error', (err) => {
  const code = err && err.code ? ` [${err.code}]` : '';
  console.error(`⚠️ Error inesperado en poolVista${code}:`, err.message);
});