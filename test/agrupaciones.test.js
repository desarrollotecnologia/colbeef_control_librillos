import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarAgrupacionConAuditoria } from '../services/agrupaciones.service.js';
import { parsearObservacion } from '../services/librillos/observacion.parser.js';
import { textoIndicaRetiroLibrillos } from '../config/plan-faena-obs.js';

describe('clasificarAgrupacionConAuditoria', () => {
  it('clasifica RETIRAR LIBRILLOS JUAN RUEDA como derivados', () => {
    const ag = clasificarAgrupacionConAuditoria('RETIRAR LIBRILLOS JUAN RUEDA');

    assert.equal(ag.codigo, 'derivados_carnicos');
    assert.equal(ag.regla, 'match_derivados_keywords');
  });

  it('no manda a cocidos si escriben RRETIRAR LIBRILLOS ASURCARNES', () => {
    const obs = 'RRETIRAR LIBRILLOS ASURCARNES';
    assert.equal(textoIndicaRetiroLibrillos(obs), true);
    const p = parsearObservacion(obs);
    assert.match(String(p.cliente_destino || ''), /ASURCARNES/i);
    const ag = clasificarAgrupacionConAuditoria(obs, p.cliente_destino);
    assert.equal(ag.codigo, 'asurcarnes');
    assert.notEqual(ag.codigo, 'cocidos');
  });

  it('tolera typo ASUCARNES y RETRAR LIBRILLOS', () => {
    const ag = clasificarAgrupacionConAuditoria('RETRAR LIBRILLOS ASUCARNES');
    assert.equal(ag.codigo, 'asurcarnes');
  });

  it('tolera typo en derivados', () => {
    const ag = clasificarAgrupacionConAuditoria('RRETIRAR LIBRILLOS DERIVADOS CARNICOS');
    assert.equal(ag.codigo, 'derivados_carnicos');
  });

  it('sigue clasificando CAT con retiro canónico', () => {
    const ag = clasificarAgrupacionConAuditoria('RETIRAR LIBRILLOS CAT');
    assert.equal(ag.codigo, 'cat');
  });
});
