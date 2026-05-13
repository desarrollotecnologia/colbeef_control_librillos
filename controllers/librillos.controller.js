import {
  obtenerLibrillos,
  obtenerLibrillosPorFecha,
  obtenerLibrillosPorRangoFechas,
  obtenerResumenMacroPorFecha,
  obtenerObservacionesPorFecha,
  obtenerStatsUltimos7Dias,
  obtenerCrudasCambioSucursalCruceDiaAnterior,
  fechaTurnoOperativoBogotaISO,
} from '../services/librillos.service.js';
import { leerSucursalesCrudas } from '../services/crudas-sucursal.store.js';
import {
  obtenerValidacionMovimientos,
  obtenerDiagnosticoMovimientos,
  obtenerAuditoriaClasificacion,
  obtenerConfigOperacion,
} from '../services/validacion.service.js';

// GET /api/librillos?fecha=YYYY-MM-DD
// GET /api/librillos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — rango (una respuesta, más rápido que N llamadas)
// Si no hay parámetros, devuelve cache de hoy.
export const getLibrillos = async (req, res) => {
  try {
    const { fecha, desde, hasta } = req.query;

    if (desde && hasta) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
        return res.status(400).json({ error: 'desde y hasta deben ser YYYY-MM-DD' });
      }
      if (desde > hasta) {
        return res.status(400).json({ error: 'desde no puede ser mayor que hasta' });
      }
      try {
        const datos = await obtenerLibrillosPorRangoFechas(desde, hasta);
        return res.json(datos);
      } catch (e) {
        return res.status(400).json({ error: e.message || 'Rango inválido' });
      }
    }

    if (fecha) {
      // Validar formato básico YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
      }
      const datos = await obtenerLibrillosPorFecha(fecha);
      return res.json(datos);
    }

    // Sin parámetro → cache en memoria del turno; si aún vacío (arranque en frío), consultar BD.
    const resultado = obtenerLibrillos();
    let datos = Array.isArray(resultado.datos) ? resultado.datos : [];
    if (!datos.length) {
      datos = await obtenerLibrillosPorFecha(fechaTurnoOperativoBogotaISO());
    }
    return res.json(datos);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener librillos' });
  }
};

// GET /api/librillos/observaciones?fecha=YYYY-MM-DD
export const getObservaciones = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' });
    }
    const datos = await obtenerObservacionesPorFecha(fecha);
    return res.json(datos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener observaciones' });
  }
};

// GET /api/librillos/estado — Info del cache
export const getEstadoCache = (req, res) => {
  const resultado = obtenerLibrillos();
  res.json({
    total: resultado.total,
    ultimaActualizacion: resultado.ultimaActualizacion,
    mensaje: resultado.ultimaActualizacion
      ? `Última actualización: ${resultado.ultimaActualizacion.toLocaleTimeString()}`
      : 'Sin datos aún',
  });
};

// GET /api/librillos/stats — Producción últimos 7 días
export const getStats = async (req, res) => {
  try {
    const datos = await obtenerStatsUltimos7Dias();
    res.json(datos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
};

// GET /api/librillos/validacion?fecha=YYYY-MM-DD — cuadre de movimientos del día
export const getValidacion = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' });
    }
    const datos = await obtenerValidacionMovimientos(fecha);
    res.json(datos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al validar movimientos' });
  }
};

// GET /api/librillos/diagnostico?fecha=YYYY-MM-DD — desglose operativo real
export const getDiagnostico = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' });
    }
    const datos = await obtenerDiagnosticoMovimientos(fecha);
    res.json(datos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener diagnóstico' });
  }
};

// GET /api/librillos/auditoria-clasificacion?fecha=YYYY-MM-DD
export const getAuditoriaClasificacion = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' });
    }
    const datos = await obtenerAuditoriaClasificacion(fecha);
    res.json(datos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener auditoría de clasificación' });
  }
};

// GET /api/librillos/config — parámetros operativos del backend
export const getConfigOperacion = (req, res) => {
  res.json(obtenerConfigOperacion());
};

// GET /api/librillos/crudas-cambio-sucursal?fecha=YYYY-MM-DD — BD: crudas con sucursal distinta vs día anterior
export const getCrudasCambioSucursal = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' });
    }
    const datos = await obtenerCrudasCambioSucursalCruceDiaAnterior(fecha);
    return res.json(datos);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al obtener cambios de sucursal en crudas' });
  }
};

// GET /api/librillos/crudas-sucursal-guardadas — sucursal persistida solo para IDs con marca CRUDAS (turno actual)
export const getCrudasSucursalGuardadas = async (req, res) => {
  try {
    const data = await leerSucursalesCrudas();
    return res.json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al leer sucursales de crudas guardadas' });
  }
};

// GET /api/librillos/resumen?fecha=YYYY-MM-DD — resumen macro estricto del día
export const getResumenMacro = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' });
    }
    const datos = await obtenerResumenMacroPorFecha(fecha);
    return res.json(datos);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al obtener resumen macro' });
  }
};