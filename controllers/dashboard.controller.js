import { obtenerDashboardResumen, obtenerCierreOperacion } from '../services/dashboard.service.js';

export const getDashboardResumen = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' });
    }
    const data = await obtenerDashboardResumen(fecha);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener resumen dashboard' });
  }
};

export const getDashboardCierre = async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' });
    }
    const data = await obtenerCierreOperacion(fecha);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener cierre operativo' });
  }
};

