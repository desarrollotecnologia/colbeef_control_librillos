/**
 * Importa data/historico-cambios.json → app_auditoria_cambios (INSERT ... ON CONFLICT DO NOTHING).
 * Requiere permisos DDL o ejecutar antes: node scripts/apply-auditoria-schema.mjs
 * Uso: npm run migrate:auditoria
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });
const { Client } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = path.join(__dirname, '..', 'data', 'historico-cambios.json');
const BATCH = 400;

async function main() {
  const host = process.env.POSTGRES_HOST;
  const database = process.env.POSTGRES_DB;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const port = process.env.POSTGRES_PORT || 5432;

  if (!host || !database || !user) {
    console.error('Falta POSTGRES_* en .env');
    process.exit(1);
  }

  if (!fs.existsSync(storePath)) {
    console.error('No existe data/historico-cambios.json');
    process.exit(1);
  }

  const raw = fs.readFileSync(storePath, 'utf8');
  let rows = [];
  try {
    rows = JSON.parse(raw || '[]');
  } catch {
    console.error('JSON inválido en historico-cambios.json');
    process.exit(1);
  }
  if (!Array.isArray(rows) || !rows.length) {
    console.log('Archivo vacío o sin arreglo; nada que migrar.');
    process.exit(0);
  }

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
    const sqlPathSchema = path.join(__dirname, '..', 'sql', 'app_auditoria_cambios.sql');
    await client.query(fs.readFileSync(sqlPathSchema, 'utf8'));

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      await client.query('BEGIN');
      try {
        for (const r of chunk) {
          const id = String(r?.id || '').trim();
          if (!id) continue;
          const fecha = r?.fecha ? new Date(r.fecha) : new Date();
          if (Number.isNaN(fecha.getTime())) continue;
          await client.query(
            `INSERT INTO app_auditoria_cambios
              (id, event_time, modulo, accion, entidad, id_entidad, usuario, antes, despues, meta)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
             ON CONFLICT (id) DO NOTHING`,
            [
              id.slice(0, 200),
              fecha.toISOString(),
              String(r?.modulo || 'general').slice(0, 60),
              String(r?.accion || 'actualizar').slice(0, 60),
              r?.entidad != null ? String(r.entidad).slice(0, 80) : null,
              r?.idEntidad != null ? String(r.idEntidad).slice(0, 140) : null,
              r?.usuario != null ? String(r.usuario).slice(0, 120) : null,
              r?.antes && typeof r.antes === 'object' ? JSON.stringify(r.antes) : null,
              r?.despues && typeof r.despues === 'object' ? JSON.stringify(r.despues) : null,
              r?.meta && typeof r.meta === 'object' ? JSON.stringify(r.meta) : null,
            ]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    console.log(
      `✅ Migración terminada. ${rows.length} filas JSON procesadas (duplicados por id ignorados).`
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('❌ Error:', e.message || e);
  process.exit(1);
});
