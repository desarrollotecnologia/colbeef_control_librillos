/**
 * Caché en memoria por fecha/rango (misma semántica que librillos.service.js).
 */

export const CACHE_FECHA_ROW_SCHEMA = 10;

export const CACHE_FECHA_MS = (() => {
  const n = parseInt(String(process.env.CACHE_FECHA_MS || ''), 10);
  if (Number.isFinite(n) && n >= 5000 && n <= 900000) return n;
  return 90000;
})();

export const CACHE_RANGO_MS = (() => {
  const n = parseInt(String(process.env.CACHE_RANGO_MS || ''), 10);
  if (Number.isFinite(n) && n >= 5000 && n <= 900000) return n;
  return 90000;
})();

export const CACHE_CRUCE_SUCURSAL_MS = (() => {
  const n = parseInt(String(process.env.CACHE_CRUCE_SUCURSAL_MS || ''), 10);
  if (Number.isFinite(n) && n >= 10000 && n <= 900000) return n;
  return 120000;
})();

export const cachePorFecha = new Map();
export const cachePorRango = new Map();
export const cacheCambiosSucursalRevision = new Map();
export const cacheMapaSucursalHastaFecha = new Map();

/** Caché turno actual (polling). */
export let cacheTurno = {
  datos: [],
  ultimaActualizacion: null,
  fecha: null,
  snapshot: new Map(),
};

export function setCacheTurno({ datos, ultimaActualizacion, fecha, snapshot }) {
  cacheTurno = {
    datos: Array.isArray(datos) ? datos : [],
    ultimaActualizacion: ultimaActualizacion ?? null,
    fecha: fecha ?? null,
    snapshot: snapshot instanceof Map ? snapshot : new Map(),
  };
}

export function getCacheTurno() {
  return cacheTurno;
}

export function claveCacheFecha(fechaISO) {
  const f = String(fechaISO || '').trim();
  return f ? `${f}|${CACHE_FECHA_ROW_SCHEMA}` : '';
}

export function leerCacheFecha(fechaISO) {
  const k = claveCacheFecha(fechaISO);
  if (!k) return null;
  const hit = cachePorFecha.get(k);
  if (!hit) return null;
  if (Date.now() - Number(hit.ts || 0) > CACHE_FECHA_MS) {
    cachePorFecha.delete(k);
    return null;
  }
  return Array.isArray(hit.data) ? hit.data : null;
}

export function guardarCacheFecha(fechaISO, data) {
  const k = claveCacheFecha(fechaISO);
  if (!k) return;
  cachePorFecha.set(k, { ts: Date.now(), data: Array.isArray(data) ? data : [] });
}

export function leerCacheRango(desde, hasta) {
  const k = `${String(desde || '').trim()}|${String(hasta || '').trim()}`;
  if (!k || k === '|') return null;
  const hit = cachePorRango.get(k);
  if (!hit) return null;
  if (Date.now() - Number(hit.ts || 0) > CACHE_RANGO_MS) {
    cachePorRango.delete(k);
    return null;
  }
  return Array.isArray(hit.data) ? hit.data : null;
}

export function guardarCacheRango(desde, hasta, data) {
  const k = `${String(desde || '').trim()}|${String(hasta || '').trim()}`;
  if (!k || k === '|') return;
  cachePorRango.set(k, { ts: Date.now(), data: Array.isArray(data) ? data : [] });
}

export function invalidarCacheFecha(fechaISO) {
  const k = claveCacheFecha(String(fechaISO || '').trim());
  if (k) cachePorFecha.delete(k);
}

export function invalidarCacheCruceSucursalPorFecha(fechaISO) {
  const f = String(fechaISO || '').trim();
  if (!f) return;
  for (const k of cacheCambiosSucursalRevision.keys()) {
    if (k.startsWith(`${f}|`) || k.endsWith(`|${f}`)) cacheCambiosSucursalRevision.delete(k);
  }
  for (const k of cacheMapaSucursalHastaFecha.keys()) {
    if (k.startsWith(`${f}|`)) cacheMapaSucursalHastaFecha.delete(k);
  }
}

export function statsCache() {
  const turno = getCacheTurno();
  const ageSec = turno.ultimaActualizacion
    ? Math.round((Date.now() - turno.ultimaActualizacion.getTime()) / 1000)
    : null;
  return {
    fechas_en_cache: cachePorFecha.size,
    rangos_en_cache: cachePorRango.size,
    turno_fecha: turno.fecha,
    turno_filas: turno.datos.length,
    turno_edad_seg: ageSec,
    cache_fecha_ttl_ms: CACHE_FECHA_MS,
    cache_rango_ttl_ms: CACHE_RANGO_MS,
    row_schema: CACHE_FECHA_ROW_SCHEMA,
  };
}
