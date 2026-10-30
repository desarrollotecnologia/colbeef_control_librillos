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

// ── 1. crudas-sucursal.json → crudas_sucursal_snapshot ───────
console.log('\n📋 Migrando crudas-sucursal.json …');
try {
  const raw = fs.readFileSync(path.join(DATA, 'crudas-sucursal.json'), 'utf8');
  const data = JSON.parse(raw);
  const fechas = data.fechas || {};
  let ok = 0, skip = 0;

  for (const [fecha, bloque] of Object.entries(fechas)) {
    const ids = bloque?.ids || {};
    for (const [id, row] of Object.entries(ids)) {
      const sucOrig = String(row?.original?.sucursal || '').trim();
      const sucAct  = String(row?.actual?.sucursal  || '').trim();
      if (!sucOrig && !sucAct) continue;
      try {
        const [res] = await pool.query(
          `INSERT IGNORE INTO crudas_sucursal_snapshot
             (id_producto, fecha_turno, sucursal_original, sucursal_actual,
              usuario_planillaje, guardado_en, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id, fecha,
            sucOrig || sucAct,
            sucAct  || sucOrig,
            row?.actual?.usuario_planillaje  || null,
            row?.original?.guardado_en  ? new Date(row.original.guardado_en)  : null,
            row?.actual?.actualizado_en ? new Date(row.actual.actualizado_en) : null,
          ]
        );
        ok   += res.affectedRows;
        skip += 1 - res.affectedRows;
      } catch (e) { console.error(`  ❌ ${id}: ${e.message}`); }
    }
  }
  console.log(`  ✅ Insertados: ${ok} | Ya existían: ${skip}`);
} catch (e) {
  console.log('  ⚠️  No se pudo leer crudas-sucursal.json:', e.message);
}

// ── 2. plan-faena-historico/*.json → plan_faena_snapshot ─────
console.log('\n📋 Migrando plan-faena-historico/ …');
const planDir = path.join(DATA, 'plan-faena-historico');
if (fs.existsSync(planDir)) {
  const files = fs.readdirSync(planDir).filter((f) => f.endsWith('.json'));
  let pok = 0;
  for (const f of files) {
    const fecha = f.replace('.json', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(planDir, f), 'utf8'));
      const items = d?.items || {};
      const vals = Object.entries(items)
        .map(([id, txt]) => [fecha, id, String(txt || '').slice(0, 500), new Date()])
        .filter(([, id]) => id);
      if (!vals.length) continue;
      const [r] = await pool.query(
        'INSERT IGNORE INTO plan_faena_snapshot (fecha_turno, id_producto, texto_obs, guardado_en) VALUES ?',
        [vals]
      );
      pok += r.affectedRows;
    } catch (e) { console.error(`  ❌ ${f}: ${e.message}`); }
  }
  console.log(`  ✅ Insertados: ${pok} de ${files.length} archivos`);
} else {
  console.log('  ℹ️  Directorio plan-faena-historico no existe (sin datos históricos de plan).');
}

await pool.end();
console.log('\n🏁 Migración completada.');
