/**
 * Día calendario en America/Bogota sobre timestamptz `fecha_registro`.
 * Rango en columna cruda suele aprovechar índice btree(fecha_registro) mejor que DATE(column).
 */
export const SQL_EXPR_FECHA_PARTE_BOGOTA = `(fecha_registro AT TIME ZONE 'America/Bogota')::date`;

/** WHERE: $1 = fecha ISO (YYYY-MM-DD) como día en Bogotá. */
export const SQL_WHERE_PARTE_DIA_BOGOTA_P1 = `fecha_registro >= ($1::date AT TIME ZONE 'America/Bogota')
      AND fecha_registro < (($1::date + INTERVAL '1 day') AT TIME ZONE 'America/Bogota')`;
