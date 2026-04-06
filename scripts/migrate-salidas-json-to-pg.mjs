/**
 * Migra data/salidas.json → colbeef.salidas_cava
 * Requiere: sql/colbeef_salidas_cava.sql ya ejecutado y variables .env de PostgreSQL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const jsonPath = path.join(root, 'data', 'salidas.json');

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
  ssl: false,
});

async function main() {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('No hay filas en salidas.json');
    await pool.end();
    return;
  }
  let n = 0;
  for (const r of rows) {
    try {
      await pool.query(
        `INSERT INTO colbeef.salidas_cava (id, id_producto, fecha_salida, registrado_por, fecha_registro, editado_por, fecha_edicion)
         VALUES ($1, $2, $3::timestamptz, $4, COALESCE($5::timestamptz, NOW()), $6, $7::timestamptz)
         ON CONFLICT (id_producto) DO NOTHING`,
        [
          r.id,
          r.id_producto,
          r.fecha_salida,
          r.registrado_por || 'usuario',
          r.fecha_registro || r.fecha_salida,
          r.editado_por || null,
          r.fecha_edicion || null,
        ]
      );
      n++;
    } catch (e) {
      console.warn('Omitido', r.id_producto, e.message);
    }
  }
  console.log(`Procesadas ${n} filas (conflictos ignorados con DO NOTHING)`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
