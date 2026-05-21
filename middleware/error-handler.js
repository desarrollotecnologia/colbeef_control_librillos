import { log } from '../lib/logger.js';

export function errorHandlerMiddleware(err, req, res, _next) {
  const status = Number(err.status || err.statusCode) || 500;
  const code = err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  log.error(err.message || 'Error', {
    requestId: req.requestId,
    path: req.path,
    code,
    status,
  });
  if (res.headersSent) return;
  res.status(status).json({
    ok: false,
    error: err.message || 'Error interno',
    code,
    requestId: req.requestId,
  });
}
