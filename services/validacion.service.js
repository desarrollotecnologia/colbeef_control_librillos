import { obtenerLibrillosPorFecha } from './librillos.service.js';
import { obtenerSalidas } from './salidas.service.js';

function normalizarObs(obs) {
  return String(obs || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function clasificarMovimiento(d) {
  const obsRaw = String(d?.observacion || '').trim();
  const obs = normalizarObs(obsRaw);
  const vacia = obs === '';
  const tieneRetiro =
    !!(d?.cliente_destino && String(d.cliente_destino).trim()) ||
    /RETIRAR\s+LIBRILLOS\b/.test(obs);
  const tieneCrudas = /\bCRUDAS?\b/.test(obs);
  const tieneAcond = /\bACONDICIONAMIENTO\b/.test(obs);

  const casoSoloCrudas = tieneCrudas && !tieneRetiro;
  const casoSoloRetiro = tieneRetiro && !tieneCrudas;
  const casoCrudasMasRetiro = tieneCrudas && tieneRetiro;
  const casoAcond = tieneAcond && !tieneRetiro;

  const librillo = casoSoloRetiro || casoCrudasMasRetiro;
  const viscera =
    vacia || casoSoloCrudas || casoCrudasMasRetiro || casoAcond || (!tieneRetiro && !vacia);
  const visceraCruda = casoSoloCrudas || casoCrudasMasRetiro;

  return { librillo, viscera, visceraCruda, vacia, tieneRetiro, tieneCrudas, tieneAcond };
}

function esVistaHistorialLibrillos(d) {
  return clasificarMovimiento(d).tieneRetiro;
}

function esVistaHistorialCrudasSolo(d) {
  const c = clasificarMovimiento(d);
  if (c.tieneRetiro) return false;
  const obs = normalizarObs(String(d?.observacion || ''));
  return obs === 'CRUDAS' || obs === 'CRUDA';
}

/** Misma regla que el front: fecha calendario Bogotá del timestamp */
function diaDesdeTimestamp(val) {
  if (!val) return null;
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function salidaEnDia(salidas, idProducto, fechaISO) {
  return (salidas || []).some(
    (s) => s.id_producto === idProducto && diaDesdeTimestamp(s.fecha_salida) === fechaISO
  );
}

/**
 * Cuadre de movimientos para un día operativo (fecha YYYY-MM-DD).
 */
export async function obtenerValidacionMovimientos(fechaISO) {
  const [datos, salidas] = await Promise.all([
    obtenerLibrillosPorFecha(fechaISO),
    obtenerSalidas(),
  ]);

  const total_registros = datos.length;
  const sin_datos_vista = datos.filter((d) => !d.enriquecido).length;

  const idsLibrillos = datos.filter(esVistaHistorialLibrillos);
  const pendientes_despacho_librillos = idsLibrillos.filter(
    (d) => !salidaEnDia(salidas, d.id_producto, fechaISO)
  ).length;

  const idsCrudas = datos.filter(esVistaHistorialCrudasSolo);
  const pendientes_despacho_crudas = idsCrudas.filter(
    (d) => !salidaEnDia(salidas, d.id_producto, fechaISO)
  ).length;

  const despachos_dia = salidas.filter((s) => diaDesdeTimestamp(s.fecha_salida) === fechaISO).length;

  const retiros_sin_cliente_parseado = idsLibrillos.filter(
    (d) => !d.cliente_destino || !String(d.cliente_destino).trim()
  ).length;

  const alertas = [];
  if (sin_datos_vista > 0) {
    alertas.push({
      codigo: 'sin_vista',
      texto: `${sin_datos_vista} registro(s) sin fila en vw_pbi01 para el ID (revisar trazabilidad)`,
    });
  }
  if (retiros_sin_cliente_parseado > 0) {
    alertas.push({
      codigo: 'retiro_sin_cliente',
      texto: `${retiros_sin_cliente_parseado} retiro(s) con texto «RETIRAR LIBRILLOS» sin cliente destino parseado`,
    });
  }
  if (pendientes_despacho_librillos > 0) {
    alertas.push({
      codigo: 'pendientes_librillos',
      texto: `${pendientes_despacho_librillos} librillo(s) con retiro sin despacho registrado hoy`,
    });
  }

  const ok = sin_datos_vista === 0 && retiros_sin_cliente_parseado === 0;

  return {
    fecha: fechaISO,
    total_registros,
    sin_datos_vista,
    librillos_con_retiro: idsLibrillos.length,
    pendientes_despacho_librillos,
    crudas_historial: idsCrudas.length,
    pendientes_despacho_crudas,
    despachos_registrados_dia: despachos_dia,
    retiros_sin_cliente_parseado,
    ok,
    alertas,
  };
}
