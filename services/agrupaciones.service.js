import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/agrupaciones-librillos.json');

let cached = null;

function cargarConfig() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    cached = JSON.parse(raw);
  } catch {
    cached = { grupos: [], default: { codigo: 'otros', etiqueta: 'Otros' }, sin_destino: { codigo: 'sin_destino', etiqueta: 'Sin destino' } };
  }
  return cached;
}

/** Normaliza texto de cliente destino para comparar alias (sin acentos, minúsculas). */
export function normalizarClienteDestino(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resuelve agrupación comercial a partir del texto en observación (cliente destino).
 * Coincidencia por subcadena; se priorizan alias más largos para evitar que "asurcarnes"
 * absorba "asurcarnescol".
 */
export function agrupacionDesdeClienteDestino(clienteDestino) {
  const cfg = cargarConfig();
  const n = normalizarClienteDestino(clienteDestino);
  if (!n) {
    return {
      codigo: cfg.sin_destino?.codigo || 'sin_destino',
      etiqueta: cfg.sin_destino?.etiqueta || 'Sin destino (retiro)',
    };
  }

  const pares = [];
  for (const g of cfg.grupos || []) {
    for (const a of g.alias || []) {
      const na = normalizarClienteDestino(a);
      if (!na) continue;
      pares.push({
        alias: na,
        len: na.length,
        codigo: g.codigo,
        etiqueta: g.etiqueta,
      });
    }
  }
  pares.sort((a, b) => b.len - a.len);

  for (const p of pares) {
    // Alias muy cortos (ej. "cat"): solo coincidencia exacta para no confundir con otras palabras.
    if (p.len <= 4) {
      if (n === p.alias) return { codigo: p.codigo, etiqueta: p.etiqueta };
      continue;
    }
    if (n === p.alias || n.includes(p.alias)) {
      return { codigo: p.codigo, etiqueta: p.etiqueta };
    }
  }

  return {
    codigo: cfg.default?.codigo || 'otros',
    etiqueta: cfg.default?.etiqueta || 'Otros',
  };
}
