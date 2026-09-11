/**
 * Clasificación librillo / víscera / cruda (cuadre y API).
 * Fuente única para validación y campo clasificacion_movimiento en filas.
 */
import {
  agrupacionDesdeObservacionCompleta,
  reglaOverrideGutierrezCarviscol,
} from './agrupaciones.service.js';
import { textoIndicaRetiroLibrillos } from '../config/plan-faena-obs.js';

const CODIGOS_RETIRO_COMERCIAL = new Set([
  'asurcarnes',
  'asurcarnescol',
  'asurcarnes_glo',
  'global_hides',
  'cat',
  'derivados_carnicos',
]);

function normalizarObs(obs) {
  return String(obs || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function clasificarMovimiento(d) {
  const obsRaw = String(d?.observaciones ?? d?.observacion ?? '').trim();
  const obs = normalizarObs(obsRaw);
  const vacia = obs === '';
  const clienteParsed = String(d?.cliente_destino || '').trim();
  const retLibr = textoIndicaRetiroLibrillos(obsRaw);
  const ovGut = reglaOverrideGutierrezCarviscol(d?.propietario, obsRaw);
  const ag = ovGut
    ? { codigo: ovGut.codigo, etiqueta: ovGut.etiqueta }
    : agrupacionDesdeObservacionCompleta(obsRaw, clienteParsed);

  const tieneRetiro =
    retLibr || !!clienteParsed || CODIGOS_RETIRO_COMERCIAL.has(ag.codigo);

  const tieneCrudas = /\bCRUDAS?\b/.test(obs);
  const tieneAcond = /\bACONDICIONAMIENTO\b/.test(obs);

  const casoSoloCrudas = tieneCrudas && !tieneRetiro;
  const casoSoloRetiro = tieneRetiro && !tieneCrudas;
  const casoCrudasMasRetiro = tieneCrudas && tieneRetiro;
  const casoAcond = tieneAcond && !tieneRetiro;

  const librillo = casoSoloRetiro || casoCrudasMasRetiro;
  const viscera =
    vacia || casoSoloCrudas || casoCrudasMasRetiro || casoAcond || (!tieneRetiro && !vacia);
  const visceraCruda = casoSoloCrudas || casoCrudasMasRetiro;

  return {
    librillo,
    viscera,
    visceraCruda,
    vacia,
    tieneRetiro,
    tieneCrudas,
    tieneAcond,
  };
}

export function esVistaHistorialLibrillos(d) {
  return clasificarMovimiento(d).tieneRetiro;
}

export function esVistaHistorialCrudasSolo(d) {
  const obs = normalizarObs(String(d?.observaciones ?? d?.observacion ?? ''));
  return /\bCRUDAS?\b/.test(obs);
}
