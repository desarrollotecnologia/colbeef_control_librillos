/**
 * Crea la tabla app_auditoria_cambios (histórico de auditoría en PostgreSQL).
 * Uso: node scripts/apply-auditoria-schema.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });
const { Client } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'sql', 'app_auditoria_cambios.sql');

async function main() {
  const host = process.env.POSTGRES_HOST;
  const database = process.env.POSTGRES_DB;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const port = process.env.POSTGRES_PORT || 5432;

  if (!host || !database || !user) {
    console.error('Falta POSTGRES_HOST, POSTGRES_DB o POSTGRES_USER en .env');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({
    host,
    port: Number(port),
    database,
    user,
    password,
    ssl: false,
  });

  await client.connect();
  try {
    try {
      await client.query('SET default_transaction_read_only = off');
    } catch {
      /* ignorar */
    }
    await client.query(sql);
    console.log('✅ Tabla app_auditoria_cambios e índices listos.');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('❌ Error:', e.message || e);
  process.exit(1);
});
