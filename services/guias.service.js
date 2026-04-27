import { pool } from '../config/db.js';

function txt(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function obtenerGuiaPorCodigo(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;

  const cabRes = await pool.query(
    `
    WITH ult AS (
      SELECT
        gd.id,
        gd.codigo,
        gd.fecha_creacion,
        gd.fecha_fin_vigencia,
        gd.conservacion,
        gd.id_empresa,
        gd.id_especie,
        gd.id_vehiculo,
        gd.id_conductor,
        gd.responsable,
        gd.observaciones AS observaciones_guia,
        gd.total_productos,
        gd.hallazgos_productos,
        gd.cantidad_canal,
        gd.cantidad_cuarto_canal,
        gd.cantidad_lengua,
        gd.user_name AS usuario_guia
      FROM desposte.guia_desposte gd
      ORDER BY gd.id DESC
      LIMIT 30000
    )
    SELECT *
    FROM ult
    WHERE UPPER(TRIM(codigo)) = UPPER(TRIM($1))
    ORDER BY id DESC
    LIMIT 1
    `,
    [cod]
  );

  if (!cabRes.rowCount) return null;
  const row = cabRes.rows[0];

  const detalle = [];

  return {
    cabecera: {
      id: row.id,
      codigo: txt(row.codigo),
      fecha_creacion: iso(row.fecha_creacion),
      fecha_fin_vigencia: iso(row.fecha_fin_vigencia),
      conservacion: txt(row.conservacion),
      id_empresa: row.id_empresa ?? null,
      id_especie: row.id_especie ?? null,
      placa: txt(row.id_vehiculo) || txt(row.placa_vehiculo),
      id_conductor: row.id_conductor ?? null,
      conductor_nombre: null,
      responsable: txt(row.responsable),
      observaciones_guia: txt(row.observaciones_guia),
      total_productos: num(row.total_productos),
      hallazgos_productos: num(row.hallazgos_productos),
      cantidad_canal: num(row.cantidad_canal),
      cantidad_cuarto_canal: num(row.cantidad_cuarto_canal),
      cantidad_lengua: num(row.cantidad_lengua),
      usuario_guia: txt(row.usuario_guia),
      id_vehiculo_asignado: null,
      precinto: null,
      destinos: null,
      elaborado_por: null,
      fecha_salida: null,
      hora_salida: null,
      tipo_despacho_nombre: null,
      texto_guia_tipo: null,
      numero_guia_transporte: null,
      numero_guia_transporte_completo: null,
    },
    detalle: detalle.map((d) => ({
      id_producto: txt(d.id_producto),
      identificacion: txt(d.identificacion),
      observaciones: txt(d.observaciones),
      fecha_registro: iso(d.fecha_registro),
      peso_despacho: d.peso_despacho != null ? Number(d.peso_despacho) : null,
      nombre_parte: txt(d.nombre_parte),
      especie: txt(d.especie),
      destino: txt(d.destino),
      empresa_destino: txt(d.empresa_destino),
      sucursal: txt(d.sucursal),
      mun_sucursal: txt(d.mun_sucursal),
      dep_sucursal: txt(d.dep_sucursal),
    })),
  };
}

