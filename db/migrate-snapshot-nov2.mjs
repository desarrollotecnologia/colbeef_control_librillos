/**
 * Recupera retroactivamente el snapshot de crudas para 2026-11-02
 * Paso 1: obtener IDs de crudas (query simple)
 * Paso 2: obtener sucursal de cada ID (en lotes, igual que el servicio)
 * Paso 3: insertar en MySQL con INSERT IGNORE
 */
import pg from 'pg';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const fecha = '2026-11-02';
const ID_TIPO = Number(process.env.ID_TIPO_PARTE_COLBEEF || 14);

const pgPool = new pg.Pool({
  host: process.env.POSTGRES_HOST, port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  ssl: false, connectionTimeoutMillis: 30000, statement_timeout: 60000,
});

const db = await mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DB || 'colbeef_librillos',
  user: process.env.MYSQL_USER || 'colbeef_app',
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true, connectionLimit: 3,
});

const chunks = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

// PASO 1: IDs de crudas del día (query simple, rápida)
console.log(`\n🔍 Paso 1 — IDs crudas tipo ${ID_TIPO} del ${fecha}...`);
const r1 = await pgPool.query(
  `SELECT DISTINCT id_producto::text AS id_producto
   FROM trazabilidad_proceso.parte_producto
   WHERE id_tipo_parte_producto = $1
     AND date(timezone('America/Bogota', fecha_registro)) = $2::date
     AND observaciones ~* '\\mCRUDAS?\\M'
   ORDER BY id_producto`,
  [ID_TIPO, fecha]
);
const crudaIds = r1.rows.map(r => r.id_producto);
console.log(`  → ${crudaIds.length} IDs encontrados`);

if (!crudaIds.length) { console.log('❌ Sin crudas'); process.exit(0); }

// PASO 2: sucursal de cada ID (en lotes de 30)
console.log(`\n🔍 Paso 2 — sucursales por lotes...`);
const sucursalMap = new Map();

for (const grupo of chunks(crudaIds, 30)) {
  const r2 = await pgPool.query(
    `WITH pp AS (
       SELECT DISTINCT ON (pp.id_producto::text)
         pp.id_producto::text AS id_producto,
         pp.id AS id_pp
       FROM trazabilidad_proceso.parte_producto pp
       WHERE pp.id_tipo_parte_producto = $1
         AND pp.id_producto::text = ANY($3::text[])
         AND (timezone('America/Bogota', pp.fecha_registro))::date <= $2::date
       ORDER BY pp.id_producto::text, pp.fecha_registro DESC NULLS LAST, pp.id DESC
     ),
     ppe AS (
       SELECT DISTINCT ON (ppe.id_producto::text)
         ppe.id_producto::text AS id_producto, ppe.id AS id_ppe
       FROM trazabilidad_proceso.parte_producto_empresa ppe
       INNER JOIN pp ON ppe.id_parte_producto = pp.id_pp
       ORDER BY ppe.id_producto::text, ppe.id DESC
     ),
     ppel AS (
       SELECT DISTINCT ON (ppel.id_parte_producto_empresa)
         ppel.id_parte_producto_empresa, ppel.id_local
       FROM trazabilidad_proceso.parte_producto_empresa_local ppel
       INNER JOIN ppe ON ppel.id_parte_producto_empresa = ppe.id_ppe
       WHERE ppel.activo = true
       ORDER BY ppel.id_parte_producto_empresa, ppel.id DESC
     )
     SELECT pp.id_producto, COALESCE(s.nombre,'') AS sucursal
     FROM pp
     LEFT JOIN ppe ON ppe.id_producto = pp.id_producto
     LEFT JOIN ppel ON ppel.id_parte_producto_empresa = ppe.id_ppe
     LEFT JOIN organizaciones.sucursal s ON s.id = ppel.id_local`,
    [ID_TIPO, fecha, grupo]
  );
  for (const r of r2.rows) {
    if (r.id_producto && r.sucursal) sucursalMap.set(r.id_producto, r.sucursal.trim());
  }
  process.stdout.write('.');
}
console.log(`\n  → ${sucursalMap.size} sucursales obtenidas`);

// PASO 3: insertar en MySQL
const ahora = new Date();
const vals = crudaIds
  .filter(id => sucursalMap.has(id))
  .map(id => {
    const suc = sucursalMap.get(id);
    return [id, fecha, suc, suc, null, ahora, ahora];
  });

console.log(`\n💾 Paso 3 — Insertando ${vals.length} registros en MySQL...`);
if (!vals.length) { console.log('❌ Sin sucursales válidas'); process.exit(0); }

const [result] = await db.query(
  `INSERT IGNORE INTO crudas_sucursal_snapshot
     (id_producto, fecha_turno, sucursal_original, sucursal_actual, usuario_planillaje, guardado_en, actualizado_en)
   VALUES ?`,
  [vals]
);

console.log(`✅ ${result.affectedRows} insertados | ${vals.length - result.affectedRows} ya existían`);
console.log(`   Sin sucursal (omitidos): ${crudaIds.length - vals.length}`);

await pgPool.end();
await db.end();
