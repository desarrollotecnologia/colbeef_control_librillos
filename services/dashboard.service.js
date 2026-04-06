import { pool } from '../config/db.js';
import { obtenerLibrillosPorFecha } from './librillos.service.js';
import { obtenerSalidas } from './salidas.service.js';

function normalizarObs(obs) {
  return String(obs || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function diaDesdeTimestamp(val) {
  if (!val) return null;
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function esAgrupacionValida(d) {
  const cod = String(d?.agrupacion_codigo || '');
  return cod !== 'otros' && cod !== 'sin_destino';
}

function tieneRetiro(d) {
  return !!(d?.cliente_destino && String(d.cliente_destino).trim());
}

function esCrudaSinRetiro(d) {
  if (tieneRetiro(d)) return false;
  const obs = normalizarObs(d?.observacion);
  return obs === 'CRUDAS' || obs === 'CRUDA';
}

export async function obtenerDashboardResumen(fechaISO) {
  const [clasificados, salidas, raw] = await Promise.all([
    obtenerLibrillosPorFecha(fechaISO),
    obtenerSalidas(),
    pool.query(
      `
      SELECT DISTINCT id_producto
      FROM a_trazabilidad_proceso.a_parte_producto
      WHERE id_tipo_parte_producto = 13
        AND fecha >= ($1::date + INTERVAL '12 hours')
        AND fecha <  ($1::date + INTERVAL '30 hours')
      `,
      [fechaISO]
    ),
  ]);

  const validos = (clasificados || []).filter(esAgrupacionValida);
  const librillos = validos.filter(tieneRetiro);
  const crudas = validos.filter(esCrudaSinRetiro);
  const cocidos = 0; // feed actual excluye cocidos desde servicio de librillos

  const salidasDia = (salidas || []).filter((s) => diaDesdeTimestamp(s.fecha_salida) === fechaISO);
  const idsLibrillos = new Set(librillos.map((x) => String(x.id_producto)));
  const idsDespachados = new Set(
    salidasDia
      .map((s) => String(s.id_producto))
      .filter((id) => idsLibrillos.has(id))
  );

  const total_librillos = idsLibrillos.size;
  const librillos_despachados = idsDespachados.size;
  const librillos_en_cava = Math.max(0, total_librillos - librillos_despachados);
  const total_crudas = crudas.length;
  const total_cocidos = cocidos;

  const agrupacionesEsperadas = [
    'asurcarnes',
    'asurcarnescol',
    'asurcarnes_glo',
    'global_hides',
    'cat',
    'derivados_carnicos',
  ];
  const por_agrupacion = Object.fromEntries(agrupacionesEsperadas.map((k) => [k, 0]));
  librillos.forEach((x) => {
    const k = String(x.agrupacion_codigo || '');
    if (Object.prototype.hasOwnProperty.call(por_agrupacion, k)) por_agrupacion[k] += 1;
  });

  const total_bd = raw.rows.length;
  const idsClasificados = new Set(validos.map((x) => String(x.id_producto)));
  const sin_clasificar = raw.rows
    .map((r) => String(r.id_producto))
    .filter((id) => !idsClasificados.has(id));

  const pendientes_en_cava = librillos
    .filter((x) => !idsDespachados.has(String(x.id_producto)))
    .sort((a, b) =>
      String(a.id_producto || '').localeCompare(String(b.id_producto || ''), undefined, { numeric: true })
    )
    .slice(0, 50)
    .map((x) => ({
      id_producto: x.id_producto,
      propietario: x.propietario,
      cliente_destino: x.cliente_destino,
      agrupacion_codigo: x.agrupacion_codigo,
      destino: x.destino || x.sucursal || '—',
    }));

  const ultimos_despachos = salidasDia
    .sort((a, b) => new Date(b.fecha_salida) - new Date(a.fecha_salida))
    .slice(0, 50)
    .map((s) => {
      const row = validos.find((x) => String(x.id_producto) === String(s.id_producto));
      return {
        id_producto: s.id_producto,
        fecha_salida: s.fecha_salida,
        registrado_por: s.registrado_por || 'usuario',
        tipo: row ? (esCrudaSinRetiro(row) ? 'CRUDA' : 'LIBRILLO') : 'N/D',
        propietario: row?.propietario || '—',
      };
    });

  return {
    fecha: fechaISO,
    total_librillos,
    librillos_despachados,
    librillos_en_cava,
    total_crudas,
    total_cocidos,
    por_agrupacion,
    validacion: {
      total_bd,
      total_clasificados: validos.length,
      sin_clasificar,
      ok: sin_clasificar.length === 0,
    },
    pendientes_en_cava,
    ultimos_despachos,
  };
}

