import { pool, poolVista } from '../config/db.js';
import { agrupacionDesdeClienteDestino } from './agrupaciones.service.js';

let cache = { datos: [], ultimaActualizacion: null };

// ── PARSEAR OBSERVACIÓN ───────────────────────────────────────────────────────
export function parsearObservacion(obs) {
  if (!obs || obs.trim() === '') return { observacion: null, cliente_destino: null };
  const limpio = String(obs).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const matchRetiro = limpio.match(/RETIRAR\s+LIBRILLOS\s+([A-Z0-9 ._-]+)/i);
  const cliente = matchRetiro ? matchRetiro[1].trim() : null;

  // Quitar solo la porcion de retiro para conservar el resto (ej: "CRUDAS RETIRAR LIBRILLOS ASURCARNES")
  const sinRetiro = limpio.replace(/RETIRAR\s+LIBRILLOS\s+[A-Z0-9 ._-]+/i, '').replace(/\s+/g, ' ').trim();
  const observacion = sinRetiro || null;
  return { observacion, cliente_destino: cliente || null };
}

/** API completa: incluir todos los registros del día (la clasificación se hace en frontend). */
function rowIncluidoColbeef(observacionesRaw, observacionParsed, cliente_destino) {
  return true;
}

// ── CHUNKS ────────────────────────────────────────────────────────────────────
function chunks(arr, n) {
  const result = [];
  for (let i = 0; i < arr.length; i += n) result.push(arr.slice(i, i + n));
  return result;
}

// ── CONSULTA PRINCIPAL ────────────────────────────────────────────────────────
const consultarLibrillos = async (fecha = null) => {
  try {
    // Día calendario completo (Bogotá).
    // Si no llega ?fecha, usamos la fecha actual de Bogotá (no la del servidor).
    const fechaParam = fecha
      ? `'${fecha}'::date`
      : `(now() AT TIME ZONE 'America/Bogota')::date`;

    // PASO 1: Tabla rápida
    const resTabla = await pool.query(`
      SELECT DISTINCT ON (id_producto)
        id_producto, identificacion, observaciones, accion,
        id_tipo_parte_producto,
        -- Día calendario (YYYY-MM-DD)
        DATE(timezone('America/Bogota', fecha))::text AS fecha
      FROM a_trazabilidad_proceso.a_parte_producto
      WHERE id_tipo_parte_producto = 13
        AND DATE(timezone('America/Bogota', fecha)) = ${fechaParam}
      ORDER BY id_producto DESC
    `);

    const librillos = resTabla.rows;
    if (librillos.length === 0) {
      console.log(`✅ Sin producción para ${fecha || 'hoy'}.`);
      return [];
    }

    // PASO 2: Vista en chunks de 50 usando codigo = id_producto
    const idProductos = [...new Set(librillos.map(l => l.id_producto))];
    console.log(`📦 ${idProductos.length} IDs únicos — consultando vista en grupos de 50...`);

    const grupos = chunks(idProductos, 50);
    const vistaMap = {};

    for (const grupo of grupos) {
      try {
        const resVista = await poolVista.query(`
          SELECT DISTINCT ON (codigo)
            codigo, nombre_propietario,
            destino, sucursal, empresa_destino,
            fecha_ingreso_cava, fecha_salida_cava
          FROM trazabilidad_proceso.vw_pbi01
          WHERE codigo = ANY($1)
            AND (
              -- Asegurar pertenencia al día calendario seleccionado
              (
                fecha_ingreso_cava IS NOT NULL
                AND DATE(timezone('America/Bogota', fecha_ingreso_cava)) = ${fechaParam}
              )
              OR
              (
                fecha_salida_cava IS NOT NULL
                AND DATE(timezone('America/Bogota', fecha_salida_cava)) = ${fechaParam}
              )
            )
          ORDER BY codigo, fecha_ingreso_cava DESC NULLS LAST
        `, [grupo]);
        resVista.rows.forEach(v => { vistaMap[v.codigo] = v; });
      } catch (err) {
        console.warn(`⚠️ Error en chunk vista: ${err.message}`);
      }
    }

    console.log(`✅ Vista: ${Object.keys(vistaMap).length} registros encontrados`);

    // PASO 3: Unir
    const resultado = librillos
      .map((l) => {
        const v = vistaMap[l.id_producto] || {};
        const { observacion, cliente_destino } = parsearObservacion(l.observaciones);
        const ag = agrupacionDesdeClienteDestino(cliente_destino);
        return {
          id_producto: l.id_producto,
          identificacion: l.identificacion,
          fecha: l.fecha,
          observacion,
          cliente_destino,
          agrupacion_codigo: ag.codigo,
          agrupacion: ag.etiqueta,
          propietario: v.nombre_propietario || 'Sin asignar',
          destino: v.destino || null,
          sucursal: v.sucursal || null,
          empresa_destino: v.empresa_destino || null,
          fecha_ingreso_cava: v.fecha_ingreso_cava || null,
          fecha_salida_cava: v.fecha_salida_cava || null,
          enriquecido: Object.keys(v).length > 0,
        };
      })
      .filter((row, i) =>
        rowIncluidoColbeef(librillos[i].observaciones, row.observacion, row.cliente_destino)
      );

    console.log(`✅ [${fecha || 'hoy'}] ${resultado.length} registros (día completo)`);
    return resultado;

  } catch (error) {
    console.error('❌ Error:', error.message);
    return [];
  }
};

// ── CACHE ─────────────────────────────────────────────────────────────────────
const actualizarCache = async () => {
  try {
    console.log('Consultando base de datos...');
    const datos = await consultarLibrillos(null);
    cache.datos = datos;
    cache.ultimaActualizacion = new Date();
    console.log(`✅ Cache actualizado — ${datos.length} registros (día completo)`);
  } catch (error) {
    console.error('Error cache:', error.message);
  }
};

export const iniciarPolling = async () => {
  console.log('Iniciando polling...');
  await actualizarCache();
  setInterval(actualizarCache, 60000);
};

export const obtenerLibrillos = () => ({
  datos: cache.datos,
  ultimaActualizacion: cache.ultimaActualizacion,
  total: cache.datos.length,
});

export const obtenerLibrillosPorFecha = async (fecha) => await consultarLibrillos(fecha);

export const obtenerObservacionesPorFecha = async (fecha) => {
  const res = await pool.query(`
    SELECT DISTINCT ON (id_producto)
      id_producto,
      COALESCE(NULLIF(TRIM(REGEXP_REPLACE(observaciones, '\\s+', ' ', 'g')), ''), '') AS observacion_actual
    FROM a_trazabilidad_proceso.a_parte_producto
    WHERE id_tipo_parte_producto = 13
      AND DATE(timezone('America/Bogota', fecha)) = $1::date
    ORDER BY id_producto DESC
  `, [fecha]);
  return res.rows.map(r => ({
    id_producto: r.id_producto,
    observacion_actual: r.observacion_actual || '',
  }));
};

export const obtenerStatsUltimos7Dias = async () => {
  try {
    const res = await pool.query(`
      SELECT DATE(timezone('America/Bogota', fecha))::text AS dia,
             COUNT(DISTINCT id_producto) AS total
      FROM a_trazabilidad_proceso.a_parte_producto
      WHERE id_tipo_parte_producto = 13
        AND DATE(timezone('America/Bogota', fecha)) >= (now() AT TIME ZONE 'America/Bogota')::date - INTERVAL '6 days'
      GROUP BY DATE(timezone('America/Bogota', fecha))
      ORDER BY dia ASC
    `);
    const resultado = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const found = res.rows.find(r => r.dia === iso);
      resultado.push({ fecha: iso, total: found ? parseInt(found.total) : 0 });
    }
    return resultado;
  } catch (error) {
    console.error('❌ Error stats:', error.message);
    return [];
  }
};