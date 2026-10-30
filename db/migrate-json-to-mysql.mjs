/**
 * db/migrate-json-to-mysql.mjs
 * Migra los datos existentes en los archivos JSON al MySQL local.
 * Ejecutar UNA sola vez: node db/migrate-json-to-mysql.mjs
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

const pool = await mysql.createPool({
  host:     process.env.MYSQL_HOST     || 'localhost',
  port:     Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DB       || 'colbeef_librillos',
  user:     process.env.MYSQL_USER     || 'colbeef_app',
  password: process.env.MYSQL_PASSWORD || 'ColbeefLib2026!',
  charset:  'utf8mb4',
  connectionLimit: 4,
  timezone: '+00:00',
});

function toDatetime3(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().replace('T', ' ').replace('Z', '');
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(path.join(DATA, file), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── 1. historico-cambios.json ─────────────────────────────────
async function migrateHistorico() {
  console.log('\n📋 Migrando historico-cambios.json …');
  const data = readJson('historico-cambios.json');
  if (!data) { console.log('  ⚠️  Archivo no encontrado, omitiendo.'); return; }

  const items = Array.isArray(data) ? data : Object.values(data);
  console.log(`  Total registros: ${items.length}`);

  const BATCH = 200;
  let ok = 0, skip = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const values = chunk.map(r => [
      r.id,
      toDatetime3(r.fecha),
      r.modulo   || 'general',
      r.accion   || 'actualizar',
      r.entidad  || null,
      r.idEntidad || r.id_entidad || null,
      r.usuario  || null,
      r.antes    ? JSON.stringify(r.antes)   : null,
      r.despues  ? JSON.stringify(r.despues) : null,
      r.meta     ? JSON.stringify(r.meta)    : null,
    ]);
    try {
      const [res] = await pool.query(
        `INSERT IGNORE INTO historico_cambios
           (id, event_time, modulo, accion, entidad, id_entidad, usuario, antes_json, despues_json, meta_json)
         VALUES ?`,
        [values]
      );
      ok += res.affectedRows;
      skip += chunk.length - res.affectedRows;
    } catch (e) {
      console.error(`  ❌ Batch ${i}–${i + BATCH}: ${e.message}`);
    }
    process.stdout.write(`\r  Procesados: ${Math.min(i + BATCH, items.length)} / ${items.length} …`);
  }
  console.log(`\n  ✅ Insertados: ${ok} | Ya existían: ${skip}`);
}

// ── 2. salidas.json ───────────────────────────────────────────
async function migrateSalidas() {
  console.log('\n📋 Migrando salidas.json …');
  const data = readJson('salidas.json');
  if (!data) { console.log('  ⚠️  Archivo no encontrado, omitiendo.'); return; }

  const items = Array.isArray(data) ? data : Object.values(data);
  console.log(`  Total registros: ${items.length}`);

  let ok = 0, skip = 0;
  const BATCH = 500;

  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const values = chunk.map(r => [
      r.id,
      r.id_producto,
      toDatetime3(r.fecha_salida),
      r.registrado_por || 'usuario',
      toDatetime3(r.fecha_registro || r.fecha_salida),
      r.editado_por  || null,
      toDatetime3(r.fecha_edicion) || null,
    ]);
    try {
      const [res] = await pool.query(
        `INSERT IGNORE INTO salidas
           (id, id_producto, fecha_salida, registrado_por, fecha_registro, editado_por, fecha_edicion)
         VALUES ?`,
        [values]
      );
      ok += res.affectedRows;
      skip += chunk.length - res.affectedRows;
    } catch (e) {
      console.error(`  ❌ Batch ${i}: ${e.message}`);
    }
  }
  console.log(`  ✅ Insertados: ${ok} | Ya existían: ${skip}`);
}

// ── 3. cierre-proceso.json ────────────────────────────────────
async function migrateCierre() {
  console.log('\n📋 Migrando cierre-proceso.json …');
  const data = readJson('cierre-proceso.json');
  if (!data?.cierres) { console.log('  ⚠️  Archivo no encontrado o sin cierres, omitiendo.'); return; }

  const fechas = Object.keys(data.cierres);
  console.log(`  Fechas de cierre: ${fechas.length}`);

  let okC = 0, okI = 0;

  for (const fecha of fechas) {
    const cierre = data.cierres[fecha];
    try {
      const [res] = await pool.query(
        `INSERT IGNORE INTO cierre_proceso (fecha_proceso, cerrado_en, usuario)
         VALUES (?, ?, ?)`,
        [fecha, toDatetime3(cierre.cerrado_en), cierre.usuario || null]
      );
      if (res.affectedRows === 0) {
        // Ya existe; obtenemos el id
      }
      // Obtener id del cierre
      const [[row]] = await pool.query(
        'SELECT id FROM cierre_proceso WHERE fecha_proceso = ?', [fecha]
      );
      okC++;
      const id_cierre = row.id;

      const items = Object.entries(cierre.items || {});
      for (const [id_producto, item] of items) {
        try {
          await pool.query(
            `INSERT IGNORE INTO cierre_proceso_item
               (id_cierre, fecha_proceso, id_producto, sucursal, identificacion, observaciones)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id_cierre, fecha, id_producto, item.sucursal || null, item.identificacion || null, item.observaciones || null]
          );
          okI++;
        } catch {}
      }
    } catch (e) {
      console.error(`  ❌ Cierre ${fecha}: ${e.message}`);
    }
  }
  console.log(`  ✅ Cierres: ${okC} | Items: ${okI}`);
}

// ── 4. analytics-events.json ──────────────────────────────────
async function migrateAnalytics() {
  console.log('\n📋 Migrando analytics-events.json …');
  const data = readJson('analytics-events.json');
  if (!data) { console.log('  ⚠️  Archivo no encontrado, omitiendo.'); return; }

  const items = Array.isArray(data) ? data : Object.values(data);
  console.log(`  Total registros: ${items.length}`);

  const BATCH = 500;
  let ok = 0, skip = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const values = chunk.map(r => [
      toDatetime3(r.eventTime),
      r.sessionId  || '',
      r.eventName  || 'unknown',
      r.viewName   || null,
      r.userName   || null,
      r.durationMs ?? null,
      r.path       || null,
      r.ip         || null,
      (r.userAgent || r.meta?.ua || null)?.slice(0, 300) || null,
      r.meta ? JSON.stringify(r.meta) : null,
    ]);
    try {
      const [res] = await pool.query(
        `INSERT INTO analytics_eventos
           (event_time, session_id, event_name, view_name, user_name, duration_ms, path, ip, user_agent, meta_json)
         VALUES ?`,
        [values]
      );
      ok += res.affectedRows;
    } catch (e) {
      console.error(`  ❌ Batch ${i}: ${e.message}`);
    }
    process.stdout.write(`\r  Procesados: ${Math.min(i + BATCH, items.length)} / ${items.length} …`);
  }
  console.log(`\n  ✅ Insertados: ${ok}`);
}

// ── Main ──────────────────────────────────────────────────────
console.log('🚀 Inicio migración JSON → MySQL (colbeef_librillos)');
console.log('   Host:', process.env.MYSQL_HOST || 'localhost');

await migrateHistorico();
await migrateSalidas();
await migrateCierre();
await migrateAnalytics();

await pool.end();
console.log('\n🏁 Migración completada.');
