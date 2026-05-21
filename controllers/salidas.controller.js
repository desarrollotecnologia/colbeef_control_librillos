import {
  obtenerSalidas,
  registrarSalidas,
  editarSalida,
  eliminarSalida,
} from '../services/salidas.service.js';
import { usuarioOperacion } from '../middleware/request-context.js';

// GET /api/salidas
export const getSalidas = async (req, res) => {
  try {
    res.json(await obtenerSalidas());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/salidas — body: { ids_productos: [...], rol: 'usuario'|'admin' }
export const postSalidas = async (req, res) => {
  try {
    const { ids_productos } = req.body;
    if (!ids_productos || !Array.isArray(ids_productos) || ids_productos.length === 0) {
      return res.status(400).json({ error: 'ids_productos requerido' });
    }
    const nuevas = await registrarSalidas(ids_productos, usuarioOperacion(req));
    res.json({ registradas: nuevas.length, salidas: nuevas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// PUT /api/salidas/:id — body: { fecha_salida, rol }
export const putSalida = async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha_salida } = req.body;
    const resultado = await editarSalida(id, fecha_salida, usuarioOperacion(req));
    if (!resultado) return res.status(404).json({ error: 'Salida no encontrada' });
    if (resultado.error) return res.status(403).json(resultado);
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /api/salidas/:id — solo admin
export const deleteSalida = async (req, res) => {
  try {
    const { id } = req.params;
    const { rol } = req.body;
    if (rol !== 'admin') return res.status(403).json({ error: 'Solo admin puede eliminar' });
    const ok = await eliminarSalida(id, usuarioOperacion(req));
    if (!ok) return res.status(404).json({ error: 'Salida no encontrada' });
    res.json({ eliminado: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
