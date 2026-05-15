/**
 * Verifica catálogo de puesto y detecta insensibilizados en sacrificio de emergencia.
 * Uso: node scripts/verificar-sacrificio-emergencia.mjs [YYYY-MM-DD] [id_producto]
 */
import dotenv from 'dotenv';
dotenv.config();

const fecha = process.argv[2] || '2026-05-13';
const idBuscar = process.argv[3] || '2605-04974';

const { pool } = await import('../config/db.js');
const {
  SACRIFICIO_EMERGENCIA_PUESTO_TABLA,
  SACRIFICIO_EMERGENCIA_PUESTO_ILIKE,
  columnasNombrePuestoTrabajo,
} = await import('../config/sacrificio-emergencia.js');

async function main() {
  const tablas = await pool.query(
    `
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name ILIKE '%puesto%'
    ORDER BY table_schema, table_name
    `
  );
  console.log('Tablas con "puesto" en el nombre:');
  tablas.rows.forEach((r) => console.log(`  ${r.table_schema}.${r.table_name}`));

  const [schema, table] = String(SACRIFICIO_EMERGENCIA_PUESTO_TABLA).split('.');
  const cols = await pool.query(
    `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
    `,
    [schema, table]
  );
  console.log(`\nColumnas de ${SACRIFICIO_EMERGENCIA_PUESTO_TABLA}:`);
  cols.rows.forEach((r) => console.log(`  ${r.column_name} (${r.data_type})`));

  const nomCols = columnasNombrePuestoTrabajo();
  const cond = nomCols.map((c) => `COALESCE(pt.${c}, '') ILIKE $2`).join(' OR ');
  const sql = `
    SELECT i.id_producto::text, i.fecha_registro, i.hora_registro, i.id_puesto_trabajo,
           ${nomCols.map((c) => `pt.${c}`).join(', ')}
    FROM trazabilidad_proceso.insensibilizacion i
    INNER JOIN ${schema}.${table} pt ON pt.id = i.id_puesto_trabajo
    WHERE i.fecha_registro = $1::date
      AND (${cond})
    ORDER BY i.id_producto
  `;
  const emerg = await pool.query(sql, [fecha, SACRIFICIO_EMERGENCIA_PUESTO_ILIKE]);
  console.log(`\nEmergencias ${fecha} (ILIKE ${SACRIFICIO_EMERGENCIA_PUESTO_ILIKE}): ${emerg.rows.length}`);
  emerg.rows.forEach((r) => console.log(' ', r));

  const uno = await pool.query(
    `
    SELECT i.*, pt.*
    FROM trazabilidad_proceso.insensibilizacion i
    LEFT JOIN ${schema}.${table} pt ON pt.id = i.id_puesto_trabajo
    WHERE i.id_producto::text = $1
    ORDER BY i.fecha_registro DESC
    LIMIT 3
    `,
    [idBuscar]
  );
  console.log(`\nHistorial insens ${idBuscar}:`);
  console.log(uno.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
