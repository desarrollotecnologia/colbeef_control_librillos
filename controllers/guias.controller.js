import { obtenerGuiaPorCodigo } from '../services/guias.service.js';

export async function getGuiaPorCodigo(req, res) {
  try {
    const codigo = String(req.params?.codigo || '').trim();
    if (!codigo) {
      return res.status(400).json({ error: 'Código de guía requerido' });
    }
    const data = await obtenerGuiaPorCodigo(codigo);
    if (!data) {
      return res.status(404).json({ error: 'Guía no encontrada' });
    }
    return res.json(data);
  } catch (err) {
    console.error('❌ getGuiaPorCodigo:', err?.message || err);
    return res.status(500).json({ error: 'No se pudo obtener la guía' });
  }
}

