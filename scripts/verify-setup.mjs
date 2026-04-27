/**
 * Comprueba conexión a PostgreSQL con las variables de .env
 * Uso: npm run verify
 */
import dotenv from 'dotenv';
dotenv.config();

const { pool, poolVista } = await import('../config/db.js');

async function cerrar() {
  await Promise.all([pool.end().catch(() => {}), poolVista.end().catch(() => {})]);
}

try {
  const r = await pool.query(
    `SELECT current_database() AS db, current_user AS usr`
  );
  const row = r.rows[0];
  console.log('OK — conexión a PostgreSQL');
  console.log(`   Base: ${row.db} · Usuario: ${row.usr}`);
  await cerrar();
  process.exit(0);
} catch (e) {
  console.error('ERROR — no se pudo conectar a la base de datos.');
  console.error(String(e.message || e));
  console.error('\nRevise .env (POSTGRES_*) y que el servidor PostgreSQL acepte conexiones.');
  await cerrar();
  process.exit(1);
}
