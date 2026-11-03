import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST, port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  ssl: false, connectionTimeoutMillis: 30000, statement_timeout: 60000
});

// Ver qué tipos de parte hay en Nov 2 (crudas)
const r1 = await pool.query(
  `SELECT id_tipo_parte_producto, COUNT(*) AS cnt
   FROM trazabilidad_proceso.parte_producto
   WHERE date(timezone('America/Bogota', fecha_registro)) = $1::date
     AND observaciones ~* '\\mCRUDAS?\\M'
   GROUP BY id_tipo_parte_producto ORDER BY 2 DESC LIMIT 5`,
  ['2026-11-02']
);
console.log('Tipos parte Nov2 (solo crudas):', r1.rows);

// Total crudas tipo 14
const r2 = await pool.query(
  `SELECT COUNT(*) AS total
   FROM trazabilidad_proceso.parte_producto
   WHERE date(timezone('America/Bogota', fecha_registro)) = $1::date
     AND id_tipo_parte_producto = 14
     AND observaciones ~* '\\mCRUDAS?\\M'`,
  ['2026-11-02']
);
console.log('Crudas Nov2 tipo 14:', r2.rows[0].total);

// Muestra
const r3 = await pool.query(
  `SELECT DISTINCT ON (id_producto) id_producto, id_tipo_parte_producto, observaciones
   FROM trazabilidad_proceso.parte_producto
   WHERE date(timezone('America/Bogota', fecha_registro)) = $1::date
     AND id_tipo_parte_producto = 14
     AND observaciones ~* '\\mCRUDAS?\\M'
   ORDER BY id_producto, fecha_registro DESC
   LIMIT 5`,
  ['2026-11-02']
);
console.log('Muestra crudas tipo14 Nov2:', r3.rows);

await pool.end();
