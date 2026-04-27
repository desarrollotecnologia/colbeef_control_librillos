import { obtenerResumenAnalytics, registrarEventoAnalytics } from '../services/analytics.service.js';

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
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost'
  );
}

function autorizadoResumen(req) {
  const secret = String(process.env.ANALYTICS_ADMIN_KEY || '').trim();
  const tokenHeader = String(req.headers['x-analytics-key'] || '').trim();
  if (secret) {
    return tokenHeader === secret;
  }
  // Fallback: si no hay clave configurada, solo permitir desde localhost.
  return esLoopback(clientIp(req));
}

export async function postAnalyticsEvent(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sessionId = String(body.sessionId || '').trim();
    const eventName = String(body.eventName || '').trim();
    if (!sessionId || !eventName) {
      return res.status(400).json({ error: 'sessionId y eventName son obligatorios' });
    }

    await registrarEventoAnalytics({
      sessionId,
      eventName,
      viewName: body.viewName || null,
      durationMs: body.durationMs,
      userName: body.userName || null,
      path: body.path || req.path,
      userAgent: req.headers['user-agent'] || null,
      ip: clientIp(req),
      meta: body.meta || null,
    });
    return res.status(202).json({ ok: true });
  } catch (error) {
    console.error('analytics.post error:', error.message || error);
    return res.status(500).json({ error: 'No se pudo registrar el evento de analitica' });
  }
}

export async function getAnalyticsResumen(req, res) {
  try {
    if (!autorizadoResumen(req)) {
      return res.status(403).json({
        error: 'Acceso denegado al resumen de analitica',
      });
    }

    const { desde, hasta } = req.query;
    if (desde && !isFechaIso(desde)) {
      return res.status(400).json({ error: 'desde debe ser YYYY-MM-DD' });
    }
    if (hasta && !isFechaIso(hasta)) {
      return res.status(400).json({ error: 'hasta debe ser YYYY-MM-DD' });
    }
    if (desde && hasta && desde > hasta) {
      return res.status(400).json({ error: 'desde no puede ser mayor que hasta' });
    }

    const data = await obtenerResumenAnalytics({ desde, hasta });
    return res.json(data);
  } catch (error) {
    console.error('analytics.resumen error:', error.message || error);
    return res.status(500).json({ error: 'No se pudo obtener el resumen de analitica' });
  }
}
