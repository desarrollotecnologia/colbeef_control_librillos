import { randomUUID } from 'node:crypto';

/** Usuario operativo: header X-Colbeef-Usuario o body.usuario (solo escrituras). */
export function requestContextMiddleware(req, res, next) {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  const fromHeader = String(req.headers['x-colbeef-usuario'] || '').trim();
  const fromBody =
    req.body && typeof req.body === 'object' && req.body.usuario != null
      ? String(req.body.usuario).trim()
      : '';
  req.colbeefUsuario = fromHeader || fromBody || 'usuario';
  next();
}

export function usuarioOperacion(req) {
  return String(req?.colbeefUsuario || 'usuario').slice(0, 120);
}
