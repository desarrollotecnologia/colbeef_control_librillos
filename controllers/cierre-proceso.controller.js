import {
  obtenerEstadoCierreProceso,
  registrarCierreProceso,
  revisarCambiosSucursalPostCierre,
} from '../services/cierre-proceso.service.js';

function validarFechaParam(req, res) {
  const fecha = String(req.params.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    res.status(400).json({ error: 'fecha debe ser YYYY-MM-DD' });
    return null;
  }
  return fecha;
}

export const getCierreEstado = async (req, res) => {
  try {
    const fecha = validarFechaParam(req, res);
    if (!fecha) return;
    const data = await obtenerEstadoCierreProceso(fecha);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al leer estado de cierre' });
  }
};

export const postCierreRegistrar = async (req, res) => {
  try {
    const fecha = validarFechaParam(req, res);
    if (!fecha) return;
    const usuario = req.body?.usuario != null ? String(req.body.usuario) : null;
    const out = await registrarCierreProceso(fecha, usuario);
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Error al registrar cierre' });
  }
};

export const postCierreRevisar = async (req, res) => {
  try {
    const fecha = validarFechaParam(req, res);
    if (!fecha) return;
    const out = await revisarCambiosSucursalPostCierre(fecha);
    res.json(out);
  } catch (e) {
    if (e.code === 'NO_CIERRE') {
      return res.status(404).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: e.message || 'Error al revisar cambios' });
  }
};
