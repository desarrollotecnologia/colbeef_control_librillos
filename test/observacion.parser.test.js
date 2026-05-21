import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsearObservacion } from '../services/librillos/observacion.parser.js';

describe('parsearObservacion', () => {
  it('vacío devuelve nulls', () => {
    const r = parsearObservacion('');
    assert.equal(r.observacion, null);
    assert.equal(r.cliente_destino, null);
    assert.equal(r.plaza, null);
  });

  it('extrae cliente tras RETIRAR LIBRILLOS', () => {
    const r = parsearObservacion(
      'ZONA - 01014 CAVA ( RETIRAR LIBRILLOS PARA DERIVADOS CARNICOS )'
    );
    assert.equal(r.cliente_destino, 'DERIVADOS CARNICOS');
    assert.ok(r.plaza?.includes('CAVA') || r.plaza === '01014 CAVA');
  });

  it('detecta CRUDAS en observación limpia', () => {
    const r = parsearObservacion('COLBEEF - PLAZA X ( CRUDAS ESTILO BOGOTA )');
    assert.match(String(r.observacion || ''), /CRUDAS/i);
  });
});
