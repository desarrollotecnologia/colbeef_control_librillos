import { pool } from '../config/db.js';
import { SQL_WHERE_PARTE_DIA_BOGOTA_P1 } from '../config/parte-dia-bogota-sql.js';
import { ID_TIPO_PARTE_COLBEEF } from '../config/tipo-parte.js';
import { obtenerLibrillosPorFecha } from './librillos.service.js';
import { obtenerSalidas } from './salidas.service.js';

function diaDesdeTimestamp(val) {
  if (!val) return null;
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function horaBogotaHHmm(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function esAgrupacionValida(d) {
  const cod = String(d?.agrupacion_codigo || '');
  return cod !== 'otros' && cod !== 'sin_destino';
}

function tieneRetiro(d) {
  return !!(d?.cliente_destino && String(d.cliente_destino).trim());
}


export async function obtenerDashboardResumen(fechaISO) {
  const [clasificados, salidas, raw] = await Promise.all([
    obtenerLibrillosPorFecha(fechaISO),
    obtenerSalidas(),
    pool.query(
      `
      SELECT DISTINCT id_producto::text AS id_producto
      FROM trazabilidad_proceso.parte_producto
      WHERE id_tipo_parte_producto = ${ID_TIPO_PARTE_COLBEEF}
        AND ${SQL_WHERE_PARTE_DIA_BOGOTA_P1}
      `,
      [fechaISO]
    ),
  ]);

  const validos = (clasificados || []).filter(esAgrupacionValida);
  const librillos = validos.filter(tieneRetiro);
  const crudas = (validos || []).filter((d) =>
    /\bCRUDAS?\b/i.test(String(d?.observaciones ?? d?.observacion ?? ''))
  );
  const cocidos = validos.filter((d) => String(d?.agrupacion_codigo || '') === 'cocidos').length;

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
    'cocidos',
  ];
  const por_agrupacion = Object.fromEntries(agrupacionesEsperadas.map((k) => [k, 0]));
  validos.forEach((x) => {
    const k = String(x.agrupacion_codigo || '');
    if (Object.prototype.hasOwnProperty.call(por_agrupacion, k)) por_agrupacion[k] += 1;
  });

  const total_bd = raw.rows.length;
  const idsClasificados = new Set(validos.map((x) => String(x.id_producto)));
  const sin_clasificar = raw.rows
    .map((r) => String(r.id_producto))
    .filter((id) => !idsClasificados.has(id));

  const validosPorId = new Map(validos.map((x) => [String(x.id_producto), x]));

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
      const row = validosPorId.get(String(s.id_producto));
      const ac = row ? String(row.agrupacion_codigo || '') : '';
      const esCruda = /\bCRUDAS?\b/i.test(String(row?.observaciones ?? row?.observacion ?? ''));
      const tipo =
        !row ? 'N/D' : esCruda ? 'CRUDA' : ac === 'cocidos' ? 'COCIDO' : 'LIBRILLO';
      return {
        id_producto: s.id_producto,
        fecha_salida: s.fecha_salida,
        registrado_por: s.registrado_por || 'usuario',
        tipo,
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

export async function obtenerCierreOperacion(fechaISO) {
  const resumen = await obtenerDashboardResumen(fechaISO);
  const total = Number(resumen.total_librillos || 0);
  const despachados = Number(resumen.librillos_despachados || 0);
  const pendientes = Math.max(0, total - despachados);
  const cumplimiento = total > 0 ? Math.round((despachados / total) * 100) : 0;

  const ult = (resumen.ultimos_despachos || [])
    .filter((x) => x && x.fecha_salida)
    .sort((a, b) => new Date(b.fecha_salida) - new Date(a.fecha_salida))[0];
  const ultimaHora = horaBogotaHHmm(ult?.fecha_salida) || '--:--';

  const pendientesPorCliente = new Map();
  (resumen.pendientes_en_cava || []).forEach((x) => {
    const cli = String(x?.cliente_destino || x?.propietario || 'Sin cliente').trim() || 'Sin cliente';
    pendientesPorCliente.set(cli, (pendientesPorCliente.get(cli) || 0) + 1);
  });
  const topPend = [...pendientesPorCliente.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const clientePendiente = topPend ? topPend[0] : null;
  const cantidadPendientePrincipal = topPend ? Number(topPend[1] || 0) : 0;

  const lineaPendiente = pendientes > 0
    ? `⚠️ Quedan ${pendientes} vísceras pendientes${clientePendiente ? ` (principal: ${clientePendiente} ${cantidadPendientePrincipal})` : ''}.`
    : '✅ No quedan vísceras pendientes en cava.';

  const mensaje = [
    '✅ OPERACION FINALIZADA - DESPACHOS COMPLETADOS',
    `Informamos que la jornada de despachos ha sido cerrada con ${cumplimiento}% de cumplimiento.`,
    `⏱️ ${ultimaHora} ultimo despacho`,
    `📦 ${despachados} juegos despachados`,
    lineaPendiente,
    'La operacion queda oficialmente finalizada y actualizada en el sistema.',
  ].join('\n');

  return {
    fecha: fechaISO,
    cumplimiento_pct: cumplimiento,
    ultimo_despacho_hora: ultimaHora,
    juegos_despachados: despachados,
    total_juegos: total,
    pendientes,
    pendiente_principal: clientePendiente
      ? { cliente: clientePendiente, cantidad: cantidadPendientePrincipal }
      : null,
    mensaje,
  };
}

