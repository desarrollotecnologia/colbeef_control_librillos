import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.resolve(process.cwd(), 'config', 'ajustes-clasificacion-librillos.json');

let cache = null;

function cargarAjustes() {
  if (cache) return cache;
  const m = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    for (const ajuste of raw?.ajustes || []) {
      const fecha = String(ajuste?.fecha || '').trim();
      const observacion = String(ajuste?.observacion || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !observacion) continue;
      for (const idRaw of ajuste?.ids || []) {
        const id = String(idRaw || '').trim();
        if (!id) continue;
        m.set(`${fecha}|${id}`, {
          fecha,
          id_producto: id,
          observacion,
          motivo: String(ajuste?.motivo || '').trim() || null,
        });
      }
    }
  } catch {
    // Sin archivo o JSON invalido: no aplica ajustes.
  }
  cache = m;
  return cache;
}

export function ajusteClasificacionPorFechaId(fechaISO, idProducto) {
  const fecha = String(fechaISO || '').trim();
  const id = String(idProducto || '').trim();
  if (!fecha || !id) return null;
  return cargarAjustes().get(`${fecha}|${id}`) || null;
}
