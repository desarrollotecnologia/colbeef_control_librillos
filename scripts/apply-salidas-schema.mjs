/**
 * Crea colbeef.salidas_cava leyendo POSTGRES_* desde .env (raíz del proyecto).
 * Uso: node scripts/apply-salidas-schema.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });
const { Client } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'sql', 'colbeef_salidas_cava.sql');

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
      /* ignorar si el rol no puede cambiarlo */
    }
    await client.query(sql);
    console.log('✅ Esquema y tabla colbeef.salidas_cava listos.');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  const msg = String(e.message || '');
  console.error('❌ Error:', msg);
  if (/read-only/i.test(msg)) {
    console.error(`
→ Tu sesión PostgreSQL está en SOLO LECTURA (réplica, pooler o política del servidor).
  Opciones:
  1) Que TI o el DBA ejecute el archivo sql/colbeef_salidas_cava.sql en el servidor PRINCIPAL.
  2) Que te den credenciales/host de una conexión con escritura y actualices .env.
  3) Mientras tanto, en .env pon: SALIDAS_USE_FILE=1 (despachos en data/salidas.json).
  Comprobar en psql: SHOW transaction_read_only; (debe ser off para crear tablas).`);
  }
  process.exit(1);
});
