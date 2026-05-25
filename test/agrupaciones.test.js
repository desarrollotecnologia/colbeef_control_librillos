import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarAgrupacionConAuditoria } from '../services/agrupaciones.service.js';

describe('clasificarAgrupacionConAuditoria', () => {
  it('clasifica RETIRAR LIBRILLOS JUAN RUEDA como derivados', () => {
    const ag = clasificarAgrupacionConAuditoria('RETIRAR LIBRILLOS JUAN RUEDA');

    assert.equal(ag.codigo, 'derivados_carnicos');
    assert.equal(ag.regla, 'match_derivados_keywords');
  });
});
