import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Lógica esperada del KPI plan vs insensibilización (documentada para regresión).
 */
function contarPlanInsens({ planIds, insensTurno, insensAnterior }) {
  const plan = new Set(planIds);
  const turno = new Set(insensTurno);
  const anterior = new Set(insensAnterior);
  let planConInsens = 0;
  let planSinInsens = 0;
  let planInsensFechaAnterior = 0;
  plan.forEach((id) => {
    if (anterior.has(id)) {
      planInsensFechaAnterior += 1;
      return;
    }
    if (turno.has(id)) planConInsens += 1;
    else planSinInsens += 1;
  });
  const totalPlanOperativo = planConInsens + planSinInsens;
  return {
    planConInsens,
    planSinInsens,
    planInsensFechaAnterior,
    totalPlanOperativo,
    totalPlanPlanillado: plan.size,
  };
}

describe('plan insensibilizado fecha anterior', () => {
  it('excluye del pendiente y del total operativo reses ya sacrificadas antes del plan', () => {
    const r = contarPlanInsens({
      planIds: ['a', 'b', 'c', 'd', 'e'],
      insensTurno: ['a', 'b'],
      insensAnterior: ['c', 'd'],
    });
    assert.equal(r.totalPlanOperativo, 3);
    assert.equal(r.totalPlanPlanillado, 5);
    assert.equal(r.planInsensFechaAnterior, 2);
    assert.equal(r.planConInsens, 2);
    assert.equal(r.planSinInsens, 1);
  });

  it('total operativo = insens + pendientes sin planillaje tardío', () => {
    const planIds = ['1', '2', '3', '4'];
    const r = contarPlanInsens({
      planIds,
      insensTurno: ['1', '2', '3'],
      insensAnterior: ['4'],
    });
    assert.equal(r.totalPlanOperativo, 3);
    assert.equal(r.totalPlanPlanillado, 4);
    assert.equal(r.planConInsens + r.planSinInsens, r.totalPlanOperativo);
    assert.equal(r.planSinInsens, 0);
  });
});
