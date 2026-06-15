/**
 * Cálculo del resumen macro diario (sin I/O).
 */
import {
  RESUMEN_RECODIFICAR_ASUR_PENDIENTE_A_COCIDOS,
  RESUMEN_SOLO_PARTE_DIA,
} from '../../config/reglas-librillos.js';

function textoMarcasResumenLibrillo(d) {
  return [d?.observaciones, d?.observacion, d?.observacion_plan, d?.observaciones_parte, d?.texto_retiro_obs]
    .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sinMarcasDiacriticos(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * @param {string} fecha
 * @param {object[]} rowsAll
 * @param {object|null} meta_universo
 * @param {object} opcionesEnv
 */
export function calcularResumenMacro(fecha, rowsAll, meta_universo, opcionesEnv = {}) {
  const rows = RESUMEN_SOLO_PARTE_DIA
    ? rowsAll.filter((d) => !Boolean(d?.pendiente_registro_parte))
    : rowsAll;
  const pendientes = rowsAll.filter((d) => Boolean(d?.pendiente_registro_parte)).length;
  const countCod = new Map();
  const inc = (k) => countCod.set(k, Number(countCod.get(k) || 0) + 1);
  const textoObs = (d) => textoMarcasResumenLibrillo(d);
  const esCruda = (d) => /\bCRUDAS?\b/i.test(textoObs(d));
  const tieneEstiloBogota = (d) => {
    const u = sinMarcasDiacriticos(textoObs(d)).toUpperCase();
    return u.includes('ESTILO BOGOTA');
  };
  const esSucursalOlimpica = (d) => {
    const u = (s) => sinMarcasDiacriticos(String(s ?? '')).toUpperCase();
    return u(d?.sucursal).includes('OLIMPICA') || u(d?.plaza).includes('OLIMPICA');
  };
  const tieneCanutasEnObservacion = (d) => /\bcanutas?\b/i.test(textoObs(d));
  let chunchullasCrudas = 0;
  let estiloBogota = 0;
  let olimpica = 0;
  let canutas = 0;
  rows.forEach((d) => {
    if (tieneEstiloBogota(d)) estiloBogota += 1;
    else if (esCruda(d)) chunchullasCrudas += 1;
    if (esSucursalOlimpica(d)) olimpica += 1;
    if (tieneCanutasEnObservacion(d)) canutas += 1;
    const codRaw = String(d?.agrupacion_codigo || 'asurcarnes').trim() || 'asurcarnes';
    const recod =
      RESUMEN_RECODIFICAR_ASUR_PENDIENTE_A_COCIDOS &&
      codRaw === 'asurcarnes' &&
      Boolean(d?.pendiente_registro_parte);
    let cod = recod ? 'cocidos' : codRaw;
    const obsResumen = textoMarcasResumenLibrillo(d);
    if (cod === 'asurcarnes' && !obsResumen) cod = 'cocidos';
    inc(cod);
  });

  const categorias = {
    chunchullas_crudas: chunchullasCrudas,
    estilo_bogota: estiloBogota,
    olimpica,
    canutas,
    asurcarnes_glo: Number(countCod.get('asurcarnes_glo') || 0),
    asurcarnescol: Number(countCod.get('asurcarnescol') || 0),
    global_hides: Number(countCod.get('global_hides') || 0),
    asurcarnes: Number(countCod.get('asurcarnes') || 0),
    cat: Number(countCod.get('cat') || 0),
    derivados: Number(countCod.get('derivados_carnicos') || 0),
    cocidos: Number(countCod.get('cocidos') || 0),
    total: rows.length,
    total_plan_faena: Number(meta_universo?.total_plan_faena) || rows.length,
  };

  const resumenLibros = {
    crudos: categorias.cat + categorias.asurcarnescol,
    cocidos: categorias.cocidos,
    derivados: categorias.derivados + categorias.asurcarnes + categorias.global_hides,
  };
  resumenLibros.total = resumenLibros.crudos + resumenLibros.cocidos + resumenLibros.derivados;

  return {
    fecha,
    total_registros: rows.length,
    total_planillados: rowsAll.length,
    total_pendientes_registro_parte: pendientes,
    categorias,
    resumen_libros: resumenLibros,
    meta_universo,
    opciones_resumen: {
      solo_parte_dia: RESUMEN_SOLO_PARTE_DIA,
      recodificar_asur_pendiente_a_cocidos: RESUMEN_RECODIFICAR_ASUR_PENDIENTE_A_COCIDOS,
      requiere_insensibilizacion_plan_faena: opcionesEnv.requiere_insensibilizacion_plan_faena ?? false,
      incluir_sacrificio_emergencia: opcionesEnv.incluir_sacrificio_emergencia ?? false,
    },
  };
}
