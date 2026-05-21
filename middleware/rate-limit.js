/** Rate limit simple en memoria para rutas de escritura. */

const buckets = new Map();
const WINDOW_MS = 60_000;
const MAX_WRITES = Math.max(
  20,
  parseInt(String(process.env.RATE_LIMIT_WRITES_PER_MIN || '120'), 10) || 120
);

function keyFor(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const path = String(req.path || req.url || '');
  return `${ip}|${path}`;
}

export function writeRateLimitMiddleware(req, res, next) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const k = keyFor(req);
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now - b.start > WINDOW_MS) {
    b = { start: now, count: 0 };
    buckets.set(k, b);
  }
  b.count += 1;
  if (b.count > MAX_WRITES) {
    return res.status(429).json({
      ok: false,
      error: 'Demasiadas solicitudes; intente de nuevo en un minuto.',
      code: 'RATE_LIMIT',
      requestId: req.requestId,
    });
  }
  return next();
}

/** Limpieza periódica de buckets viejos. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > WINDOW_MS * 2) buckets.delete(k);
  }
}, WINDOW_MS * 2).unref?.();
