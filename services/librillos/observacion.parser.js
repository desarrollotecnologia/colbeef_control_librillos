/**
 * Parseo de observaciones plan/parte (retiro librillos, plaza, cliente).
 * Tolera typos de RETIRAR LIBRILLOS y destinos comerciales.
 */

import {
  RX_RETIRO_LIBRILLOS_CAPTURE,
  RX_RETIRO_LIBRILLOS_STRIP,
  normalizarObservacionComercial,
} from '../../config/obs-typo-normalizer.js';

const RX_COLA_PLAN_FAENA =
  /\b(?:VISCERAS?\s+PARA|VISCERAS?|ACONDICIONAMIENTO|DESPOSTE|CONGELACION|CARNES?\s+DE)\b[\s\S]*$/i;

function plazaLogisticaTrasGuion(antesParentesis) {
  const s = String(antesParentesis || '')
    .trim()
    .replace(/\s*\.\s*$/, '');
  if (!s) return null;
  const m = s.match(/^(.+?)\s*-\s*(.+)$/s);
  if (m && String(m[2]).trim()) return String(m[2]).trim().replace(/\s*\.\s*$/, '');
  return s;
}

function plazaDesdeTextoLimpio(limpio) {
  if (!limpio) return null;
  const antes = limpio
    .replace(/^COLBEEF\s+S\.A\.S\s*[-–]\s*/i, '')
    .split('(')[0]
    .trim()
    .replace(/\s*\.\s*$/, '');
  return plazaLogisticaTrasGuion(antes);
}

function limpiarClienteRetiro(raw) {
  const c = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!c) return null;
  const sinCola = c.replace(RX_COLA_PLAN_FAENA, '').replace(/\s+/g, ' ').trim();
  return (sinCola || c).replace(/\s*[-–:,.;]\s*$/, '').trim() || null;
}

export function parsearObservacion(obs) {
  if (!obs || obs.trim() === '') {
    return { observacion: null, cliente_destino: null, plaza: null };
  }
  // Corrige typos (RRETIRAR, ASUCARNES, etc.) antes de extraer destino
  const src = normalizarObservacionComercial(String(obs).replace(/\r\n/g, '\n'));

  let cliente = null;
  let m = null;
  const rxCap = new RegExp(RX_RETIRO_LIBRILLOS_CAPTURE.source, RX_RETIRO_LIBRILLOS_CAPTURE.flags);
  while ((m = rxCap.exec(src)) !== null) {
    const c = limpiarClienteRetiro(m?.[1] || '');
    if (c) cliente = c;
  }

  const limpio = src.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const plaza = plazaDesdeTextoLimpio(limpio);

  let sinRetiro = limpio
    .replace(RX_RETIRO_LIBRILLOS_STRIP, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  sinRetiro = sinRetiro.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();

  const observacion = sinRetiro || null;
  return { observacion, cliente_destino: cliente || null, plaza };
}
