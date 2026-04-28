import { pool } from '../config/db.js';
import { obtenerLibrillosPorFecha } from './librillos.service.js';
import { obtenerSalidas } from './salidas.service.js';

function txt(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function first(obj, keys, fallback = null) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return fallback;
}

const HORA_CORTE_TURNO_SALIDA_BOGOTA = (() => {
  const n = parseInt(String(process.env.HORA_CORTE_TURNO_SALIDA_BOGOTA || ''), 10);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 6;
})();

function diaAnteriorISO(isoDate) {
  const d = new Date(`${isoDate}T00:00:00-05:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function diaOperativoSalidaISO(fechaSalida) {
  if (!fechaSalida) return null;
  const d = new Date(fechaSalida);
  if (Number.isNaN(d.getTime())) return null;
  const cal = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  if (h < HORA_CORTE_TURNO_SALIDA_BOGOTA) return diaAnteriorISO(cal);
  return cal;
}

function esDespachadoEnFecha(d, fechaIso, mapSalida) {
  const id = String(d?.id_producto || '').trim();
  if (id && mapSalida.has(id)) return true;
  const tsTraz = d?.fecha_salida_cava || null;
  return diaOperativoSalidaISO(tsTraz) === fechaIso;
}

function salidaEfectivaRegistro(d, mapSalida) {
  const id = String(d?.id_producto || '').trim();
  const sal = id ? mapSalida.get(id) : null;
  if (sal?.fecha_salida) return sal.fecha_salida;
  return d?.fecha_salida_cava || null;
}

function normalizarCategoriaGuia(raw) {
  const c = String(raw || '').trim().toLowerCase();
  if (!c) return null;
  if (c === 'cat') return 'cat';
  if (c === 'derivados' || c === 'derivados_carnicos') return 'derivados';
  if (c === 'global_hides' || c === 'global hides' || c === 'global') return 'global_hides';
  return null;
}

function definicionCategoriaGuia(categoriaRaw) {
  const key = normalizarCategoriaGuia(categoriaRaw);
  if (!key) return null;
  if (key === 'cat') {
    return { key, etiqueta: 'CAT', codigos: new Set(['cat', 'asurcarnescol']) };
  }
  if (key === 'derivados') {
    return { key, etiqueta: 'DERIVADOS', codigos: new Set(['derivados_carnicos', 'asurcarnes']) };
  }
  return {
    key: 'global_hides',
    etiqueta: 'GLOBAL HIDES',
    codigos: new Set(['global_hides', 'asurcarnes_glo']),
  };
}

function palabrasCategoria(def) {
  if (!def?.key) return [];
  if (def.key === 'cat') return ['CAT', 'ASURCARNESCOL'];
  if (def.key === 'derivados') return ['DERIVADOS', 'ASURCARNES'];
  return ['GLOBAL HIDES', 'ASURCARNESGLO'];
}

async function obtenerCabeceraRealPorFechaYCategoria(fechaIso, def) {
  const keys = palabrasCategoria(def);
  if (!keys.length) return null;
  const likes = keys.map((k, i) => `UPPER(COALESCE(gd.texto_guia_tipo::text, gd.tipo_despacho::text, gd.observaciones::text, gd.codigo::text, '')) LIKE $${i + 2}`);
  const sql = `
    SELECT gd.*
    FROM desposte.guia_desposte gd
    WHERE (
      DATE(COALESCE(gd.fecha_creacion, gd.created_at) AT TIME ZONE 'America/Bogota') = $1::date
      OR DATE(COALESCE(gd.fecha_salida, gd.fecha_creacion, gd.created_at) AT TIME ZONE 'America/Bogota') = $1::date
    )
    AND (${likes.join(' OR ')})
    ORDER BY gd.id DESC
    LIMIT 1
  `;
  const params = [fechaIso, ...keys.map((k) => `%${k}%`)];
  try {
    const res = await pool.query(sql, params);
    if (res?.rowCount) return res.rows[0];
  } catch {
    return null;
  }
  return null;
}

const GUIA_PLANTA_DEFAULT = {
  planta_beneficio: 'Colbeef S.A.S',
  direccion: 'Vía Corredor Río Frío Calle 210 No. 9 - 631',
  codigo_invima: '696BD',
  departamento: 'Santander',
  ciudad: 'Florida Blanca',
  responsable_firma: 'YERSON JAVIER RINCON BOTELLO',
  cedula_responsable: '1.127.947.335',
  cargo_responsable: 'COORDINADOR DE SUBPRODUCTOS CARNICOS COMESTIBLES',
  tipo_vehiculo_default: 'TRANSPORTE DE ALIMENTO NO COMESTIBLE',
  numero_guia_default: 'Colbeef - 06369-18',
};

function extraerHoraBogota(fechaIso) {
  if (!fechaIso) return null;
  const d = new Date(fechaIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

async function consultarDetalleGuia(rowCabecera) {
  const idGuia = rowCabecera?.id;
  const codigo = String(rowCabecera?.codigo || '').trim();
  if (!idGuia && !codigo) return [];

  // Intentos por estructuras comunes de desposte; si una falla, probamos la siguiente.
  const intents = [
    {
      text: `
        SELECT
          d.id_producto::text AS id_producto,
          d.identificacion::text AS identificacion,
          d.observaciones::text AS observaciones,
          d.fecha_registro,
          d.peso_despacho,
          d.nombre_parte::text AS nombre_parte,
          d.especie::text AS especie,
          d.destino::text AS destino,
          d.empresa_destino::text AS empresa_destino,
          d.sucursal::text AS sucursal,
          d.mun_sucursal::text AS mun_sucursal,
          d.dep_sucursal::text AS dep_sucursal
        FROM desposte.guia_desposte_detalle d
        WHERE d.id_guia_desposte = $1
        ORDER BY d.id ASC
      `,
      values: [idGuia],
    },
    {
      text: `
        SELECT
          d.id_producto::text AS id_producto,
          d.identificacion::text AS identificacion,
          d.observaciones::text AS observaciones,
          d.fecha_registro,
          d.peso_despacho,
          d.nombre_parte::text AS nombre_parte,
          d.especie::text AS especie,
          d.destino::text AS destino,
          d.empresa_destino::text AS empresa_destino,
          d.sucursal::text AS sucursal,
          d.mun_sucursal::text AS mun_sucursal,
          d.dep_sucursal::text AS dep_sucursal
        FROM desposte.guia_desposte_detalle d
        WHERE UPPER(TRIM(d.codigo_guia::text)) = UPPER(TRIM($1))
        ORDER BY d.id ASC
      `,
      values: [codigo],
    },
    {
      text: `
        SELECT
          x.id_producto::text AS id_producto,
          x.identificacion::text AS identificacion,
          x.observaciones::text AS observaciones,
          x.fecha_registro,
          x.peso_despacho,
          x.nombre_parte::text AS nombre_parte,
          x.especie::text AS especie,
          x.destino::text AS destino,
          x.empresa_destino::text AS empresa_destino,
          x.sucursal::text AS sucursal,
          x.mun_sucursal::text AS mun_sucursal,
          x.dep_sucursal::text AS dep_sucursal
        FROM desposte.guia_desposte_producto x
        WHERE x.id_guia_desposte = $1
        ORDER BY x.id ASC
      `,
      values: [idGuia],
    },
  ];

  for (const q of intents) {
    try {
      const res = await pool.query(q.text, q.values);
      if (Array.isArray(res?.rows) && res.rows.length) return res.rows;
    } catch {
      // Ignore and continue with the next candidate query.
    }
  }
  return [];
}

export async function obtenerGuiaPorCodigo(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;

  const cabRes = await pool.query(
    `
    WITH ult AS (
      SELECT
        gd.*
      FROM desposte.guia_desposte gd
      ORDER BY gd.id DESC
      LIMIT 30000
    )
    SELECT *
    FROM ult
    WHERE UPPER(TRIM(codigo)) = UPPER(TRIM($1))
    ORDER BY id DESC
    LIMIT 1
    `,
    [cod]
  );

  if (!cabRes.rowCount) return null;
  const row = cabRes.rows[0];
  const detalle = await consultarDetalleGuia(row);
  const placa = txt(first(row, ['placa', 'placa_vehiculo', 'id_vehiculo']));
  const conductorNombre = txt(first(row, ['conductor_nombre', 'nombre_conductor', 'conductor']));
  const usuarioGuia = txt(first(row, ['usuario_guia', 'user_name', 'usuario', 'created_by']));
  const tipoDespachoNombre = txt(
    first(row, ['tipo_despacho_nombre', 'nombre_tipo_despacho', 'tipo_despacho'])
  );
  const numeroGuiaTransporte = txt(
    first(row, ['numero_guia_transporte', 'guia_transporte', 'num_guia_transporte'])
  );
  const numeroGuiaTransporteCompleto = txt(
    first(row, ['numero_guia_transporte_completo', 'guia_transporte_completa'])
  );

  return {
    cabecera: {
      id: row.id,
      codigo: txt(row.codigo),
      fecha_creacion: iso(first(row, ['fecha_creacion', 'created_at'])),
      fecha_fin_vigencia: iso(first(row, ['fecha_fin_vigencia', 'vigencia_hasta'])),
      conservacion: txt(row.conservacion),
      id_empresa: row.id_empresa ?? null,
      id_especie: row.id_especie ?? null,
      placa,
      id_conductor: row.id_conductor ?? null,
      conductor_nombre: conductorNombre,
      responsable: txt(row.responsable),
      observaciones_guia: txt(first(row, ['observaciones_guia', 'observaciones'])),
      total_productos: num(row.total_productos),
      hallazgos_productos: num(row.hallazgos_productos),
      cantidad_canal: num(row.cantidad_canal),
      cantidad_cuarto_canal: num(row.cantidad_cuarto_canal),
      cantidad_lengua: num(row.cantidad_lengua),
      usuario_guia: usuarioGuia,
      id_vehiculo_asignado: first(row, ['id_vehiculo_asignado', 'id_vehiculo']) ?? null,
      precinto: txt(first(row, ['precinto', 'numero_precinto'])),
      destinos: txt(first(row, ['destinos', 'destino'])),
      elaborado_por: txt(first(row, ['elaborado_por', 'creado_por'])),
      fecha_salida: iso(first(row, ['fecha_salida'])),
      hora_salida: txt(first(row, ['hora_salida'])),
      tipo_despacho_nombre: tipoDespachoNombre,
      texto_guia_tipo: txt(first(row, ['texto_guia_tipo', 'texto_guia'])),
      numero_guia_transporte: numeroGuiaTransporte,
      numero_guia_transporte_completo: numeroGuiaTransporteCompleto,
    },
    detalle: detalle.map((d) => ({
      id_producto: txt(d.id_producto),
      identificacion: txt(d.identificacion),
      observaciones: txt(d.observaciones),
      fecha_registro: iso(d.fecha_registro),
      peso_despacho: d.peso_despacho != null ? Number(d.peso_despacho) : null,
      nombre_parte: txt(d.nombre_parte),
      especie: txt(d.especie),
      destino: txt(d.destino),
      empresa_destino: txt(d.empresa_destino),
      sucursal: txt(d.sucursal),
      mun_sucursal: txt(d.mun_sucursal),
      dep_sucursal: txt(d.dep_sucursal),
    })),
  };
}

export async function generarGuiaPorFechaYCategoria(fecha, categoria) {
  const fechaIso = String(fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaIso)) {
    const err = new Error('Fecha inválida. Use formato YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
  const def = definicionCategoriaGuia(categoria);
  if (!def) {
    const err = new Error('Categoría inválida. Use CAT, DERIVADOS o GLOBAL HIDES.');
    err.status = 400;
    throw err;
  }

  const [rowsDia, salidas, cabeceraReal] = await Promise.all([
    obtenerLibrillosPorFecha(fechaIso),
    obtenerSalidas(),
    obtenerCabeceraRealPorFechaYCategoria(fechaIso, def),
  ]);
  const listaDia = Array.isArray(rowsDia) ? rowsDia : [];
  const salidasDia = (Array.isArray(salidas) ? salidas : [])
    .filter((s) => diaOperativoSalidaISO(s?.fecha_salida) === fechaIso)
    .map((s) => ({
      id_producto: String(s?.id_producto || '').trim(),
      fecha_salida: s?.fecha_salida || null,
    }))
    .filter((s) => s.id_producto);
  const mapSalida = new Map(salidasDia.map((s) => [s.id_producto, s]));

  const detalleBase = listaDia.filter((d) => {
    const cod = String(d?.agrupacion_codigo || '').trim().toLowerCase();
    return def.codigos.has(cod) && esDespachadoEnFecha(d, fechaIso, mapSalida);
  });

  if (!detalleBase.length) {
    const err = new Error(`No hay productos despachados para ${def.etiqueta} en ${fechaIso}.`);
    err.status = 404;
    throw err;
  }

  const detalle = detalleBase.map((d) => {
    const id = String(d?.id_producto || '').trim();
    const fechaSalidaEff = salidaEfectivaRegistro(d, mapSalida);
    return {
      id_producto: id,
      identificacion: txt(d?.identificacion),
      observaciones: txt(d?.observacion || d?.observaciones),
      fecha_registro: iso(fechaSalidaEff),
      peso_despacho: null,
      nombre_parte: 'Librillo',
      especie: null,
      destino: txt(d?.destino || d?.cliente_destino),
      empresa_destino: txt(d?.empresa_destino),
      sucursal: txt(d?.sucursal || d?.plaza),
      mun_sucursal: null,
      dep_sucursal: null,
    };
  });

  const subconteos = {
    cat: 0,
    asurcarnescol: 0,
    derivados_carnicos: 0,
    asurcarnes: 0,
    global_hides: 0,
    asurcarnes_glo: 0,
  };
  detalleBase.forEach((d) => {
    const c = String(d?.agrupacion_codigo || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(subconteos, c)) subconteos[c] += 1;
  });

  const pendientesHoy = listaDia.filter((d) => {
    const cod = String(d?.agrupacion_codigo || '').trim().toLowerCase();
    if (!def.codigos.has(cod)) return false;
    return !esDespachadoEnFecha(d, fechaIso, mapSalida);
  }).length;

  const destinos = [...new Set(detalle.map((d) => d.destino).filter(Boolean))].join(', ') || null;
  const fechaCreacion = new Date(`${fechaIso}T12:00:00-05:00`).toISOString();
  const codigoGuia = txt(cabeceraReal?.codigo) || `AUTO-${def.key.toUpperCase()}-${fechaIso.replaceAll('-', '')}`;
  const principalDestino =
    def.key === 'cat' ? 'Piedecuesta' : 'Bucaramanga';
  const observacionProducto = 'LIBROS CRUDOS';
  const especie = 'bovina';
  const fechaSalidaReal = iso(first(cabeceraReal, ['fecha_salida', 'fecha_creacion', 'created_at']));
  const horaDespacho = txt(first(cabeceraReal, ['hora_salida'])) || extraerHoraBogota(fechaSalidaReal || fechaCreacion);
  const placaReal = txt(first(cabeceraReal, ['placa', 'placa_vehiculo', 'id_vehiculo']));
  const conductorReal = txt(first(cabeceraReal, ['conductor_nombre', 'nombre_conductor', 'conductor']));
  const idConductorReal = first(cabeceraReal, ['id_conductor']) ?? null;
  const precintoReal = txt(first(cabeceraReal, ['precinto', 'numero_precinto']));
  const numeroGuiaReal = txt(
    first(cabeceraReal, ['numero_guia_transporte_completo', 'numero_guia_transporte', 'guia_transporte'])
  ) || GUIA_PLANTA_DEFAULT.numero_guia_default;
  const conservacionReal = txt(first(cabeceraReal, ['conservacion'])) || 'Refrigerado';
  const tipoVehiculoReal = txt(first(cabeceraReal, ['tipo_vehiculo'])) || GUIA_PLANTA_DEFAULT.tipo_vehiculo_default;
  const isotermoReal = txt(first(cabeceraReal, ['isotermo']));
  const decomisoReal = num(first(cabeceraReal, ['decomiso', 'cantidad_decomiso']));

  return {
    cabecera: {
      id: null,
      codigo: codigoGuia,
      fecha_creacion: fechaSalidaReal || fechaCreacion,
      fecha_fin_vigencia: null,
      conservacion: conservacionReal,
      id_empresa: null,
      id_especie: null,
      placa: placaReal,
      id_conductor: idConductorReal,
      conductor_nombre: conductorReal,
      responsable: 'COLBEEF',
      observaciones_guia: `Guía generada automáticamente por fecha de salida (${fechaIso}) para ${def.etiqueta}.`,
      total_productos: detalle.length,
      hallazgos_productos: 0,
      cantidad_canal: 0,
      cantidad_cuarto_canal: 0,
      cantidad_lengua: 0,
      usuario_guia: 'sistema',
      id_vehiculo_asignado: null,
      precinto: precintoReal,
      destinos,
      elaborado_por: 'COLBEEF',
      fecha_salida: fechaSalidaReal || fechaCreacion,
      hora_salida: horaDespacho,
      tipo_despacho_nombre: def.etiqueta,
      texto_guia_tipo: `Despacho ${def.etiqueta}`,
      numero_guia_transporte: numeroGuiaReal,
      numero_guia_transporte_completo: numeroGuiaReal,
      planta_beneficio: GUIA_PLANTA_DEFAULT.planta_beneficio,
      direccion_planta: GUIA_PLANTA_DEFAULT.direccion,
      codigo_invima: GUIA_PLANTA_DEFAULT.codigo_invima,
      departamento_planta: GUIA_PLANTA_DEFAULT.departamento,
      ciudad_planta: GUIA_PLANTA_DEFAULT.ciudad,
      tipo_vehiculo: tipoVehiculoReal,
      especie_producto: especie,
      observacion_producto: observacionProducto,
      destino_principal: principalDestino,
      isotermo: isotermoReal,
      decomiso: decomisoReal,
      resumen_categoria: {
        pendientes_hoy: pendientesHoy,
        cat: subconteos.cat,
        asurcarnescol: subconteos.asurcarnescol,
        derivados: subconteos.derivados_carnicos,
        asurcarnes: subconteos.asurcarnes,
        global_hides: subconteos.global_hides,
        asurcarnes_glo: subconteos.asurcarnes_glo,
      },
      firma_responsable: GUIA_PLANTA_DEFAULT.responsable_firma,
      firma_cedula: GUIA_PLANTA_DEFAULT.cedula_responsable,
      firma_cargo: GUIA_PLANTA_DEFAULT.cargo_responsable,
      fuentes: {
        productos_despachados: 'obtenerLibrillosPorFecha + obtenerSalidas',
        conteos_categoria: 'agrupacion_codigo en librillos del dia',
        cabecera_transporte: cabeceraReal ? 'desposte.guia_desposte' : 'fallback interno',
      },
    },
    detalle,
  };
}

export async function verificarFuentesGuiaPorFechaYCategoria(fecha, categoria) {
  const fechaIso = String(fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaIso)) {
    const err = new Error('Fecha inválida. Use formato YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
  const def = definicionCategoriaGuia(categoria);
  if (!def) {
    const err = new Error('Categoría inválida. Use CAT, DERIVADOS o GLOBAL HIDES.');
    err.status = 400;
    throw err;
  }

  const [rowsDia, salidas, cabeceraReal] = await Promise.all([
    obtenerLibrillosPorFecha(fechaIso),
    obtenerSalidas(),
    obtenerCabeceraRealPorFechaYCategoria(fechaIso, def),
  ]);
  const listaDia = Array.isArray(rowsDia) ? rowsDia : [];
  const salidasDia = (Array.isArray(salidas) ? salidas : [])
    .filter((s) => diaOperativoSalidaISO(s?.fecha_salida) === fechaIso)
    .map((s) => String(s?.id_producto || '').trim())
    .filter(Boolean);
  const salidasDiaSet = new Set(salidasDia);

  const categoriaDia = listaDia.filter((d) => {
    const cod = String(d?.agrupacion_codigo || '').trim().toLowerCase();
    return def.codigos.has(cod);
  });
  const categoriaDespachados = categoriaDia.filter((d) => {
    return esDespachadoEnFecha(d, fechaIso, salidasDiaSet);
  });
  const categoriaPendientes = categoriaDia.filter((d) => {
    return !esDespachadoEnFecha(d, fechaIso, salidasDiaSet);
  });

  return {
    fecha: fechaIso,
    categoria: def.etiqueta,
    fuentes: {
      librillos_dia: 'obtenerLibrillosPorFecha(fecha)',
      salidas_dia: 'obtenerSalidas() filtrado por diaOperativoSalidaISO',
      cabecera_transporte: cabeceraReal ? 'desposte.guia_desposte (match por fecha+categoria)' : 'fallback',
    },
    resumen: {
      total_librillos_dia: listaDia.length,
      total_salidas_dia: salidasDiaSet.size,
      total_categoria_dia: categoriaDia.length,
      total_categoria_despachados: categoriaDespachados.length,
      total_categoria_pendientes: categoriaPendientes.length,
    },
    cabecera_real: cabeceraReal
      ? {
          id: cabeceraReal.id ?? null,
          codigo: txt(cabeceraReal.codigo),
          fecha_creacion: iso(first(cabeceraReal, ['fecha_creacion', 'created_at'])),
          fecha_salida: iso(first(cabeceraReal, ['fecha_salida'])),
          conductor: txt(first(cabeceraReal, ['conductor_nombre', 'nombre_conductor', 'conductor'])),
          placa: txt(first(cabeceraReal, ['placa', 'placa_vehiculo', 'id_vehiculo'])),
          precinto: txt(first(cabeceraReal, ['precinto', 'numero_precinto'])),
        }
      : null,
    muestra_ids: {
      despachados: categoriaDespachados.slice(0, 20).map((d) => String(d?.id_producto || '').trim()),
      pendientes: categoriaPendientes.slice(0, 20).map((d) => String(d?.id_producto || '').trim()),
    },
  };
}

