import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ajusteClasificacionPorFechaId } from '../services/librillos/ajustes-clasificacion.js';

describe('ajusteClasificacionPorFechaId', () => {
  it('recupera la observacion historica de Juan Rueda para el 18 de mayo', () => {
    const ajuste = ajusteClasificacionPorFechaId('2026-05-18', '2605-07038');

    assert.equal(ajuste.observacion, 'RETIRAR LIBRILLOS JUAN RUEDA');
  });
});
