import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * KPI plan vs insensibilización: totales sobre planillado; planillaje tardío no es pendiente.
 */
function contarPlanInsens({ planIds, insensTurno, insensAnterior }) {
  const plan = new Set(planIds);
  const turno = new Set(insensTurno);
  const anterior = new Set(insensAnterior);
  let planConInsens = 0;
  let planSinInsens = 0;
  let planInsensFechaAnterior = 0;
  plan.forEach((id) => {
    if (turno.has(id)) planConInsens += 1;
    else if (anterior.has(id)) {
      planConInsens += 1;
      planInsensFechaAnterior += 1;
    } else planSinInsens += 1;
  });
  return {
    planConInsens,
    planSinInsens,
    planInsensFechaAnterior,
    totalPlanPlanillado: plan.size,
  };
}

describe('plan insensibilizado fecha anterior', () => {
  it('planillaje tardío cuenta en plan total pero no como pendiente', () => {
    const r = contarPlanInsens({
      planIds: ['a', 'b', 'c', 'd', 'e'],
      insensTurno: ['a', 'b'],
      insensAnterior: ['c', 'd'],
    });
    assert.equal(r.totalPlanPlanillado, 5);
    assert.equal(r.planInsensFechaAnterior, 2);
    assert.equal(r.planConInsens, 4);
    assert.equal(r.planSinInsens, 1);
  });

  it('planillado = insens turno + insens anterior + pendientes', () => {
    const planIds = ['1', '2', '3', '4'];
    const r = contarPlanInsens({
      planIds,
      insensTurno: ['1', '2', '3'],
      insensAnterior: ['4'],
    });
    assert.equal(r.totalPlanPlanillado, 4);
    assert.equal(r.planConInsens + r.planSinInsens, planIds.length);
    assert.equal(r.planSinInsens, 0);
  });
});
