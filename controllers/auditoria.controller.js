import {
  obtenerHistoricoCambios,
  obtenerReimpresionesCrudasMap,
  registrarReimpresionCrudas,
} from '../services/auditoria.service.js';
import { usuarioOperacion } from '../middleware/request-context.js';

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

/** GET /api/auditoria/reimpresion-crudas?fecha_plan=&fecha_revision= */
export async function getReimpresionesCrudas(req, res) {
  try {
    const fechaPlan = String(req.query.fecha_plan || '').trim();
    const fechaRevision = String(req.query.fecha_revision || '').trim();
    if (!isFechaIso(fechaPlan) || !isFechaIso(fechaRevision)) {
      return res.status(400).json({ error: 'fecha_plan y fecha_revision deben ser YYYY-MM-DD' });
    }
    const map = await obtenerReimpresionesCrudasMap(fechaPlan, fechaRevision);
    const reimpresos = [...map.entries()].map(([id_producto, info]) => ({
      id_producto,
      ...info,
    }));
    return res.json({
      fecha_plan: fechaPlan,
      fecha_revision: fechaRevision,
      total: reimpresos.length,
      reimpresos,
    });
  } catch (error) {
    console.error('auditoria.reimpresion-crudas GET:', error.message || error);
    return res.status(500).json({ error: 'No se pudo leer reimpresiones de crudas' });
  }
}

/** POST /api/auditoria/reimpresion-crudas — body: { fecha_plan, fecha_revision, items: [...] } */
export async function postReimpresionCrudas(req, res) {
  try {
    const { fecha_plan, fecha_revision, items } = req.body || {};
    const row = await registrarReimpresionCrudas({
      fecha_plan,
      fecha_revision,
      items,
      usuario: usuarioOperacion(req),
    });
    return res.json({ ok: true, registrado: row });
  } catch (error) {
    const msg = String(error.message || error);
    if (msg.includes('YYYY-MM-DD') || msg.includes('items requiere')) {
      return res.status(400).json({ error: msg });
    }
    console.error('auditoria.reimpresion-crudas POST:', msg);
    return res.status(500).json({ error: 'No se pudo registrar la reimpresión' });
  }
}
