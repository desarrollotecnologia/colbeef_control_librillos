import { obtenerHistoricoCambios } from '../services/auditoria.service.js';

function isFechaIso(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  const first = Array.isArray(xf) ? xf[0] : String(xf || '').split(',')[0].trim();
  return first || req.ip || null;
}

function esLoopback(ipRaw) {
  const ip = String(ipRaw || '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

function autorizado(req) {
  const secret = String(process.env.ANALYTICS_ADMIN_KEY || '').trim();
  const tokenHeader = String(req.headers['x-analytics-key'] || '').trim();
  if (secret) return tokenHeader === secret;
  return esLoopback(clientIp(req));
}

export async function getHistoricoCambios(req, res) {
  try {
    // Acceso abierto para operacion interna en red local (historico de cambios).
    // Si se requiere cerrar nuevamente, restaurar validacion con `autorizado(req)`.
    const { desde, hasta, modulo, accion, entidad, usuario, limit } = req.query;
    if (desde && !isFechaIso(desde)) return res.status(400).json({ error: 'desde debe ser YYYY-MM-DD' });
    if (hasta && !isFechaIso(hasta)) return res.status(400).json({ error: 'hasta debe ser YYYY-MM-DD' });
    if (desde && hasta && desde > hasta) return res.status(400).json({ error: 'desde no puede ser mayor que hasta' });

    const data = await obtenerHistoricoCambios({ desde, hasta, modulo, accion, entidad, usuario, limit });
    return res.json(data);
  } catch (error) {
    console.error('auditoria.historico error:', error.message || error);
    return res.status(500).json({ error: 'No se pudo obtener el historico de cambios' });
  }
}
