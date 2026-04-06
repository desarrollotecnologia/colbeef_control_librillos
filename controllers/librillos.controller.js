import {
  obtenerLibrillos,
  obtenerLibrillosPorFecha,
  obtenerObservacionesPorFecha,
  obtenerStatsUltimos7Dias,
} from '../services/librillos.service.js';
import { obtenerValidacionMovimientos } from '../services/validacion.service.js';

// GET /api/librillos?fecha=YYYY-MM-DD
// Si hay ?fecha, consulta histórico directo; si no, devuelve cache de hoy.
export const getLibrillos = async (req, res) => {
  try {
    const { fecha } = req.query;

    if (fecha) {
      // Validar formato básico YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
      }
      const datos = await obtenerLibrillosPorFecha(fecha);
      return res.json(datos);
    }

    // Sin parámetro → cache de hoy
    const resultado = obtenerLibrillos();
    return res.json(resultado.datos);

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