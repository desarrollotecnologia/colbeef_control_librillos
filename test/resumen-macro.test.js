import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularResumenMacro } from '../services/librillos/resumen-macro.js';

describe('calcularResumenMacro', () => {
  it('cuenta chunchullas crudas sin estilo bogota', () => {
    const rows = [
      { agrupacion_codigo: 'cat', observaciones: 'CRUDAS', sucursal: 'X' },
      { agrupacion_codigo: 'cat', observaciones: 'ESTILO BOGOTA', sucursal: 'X' },
    ];
    const r = calcularResumenMacro('2026-05-20', rows, null, {});
    assert.equal(r.categorias.chunchullas_crudas, 1);
    assert.equal(r.categorias.estilo_bogota, 1);
  });

  it('asurcarnes sin texto → cocidos en resumen', () => {
    const rows = [{ agrupacion_codigo: 'asurcarnes', observaciones: '', pendiente_registro_parte: false }];
    const r = calcularResumenMacro('2026-05-20', rows, null, {});
    assert.equal(r.categorias.cocidos, 1);
  });

  it('cuenta canuta o canutas en observación', () => {
    const rows = [
      { agrupacion_codigo: 'cat', observaciones: 'RETIRAR LIBRILLOS CANUTAS' },
      { agrupacion_codigo: 'cat', observaciones: 'canuta para derivados' },
      { agrupacion_codigo: 'cat', observaciones: 'DERIVADOS' },
    ];
    const r = calcularResumenMacro('2026-05-20', rows, null, {});
    assert.equal(r.categorias.canutas, 2);
  });
});
