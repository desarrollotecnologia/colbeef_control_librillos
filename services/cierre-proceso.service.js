import { guardarCierreProceso, leerCierreProceso } from './cierre-proceso.store.js';
import { obtenerLibrillosConsultaBdDirecta, invalidarCacheLibrillosFecha } from './librillos.service.js';

function esCrudaRow(d) {
  const t = String(d?.observaciones ?? d?.observacion ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return /\bCRUDAS?\b/i.test(t);
}

function normSuc(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Registra cierre: snapshot sucursal por id_producto (solo filas crudas del día).
 */
export async function registrarCierreProceso(fechaISO, usuario = null) {
  const fecha = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('fecha debe ser YYYY-MM-DD');
  }
  const datos = await obtenerLibrillosConsultaBdDirecta(fecha);
  const arr = Array.isArray(datos) ? datos : [];
  const items = {};
  for (const d of arr) {
    if (!d || !esCrudaRow(d)) continue;
    const id = String(d.id_producto ?? '').trim();
    if (!id) continue;
    items[id] = {
      sucursal: normSuc(d.sucursal),
      identificacion: String(d.identificacion || '').trim() || null,
      observaciones: String(d.observaciones || d.observacion || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400),
    };
  }
  const cerrado_en = new Date().toISOString();
  await guardarCierreProceso({
    fecha_proceso: fecha,
    cerrado_en,
    usuario: usuario || null,
    items,
    total_items: Object.keys(items).length,
  });
  invalidarCacheLibrillosFecha(fecha);
  return {
    fecha_proceso: fecha,
    cerrado_en,
    total_items: Object.keys(items).length,
  };
}

/**
 * Compara snapshot del cierre con sucursal actual en BD (misma consulta que librillos).
 */
export async function revisarCambiosSucursalPostCierre(fechaISO) {
  const fecha = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('fecha debe ser YYYY-MM-DD');
  }
  const cierre = await leerCierreProceso(fecha);
  if (!cierre?.items || typeof cierre.items !== 'object') {
    const err = new Error('No hay cierre registrado para esa fecha');
    err.code = 'NO_CIERRE';
    throw err;
  }
  const datos = await obtenerLibrillosConsultaBdDirecta(fecha);
  const arr = Array.isArray(datos) ? datos : [];
  const porId = new Map(arr.map((d) => [String(d?.id_producto || '').trim(), d]));

  const cambios = [];
  for (const [id, snap] of Object.entries(cierre.items)) {
    if (!id) continue;
    const s0 = normSuc(snap?.sucursal);
    const row = porId.get(id);
    if (!row) {
      cambios.push({
        id_producto: id,
        sucursal_cierre: s0,
        sucursal_actual: null,
        identificacion: snap?.identificacion || null,
        motivo: 'sin_fila_hoy',
      });
      continue;
    }
    const s1 = normSuc(row.sucursal);
    if (s0 !== s1) {
      const obsTxt = String(row.observaciones || row.observacion || '')
        .replace(/\s+/g, ' ')
        .trim();
      cambios.push({
        id_producto: id,
        sucursal_cierre: s0,
        sucursal_actual: s1,
        identificacion: String(row.identificacion || snap?.identificacion || '').trim() || null,
        propietario: String(row.propietario || '').trim() || null,
        cliente_destino: String(row.cliente_destino || '').trim() || null,
        agrupacion: String(row.agrupacion || '').trim() || null,
        plaza: String(row.plaza || '').trim() || null,
        empresa_destino: String(row.empresa_destino || '').trim() || null,
        destino: String(row.destino || '').trim() || null,
        observacion_texto: obsTxt.slice(0, 400) || null,
        motivo: 'sucursal_distinta',
      });
    }
  }

  return {
    fecha_proceso: fecha,
    cerrado_en: cierre.cerrado_en || null,
    generado_en: new Date().toISOString(),
    total_snapshot: Object.keys(cierre.items).length,
    cambios_sucursal: cambios.filter((c) => c.motivo === 'sucursal_distinta'),
    sin_fila_hoy: cambios.filter((c) => c.motivo === 'sin_fila_hoy'),
  };
}

export async function obtenerEstadoCierreProceso(fechaISO) {
  const c = await leerCierreProceso(fechaISO);
  if (!c) return { cerrado: false, fecha_proceso: String(fechaISO || '').trim() };
  return {
    cerrado: true,
    fecha_proceso: c.fecha_proceso,
    cerrado_en: c.cerrado_en,
    usuario: c.usuario || null,
    total_items: c.total_items ?? Object.keys(c.items || {}).length,
  };
}
