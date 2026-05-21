import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarMovimiento } from '../services/clasificacion-movimiento.service.js';

describe('clasificarMovimiento', () => {
  it('solo retiro → librillo, no cruda', () => {
    const c = clasificarMovimiento({
      observaciones: 'RETIRAR LIBRILLOS PARA ASURCARNES',
      cliente_destino: 'ASURCARNES',
    });
    assert.equal(c.tieneRetiro, true);
    assert.equal(c.librillo, true);
    assert.equal(c.visceraCruda, false);
  });

  it('solo CRUDAS → víscera cruda', () => {
    const c = clasificarMovimiento({ observaciones: 'CRUDAS PARA OLIMPICA' });
    assert.equal(c.tieneCrudas, true);
    assert.equal(c.visceraCruda, true);
    assert.equal(c.librillo, false);
  });

  it('CRUDAS + retiro → librillo y cruda', () => {
    const c = clasificarMovimiento({
      observaciones: 'RETIRAR LIBRILLOS PARA CAT CRUDAS',
      cliente_destino: 'CAT',
    });
    assert.equal(c.librillo, true);
    assert.equal(c.visceraCruda, true);
  });
});
