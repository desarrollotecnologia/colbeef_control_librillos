import {
  generarGuiaPorFechaYCategoria,
  obtenerGuiaPorCodigo,
  verificarFuentesGuiaPorFechaYCategoria,
} from '../services/guias.service.js';

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

export async function getGuiaGenerada(req, res) {
  try {
    const fecha = String(req.query?.fecha || '').trim();
    const categoria = String(req.query?.categoria || '').trim();
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
    if (!categoria) return res.status(400).json({ error: 'Categoría requerida' });
    const data = await generarGuiaPorFechaYCategoria(fecha, categoria);
    return res.json(data);
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: err?.message || 'Solicitud inválida' });
    }
    console.error('❌ getGuiaGenerada:', err?.message || err);
    return res.status(500).json({ error: 'No se pudo generar la guía' });
  }
}

export async function getVerificacionGuia(req, res) {
  try {
    const fecha = String(req.query?.fecha || '').trim();
    const categoria = String(req.query?.categoria || '').trim();
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
    if (!categoria) return res.status(400).json({ error: 'Categoría requerida' });
    const data = await verificarFuentesGuiaPorFechaYCategoria(fecha, categoria);
    return res.json(data);
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: err?.message || 'Solicitud inválida' });
    }
    console.error('❌ getVerificacionGuia:', err?.message || err);
    return res.status(500).json({ error: 'No se pudo verificar la guía' });
  }
}

