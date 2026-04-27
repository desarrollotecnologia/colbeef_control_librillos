/**
 * Tipo de parte para librillos/visceras blancas.
 * Se puede sobreescribir por .env con ID_TIPO_PARTE_COLBEEF.
 * Default operativo: 14 (según evidencia en BD real).
 */
const raw = Number.parseInt(String(process.env.ID_TIPO_PARTE_COLBEEF || ''), 10);
export const ID_TIPO_PARTE_COLBEEF = Number.isFinite(raw) && raw > 0 ? raw : 14;
