/**
 * Cuenta "CHUNCHULLAS CRUDAS" con el mismo criterio que el resumen del día
 * (`obtenerResumenMacroPorFecha` = `/api/librillos/resumen`), no un SELECT
 * aislado a `parte_producto`.
 *
 * Uso:
 *   node scripts/cuenta-crudas-macro.mjs 2026-05-11
 *   node scripts/cuenta-crudas-macro.mjs 2026-05-11 --ids
 */
import dotenv from 'dotenv';

dotenv.config();

const { pool, poolVista } = await import('../config/db.js');
const { obtenerResumenMacroPorFecha, obtenerLibrillosPorFecha } = await import(
  '../services/librillos.service.js'
);
const { RESUMEN_SOLO_PARTE_DIA } = await import('../config/reglas-librillos.js');

const fecha = process.argv[2];
const wantIds = process.argv.includes('--ids');

if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) {
  console.error('Uso: node scripts/cuenta-crudas-macro.mjs YYYY-MM-DD [--ids]');
  process.exit(1);
}

async function cerrar() {
  await Promise.all([pool.end().catch(() => {}), poolVista.end().catch(() => {})]);
}

const esCruda = (d) => /\bCRUDAS?\b/i.test(String(d?.observaciones ?? d?.observacion ?? ''));

try {
  const rm = await obtenerResumenMacroPorFecha(fecha);
  const n = Number(rm?.categorias?.chunchullas_crudas ?? 0);
  console.log(JSON.stringify(rm, null, 2));
  console.log('');
  console.log(`chunchullas_crudas (mismo criterio que pantalla /api/librillos/resumen): ${n}`);

  if (wantIds) {
    const datos = await obtenerLibrillosPorFecha(fecha);
    const rowsAll = Array.isArray(datos) ? datos : [];
    const rows = RESUMEN_SOLO_PARTE_DIA
      ? rowsAll.filter((d) => !Boolean(d?.pendiente_registro_parte))
      : rowsAll;
    const ids = rows.filter(esCruda).map((d) => d?.id_producto);
    console.log('');
    console.log(`--ids (${ids.length} líneas, id_producto):`);
    for (const id of ids) console.log(String(id ?? ''));
  }

  await cerrar();
  process.exit(0);
} catch (e) {
  console.error(String(e?.message || e));
  await cerrar();
  process.exit(1);
}
